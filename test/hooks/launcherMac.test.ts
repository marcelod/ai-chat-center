import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from '../helpers/tmp.js';
import { fakePng } from '../helpers/png.js';
import { installLauncher, removeLauncher } from '../../src/hooks/launcher.js';
import { BUNDLE_ID, infoPlist, launchScript, macLauncherPaths, shQuote } from '../../src/hooks/launcherMac.js';

function fakeDist(): string {
  const d = tmpDir();
  fs.mkdirSync(path.join(d, 'ui', 'icons'), { recursive: true });
  fs.writeFileSync(path.join(d, 'ui', 'icons', 'icon-512.png'), fakePng(512, 512));
  return d;
}

describe('macOS launcher', () => {
  it('the app bundle lives in ~/Applications', () => {
    const p = macLauncherPaths('/Users/u');
    expect(p.app).toBe(path.join('/Users/u', 'Applications', 'AI Chat Center.app'));
    expect(p.plist).toBe(path.join(p.app, 'Contents', 'Info.plist'));
    expect(p.exec).toBe(path.join(p.app, 'Contents', 'MacOS', 'ai-chat-center'));
    expect(p.icon).toBe(path.join(p.app, 'Contents', 'Resources', 'icon.icns'));
  });

  it('quotes shell words with single quotes', () => {
    expect(shQuote("/a b/it's")).toBe("'/a b/it'\\''s'");
    expect(launchScript('/n/node', '/p/open.mjs')).toBe("#!/bin/sh\nexec '/n/node' '/p/open.mjs'\n");
  });

  it('Info.plist names the app, the executable, the icon and our identifier, and keeps out of the Dock', () => {
    const x = infoPlist();
    expect(x.startsWith('<?xml')).toBe(true);
    for (const [k, v] of [
      ['CFBundleName', 'AI Chat Center'],
      ['CFBundleDisplayName', 'AI Chat Center'],
      ['CFBundleIdentifier', BUNDLE_ID],
      ['CFBundleExecutable', 'ai-chat-center'],
      ['CFBundleIconFile', 'icon'],
      ['CFBundlePackageType', 'APPL'],
    ]) expect(x).toContain(`<key>${k}</key>\n  <string>${v}</string>`);
    expect(x).toContain('<key>LSUIElement</key>\n  <true/>');
    expect(BUNDLE_ID).toBe('com.ai-chat-center.launcher');
  });

  it('install writes the bundle (executable script, icns), refreshes it, and remove deletes it', () => {
    const home = tmpDir();
    const dist = fakeDist();
    const o = { platform: 'darwin' as const, env: {}, home, node: '/opt/node/bin/node', distDir: dist };
    expect(installLauncher(o)).toBe(true);
    const p = macLauncherPaths(home);
    expect(fs.readFileSync(p.exec, 'utf8')).toBe(launchScript('/opt/node/bin/node', path.join(dist, 'open.mjs')));
    expect(fs.statSync(p.exec).mode & 0o777).toBe(0o755);
    expect(fs.readFileSync(p.plist, 'utf8')).toBe(infoPlist());
    const icns = fs.readFileSync(p.icon);
    expect(icns.toString('latin1', 8, 12)).toBe('ic09');
    expect(icns.subarray(16).equals(fakePng(512, 512))).toBe(true);
    installLauncher({ ...o, node: '/other/node' });
    expect(fs.readFileSync(p.exec, 'utf8')).toContain("exec '/other/node'");
    removeLauncher({ platform: 'darwin', env: {}, home });
    expect(fs.existsSync(p.app)).toBe(false);
    removeLauncher({ platform: 'darwin', env: {}, home }); // nothing left: no error
  });

  it('never touches an app of the same name that is not ours', () => {
    const home = tmpDir();
    const p = macLauncherPaths(home);
    fs.mkdirSync(path.dirname(p.plist), { recursive: true });
    const foreign = infoPlist().replace(BUNDLE_ID, 'com.example.other');
    fs.writeFileSync(p.plist, foreign);
    expect(() => installLauncher({ platform: 'darwin', env: {}, home, distDir: fakeDist() })).toThrow(/not ours/);
    removeLauncher({ platform: 'darwin', env: {}, home });
    expect(fs.readFileSync(p.plist, 'utf8')).toBe(foreign);
    expect(fs.existsSync(p.exec)).toBe(false);
    // a folder with no Info.plist is not ours either
    const h2 = tmpDir();
    const p2 = macLauncherPaths(h2);
    fs.mkdirSync(p2.app, { recursive: true });
    fs.writeFileSync(path.join(p2.app, 'x'), 'x');
    expect(() => installLauncher({ platform: 'darwin', env: {}, home: h2, distDir: fakeDist() })).toThrow(/not ours/);
    removeLauncher({ platform: 'darwin', env: {}, home: h2 });
    expect(fs.existsSync(path.join(p2.app, 'x'))).toBe(true);
  });

  it('never puts the token in the bundle', () => {
    const home = tmpDir();
    installLauncher({ platform: 'darwin', env: { AI_CHAT_CENTER_HOME: '/x' }, home, node: '/n', distDir: fakeDist() });
    const p = macLauncherPaths(home);
    for (const f of [p.plist, p.exec]) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/token/i);
  });
});
