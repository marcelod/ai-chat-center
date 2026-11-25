// Background sessions of Claude Code (spec 2026-11-24-background-sessions): resuming a session with
// `claude --bg --resume <sid> "/ai-chat-center:cc"`, and typing a slash command into a background session
// through `claude attach <id>` in a pseudo-terminal made by `script`. Every contact with those commands is
// here: their output is not a stable API, so any surprise ends in an error, never in something stuck.
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import os from 'node:os';
import type { Registration } from '../core/registry.js';
import { assertSessionId } from '../core/paths.js';

export type Spawn = (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess;

/** The short id `claude agents --json` gives a background session. */
const BG_ID_RE = /^[0-9a-f]{8}$/;
export const isBgId = (id: unknown): id is string => typeof id === 'string' && BG_ID_RE.test(id);

export const MAX_COMMAND = 200;
/** A slash command the app may type: one line, printable, starting with `/` and a command name. */
export function isValidCommand(text: unknown): text is string {
  if (typeof text !== 'string' || text.length > MAX_COMMAND) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(text)) return false;
  return /^\/[A-Za-z0-9][\w:.-]*( .*)?$/.test(text);
}

/** The command `/cc` that reconnects a resumed session to the app (as if the user typed it). */
export const RESUME_PROMPT = '/ai-chat-center:cc';

/**
 * The environment for a `claude` started by the hub: without the variables of the session that started the
 * hub (CLAUDECODE, CLAUDE_CODE_*, CLAUDE_PID, CLAUDE_EFFORT). Inherited, they make the new claude a child
 * session that writes no transcript (issue #2). CLAUDE_CONFIG_DIR is the session's own.
 */
export function cleanEnv(env: NodeJS.ProcessEnv, configDir?: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k === 'CLAUDE_PID' || k === 'CLAUDE_EFFORT' || k === 'CLAUDE_CONFIG_DIR') continue;
    out[k] = v;
  }
  if (configDir) out.CLAUDE_CONFIG_DIR = configDir;
  return out;
}

export interface BgDeps {
  spawn?: Spawn;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

export type ResumeResult = { ok: true } | { ok: false; error: string };

const RESUME_TIMEOUT_MS = 60_000;
const MAX_ERROR = 500;

/**
 * Runs `claude --bg --resume <sid> "/ai-chat-center:cc"` in the session's folder. `claude --bg` returns as
 * soon as the session runs in the background: exit 0 is success; anything else gives the first lines of its
 * output as the error ("Workspace not trusted", claude missing...).
 */
export async function resumeInBackground(reg: Registration, deps: BgDeps = {}): Promise<ResumeResult> {
  assertSessionId(reg.sessionId);
  const platform = deps.platform ?? process.platform;
  const win = platform === 'win32';
  const spawn = deps.spawn ?? (nodeSpawn as Spawn);
  // Windows: `claude` is a .cmd shim and needs the shell; the line is built from a validated uuid and a
  // constant only (see runClaudeAgentsJson for why it is one string).
  const cmd = win ? `claude --bg --resume ${reg.sessionId} ${RESUME_PROMPT}` : 'claude';
  const args = win ? [] : ['--bg', '--resume', reg.sessionId, RESUME_PROMPT];
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (r: ResumeResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    let child: ChildProcess;
    try {
      child = spawn(cmd, args, {
        cwd: reg.cwd,
        env: cleanEnv(deps.env ?? process.env, reg.configDir),
        shell: win,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      return resolve({ ok: false, error: (e as Error).message });
    }
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, error: 'claude --bg did not answer in 60 s' });
    }, RESUME_TIMEOUT_MS);
    const collect = (d: Buffer | string) => {
      if (out.length < 4 * MAX_ERROR) out += String(d);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', (e) => finish({ ok: false, error: e.message }));
    child.on('close', (code) => {
      if (code === 0) return finish({ ok: true });
      finish({ ok: false, error: stripAnsi(out).trim().slice(0, MAX_ERROR) || `claude exited with code ${code}` });
    });
  });
}

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '');

export class CommandUnsupportedError extends Error {
  constructor() {
    super('commands from the app are not available on Windows yet');
    this.name = 'CommandUnsupportedError';
  }
}

export interface TypeDeps extends BgDeps {
  /** How long to wait for the prompt (❯) to show. */
  promptTimeoutMs?: number;
  /** Pause after the prompt shows, before typing (the screen is still drawing). */
  settleMs?: number;
  /** Pause between the text and Enter, and after Enter before closing the attach. */
  enterDelayMs?: number;
  afterMs?: number;
}

/** `script` arguments that run `claude attach <id>` in a pseudo-terminal (util-linux on Linux, BSD on macOS). */
export function scriptArgs(id: string, platform: NodeJS.Platform): string[] {
  if (!isBgId(id)) throw new Error('invalid background session id');
  if (platform === 'darwin') return ['-q', '/dev/null', 'claude', 'attach', id];
  // util-linux runs the -c line through the shell: it holds a constant and a validated 8-hex id only.
  return ['-qfec', `claude attach ${id}`, '/dev/null'];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Types `text` and Enter into the background session `id`, then closes the attach (the session keeps
 * running: verified live). Rejects when the prompt does not show in time or the attach ends first.
 */
export async function typeCommand(id: string, text: string, deps: TypeDeps = {}): Promise<void> {
  const platform = deps.platform ?? process.platform;
  if (platform === 'win32') throw new CommandUnsupportedError();
  if (!isValidCommand(text)) throw new Error('invalid command');
  const args = scriptArgs(id, platform);
  const spawn = deps.spawn ?? (nodeSpawn as Spawn);
  const child = spawn('script', args, {
    cwd: os.homedir(),
    env: { ...cleanEnv(deps.env ?? process.env), TERM: 'xterm-256color', COLUMNS: '120', LINES: '40' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let exited = false;
  let exitError: Error | null = null;
  const closed = new Promise<void>((resolve) => {
    child.on('error', (e) => {
      exitError = e;
      exited = true;
      resolve();
    });
    child.on('close', () => {
      exited = true;
      resolve();
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      let seen = '';
      const timer = setTimeout(() => reject(new Error('the session prompt did not show')), deps.promptTimeoutMs ?? 10_000);
      const onData = (d: Buffer | string) => {
        seen = (seen + String(d)).slice(-4096);
        if (seen.includes('❯')) {
          clearTimeout(timer);
          child.stdout?.off('data', onData);
          resolve();
        }
      };
      child.stdout?.on('data', onData);
      void closed.then(() => {
        clearTimeout(timer);
        reject(exitError ?? new Error(`claude attach ended: ${stripAnsi(seen).trim().slice(0, MAX_ERROR)}`));
      });
    });
    child.stdout?.resume(); // keep draining the screen so the pty never blocks
    await sleep(deps.settleMs ?? 1000);
    if (exited) throw new Error('claude attach ended');
    child.stdin?.write(text);
    await sleep(deps.enterDelayMs ?? 300);
    child.stdin?.write('\r');
    await sleep(deps.afterMs ?? 2000);
  } finally {
    if (!exited) child.kill();
    child.stderr?.resume();
  }
}
