// Background sessions of Claude Code (spec 2026-11-24-background-sessions): resuming a session with
// `claude --bg --resume <sid> "/ai-chat-center:cc"`, and typing a slash command into a background session
// through `claude attach <id>` in a pseudo-terminal made by `script`. Every contact with those commands is
// here: their output is not a stable API, so any surprise ends in an error, never in something stuck.
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
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
 * session that writes no transcript (issue #2). CLAUDE_CONFIG_DIR is set only for a session that ran with a
 * custom one (see configDirFor).
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

/**
 * The CLAUDE_CONFIG_DIR to pass for a session, or undefined for the default ~/.claude. Never pass the default
 * explicitly: with CLAUDE_CONFIG_DIR set, Claude Code reads its global config (folder trust included) from
 * <dir>/.claude.json instead of ~/.claude.json, and `claude --bg` then refuses every folder as not trusted
 * (seen live with 0.5.0).
 */
export function configDirFor(configDir: string | undefined, home: string = os.homedir(), platform: NodeJS.Platform = process.platform): string | undefined {
  if (!configDir) return undefined;
  const a = path.resolve(configDir);
  const b = path.resolve(home, '.claude');
  const same = platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  return same ? undefined : configDir;
}

export interface BgDeps {
  spawn?: Spawn;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** The home folder (default os.homedir()), for configDirFor. */
  home?: string;
}

export type ResumeResult = { ok: true } | { ok: false; error: string };
export type StartResult = { ok: true; bgId?: string } | { ok: false; error: string };

const RESUME_TIMEOUT_MS = 60_000;
const MAX_ERROR = 500;

/**
 * Runs `claude --bg <args>` in `cwd`. `claude --bg` returns as soon as the session runs in the background:
 * exit 0 is success, with its output (the short id is in it); anything else gives the first lines of its
 * output as the error ("Workspace not trusted", claude missing...).
 */
function runBg(args: string[], cwd: string, configDir: string | undefined, deps: BgDeps): Promise<{ ok: true; out: string } | { ok: false; error: string }> {
  const platform = deps.platform ?? process.platform;
  const win = platform === 'win32';
  const spawn = deps.spawn ?? (nodeSpawn as Spawn);
  // Windows: `claude` is a .cmd shim and needs the shell; the line is built from validated values only
  // (see winQuote, and runClaudeAgentsJson for why it is one string).
  const cmd = win ? ['claude', '--bg', ...args.map(winQuote)].join(' ') : 'claude';
  const argv = win ? [] : ['--bg', ...args];
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (r: { ok: true; out: string } | { ok: false; error: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    let child: ChildProcess;
    try {
      child = spawn(cmd, argv, {
        cwd,
        env: cleanEnv(deps.env ?? process.env, configDirFor(configDir, deps.home, platform)),
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
      if (code === 0) return finish({ ok: true, out: stripAnsi(out) });
      finish({ ok: false, error: stripAnsi(out).trim().slice(0, MAX_ERROR) || `claude exited with code ${code}` });
    });
  });
}

/** Quotes one argument for the Windows command line. Only ever given values checked by the validators here. */
function winQuote(a: string): string {
  return /^[\w:./-]+$/.test(a) ? a : `"${a}"`;
}

/** Runs `claude --bg --resume <sid> "/ai-chat-center:cc"` in the session's folder. */
export async function resumeInBackground(reg: Registration, deps: BgDeps = {}): Promise<ResumeResult> {
  assertSessionId(reg.sessionId);
  const r = await runBg(['--resume', reg.sessionId, RESUME_PROMPT], reg.cwd, reg.configDir, deps);
  return r.ok ? { ok: true } : r;
}

/** Reasoning effort levels `claude --effort` takes. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];
export const isEffort = (v: unknown): v is Effort => typeof v === 'string' && (EFFORTS as readonly string[]).includes(v);
/** A model alias or id (`opus`, `sonnet`, `claude-opus-5-5`, `opus[1m]`). */
export const isModel = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(\[1m\])?$/.test(v);
export const MAX_NAME = 60;
/** A session name: letters, digits, spaces and . _ - only (it goes on a Windows command line). */
export const isSessionName = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= MAX_NAME && /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(v) && v.trim() === v;

export interface NewSession {
  cwd: string;
  name?: string;
  model?: string;
  effort?: Effort;
  /** The Claude config dir to run with (undefined: the default). */
  configDir?: string;
}

/** The short id in the output of `claude --bg` (the last 8-hex word), when it shows one. */
export function bgIdFromOutput(out: string): string | undefined {
  const all = out.match(/\b[0-9a-f]{8}\b/g);
  return all?.[all.length - 1];
}

/**
 * Starts a new background session in `cwd` that connects to the app at once: `claude --bg [-n name]
 * [--model m] [--effort e] "/ai-chat-center:cc"` (spec 2026-11-25-app-batch). Every value is validated.
 */
export async function startInBackground(s: NewSession, deps: BgDeps = {}): Promise<StartResult> {
  if (s.name !== undefined && !isSessionName(s.name)) throw new Error('invalid session name');
  if (s.model !== undefined && !isModel(s.model)) throw new Error('invalid model');
  if (s.effort !== undefined && !isEffort(s.effort)) throw new Error('invalid effort');
  const args = [
    ...(s.name ? ['-n', s.name] : []),
    ...(s.model ? ['--model', s.model] : []),
    ...(s.effort ? ['--effort', s.effort] : []),
    RESUME_PROMPT,
  ];
  const r = await runBg(args, s.cwd, s.configDir, deps);
  return r.ok ? { ok: true, bgId: bgIdFromOutput(r.out) } : r;
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
