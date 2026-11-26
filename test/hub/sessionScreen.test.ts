import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { cleanScreen, readScreen, MAX_SCREEN_CHARS } from '../../src/hub/sessionScreen.js';

// Spec 2026-11-26-side-panel: the screen of a background session (`claude logs <bgId>`), cleaned before it
// reaches the app: no terminal codes, no app link, no token, no key.

const TOKEN = '0123456789abcdef'.repeat(4);
const KEY = 'fedcba9876543210'.repeat(2);
const SECRET = 'abcdefabcdef0123'.repeat(4);

describe('cleanScreen', () => {
  it('removes colours, cursor moves and window titles', () => {
    const raw = '\x1b[1;32m✓ done\x1b[0m\r\n\x1b]0;claude\x07\x1b[2K\x1b[?25lnext\x1b(B line\x07\r\nlast\r';
    expect(cleanScreen(raw, [])).toBe('✓ done\nnext line\nlast');
  });

  it('removes the /cc link with its token, any app address, and the literal token, key and secret', () => {
    const raw = [
      `Open the app: http://127.0.0.1:7777/#token=${TOKEN}`,
      `or http://localhost:7777/#pair=${'9'.repeat(64)} now`,
      'see 127.0.0.1:7777/api/sessions',
      `AI Chat Center key: ${KEY}`,
      `stray ${TOKEN} and ${SECRET}`,
      'keep https://example.com/docs and the uuid eded50bc-d802-4024-ac92-bb8fe087d400',
    ].join('\n');
    const out = cleanScreen(raw, [TOKEN, KEY, SECRET]);
    for (const bad of [TOKEN, KEY, SECRET, '127.0.0.1', 'localhost', '#token', '#pair', '9'.repeat(20)]) expect(out).not.toContain(bad);
    expect(out).toContain('Open the app: [app link removed]');
    expect(out).toContain('AI Chat Center key: [redacted]');
    expect(out).toContain('https://example.com/docs');
    expect(out).toContain('eded50bc-d802-4024-ac92-bb8fe087d400');
  });

  it('a token cut by the terminal width, or by colour codes, is still removed', () => {
    const raw = `link: http://127.0.0.1:7777/#token=${TOKEN.slice(0, 30)}\n${TOKEN.slice(30)} rest\nkey ${KEY.slice(0, 10)}\x1b[0m${KEY.slice(10)}`;
    const out = cleanScreen(raw, [TOKEN, KEY]);
    expect(out).not.toContain(TOKEN.slice(30));
    expect(out).not.toContain(KEY.slice(10));
    expect(out).toContain('rest');
  });

  it('keeps the end of a long screen', () => {
    const raw = 'x'.repeat(MAX_SCREEN_CHARS) + '\nTHE END';
    const out = cleanScreen(raw, []);
    expect(out.length).toBeLessThanOrEqual(MAX_SCREEN_CHARS);
    expect(out.endsWith('THE END')).toBe(true);
  });
});

function fakeChild(): ChildProcess & { stdout: PassThrough; stderr: PassThrough } {
  const c = new EventEmitter() as ChildProcess & { stdout: PassThrough; stderr: PassThrough };
  Object.assign(c, { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true) });
  return c;
}

describe('readScreen', () => {
  it('runs `claude logs <bgId>` without a shell and gives its output', async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const p = readScreen('5e1b5e9b', { spawn, platform: 'linux', env: { PATH: '/bin', CLAUDECODE: '1' } });
    child.stdout.write('screen text');
    child.emit('close', 0);
    expect(await p).toBe('screen text');
    expect(spawn).toHaveBeenCalledWith('claude', ['logs', '5e1b5e9b'], expect.objectContaining({ shell: false }));
    const env = (spawn.mock.calls[0] as unknown as [string, string[], { env: NodeJS.ProcessEnv }])[2].env;
    expect(env.CLAUDECODE).toBeUndefined();
  });

  it('refuses a bad id and Windows', async () => {
    await expect(readScreen('../x', { spawn: vi.fn(), platform: 'linux' })).rejects.toThrow();
    await expect(readScreen('5e1b5e9b', { spawn: vi.fn(), platform: 'win32' })).rejects.toThrow(/Windows/);
  });

  it('fails on a non-zero exit without echoing the output, and on a timeout (killing the process)', async () => {
    let child = fakeChild();
    let p = readScreen('5e1b5e9b', { spawn: () => child, platform: 'linux' });
    child.stdout.write(`oops ${TOKEN}`);
    child.emit('close', 1);
    await expect(p).rejects.toThrow('claude logs failed');
    await p.catch((e: Error) => expect(e.message).not.toContain(TOKEN));
    child = fakeChild();
    p = readScreen('5e1b5e9b', { spawn: () => child, platform: 'linux', timeoutMs: 20 });
    await expect(p).rejects.toThrow('claude logs did not answer');
    expect(child.kill).toHaveBeenCalled();
  });

  it('keeps at most the last bytes of a huge output', async () => {
    const child = fakeChild();
    const p = readScreen('5e1b5e9b', { spawn: () => child, platform: 'linux', maxBytes: 100 });
    child.stdout.write('a'.repeat(500));
    child.stdout.write('END');
    child.emit('close', 0);
    const out = await p;
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith('END')).toBe(true);
  });
});
