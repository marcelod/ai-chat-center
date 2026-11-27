import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { linuxTerminal, macCommandScript, openTerminal } from '../../src/hub/openTerminal.js';
import type { Spawn } from '../../src/hub/bgSessions.js';

const ID = '5e1b5e9b';

function recorder(outcome: 'spawn' | Error = 'spawn') {
  const calls: { cmd: string; args: string[]; opts: SpawnOptions; unref: boolean }[] = [];
  const spawn: Spawn = (cmd, args, opts) => {
    const c = new EventEmitter() as ChildProcess;
    const call = { cmd, args, opts, unref: false };
    c.unref = () => {
      call.unref = true;
    };
    calls.push(call);
    setImmediate(() => (outcome === 'spawn' ? c.emit('spawn') : c.emit('error', outcome)));
    return c;
  };
  return { spawn, calls };
}

describe('linuxTerminal', () => {
  const env = { PATH: 'relative/bin:/usr/local/bin:/usr/bin' };
  it('takes the first terminal of the list found in an absolute PATH entry', () => {
    const t = linuxTerminal(ID, '/home/u/p', env, (p) => p === '/usr/bin/konsole' || p === '/usr/bin/xterm');
    expect(t).toEqual({ cmd: '/usr/bin/konsole', args: ['--workdir', '/home/u/p', '-e', 'claude', 'attach', ID] });
  });
  it('gives each terminal its own way of running a command', () => {
    const args = (name: string) => linuxTerminal(ID, '/p', env, (p) => p === `/usr/bin/${name}`, (p) => p)?.args;
    expect(args('x-terminal-emulator')).toEqual(['-e', `claude attach ${ID}`]);
    expect(args('ptyxis')).toEqual(['--new-window', '--working-directory', '/p', '--', 'claude', 'attach', ID]);
    expect(args('kgx')).toEqual(['--working-directory', '/p', '--', 'claude', 'attach', ID]);
    expect(args('konsole')).toEqual(['--workdir', '/p', '-e', 'claude', 'attach', ID]);
    expect(args('gnome-terminal')).toEqual(['--working-directory=/p', '--', 'claude', 'attach', ID]);
    expect(args('xfce4-terminal')).toEqual(['--working-directory=/p', '-x', 'claude', 'attach', ID]);
    expect(args('kitty')).toEqual(['--directory', '/p', 'claude', 'attach', ID]);
    expect(args('alacritty')).toEqual(['--working-directory', '/p', '-e', 'claude', 'attach', ID]);
    expect(args('xterm')).toEqual(['-e', 'claude', 'attach', ID]);
  });
  it('x-terminal-emulator is the last resort; relative PATH entries are ignored; none found is null', () => {
    expect(linuxTerminal(ID, '/p', env, () => true)?.cmd).toBe('/usr/local/bin/gnome-terminal');
    expect(linuxTerminal(ID, '/p', env, (p) => p.endsWith('/x-terminal-emulator') || p.endsWith('/xterm'))?.cmd).toBe('/usr/local/bin/xterm');
    expect(linuxTerminal(ID, '/p', env, (p) => p === '/usr/bin/x-terminal-emulator', (p) => p)?.cmd).toBe('/usr/bin/x-terminal-emulator');
    expect(linuxTerminal(ID, '/p', env, (p) => p.endsWith('/x-terminal-emulator') || p.endsWith('/ptyxis') || p.endsWith('/kgx'), (p) => p)?.cmd).toBe(
      '/usr/local/bin/ptyxis',
    );
    expect(linuxTerminal(ID, '/p', { PATH: 'bin:.' }, () => true)).toBeNull();
    expect(linuxTerminal(ID, '/p', env, () => false)).toBeNull();
    expect(
      linuxTerminal(ID, '/p', env, () => {
        throw new Error('EACCES');
      }),
    ).toBeNull();
  });
  it('x-terminal-emulator: the real terminal behind it (realpath) gets its own syntax', () => {
    const only = (p: string) => p === '/usr/bin/x-terminal-emulator';
    const via = (target: string) => linuxTerminal(ID, '/home/u/p', env, only, (p) => (p === '/usr/bin/x-terminal-emulator' ? target : p));
    // Ubuntu with Ptyxis as the default terminal and no gnome-terminal (backlog 2026-11-26).
    expect(via('/usr/bin/ptyxis')).toEqual({
      cmd: '/usr/bin/ptyxis',
      args: ['--new-window', '--working-directory', '/home/u/p', '--', 'claude', 'attach', ID],
    });
    expect(via('/usr/bin/kgx')).toEqual({ cmd: '/usr/bin/kgx', args: ['--working-directory', '/home/u/p', '--', 'claude', 'attach', ID] });
    expect(via('/usr/bin/gnome-terminal')).toEqual({
      cmd: '/usr/bin/gnome-terminal',
      args: ['--working-directory=/home/u/p', '--', 'claude', 'attach', ID],
    });
    expect(via('/usr/bin/konsole')?.args).toEqual(['--workdir', '/home/u/p', '-e', 'claude', 'attach', ID]);
    expect(via('/usr/bin/xfce4-terminal')?.args).toEqual(['--working-directory=/home/u/p', '-x', 'claude', 'attach', ID]);
    expect(via('/opt/kitty.app/bin/kitty')).toEqual({ cmd: '/opt/kitty.app/bin/kitty', args: ['--directory', '/home/u/p', 'claude', 'attach', ID] });
    expect(via('/usr/bin/alacritty')?.args).toEqual(['--working-directory', '/home/u/p', '-e', 'claude', 'attach', ID]);
    expect(via('/usr/bin/xterm')?.args).toEqual(['-e', 'claude', 'attach', ID]);
  });
  it('x-terminal-emulator: an unknown target, a Debian .wrapper (xterm-style) or a realpath error keeps the one-string -e', () => {
    const only = (p: string) => p === '/usr/bin/x-terminal-emulator';
    const fallback = { cmd: '/usr/bin/x-terminal-emulator', args: ['-e', `claude attach ${ID}`] };
    expect(linuxTerminal(ID, '/p', env, only, () => '/usr/bin/terminology')).toEqual(fallback);
    expect(linuxTerminal(ID, '/p', env, only, () => '/usr/bin/gnome-terminal.wrapper')).toEqual(fallback);
    expect(linuxTerminal(ID, '/p', env, only, () => '/usr/bin/x-terminal-emulator')).toEqual(fallback);
    expect(
      linuxTerminal(ID, '/p', env, only, () => {
        throw new Error('ELOOP');
      }),
    ).toEqual(fallback);
  });
});

describe('macCommandScript', () => {
  it('quotes every path as one shell word and execs claude attach with the id', () => {
    const s = macCommandScript(ID, "/Users/u/it's $(x)", '/tmp/d/attach.command', '/Users/u/.claude-work');
    expect(s).toBe(
      [
        '#!/bin/sh',
        "rm -f '/tmp/d/attach.command'",
        "rmdir '/tmp/d' 2>/dev/null",
        "export CLAUDE_CONFIG_DIR='/Users/u/.claude-work'",
        "cd '/Users/u/it'\\''s $(x)' || exit 1",
        `exec claude attach ${ID}`,
        '',
      ].join('\n'),
    );
    expect(macCommandScript(ID, '/p', '/t/f.command')).not.toContain('CLAUDE_CONFIG_DIR');
  });
  it('refuses an id that is not 8 hex characters', () => {
    expect(() => macCommandScript('abc; rm -rf ~', '/p', '/t/f')).toThrow();
  });
});

describe('openTerminal', () => {
  it('Linux: spawns the terminal detached, without a shell, in the folder, with a clean env', async () => {
    const r = recorder();
    const res = await openTerminal(
      { bgId: ID, cwd: '/home/u/p', configDir: '/home/u/.claude-work' },
      { spawn: r.spawn, isDir: () => true, platform: 'linux', env: { PATH: '/usr/bin', CLAUDECODE: '1', HOME: '/home/u' }, home: '/home/u', exists: (p) => p === '/usr/bin/xterm' },
    );
    expect(res).toEqual({ ok: true });
    expect(r.calls).toHaveLength(1);
    const c = r.calls[0];
    expect(c.cmd).toBe('/usr/bin/xterm');
    expect(c.args).toEqual(['-e', 'claude', 'attach', ID]);
    expect(c.opts).toMatchObject({ cwd: '/home/u/p', detached: true, stdio: 'ignore', shell: false });
    expect(c.opts.env).toMatchObject({ PATH: '/usr/bin', CLAUDE_CONFIG_DIR: '/home/u/.claude-work' });
    expect(c.opts.env).not.toHaveProperty('CLAUDECODE');
    expect(c.unref).toBe(true);
  });
  it('Linux: x-terminal-emulator pointing to Ptyxis runs ptyxis with separate arguments (realpath injected)', async () => {
    const r = recorder();
    const res = await openTerminal(
      { bgId: ID, cwd: '/home/u/p' },
      {
        spawn: r.spawn,
        isDir: () => true,
        platform: 'linux',
        env: { PATH: '/usr/bin' },
        exists: (p) => p === '/usr/bin/x-terminal-emulator',
        realpath: (p) => (p === '/usr/bin/x-terminal-emulator' ? '/usr/bin/ptyxis' : p),
      },
    );
    expect(res).toEqual({ ok: true });
    expect(r.calls[0].cmd).toBe('/usr/bin/ptyxis');
    expect(r.calls[0].args).toEqual(['--new-window', '--working-directory', '/home/u/p', '--', 'claude', 'attach', ID]);
    expect(r.calls[0].opts).toMatchObject({ cwd: '/home/u/p', shell: false });
  });
  it('no terminal found, or a spawn error, is a failure (never a throw)', async () => {
    const r = recorder();
    expect(await openTerminal({ bgId: ID, cwd: '/p' }, { spawn: r.spawn, isDir: () => true, platform: 'linux', env: { PATH: '/usr/bin' }, exists: () => false })).toMatchObject({
      ok: false,
      code: 'no-terminal',
    });
    expect(r.calls).toHaveLength(0);
    const bad = recorder(new Error('spawn ENOENT'));
    expect(await openTerminal({ bgId: ID, cwd: '/p' }, { spawn: bad.spawn, isDir: () => true, platform: 'linux', env: { PATH: '/usr/bin' }, exists: () => true })).toMatchObject({
      ok: false,
      code: 'spawn-failed',
    });
  });
  it('refuses an invalid id and a relative folder', async () => {
    const r = recorder();
    await expect(openTerminal({ bgId: '../x', cwd: '/p' }, { spawn: r.spawn, isDir: () => true, platform: 'linux' })).rejects.toThrow();
    expect(await openTerminal({ bgId: ID, cwd: 'p' }, { spawn: r.spawn, isDir: () => true, platform: 'linux', env: { PATH: '/usr/bin' }, exists: () => true })).toMatchObject({ ok: false });
    expect(r.calls).toHaveLength(0);
  });
  it('macOS: writes a private 0700 .command script and opens it with Terminal', async () => {
    const r = recorder();
    const written: { p: string; data: string; mode: number }[] = [];
    const res = await openTerminal(
      { bgId: ID, cwd: '/Users/u/p' },
      {
        spawn: r.spawn, isDir: () => true,
        platform: 'darwin',
        env: {},
        home: '/Users/u',
        mkdtemp: () => '/var/folders/x/T/ai-chat-center-term-abc',
        writeFile: (p, data, mode) => written.push({ p, data, mode }),
      },
    );
    expect(res).toEqual({ ok: true });
    const file = `/var/folders/x/T/ai-chat-center-term-abc/attach-${ID}.command`;
    expect(written).toEqual([{ p: file, data: macCommandScript(ID, '/Users/u/p', file), mode: 0o700 }]);
    expect(r.calls[0].cmd).toBe('/usr/bin/open');
    expect(r.calls[0].args).toEqual(['-a', 'Terminal', file]);
    expect(r.calls[0].opts.shell).toBe(false);
  });
  it('macOS: a failure to write the script is a failure', async () => {
    const r = recorder();
    const res = await openTerminal(
      { bgId: ID, cwd: '/p' },
      {
        spawn: r.spawn, isDir: () => true,
        platform: 'darwin',
        mkdtemp: () => {
          throw new Error('ENOSPC');
        },
      },
    );
    expect(res).toMatchObject({ ok: false, code: 'spawn-failed' });
    expect(r.calls).toHaveLength(0);
  });
  const winEnv = { SystemRoot: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', PATH: 'C:\\bin' };
  it('Windows: wt.exe when present, the folder as its cwd (-d .), cmd.exe /k running claude attach', async () => {
    const r = recorder();
    const res = await openTerminal({ bgId: ID, cwd: 'C:\\Users\\u\\my %proj% & co' }, { spawn: r.spawn, isDir: () => true, platform: 'win32', env: winEnv, exists: () => true });
    expect(res).toEqual({ ok: true });
    const c = r.calls[0];
    expect(c.cmd).toBe('C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe');
    expect(c.args).toEqual(['-d', '.', 'C:\\Windows\\System32\\cmd.exe', '/k', 'claude', 'attach', ID]);
    expect(c.opts).toMatchObject({ cwd: 'C:\\Users\\u\\my %proj% & co', shell: false, detached: true });
    expect(c.args.join(' ')).not.toContain('proj');
  });
  it('Windows: without wt.exe, cmd.exe start opens a console window with cmd.exe /k, the folder never on the command line', async () => {
    const r = recorder();
    await openTerminal({ bgId: ID, cwd: 'C:\\p & x' }, { spawn: r.spawn, isDir: () => true, platform: 'win32', env: winEnv, exists: () => false });
    expect(r.calls[0].cmd).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(r.calls[0].args).toEqual(['/d', '/c', 'start', '', 'C:\\Windows\\System32\\cmd.exe', '/k', 'claude', 'attach', ID]);
    expect(r.calls[0].opts).toMatchObject({ cwd: 'C:\\p & x', shell: false, detached: true });
    expect(await openTerminal({ bgId: ID, cwd: 'C:\\p' }, { spawn: r.spawn, isDir: () => true, platform: 'win32', env: {}, exists: () => false })).toMatchObject({
      ok: false,
      code: 'no-terminal',
    });
  });
  it('Windows: the process env has NoDefaultCurrentDirectoryInExePath=1 (claude is not looked up in the session folder)', async () => {
    for (const exists of [() => true, () => false]) {
      const r = recorder();
      await openTerminal({ bgId: ID, cwd: 'C:\\p' }, { spawn: r.spawn, isDir: () => true, platform: 'win32', env: winEnv, exists });
      expect(r.calls[0].opts.env).toMatchObject({ NoDefaultCurrentDirectoryInExePath: '1' });
    }
    const l = recorder();
    await openTerminal({ bgId: ID, cwd: '/p' }, { spawn: l.spawn, isDir: () => true, platform: 'linux', env: { PATH: '/usr/bin' }, exists: () => true });
    expect(l.calls[0].opts.env).not.toHaveProperty('NoDefaultCurrentDirectoryInExePath');
  });
  it('a folder that is missing or not a folder is folder-missing, nothing is spawned', async () => {
    const r = recorder();
    const res = await openTerminal({ bgId: ID, cwd: '/gone' }, { spawn: r.spawn, isDir: () => false, platform: 'linux', env: { PATH: '/usr/bin' }, exists: () => true });
    expect(res).toMatchObject({ ok: false, code: 'folder-missing' });
    expect(r.calls).toHaveLength(0);
  });
});
