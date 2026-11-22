#!/usr/bin/env node
// Drives an interactive `claude` session in a pseudo-terminal for the manual e2e checks
// (docs/testing/e2e-results.md). Not run in CI: it spends tokens.
//
// Approach: node-pty spawns the real `claude` TUI; @xterm/headless renders its output so the
// current screen can be dumped as plain text. Keystrokes come from a "keys" file, which the
// driver consumes (Node port of a Python `pty` spike: log the screen, read keys from a file).
//
// Usage:
//   node scripts/e2e/drive-session.mjs run  --dir <project> --state <dir> [--max-secs 1800] -- <claude args...>
//   node scripts/e2e/drive-session.mjs send --state <dir> <chunk> [<chunk>...]
//   node scripts/e2e/drive-session.mjs screen --state <dir>
//   node scripts/e2e/drive-session.mjs wait --state <dir> --text <substring> [--secs 60]
//
// <state> holds: raw.log (all pty output), screen.txt (rendered screen, refreshed every 500 ms),
// keys (pending chunks, one JSON string per line), pid (the claude pid), exit (exit code).
// Each `send` chunk is written separately with a 400 ms pause, so "text" then "\r" is typed and
// then submitted (sending both in one write can be taken as a paste). Chunks accept the escapes
// \r \n \t \e \xHH \uHHHH and \\ ; handy keys: "\r" Enter, "\e" Esc, "\e[B" Down, "\e[Z" Shift+Tab
// (cycles the permission mode), "\x03" Ctrl-C. Killing the `run` process closes the terminal.
//
// Pick the model with `-- --model <name>` at launch. Do NOT type `/model` in a driven session:
// it saves the choice as the default model in the user's ~/.claude/settings.json.
// Isolation: export AI_CHAT_CENTER_HOME (scratch dir), AI_CHAT_CENTER_PORT and
// CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1 before `run`; the env is passed to claude and its hooks.
import fs from 'node:fs';
import path from 'node:path';

const [, , cmd, ...rest] = process.argv;

function parseArgs(argv) {
  const opts = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      opts._tail = argv.slice(i + 1);
      break;
    }
    if (a.startsWith('--')) opts[a.slice(2)] = argv[++i];
    else pos.push(a);
  }
  return { opts, pos };
}

function unescapeKeys(s) {
  return s.replace(/\\(r|n|t|e|\\|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/g, (_, c) => {
    if (c === 'r') return '\r';
    if (c === 'n') return '\n';
    if (c === 't') return '\t';
    if (c === 'e') return '\x1b';
    if (c === '\\') return '\\';
    return String.fromCharCode(parseInt(c.slice(1), 16));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const files = (state) => ({
  raw: path.join(state, 'raw.log'),
  screen: path.join(state, 'screen.txt'),
  keys: path.join(state, 'keys'),
  pid: path.join(state, 'pid'),
  exit: path.join(state, 'exit'),
});

async function run(opts) {
  const { default: pty } = await import('node-pty');
  const { default: xterm } = await import('@xterm/headless');
  const state = path.resolve(opts.state);
  const f = files(state);
  fs.mkdirSync(state, { recursive: true });
  for (const p of [f.keys, f.exit]) fs.rmSync(p, { force: true });
  const cols = 160;
  const rows = 50;
  const args = opts._tail ?? [];
  const term = new xterm.Terminal({ cols, rows, allowProposedApi: true, scrollback: 2000 });
  const child = pty.spawn('claude', args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: path.resolve(opts.dir),
    env: { ...process.env, TERM: 'xterm-256color' },
  });
  fs.writeFileSync(f.pid, String(child.pid));
  const raw = fs.createWriteStream(f.raw, { flags: 'a' });
  child.onData((d) => {
    raw.write(d);
    term.write(d);
  });

  const dumpScreen = () => {
    const buf = term.buffer.active;
    const lines = [];
    for (let i = buf.viewportY; i < buf.viewportY + rows; i++) {
      lines.push((buf.getLine(i)?.translateToString(true) ?? '').trimEnd());
    }
    fs.writeFileSync(f.screen, lines.join('\n') + '\n');
  };

  let exited = false;
  child.onExit(({ exitCode, signal }) => {
    exited = true;
    dumpScreen();
    fs.writeFileSync(f.exit, JSON.stringify({ exitCode, signal }));
  });

  const deadline = Date.now() + Number(opts['max-secs'] ?? 1800) * 1000;
  const onSignal = () => {
    try {
      child.kill();
    } catch {}
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);

  while (!exited) {
    if (Date.now() > deadline) {
      child.kill();
      break;
    }
    if (fs.existsSync(f.keys)) {
      const tmp = f.keys + '.taken';
      fs.renameSync(f.keys, tmp);
      const chunks = fs.readFileSync(tmp, 'utf8').split('\n').filter(Boolean);
      fs.rmSync(tmp, { force: true });
      for (const line of chunks) {
        child.write(unescapeKeys(JSON.parse(line)));
        await sleep(400);
      }
    }
    dumpScreen();
    await sleep(500);
  }
  await sleep(300);
  raw.end();
  process.exit(0);
}

function send(opts, chunks) {
  const f = files(path.resolve(opts.state));
  fs.appendFileSync(f.keys, chunks.map((c) => JSON.stringify(c)).join('\n') + '\n');
}

function screen(opts) {
  process.stdout.write(fs.readFileSync(files(path.resolve(opts.state)).screen, 'utf8'));
}

async function wait(opts) {
  const f = files(path.resolve(opts.state));
  const end = Date.now() + Number(opts.secs ?? 60) * 1000;
  while (Date.now() < end) {
    const s = fs.existsSync(f.screen) ? fs.readFileSync(f.screen, 'utf8') : '';
    if (s.includes(opts.text)) {
      console.log('found');
      return;
    }
    await sleep(500);
  }
  console.log('timeout');
  process.exitCode = 1;
}

const { opts, pos } = parseArgs(rest);
if (cmd === 'run') await run(opts);
else if (cmd === 'send') send(opts, pos);
else if (cmd === 'screen') screen(opts);
else if (cmd === 'wait') await wait(opts);
else {
  console.error('usage: drive-session.mjs run|send|screen|wait (see header)');
  process.exitCode = 1;
}
