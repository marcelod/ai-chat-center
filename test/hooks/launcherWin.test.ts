import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from '../helpers/tmp.js';
import { fakePng } from '../helpers/png.js';
import { installLauncher, removeLauncher } from '../../src/hooks/launcher.js';
import { SHORTCUT_SCRIPT, winLauncherPaths } from '../../src/hooks/launcherWin.js';

type Env = Record<string, string | undefined>;
interface Call { cmd: string; args: readonly string[]; opts: { env?: Env; shell?: boolean; windowsHide?: boolean; timeout?: number } }

function fakeDist(): string {
  const d = tmpDir();
  fs.mkdirSync(path.join(d, 'ui', 'icons'), { recursive: true });
  fs.writeFileSync(path.join(d, 'ui', 'icons', 'icon-256.png'), fakePng(256, 256));
  return d;
}

function setup() {
  const home = tmpDir();
  const env: Env = { APPDATA: path.join(home, 'Roaming'), LOCALAPPDATA: path.join(home, 'Local'), SystemRoot: 'C:\\Windows', PATH: '/bin' };
  const calls: Call[] = [];
  let status = 0;
  // Stands in for PowerShell: records the call and "creates" the shortcut it was asked for.
  const spawn = (cmd: string, args: readonly string[], opts: Call['opts']) => {
    calls.push({ cmd, args, opts });
    if (status === 0) {
      fs.mkdirSync(path.dirname(opts.env!.ACC_LNK!), { recursive: true });
      fs.writeFileSync(opts.env!.ACC_LNK!, 'LNK');
    }
    return { status, error: undefined };
  };
  const dist = fakeDist();
  const o = { platform: 'win32' as const, env, home, node: 'C:\\node\\node.exe', distDir: dist, comment: 'Follow', spawn };
  return { home, env, calls, dist, o, fail: (s: number) => (status = s) };
}

describe('Windows launcher', () => {
  it('paths: the Start menu shortcut under APPDATA, icon and stamp under LOCALAPPDATA (home fallbacks)', () => {
    const p = winLauncherPaths({ APPDATA: '/r', LOCALAPPDATA: '/l' }, '/h');
    expect(p.shortcut).toBe(path.join('/r', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'AI Chat Center.lnk'));
    expect(p.icon).toBe(path.join('/l', 'ai-chat-center', 'ai-chat-center.ico'));
    expect(p.stamp).toBe(path.join('/l', 'ai-chat-center', 'launcher.json'));
    expect(p.failStamp).toBe(path.join('/l', 'ai-chat-center', 'launcher-failed.json'));
    const f = winLauncherPaths({}, '/h');
    expect(f.shortcut.startsWith(path.join('/h', 'AppData', 'Roaming'))).toBe(true);
    expect(f.icon.startsWith(path.join('/h', 'AppData', 'Local'))).toBe(true);
  });

  it('writes the .ico and creates the shortcut with PowerShell, the paths passed only through the environment', () => {
    const { env, calls, dist, o, home } = setup();
    expect(installLauncher(o)).toBe(true);
    const p = winLauncherPaths(env, home);
    const ico = fs.readFileSync(p.icon);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.subarray(22).equals(fakePng(256, 256))).toBe(true);
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.cmd).toBe(path.join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
    expect(c.args).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SHORTCUT_SCRIPT]);
    expect(c.opts).toMatchObject({ shell: false, windowsHide: true, timeout: 10_000 });
    const openScript = path.join(dist, 'open.mjs');
    expect(c.opts.env).toMatchObject({
      PATH: '/bin',
      ACC_LNK: p.shortcut,
      ACC_TARGET: 'C:\\node\\node.exe',
      ACC_ARGS: `"${openScript}"`,
      ACC_WORKDIR: dist,
      ACC_ICON: p.icon,
      ACC_COMMENT: 'Follow',
    });
    // The script is fixed: no path or comment in it, a minimized window, everything read from $env:.
    expect(SHORTCUT_SCRIPT).not.toContain(dist);
    expect(SHORTCUT_SCRIPT).toContain('WScript.Shell');
    expect(SHORTCUT_SCRIPT).toContain('WindowStyle = 7');
    for (const k of ['ACC_LNK', 'ACC_TARGET', 'ACC_ARGS', 'ACC_WORKDIR', 'ACC_ICON', 'ACC_COMMENT']) expect(SHORTCUT_SCRIPT).toContain(`$env:${k}`);
    expect(JSON.parse(fs.readFileSync(p.stamp, 'utf8'))).toEqual({ node: 'C:\\node\\node.exe', openScript, icon: p.icon, comment: 'Follow' });
  });

  it('falls back to powershell.exe on PATH when SystemRoot is unknown', () => {
    const { calls, o, env } = setup();
    installLauncher({ ...o, env: { ...env, SystemRoot: undefined } });
    expect(calls[0]!.cmd).toBe('powershell.exe');
  });

  it('skips PowerShell while the shortcut exists and nothing changed; redoes it when something did', () => {
    const { env, calls, o, home } = setup();
    installLauncher(o);
    installLauncher(o);
    expect(calls).toHaveLength(1);
    installLauncher({ ...o, node: 'D:\\nvm\\node.exe' });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.opts.env!.ACC_TARGET).toBe('D:\\nvm\\node.exe');
    fs.rmSync(winLauncherPaths(env, home).shortcut);
    installLauncher({ ...o, node: 'D:\\nvm\\node.exe' });
    expect(calls).toHaveLength(3);
  });

  it('a failing PowerShell throws (the hook logs it), leaves no stamp and is not run again for 24 h with the same inputs', () => {
    const { env, calls, o, home, fail } = setup();
    let now = Date.parse('2026-11-24T10:00:00Z');
    const at = { ...o, now: () => now };
    const p = winLauncherPaths(env, home);
    fail(1);
    expect(() => installLauncher(at)).toThrow(/PowerShell/);
    expect(fs.existsSync(p.stamp)).toBe(false);
    expect(fs.existsSync(p.failStamp)).toBe(true);
    // Every /cc in the next 24 h: no PowerShell (it may block up to 10 s), still reported as not made.
    now += 23 * 3600_000;
    expect(() => installLauncher(at)).toThrow(/skipped/);
    expect(calls).toHaveLength(1);
    // Other inputs (a new Node or plugin folder): try at once.
    expect(() => installLauncher({ ...at, node: 'D:\\nvm\\node.exe' })).toThrow(/PowerShell/);
    expect(calls).toHaveLength(2);
    // 24 h after the last failure: try again; a success clears the failure stamp.
    now += 24 * 3600_000 + 1;
    fail(0);
    expect(installLauncher({ ...at, node: 'D:\\nvm\\node.exe' })).toBe(true);
    expect(calls).toHaveLength(3);
    expect(fs.existsSync(p.failStamp)).toBe(false);
    expect(fs.existsSync(p.stamp)).toBe(true);
  });

  it('remove deletes the shortcut, the icon and the stamp', () => {
    const { env, o, home } = setup();
    installLauncher(o);
    const p = winLauncherPaths(env, home);
    removeLauncher({ platform: 'win32', env, home });
    for (const f of [p.shortcut, p.icon, p.stamp, p.failStamp]) expect(fs.existsSync(f)).toBe(false);
    removeLauncher({ platform: 'win32', env, home }); // nothing left: no error
    expect(fs.existsSync(p.dir)).toBe(false);
  });

  it('remove also deletes a failure stamp', () => {
    const { env, o, home, fail } = setup();
    fail(1);
    expect(() => installLauncher(o)).toThrow(/PowerShell/);
    const p = winLauncherPaths(env, home);
    removeLauncher({ platform: 'win32', env, home });
    expect(fs.existsSync(p.failStamp)).toBe(false);
    expect(fs.existsSync(p.dir)).toBe(false);
  });

  it('never puts the token in the shortcut command, the stamp or the files', () => {
    const { env, calls, o, home } = setup();
    const acc = path.join(home, '.ai-chat-center');
    fs.mkdirSync(acc);
    fs.writeFileSync(path.join(acc, 'token'), 'tok-SECRET-123');
    installLauncher({ ...o, env: { ...env, AI_CHAT_CENTER_HOME: acc } });
    const p = winLauncherPaths(env, home);
    const seen = [fs.readFileSync(p.stamp, 'utf8'), JSON.stringify(calls.map((c) => [c.cmd, c.args]))];
    for (const s of seen) expect(s).not.toContain('tok-SECRET');
  });
});
