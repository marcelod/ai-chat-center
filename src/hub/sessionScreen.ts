// The screen of a background session in the side panel (spec 2026-11-26-side-panel): `claude logs <bgId>`
// prints the session's recent terminal output, read only. That screen holds the /cc link with the app token
// and the "AI Chat Center key" line, so the text is cleaned before it leaves the hub: terminal codes out,
// every app address out, the token, keys and secret out, and any long hex run (a token cut by the terminal
// width) out.
// The output is a terminal stream, not text (spec 2026-11-27-session-screen-terminal): cursor moves redraw
// the same lines (every frame of "thinking…") and "cursor forward" stands for spaces. renderScreen plays it
// in a headless terminal and keeps only the final screen; screenText then cleans that screen.
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import xtermHeadless from '@xterm/headless';
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
const APP_URL = /(?:[a-z][a-z0-9+.-]{0,31}:\/\/)?(?:127\.\d+\.\d+\.\d+|localhost|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:[/?#]\S*)?/gi;
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
  s = redactSecretPieces(s.split('\n').map((l) => l.trimEnd()).join('\n'), secrets);
  s = s.replace(APP_URL, '[app link removed]').replace(LINK_PARTS, '[app link removed]').replace(HEX_RUN, '[redacted]');
  s = s
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n+$/, '');
  return s.length > MAX_SCREEN_CHARS ? s.slice(s.length - MAX_SCREEN_CHARS) : s;
}

/** How much of the end of the stream is played: the screen is redrawn often, the end holds the last frame. */
export const MAX_RENDER_BYTES = 512 * 1024;
const RENDER_TIMEOUT_MS = 5_000;
/** `claude logs` draws at the session's size, 200x50 when seen live (Claude Code 2.1.3xx), whatever COLUMNS says. */
const MIN_COLS = 200;
const MIN_ROWS = 50;
const MAX_COLS = 400;
const MAX_ROWS = 200;
/** A piece of a secret this long at the edge of a line (the rest on the next one) is removed too. */
const MIN_SECRET_PIECE = 6;

/* eslint-disable no-control-regex */
const CUP = /\x1b\[(\d*)(?:;(\d*))?[Hf]/g;
const VPA = /\x1b\[(\d+)d/g;
const CHA = /\x1b\[(\d+)[G`]/g;
/* eslint-enable no-control-regex */

/**
 * The terminal size to play the stream at: never smaller than the size `claude logs` draws at, and as large
 * as the furthest row and column the stream moves the cursor to (a session attached from a bigger window).
 * A bigger terminal does no harm: the stream places its lines with absolute moves and never scrolls.
 */
export function screenSize(raw: string): { cols: number; rows: number } {
  let rows = MIN_ROWS;
  let cols = MIN_COLS;
  for (const m of raw.matchAll(CUP)) {
    rows = Math.max(rows, Number(m[1] || 1));
    cols = Math.max(cols, Number(m[2] || 1));
  }
  for (const m of raw.matchAll(VPA)) rows = Math.max(rows, Number(m[1]));
  for (const m of raw.matchAll(CHA)) cols = Math.max(cols, Number(m[1]));
  return { cols: Math.min(cols, MAX_COLS), rows: Math.min(rows, MAX_ROWS) };
}

/**
 * The final screen of a terminal stream, as text: played in a headless terminal (one per call, disposed at
 * the end, no scrollback), the visible lines read back, the lines the terminal wrapped joined again, and the
 * empty lines above and below dropped. Not cleaned: see screenText.
 */
export async function renderScreen(raw: string, size: { cols: number; rows: number } = screenSize(raw)): Promise<string> {
  const data = raw.length > MAX_RENDER_BYTES ? raw.slice(raw.length - MAX_RENDER_BYTES) : raw;
  // allowProposedApi: reading the buffer back is a "proposed" API in the headless build.
  const term = new xtermHeadless.Terminal({ cols: size.cols, rows: size.rows, scrollback: 0, convertEol: true, logLevel: 'off', allowProposedApi: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the screen took too long to draw')), RENDER_TIMEOUT_MS);
      term.write(data, () => {
        clearTimeout(timer);
        resolve();
      });
    });
    const buf = term.buffer.active;
    const lines: string[] = [];
    for (let y = buf.baseY; y < buf.baseY + term.rows; y++) {
      const line = buf.getLine(y);
      if (!line) continue;
      const text = line.translateToString(true);
      if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += text;
      else lines.push(text);
    }
    const out = lines.map((l) => l.trimEnd());
    while (out.length > 0 && out[out.length - 1] === '') out.pop();
    while (out.length > 0 && out[0] === '') out.shift();
    return out.join('\n');
  } finally {
    term.dispose();
  }
}

/**
 * The screen as the app shows it: the stream played as a terminal would, then cleaned (cleanScreen). When the
 * terminal cannot play it, the codes are only stripped, as before.
 */
export async function screenText(raw: string, secrets: string[], size?: { cols: number; rows: number }): Promise<string> {
  let screen: string;
  try {
    screen = await renderScreen(raw, size);
  } catch {
    screen = raw;
  }
  return cleanScreen(screen, secrets);
}

/** Removes the start of a secret left at the end of a line and its end at the start of the next one. */
function redactSecretPieces(s: string, secrets: string[]): string {
  const long = secrets.filter((x) => x && x.length > MIN_SECRET_PIECE);
  if (long.length === 0) return s;
  return s
    .split('\n')
    .map((line) => {
      for (const secret of long) {
        for (let k = secret.length - 1; k >= MIN_SECRET_PIECE; k--) {
          if (line.endsWith(secret.slice(0, k))) {
            line = line.slice(0, line.length - k) + '[redacted]';
            break;
          }
        }
        const indent = line.length - line.trimStart().length;
        for (let k = secret.length - 1; k >= MIN_SECRET_PIECE; k--) {
          if (line.startsWith(secret.slice(secret.length - k), indent)) {
            line = line.slice(0, indent) + '[redacted]' + line.slice(indent + k);
            break;
          }
        }
      }
      return line;
    })
    .join('\n');
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
