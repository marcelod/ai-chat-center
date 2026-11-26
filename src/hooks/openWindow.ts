// Opens the app in its own Chrome/Chromium/Edge window (`--app`), spec 2026-11-23-app-window §2/§3.
// With none of them (Safari only on macOS, Firefox only), it opens a tab of the default browser instead.
// The window never gets the token on its command line (readable through `ps` or /proc/<pid>/cmdline):
// the hook trades it with the hub for a one-time pairing code and opens `#pair=<code>` instead.
import fs from 'node:fs';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';

type Env = Record<string, string | undefined>;
type Spawn = typeof nodeSpawn;

const LINUX_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable'];
const MAC_APPS = [
  'Google Chrome.app/Contents/MacOS/Google Chrome',
  'Chromium.app/Contents/MacOS/Chromium',
  'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];
const WIN_EXES = [
  ['Google', 'Chrome', 'Application', 'chrome.exe'],
  ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
];
const WIN_BASES = ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA'];

export interface FileChecks {
  stat?: (p: string) => { isFile(): boolean };
  access?: (p: string, mode?: number) => void;
}

/** A regular file that can be run: with the execute bit on Linux/macOS; any regular file on Windows. */
export function isExecutableFile(p: string, platform: NodeJS.Platform = process.platform, checks: FileChecks = {}): boolean {
  const stat = checks.stat ?? fs.statSync;
  const access = checks.access ?? fs.accessSync;
  try {
    if (!stat(p).isFile()) return false;
    if (platform !== 'win32') access(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Path of a Chrome, Chromium or Edge executable (spec §2 order), or null. */
export function findBrowser(
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => boolean = (p) => isExecutableFile(p, platform),
): string | null {
  const ok = (p: string) => {
    try {
      return exists(p);
    } catch {
      return false;
    }
  };
  let candidates: string[];
  if (platform === 'darwin') {
    // /Applications first, then the user's own ~/Applications (a Chrome installed without admin rights).
    const roots = ['/Applications', ...(env.HOME && path.posix.isAbsolute(env.HOME) ? [path.posix.join(env.HOME, 'Applications')] : [])];
    candidates = MAC_APPS.flatMap((app) => roots.map((r) => path.posix.join(r, app)));
  }
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

/** How to open a URL in the default browser: the command and the arguments before the URL. */
export interface DefaultOpener {
  cmd: string;
  args: string[];
}

/**
 * The system command that opens a URL in the default browser, without a shell: `open` on macOS,
 * `rundll32 url.dll,FileProtocolHandler` on Windows (`start` is a cmd.exe builtin and would need a shell),
 * `xdg-open` from an absolute PATH entry on Linux. Null when there is none.
 */
export function findDefaultOpener(
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => boolean = (p) => isExecutableFile(p, platform),
): DefaultOpener | null {
  const ok = (p: string) => {
    try {
      return exists(p);
    } catch {
      return false;
    }
  };
  if (platform === 'darwin') return ok('/usr/bin/open') ? { cmd: '/usr/bin/open', args: [] } : null;
  if (platform === 'win32') {
    const root = env.SystemRoot ?? env.SYSTEMROOT ?? env.windir;
    if (!root || !path.win32.isAbsolute(root)) return null;
    const exe = path.win32.join(root, 'System32', 'rundll32.exe');
    return ok(exe) ? { cmd: exe, args: ['url.dll,FileProtocolHandler'] } : null;
  }
  const dirs = (env.PATH ?? '').split(path.posix.delimiter).filter((d) => path.posix.isAbsolute(d));
  const exe = dirs.map((d) => path.posix.join(d, 'xdg-open')).find(ok);
  return exe ? { cmd: exe, args: [] } : null;
}

export interface OpenDeps {
  spawn?: Spawn;
  /** Receives a failure that happens after the spawn returned (ENOENT, EACCES): message only, never the url. */
  onError?: (msg: string) => void;
}

/**
 * Starts `browser --app=<url> --new-window` detached, without a shell. False when it could not start.
 * No `--window-size`: Chrome ignores it when it is already running, and when this launch starts Chrome it
 * becomes the size of every new window of that Chrome. The app sizes its own window (ui/src/useWindowSize.ts,
 * spec 2026-11-26-window-size).
 */
export function openAppWindow(browser: string, url: string, deps: OpenDeps = {}): boolean {
  const spawn = deps.spawn ?? nodeSpawn;
  try {
    // No windowsHide: chrome.exe/msedge.exe have no console to hide, and SW_HIDE would apply to the
    // browser's first window, so a browser that was not running yet would start with the app hidden.
    const child = spawn(browser, [`--app=${url}`, '--new-window'], { detached: true, stdio: 'ignore', shell: false });
    // An async spawn error (ENOENT, EACCES after the check) must not crash the hook; it is only logged.
    child.on?.('error', (e: Error) => {
      try {
        deps.onError?.(`app window: could not start ${browser}: ${String(e?.message ?? e).split(url).join('<url>')}`);
      } catch {
        /* never break the hook */
      }
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** Opens `url` in a tab of the default browser, detached, without a shell. False when it could not start. */
export function openDefaultBrowser(opener: DefaultOpener, url: string, deps: OpenDeps = {}): boolean {
  const spawn = deps.spawn ?? nodeSpawn;
  try {
    const child = spawn(opener.cmd, [...opener.args, url], { detached: true, stdio: 'ignore', shell: false, windowsHide: true });
    child.on?.('error', (e: Error) => {
      try {
        deps.onError?.(`app tab: could not start ${opener.cmd}: ${String(e?.message ?? e).split(url).join('<url>')}`);
      } catch {
        /* never break the hook */
      }
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export interface LaunchDeps extends OpenDeps {
  findBrowser?: () => string | null;
  /** The default-browser command used when no Chrome, Chromium or Edge is found. */
  findDefaultOpener?: () => DefaultOpener | null;
  fetch?: typeof fetch;
  /** Timeout of the pair-code request, ms. */
  timeoutMs?: number;
}

/** The hub issues 32 random bytes in hex. */
const CODE_RE = /^[0-9a-f]{64}$/;

/**
 * Opens the app window for the hub at `hubUrl` (the `#token=` URL ensureHub returns), unless an app page
 * is already open: then the hub asks that page to show `sessionId` and no window is opened ('reused'), so
 * only one window stays open (an ordinary tab of the app counts as open too). With no Chrome, Chromium or
 * Edge, the app opens in a tab of the default browser ('tab'). False when there is neither (nothing else is
 * attempted). Throws when the hub gives no pairing code or the spawn fails; error messages never carry the token.
 */
export async function launchAppWindow(hubUrl: string, deps: LaunchDeps = {}, sessionId?: string): Promise<'opened' | 'tab' | 'reused' | false> {
  const browser = (deps.findBrowser ?? (() => findBrowser()))();
  const opener = browser ? null : (deps.findDefaultOpener ?? (() => findDefaultOpener()))();
  if (!browser && !opener) return false;
  const u = new URL(hubUrl);
  const token = new URLSearchParams(u.hash.slice(1)).get('token');
  if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || !token) throw new Error('app window: unexpected hub url');
  const doFetch = deps.fetch ?? fetch;
  const res = await doFetch(`${u.origin}/api/pair-code`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(sessionId ? { sessionId } : {}),
    signal: AbortSignal.timeout(deps.timeoutMs ?? 2000),
  });
  if (!res.ok) throw new Error(`app window: pair-code answered ${res.status}`);
  let answer: { code?: unknown; live?: unknown } | null;
  try {
    answer = (await res.json()) as typeof answer;
  } catch {
    throw new Error('app window: pair-code answer is not JSON');
  }
  if (answer?.live === true) return 'reused';
  const code = answer?.code;
  if (typeof code !== 'string' || !CODE_RE.test(code)) throw new Error('app window: pair-code answer has no valid code');
  const appUrl = `${u.origin}/#pair=${code}`;
  if (browser) {
    if (!openAppWindow(browser, appUrl, deps)) throw new Error(`app window: could not start ${browser}`);
    return 'opened';
  }
  if (!openDefaultBrowser(opener!, appUrl, deps)) throw new Error(`app tab: could not start ${opener!.cmd}`);
  return 'tab';
}
