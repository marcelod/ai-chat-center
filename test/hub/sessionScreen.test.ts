import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { cleanScreen, readScreen, renderScreen, screenSize, screenText, MAX_SCREEN_CHARS, MAX_RENDER_BYTES } from '../../src/hub/sessionScreen.js';

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

// Spec 2026-11-27-session-screen-terminal: `claude logs` is a terminal stream (cursor moves, redraws, "cursor
// forward" in place of spaces). The hub plays it in a headless terminal and keeps only the final screen.
const ESC = '\x1b[';
describe('renderScreen', () => {
  it('a line redrawn many times shows once, as its last frame', async () => {
    let raw = `${ESC}2J${ESC}1;1HHeader\r\n`;
    for (let i = 1; i <= 40; i++) raw += `\r${ESC}K✻ Doodling… ${i}`;
    raw += `\r${ESC}KDone thinking\r\nprompt`;
    const out = await renderScreen(raw);
    expect(out).toBe('Header\nDone thinking\nprompt');
    expect(out).not.toContain('Doodling');
  });

  it('cursor forward gives the spaces back; cursor up rewrites a line above', async () => {
    const raw = `Fala${ESC}1Cmeu${ESC}3Crei!\r\nold status\r\nbottom${ESC}1A\r${ESC}2Knew status`;
    expect(await renderScreen(raw)).toBe('Fala meu   rei!\nnew status\nbottom');
  });

  it('absolute moves (CUP, CHA) land where the session put them, without trailing empty lines', async () => {
    const raw = `${ESC}2J${ESC}3;5Hmiddle${ESC}1;1Htop${ESC}5;1Hleft${ESC}60Gright\r\n\r\n\r\n`;
    expect(await renderScreen(raw)).toBe(`top\n\n    middle\n\nleft${' '.repeat(55)}right`);
  });

  it('only the final screen: what scrolled off the top is gone', async () => {
    const raw = Array.from({ length: 120 }, (_, i) => `line ${i}`).join('\r\n');
    const out = (await renderScreen(raw, { cols: 80, rows: 10 })).split('\n');
    expect(out).toHaveLength(10);
    expect(out[0]).toBe('line 110');
    expect(out[9]).toBe('line 119');
  });

  it('a line the terminal wrapped is joined back (so a long token is never cut in two)', async () => {
    const out = await renderScreen(`${'a'.repeat(30)}${'b'.repeat(30)}\r\nnext`, { cols: 40, rows: 5 });
    expect(out).toBe(`${'a'.repeat(30)}${'b'.repeat(30)}\nnext`);
  });

  it('a huge stream: only its end is played', async () => {
    const raw = 'x'.repeat(MAX_RENDER_BYTES * 2) + '\r\nTHE END';
    expect((await renderScreen(raw)).endsWith('THE END')).toBe(true);
  });
});

describe('screenSize', () => {
  it('at least 200x50 (what `claude logs` draws at), larger when the session moved the cursor further', () => {
    expect(screenSize('')).toEqual({ cols: 200, rows: 50 });
    expect(screenSize(`${ESC}40;1H${ESC}38;3Hx`)).toEqual({ cols: 200, rows: 50 });
    expect(screenSize(`${ESC}62;1H${ESC}250Gx${ESC}5;300H${ESC}70d`)).toEqual({ cols: 300, rows: 70 });
    expect(screenSize(`${ESC}9999;9999H`)).toEqual({ cols: 400, rows: 200 });
  });
});

describe('screenText', () => {
  it('plays the stream, then removes the app link, token, key and secret', async () => {
    const raw = `${ESC}2J${ESC}1;1HOpen the app:${ESC}1Chttp://127.0.0.1:7777/#token=${TOKEN}\r\nAI${ESC}1CChat${ESC}1CCenter${ESC}1Ckey:${ESC}1C${KEY}\r\nsecret ${SECRET}\r\n${ESC}1;200Hz`;
    const out = await screenText(raw, [TOKEN, KEY, SECRET]);
    for (const bad of [TOKEN, KEY, SECRET, '127.0.0.1', '#token', '\x1b']) expect(out).not.toContain(bad);
    expect(out).toContain('Open the app: [app link removed]');
    expect(out).toContain('AI Chat Center key: [redacted]');
  });

  it('a token wrapped by the terminal, or cut by the session at the end of a line, is still removed', async () => {
    const wrapped = await screenText(`link: http://127.0.0.1:7777/#token=${TOKEN}\r\nrest`, [TOKEN], { cols: 40, rows: 10 });
    for (const bad of [TOKEN.slice(-12), TOKEN.slice(0, 12), '127.0.0.1']) expect(wrapped).not.toContain(bad);
    expect(wrapped).toContain('rest');
    const cut = await screenText(`key ${KEY.slice(0, 22)}\r\n  ${KEY.slice(22)} after\r\nthe ${TOKEN.slice(0, 9)}\r\n${TOKEN.slice(9)}`, [TOKEN, KEY]);
    for (const bad of [KEY.slice(22), KEY.slice(0, 22), TOKEN.slice(0, 9)]) expect(cut).not.toContain(bad);
    expect(cut).toContain('after');
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
