// The "AI Chat Center" icon of the system's app launcher. On Linux a freedesktop .desktop entry (here); on
// Windows a Start menu shortcut (launcherWin.ts); on macOS an app bundle in ~/Applications (launcherMac.ts).
// Clicking it runs dist/open.mjs, which starts the hub if needed and opens the app window with a pairing code (never the
// token). The entry is written by `/cc window on` and refreshed by every /cc while the option is on (the
// plugin folder and the Node path change with updates); `/cc window off` removes it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeIfChanged } from './launcherFiles.js';
import { installMacLauncher, removeMacLauncher } from './launcherMac.js';
import { installWinLauncher, removeWinLauncher, type SpawnSyncLike } from './launcherWin.js';

type Env = Record<string, string | undefined>;

export const DESKTOP_ID = 'ai-chat-center';
/**
 * The Wayland app_id (X11: WM_CLASS) Chrome gives an `--app=http://127.0.0.1:<port>/` window of the
 * Default profile: `chrome-<host>_<path with / as _>-<profile>`, without the port. GNOME matches it to
 * StartupWMClass, so the window shows under this icon and a click on the icon raises it instead of
 * opening another one.
 */
export const APP_WM_CLASS = 'chrome-127.0.0.1__-Default';

export interface LauncherPaths {
  desktopFile: string;
  iconFile: string;
}

export function launcherPaths(env: Env = process.env, home = os.homedir()): LauncherPaths {
  const data = env.XDG_DATA_HOME && path.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : path.join(home, '.local', 'share');
  return {
    desktopFile: path.join(data, 'applications', `${DESKTOP_ID}.desktop`),
    iconFile: path.join(data, 'icons', 'hicolor', '512x512', 'apps', `${DESKTOP_ID}.png`),
  };
}

/** An argument of Exec, quoted as the Desktop Entry spec asks (and `%` doubled: it starts a field code). */
export function quoteExecArg(a: string): string {
  return `"${a.replace(/[\\"`$]/g, (c) => `\\${c}`).replace(/%/g, '%%')}"`;
}

/** Escapes a string value of a key (the spec's \s \n \t \r \\ escapes). */
const value = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r');

export function desktopEntry(o: { node: string; openScript: string; icon: string; comment: string }): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    'Name=AI Chat Center',
    `Comment=${value(o.comment)}`,
    `Exec=${quoteExecArg(o.node)} ${quoteExecArg(o.openScript)}`,
    `Icon=${value(o.icon)}`,
    'Terminal=false',
    'Categories=Development;Utility;',
    `StartupWMClass=${APP_WM_CLASS}`,
    'StartupNotify=false',
    '',
  ].join('\n');
}

export interface LauncherOptions {
  platform?: NodeJS.Platform;
  env?: Env;
  home?: string;
  /** The Node that runs the hook: an absolute path, so the launcher works without the shell's PATH (nvm). */
  node?: string;
  /** plugin/dist: holds open.mjs and ui/icons/icon-512.png (icon-256.png for Windows). */
  distDir?: string;
  comment?: string;
  /** Runs PowerShell to make the Windows shortcut (tests inject a fake). */
  spawn?: SpawnSyncLike;
  /** Epoch ms, for the Windows retry window after a PowerShell failure (tests). */
  now?: () => number;
}

const defaultDist = () => path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_COMMENT = 'Follow and answer your Claude Code sessions';

/**
 * Writes (or refreshes) the launcher of this system: true on Linux, Windows and macOS, false elsewhere.
 * Rewrites files only when they changed. Throws on failure (the hook logs it and carries on).
 */
export function installLauncher(o: LauncherOptions = {}): boolean {
  const platform = o.platform ?? process.platform;
  const env = o.env ?? process.env;
  const home = o.home ?? os.homedir();
  const distDir = o.distDir ?? defaultDist();
  const node = o.node ?? process.execPath;
  const comment = o.comment ?? DEFAULT_COMMENT;
  if (platform === 'win32') return installWinLauncher({ env, home, node, distDir, comment, ...(o.spawn ? { spawn: o.spawn } : {}), ...(o.now ? { now: o.now } : {}) });
  if (platform === 'darwin') return installMacLauncher({ home, node, distDir });
  if (platform !== 'linux') return false;
  const p = launcherPaths(env, home);
  writeIfChanged(p.iconFile, fs.readFileSync(path.join(distDir, 'ui', 'icons', 'icon-512.png')));
  const entry = desktopEntry({ node, openScript: path.join(distDir, 'open.mjs'), icon: p.iconFile, comment });
  writeIfChanged(p.desktopFile, Buffer.from(entry, 'utf8'));
  return true;
}

/** Removes the launcher of this system, if there is one. */
export function removeLauncher(o: Pick<LauncherOptions, 'platform' | 'env' | 'home'> = {}): void {
  const platform = o.platform ?? process.platform;
  const env = o.env ?? process.env;
  const home = o.home ?? os.homedir();
  if (platform === 'win32') return removeWinLauncher(env, home);
  if (platform === 'darwin') return removeMacLauncher(home);
  if (platform !== 'linux') return;
  const p = launcherPaths(env, home);
  for (const f of [p.desktopFile, p.iconFile]) fs.rmSync(f, { force: true });
}
