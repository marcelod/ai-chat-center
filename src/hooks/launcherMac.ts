// "AI Chat Center.app" in ~/Applications (spec 2026-11-24-launcher-windows-macos §3.2): a minimal bundle
// whose executable is a shell script that execs `node open.mjs`. ~/Applications needs no admin password and
// shows in Launchpad and Spotlight. A locally written bundle gets no quarantine attribute, so Gatekeeper lets
// it run unsigned. Only a bundle carrying our identifier, or one without Info.plist that holds nothing but
// our own files (an install cut short), is ever rewritten or removed.
import fs from 'node:fs';
import path from 'node:path';
import { pngToIcns, writeIfChanged } from './launcherFiles.js';

export const BUNDLE_ID = 'com.ai-chat-center.launcher';
const EXECUTABLE = 'ai-chat-center';

export interface MacLauncherPaths {
  app: string;
  plist: string;
  exec: string;
  icon: string;
}

export function macLauncherPaths(home: string): MacLauncherPaths {
  const app = path.join(home, 'Applications', 'AI Chat Center.app');
  return {
    app,
    plist: path.join(app, 'Contents', 'Info.plist'),
    exec: path.join(app, 'Contents', 'MacOS', EXECUTABLE),
    icon: path.join(app, 'Contents', 'Resources', 'icon.icns'),
  };
}

/** A POSIX shell word: single quotes, a quote inside written as '\''. */
export const shQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

export function launchScript(node: string, openScript: string): string {
  return `#!/bin/sh\nexec ${shQuote(node)} ${shQuote(openScript)}\n`;
}

export function infoPlist(): string {
  const str = (k: string, v: string) => `  <key>${k}</key>\n  <string>${v}</string>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    str('CFBundleName', 'AI Chat Center'),
    str('CFBundleDisplayName', 'AI Chat Center'),
    str('CFBundleIdentifier', BUNDLE_ID),
    str('CFBundleExecutable', EXECUTABLE),
    str('CFBundleIconFile', 'icon'),
    str('CFBundlePackageType', 'APPL'),
    str('CFBundleInfoDictionaryVersion', '6.0'),
    // The script gets no Dock icon of its own: the Chrome window it opens is what shows in the Dock.
    '  <key>LSUIElement</key>\n  <true/>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

/** What a bundle of ours may hold besides Info.plist: directories and files, by path inside the .app. */
const OUR_DIRS = new Set(['Contents', path.join('Contents', 'MacOS'), path.join('Contents', 'Resources')]);
const OUR_EXEC = path.join('Contents', 'MacOS', EXECUTABLE);
const OUR_ICON = path.join('Contents', 'Resources', 'icon.icns');

/**
 * True when the folder holds nothing but (part of) what installMacLauncher writes, minus Info.plist: an
 * install cut short, or an Info.plist lost. Symbolic links, other files and an executable that is not our
 * launch script make it someone else's.
 */
function onlyOurFiles(app: string): boolean {
  const walk = (rel: string): boolean => {
    for (const e of fs.readdirSync(path.join(app, rel), { withFileTypes: true })) {
      const r = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) {
        if (!OUR_DIRS.has(r) || !walk(r)) return false;
      } else if (!e.isFile()) {
        return false;
      } else if (r === OUR_EXEC) {
        const st = fs.statSync(path.join(app, r));
        if (st.size > 64 * 1024 || !fs.readFileSync(path.join(app, r), 'utf8').startsWith('#!/bin/sh\nexec ')) return false;
      } else if (r !== OUR_ICON) {
        return false;
      }
    }
    return true;
  };
  try {
    return fs.lstatSync(app).isDirectory() && walk('');
  } catch {
    return false;
  }
}

/**
 * Missing bundle: 'none'; a bundle with our identifier: 'ours'; a folder without Info.plist that holds only
 * our files (or nothing): 'partial', ours to rewrite or remove; anything else at that path: 'foreign'. An
 * Info.plist with another identifier, or one that cannot be read, is never ours.
 */
function ownership(p: MacLauncherPaths): 'none' | 'ours' | 'partial' | 'foreign' {
  if (!fs.existsSync(p.app)) return 'none';
  let plist: string;
  try {
    plist = fs.readFileSync(p.plist, 'utf8');
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === 'ENOENT' && !lexists(p.plist);
    return missing && onlyOurFiles(p.app) ? 'partial' : 'foreign';
  }
  return /<key>CFBundleIdentifier<\/key>\s*<string>com\.ai-chat-center\.launcher<\/string>/.test(plist) ? 'ours' : 'foreign';
}

/** True when something (even a dangling link) sits at the path. */
function lexists(f: string): boolean {
  try {
    fs.lstatSync(f);
    return true;
  } catch {
    return false;
  }
}

export interface MacInstallOptions {
  home: string;
  node: string;
  distDir: string;
}

export function installMacLauncher(o: MacInstallOptions): true {
  const p = macLauncherPaths(o.home);
  if (ownership(p) === 'foreign') throw new Error(`launcher: ${p.app} exists and is not ours; left alone`);
  // Info.plist first: from then on the folder is recognisably ours, even if a later write fails.
  writeIfChanged(p.plist, Buffer.from(infoPlist(), 'utf8'));
  writeIfChanged(p.exec, Buffer.from(launchScript(o.node, path.join(o.distDir, 'open.mjs')), 'utf8'), 0o755);
  writeIfChanged(p.icon, pngToIcns(fs.readFileSync(path.join(o.distDir, 'ui', 'icons', 'icon-512.png'))));
  return true;
}

export function removeMacLauncher(home: string): void {
  const p = macLauncherPaths(home);
  const owner = ownership(p);
  if (owner === 'ours' || owner === 'partial') fs.rmSync(p.app, { recursive: true, force: true });
}
