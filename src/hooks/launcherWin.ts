// The "AI Chat Center" entry of the Windows Start menu (spec 2026-11-24-launcher-windows-macos §3.1): a .lnk
// that runs `node.exe "<dist>\open.mjs"` in a minimized console, with an .ico kept outside the plugin folder
// (which changes with every version). The .lnk is made by PowerShell (WScript.Shell); the script is fixed and
// gets every path through its environment, so no path is ever spliced into code. A stamp of what the .lnk
// points at keeps PowerShell (hundreds of ms) from running on every /cc; a failure stamp (same inputs plus
// the time) keeps a PowerShell that keeps failing (it may block the hook up to 10 s) from running again
// for 24 h, or until the inputs change.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pngToIco, writeIfChanged } from './launcherFiles.js';

type Env = Record<string, string | undefined>;

export type SpawnSyncLike = (
  cmd: string,
  args: readonly string[],
  opts: { env: Env; shell: false; windowsHide: true; timeout: number; stdio: 'ignore' },
) => { status: number | null; error?: Error | undefined };

export interface WinLauncherPaths {
  shortcut: string;
  dir: string;
  icon: string;
  stamp: string;
  failStamp: string;
}

export function winLauncherPaths(env: Env, home: string): WinLauncherPaths {
  const roaming = env.APPDATA && path.isAbsolute(env.APPDATA) ? env.APPDATA : path.join(home, 'AppData', 'Roaming');
  const local = env.LOCALAPPDATA && path.isAbsolute(env.LOCALAPPDATA) ? env.LOCALAPPDATA : path.join(home, 'AppData', 'Local');
  const dir = path.join(local, 'ai-chat-center');
  return {
    shortcut: path.join(roaming, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'AI Chat Center.lnk'),
    dir,
    icon: path.join(dir, 'ai-chat-center.ico'),
    stamp: path.join(dir, 'launcher.json'),
    failStamp: path.join(dir, 'launcher-failed.json'),
  };
}

/** Fixed: reads everything from $env: (never interpolated). WindowStyle 7 = minimized, no focus. */
export const SHORTCUT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:ACC_LNK)',
  '$s.TargetPath = $env:ACC_TARGET',
  '$s.Arguments = $env:ACC_ARGS',
  '$s.WorkingDirectory = $env:ACC_WORKDIR',
  "$s.IconLocation = $env:ACC_ICON + ',0'",
  '$s.Description = $env:ACC_COMMENT',
  '$s.WindowStyle = 7',
  '$s.Save()',
].join('; ');

export interface WinInstallOptions {
  env: Env;
  home: string;
  node: string;
  distDir: string;
  comment: string;
  spawn?: SpawnSyncLike;
  /** Epoch ms (tests). Default Date.now. */
  now?: () => number;
}

/** After a PowerShell failure, the same inputs are not tried again for this long. */
export const RETRY_AFTER_FAILURE_MS = 24 * 3600_000;

/** When PowerShell last failed for these very inputs, or null. */
function lastFailure(file: string, stamp: string): number | null {
  try {
    const f = JSON.parse(fs.readFileSync(file, 'utf8')) as { stamp?: unknown; at?: unknown };
    return f.stamp === stamp && typeof f.at === 'number' ? f.at : null;
  } catch {
    return null;
  }
}

const defaultSpawn: SpawnSyncLike = (cmd, args, opts) => spawnSync(cmd, args, opts);

function powershell(env: Env): string {
  const root = env.SystemRoot ?? env.SYSTEMROOT;
  // An absolute path when Windows says where it lives: no PATH lookup that another folder could shadow.
  return root ? path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell.exe';
}

export function installWinLauncher(o: WinInstallOptions): true {
  const p = winLauncherPaths(o.env, o.home);
  writeIfChanged(p.icon, pngToIco(fs.readFileSync(path.join(o.distDir, 'ui', 'icons', 'icon-256.png'))));
  const openScript = path.join(o.distDir, 'open.mjs');
  const stamp = JSON.stringify({ node: o.node, openScript, icon: p.icon, comment: o.comment });
  let same = false;
  try {
    same = fs.existsSync(p.shortcut) && fs.readFileSync(p.stamp, 'utf8') === stamp;
  } catch {
    /* no stamp: make the shortcut */
  }
  if (same) return true;
  const now = (o.now ?? Date.now)();
  const failedAt = lastFailure(p.failStamp, stamp);
  if (failedAt !== null && now - failedAt >= 0 && now - failedAt < RETRY_AFTER_FAILURE_MS) {
    throw new Error(`launcher: Start menu shortcut skipped: PowerShell failed at ${new Date(failedAt).toISOString()}; next try 24 h later or when the plugin or Node path changes`);
  }
  fs.mkdirSync(path.dirname(p.shortcut), { recursive: true });
  const r = (o.spawn ?? defaultSpawn)(
    powershell(o.env),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SHORTCUT_SCRIPT],
    {
      env: {
        ...o.env,
        ACC_LNK: p.shortcut,
        ACC_TARGET: o.node,
        ACC_ARGS: `"${openScript}"`,
        ACC_WORKDIR: o.distDir,
        ACC_ICON: p.icon,
        ACC_COMMENT: o.comment,
      },
      shell: false,
      windowsHide: true,
      timeout: 10_000,
      stdio: 'ignore',
    },
  );
  if (r.error || r.status !== 0) {
    writeIfChanged(p.failStamp, Buffer.from(JSON.stringify({ stamp, at: now }), 'utf8'));
    throw new Error(`launcher: PowerShell could not create the Start menu shortcut (${r.error?.message ?? `exit ${r.status}`})`);
  }
  writeIfChanged(p.stamp, Buffer.from(stamp, 'utf8'));
  fs.rmSync(p.failStamp, { force: true });
  return true;
}

export function removeWinLauncher(env: Env, home: string): void {
  const p = winLauncherPaths(env, home);
  for (const f of [p.shortcut, p.icon, p.stamp, p.failStamp]) fs.rmSync(f, { force: true });
  try {
    fs.rmdirSync(p.dir); // only when empty
  } catch {
    /* missing or not empty */
  }
}
