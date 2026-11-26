// The screen of a background session in the side panel (spec 2026-11-26-side-panel): `claude logs <bgId>`
// prints the session's recent terminal output, read only. That screen holds the /cc link with the app token
// and the "AI Chat Center key" line, so the text is cleaned before it leaves the hub: terminal codes out,
// every app address out, the token, keys and secret out, and any long hex run (a token cut by the terminal
// width) out.
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import { cleanEnv, configDirFor, isBgId, type Spawn } from './bgSessions.js';

export const MAX_SCREEN_CHARS = 200_000;
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 10_000;

/* eslint-disable no-control-regex */
const ANSI = [
  /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, // OSC (window title, hyperlinks)
  /\x1b[P^_][\s\S]*?\x1b\\/g, // DCS, PM, APC
  /\x1b\[[0-?]*[ -/]*[@-~]/g, // CSI (colours, cursor)
  /\x1b[()*+][0-9A-Za-z]/g, // character sets
  /\x1b[@-Z\\-_=>78]/g, // other two-byte escapes
];
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g;
/* eslint-enable no-control-regex */
/** Any address of the hub: the /cc link and anything else on this machine's loopback. */
const APP_URL = /(?:[a-z][a-z0-9+.-]*:\/\/)?(?:127\.\d+\.\d+\.\d+|localhost|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:[/?#]\S*)?/gi;
/** Fragments of the link even without its address (`#token=…`, `#pair=…`). */
const LINK_PARTS = /[#?&](?:token|pair)=\S*/gi;
/** A long hex run: the token, the key, the secret, or a piece of one cut at the end of a line. */
const HEX_RUN = /[0-9a-fA-F]{16,}/g;

/** The screen text without terminal codes and without anything that could open the app. */
export function cleanScreen(raw: string, secrets: string[]): string {
  let s = raw;
  for (const re of ANSI) s = s.replace(re, '');
  s = s.replace(/\r\n?/g, '\n').replace(CONTROL, '');
  for (const secret of secrets) if (secret && secret.length >= 8) s = s.split(secret).join('[redacted]');
  s = s.replace(APP_URL, '[app link removed]').replace(LINK_PARTS, '[app link removed]').replace(HEX_RUN, '[redacted]');
  s = s
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n+$/, '');
  return s.length > MAX_SCREEN_CHARS ? s.slice(s.length - MAX_SCREEN_CHARS) : s;
}

export interface ScreenDeps {
  spawn?: Spawn;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** The session's Claude config dir (`claude logs` only sees the sessions of its own). */
  configDir?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

/**
 * The raw output of `claude logs <bgId>` (not cleaned: see cleanScreen), at most its last `maxBytes`.
 * Rejects on a bad id, on Windows (`claude` needs a shell there), on a timeout and on a failed run; the
 * error never carries the output.
 */
export function readScreen(bgId: string, deps: ScreenDeps = {}): Promise<string> {
  if (!isBgId(bgId)) return Promise.reject(new Error('invalid background session id'));
  const platform = deps.platform ?? process.platform;
  if (platform === 'win32') return Promise.reject(new Error('the session screen is not available on Windows yet'));
  const spawn = deps.spawn ?? (nodeSpawn as Spawn);
  const max = deps.maxBytes ?? MAX_BYTES;
  return new Promise((resolve, reject) => {
    let chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    let child: ChildProcess;
    const finish = (err: Error | null, out?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(out ?? '');
    };
    try {
      child = spawn('claude', ['logs', bgId], {
        cwd: os.homedir(),
        env: { ...cleanEnv(deps.env ?? process.env, configDirFor(deps.configDir, undefined, platform)), COLUMNS: '200' },
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      return reject(new Error('could not run claude logs'));
    }
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('claude logs did not answer'));
    }, deps.timeoutMs ?? TIMEOUT_MS);
    child.stdout?.on('data', (d: Buffer | string) => {
      const b = Buffer.isBuffer(d) ? d : Buffer.from(d);
      chunks.push(b);
      size += b.length;
      if (size > 2 * max) {
        const all = Buffer.concat(chunks);
        chunks = [all.subarray(all.length - max)];
        size = max;
      }
    });
    child.stderr?.resume();
    child.on('error', () => finish(new Error('could not run claude logs')));
    child.on('close', (code) => {
      if (code !== 0) return finish(new Error('claude logs failed'));
      const all = Buffer.concat(chunks);
      finish(null, all.subarray(Math.max(0, all.length - max)).toString('utf8'));
    });
  });
}
