// "AI Chat Center.app" in ~/Applications (spec 2026-11-24-launcher-windows-macos §3.2): a minimal bundle
// whose executable is a shell script that execs `node open.mjs`. ~/Applications needs no admin password and
// shows in Launchpad and Spotlight. A locally written bundle gets no quarantine attribute, so Gatekeeper lets
// it run unsigned. Only a bundle carrying our identifier is ever rewritten or removed.
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

/** Missing bundle: 'none'; a bundle with our identifier: 'ours'; anything else at that path: 'foreign'. */
function ownership(p: MacLauncherPaths): 'none' | 'ours' | 'foreign' {
  if (!fs.existsSync(p.app)) return 'none';
  try {
    const plist = fs.readFileSync(p.plist, 'utf8');
    return /<key>CFBundleIdentifier<\/key>\s*<string>com\.ai-chat-center\.launcher<\/string>/.test(plist) ? 'ours' : 'foreign';
  } catch {
    return 'foreign';
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
  if (ownership(p) === 'ours') fs.rmSync(p.app, { recursive: true, force: true });
}
