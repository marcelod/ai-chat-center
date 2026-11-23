// Opens the app in its own Chrome/Chromium/Edge window (`--app`), spec 2026-11-23-app-window §2/§3.
// The window never gets the token on its command line (readable through `ps` or /proc/<pid>/cmdline):
// the hook trades it with the hub for a one-time pairing code and opens `#pair=<code>` instead.
import fs from 'node:fs';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';

type Env = Record<string, string | undefined>;
type Spawn = typeof nodeSpawn;

const LINUX_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable'];
const MAC_APPS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];
const WIN_EXES = [
  ['Google', 'Chrome', 'Application', 'chrome.exe'],
  ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
];
const WIN_BASES = ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA'];

/** Path of a Chrome, Chromium or Edge executable (spec §2 order), or null. */
export function findBrowser(
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => boolean = fs.existsSync,
): string | null {
  const ok = (p: string) => {
    try {
      return exists(p);
    } catch {
      return false;
    }
  };
  let candidates: string[];
  if (platform === 'darwin') candidates = MAC_APPS;
  else if (platform === 'win32') {
    const bases = WIN_BASES.map((k) => env[k]).filter((b): b is string => !!b && path.win32.isAbsolute(b));
    candidates = WIN_EXES.flatMap((exe) => bases.map((b) => path.win32.join(b, ...exe)));
  } else {
    // Only absolute PATH entries: a relative one would resolve against the session's cwd.
    const dirs = (env.PATH ?? '').split(path.posix.delimiter).filter((d) => path.posix.isAbsolute(d));
    candidates = LINUX_NAMES.flatMap((n) => dirs.map((d) => path.posix.join(d, n)));
  }
  return candidates.find(ok) ?? null;
}

export interface OpenDeps {
  spawn?: Spawn;
  platform?: NodeJS.Platform;
}

/** Starts `browser --app=<url> --new-window` detached, without a shell. False when it could not start. */
export function openAppWindow(browser: string, url: string, deps: OpenDeps = {}): boolean {
  const spawn = deps.spawn ?? nodeSpawn;
  const platform = deps.platform ?? process.platform;
  try {
    const child = spawn(browser, [`--app=${url}`, '--new-window'], {
      detached: true,
      stdio: 'ignore',
      shell: false,
      ...(platform === 'win32' ? { windowsHide: true } : {}),
    });
    // An async spawn error (ENOENT after the check) must not crash the hook.
    child.on?.('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export interface LaunchDeps extends OpenDeps {
  findBrowser?: () => string | null;
  fetch?: typeof fetch;
  /** Timeout of the pair-code request, ms. */
  timeoutMs?: number;
}

/** The hub issues 32 random bytes in hex. */
const CODE_RE = /^[0-9a-f]{64}$/;

/**
 * Opens a new app window for the hub at `hubUrl` (the `#token=` URL ensureHub returns). False when no
 * browser is found (nothing else is attempted). Throws when the hub gives no pairing code or the spawn
 * fails; error messages never carry the token.
 */
export async function launchAppWindow(hubUrl: string, deps: LaunchDeps = {}): Promise<boolean> {
  const browser = (deps.findBrowser ?? (() => findBrowser()))();
  if (!browser) return false;
  const u = new URL(hubUrl);
  const token = new URLSearchParams(u.hash.slice(1)).get('token');
  if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || !token) throw new Error('app window: unexpected hub url');
  const doFetch = deps.fetch ?? fetch;
  const res = await doFetch(`${u.origin}/api/pair-code`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(deps.timeoutMs ?? 2000),
  });
  if (!res.ok) throw new Error(`app window: pair-code answered ${res.status}`);
  let code: unknown;
  try {
    code = ((await res.json()) as { code?: unknown })?.code;
  } catch {
    throw new Error('app window: pair-code answer is not JSON');
  }
  if (typeof code !== 'string' || !CODE_RE.test(code)) throw new Error('app window: pair-code answer has no valid code');
  if (!openAppWindow(browser, `${u.origin}/#pair=${code}`, deps)) throw new Error(`app window: could not start ${browser}`);
  return true;
}
