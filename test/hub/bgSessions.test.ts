import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import {
  cleanEnv,
  CommandUnsupportedError,
  isBgId,
  isValidCommand,
  resumeInBackground,
  scriptArgs,
  typeCommand,
  RESUME_PROMPT,
  type Spawn,
} from '../../src/hub/bgSessions.js';
import type { Registration } from '../../src/core/registry.js';

const SID = '5e1b5e9b-474f-47f4-8f6f-c34bd6995616';
const reg = (over: Partial<Registration> = {}): Registration => ({
  sessionId: SID,
  transcriptPath: '/t.jsonl',
  cwd: '/home/u/proj',
  pid: null,
  connectedAt: '2026-11-24T00:00:00.000Z',
  configDir: '/home/u/.claude',
  ...over,
});

type Fake = ChildProcess & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; written: string[]; killed: boolean };
function fakeChild(): Fake {
  const c = new EventEmitter() as Fake;
  c.stdout = new PassThrough();
  c.stderr = new PassThrough();
  c.stdin = new PassThrough();
  c.written = [];
  c.stdin.on('data', (d) => c.written.push(String(d)));
  (c as { killed: boolean }).killed = false;
  c.kill = (() => {
    (c as { killed: boolean }).killed = true;
    setImmediate(() => c.emit('close', null));
    return true;
  }) as ChildProcess['kill'];
  return c;
}
function recorder(onSpawn: (c: Fake) => void = () => {}) {
  const calls: { cmd: string; args: string[]; opts: SpawnOptions; child: Fake }[] = [];
  const spawn: Spawn = (cmd, args, opts) => {
    const child = fakeChild();
    calls.push({ cmd, args, opts, child });
    setImmediate(() => onSpawn(child));
    return child;
  };
  return { spawn, calls };
}

describe('validation', () => {
  it('background ids are 8 hex characters', () => {
    expect(isBgId('5e1b5e9b')).toBe(true);
    for (const bad of ['5E1B5E9B', '5e1b5e9', '5e1b5e9bb', '5e1b;rm ', '', 1]) expect(isBgId(bad)).toBe(false);
  });

  it('commands: one printable line starting with a slash command name, at most 200 characters', () => {
    for (const ok of ['/compact', '/reload-plugins', '/rename meu nome', '/ai-chat-center:cc off', '/compact foco nos testes']) expect(isValidCommand(ok)).toBe(true);
    for (const bad of ['compact', '/', '/ x', '/compact\n/clear', '/a\r', '/a\x1b[A', `/${'a'.repeat(200)}`, 42, null]) expect(isValidCommand(bad)).toBe(false);
  });
});

describe('cleanEnv', () => {
  it('drops the variables of the session that started the hub and sets the config dir', () => {
    const env = cleanEnv(
      { PATH: '/bin', HOME: '/h', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'x', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_PID: '9', CLAUDE_EFFORT: 'high', CLAUDE_CONFIG_DIR: '/other' },
      '/home/u/.claude',
    );
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', CLAUDE_CONFIG_DIR: '/home/u/.claude' });
    expect(cleanEnv({ CLAUDE_CONFIG_DIR: '/other', A: 'b' })).toEqual({ A: 'b' });
  });
});

describe('resumeInBackground', () => {
  it('runs claude --bg --resume <sid> /ai-chat-center:cc in the session folder, without the shell', async () => {
    const r = recorder((c) => c.emit('close', 0));
    expect(await resumeInBackground(reg(), { spawn: r.spawn, platform: 'linux', env: { PATH: '/bin', CLAUDECODE: '1' } })).toEqual({ ok: true });
    const [call] = r.calls;
    expect(call.cmd).toBe('claude');
    expect(call.args).toEqual(['--bg', '--resume', SID, RESUME_PROMPT]);
    expect(call.opts.cwd).toBe('/home/u/proj');
    expect(call.opts.shell).toBe(false);
    expect(call.opts.env).toEqual({ PATH: '/bin', CLAUDE_CONFIG_DIR: '/home/u/.claude' });
  });

  it('Windows: one command line through the shell (claude is a .cmd shim)', async () => {
    const r = recorder((c) => c.emit('close', 0));
    await resumeInBackground(reg(), { spawn: r.spawn, platform: 'win32', env: {} });
    expect(r.calls[0].cmd).toBe(`claude --bg --resume ${SID} ${RESUME_PROMPT}`);
    expect(r.calls[0].args).toEqual([]);
    expect(r.calls[0].opts.shell).toBe(true);
  });

  it('a failure gives the output, without terminal escapes', async () => {
    const r = recorder((c) => {
      c.stderr.write('\x1b[31mWorkspace not trusted.\x1b[0m Run `claude` once\n');
      setImmediate(() => c.emit('close', 1));
    });
    const res = await resumeInBackground(reg(), { spawn: r.spawn, platform: 'linux', env: {} });
    expect(res).toEqual({ ok: false, error: 'Workspace not trusted. Run `claude` once' });
  });

  it('claude missing (spawn error) and a silent failure', async () => {
    const missing = recorder((c) => c.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })));
    expect(await resumeInBackground(reg(), { spawn: missing.spawn, platform: 'linux', env: {} })).toEqual({ ok: false, error: 'spawn claude ENOENT' });
    const silent = recorder((c) => c.emit('close', 3));
    expect(await resumeInBackground(reg(), { spawn: silent.spawn, platform: 'linux', env: {} })).toEqual({ ok: false, error: 'claude exited with code 3' });
  });

  it('refuses an invalid session id', async () => {
    await expect(resumeInBackground(reg({ sessionId: '../x' }), { spawn: recorder().spawn })).rejects.toThrow();
  });
});

describe('typeCommand', () => {
  const quick = { settleMs: 0, enterDelayMs: 0, afterMs: 0, env: {} };

  it('script arguments per platform', () => {
    expect(scriptArgs('5e1b5e9b', 'linux')).toEqual(['-qfec', 'claude attach 5e1b5e9b', '/dev/null']);
    expect(scriptArgs('5e1b5e9b', 'darwin')).toEqual(['-q', '/dev/null', 'claude', 'attach', '5e1b5e9b']);
    expect(() => scriptArgs('5e1b5e9b; rm -rf ~', 'linux')).toThrow();
  });

  it('waits for the prompt, types the text, Enter, then closes the attach', async () => {
    const r = recorder((c) => c.stdout.write('\x1b[2J ▐▛███▜▌ Claude Code\r\n❯ '));
    await typeCommand('5e1b5e9b', '/compact', { ...quick, spawn: r.spawn, platform: 'linux' });
    const [call] = r.calls;
    expect(call.cmd).toBe('script');
    expect(call.args).toEqual(['-qfec', 'claude attach 5e1b5e9b', '/dev/null']);
    expect(call.child.written).toEqual(['/compact', '\r']);
    expect(call.child.killed).toBe(true);
  });

  it('nothing is typed when the prompt never shows', async () => {
    const r = recorder((c) => c.stdout.write('loading...'));
    await expect(typeCommand('5e1b5e9b', '/compact', { ...quick, spawn: r.spawn, platform: 'linux', promptTimeoutMs: 20 })).rejects.toThrow(/prompt did not show/);
    expect(r.calls[0].child.written).toEqual([]);
    expect(r.calls[0].child.killed).toBe(true);
  });

  it('an attach that ends first (unknown session) rejects with its output', async () => {
    const r = recorder((c) => {
      c.stdout.write("No session matching '5e1b5e9b'.");
      setImmediate(() => c.emit('close', 1));
    });
    await expect(typeCommand('5e1b5e9b', '/compact', { ...quick, spawn: r.spawn, platform: 'linux' })).rejects.toThrow(/No session matching/);
    expect(r.calls[0].child.written).toEqual([]);
  });

  it('Windows is not supported yet; invalid text or id never spawns', async () => {
    const r = recorder();
    await expect(typeCommand('5e1b5e9b', '/compact', { spawn: r.spawn, platform: 'win32' })).rejects.toBeInstanceOf(CommandUnsupportedError);
    await expect(typeCommand('5e1b5e9b', 'compact', { spawn: r.spawn, platform: 'linux' })).rejects.toThrow();
    await expect(typeCommand('nope', '/compact', { spawn: r.spawn, platform: 'linux' })).rejects.toThrow();
    expect(r.calls).toEqual([]);
  });
});
