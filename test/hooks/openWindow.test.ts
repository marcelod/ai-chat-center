import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { findBrowser, openAppWindow, launchAppWindow, isExecutableFile } from '../../src/hooks/openWindow.js';

const CODE = 'c0de'.repeat(16);
const onlyExists = (...files: string[]) => (p: string) => files.includes(p);

describe('findBrowser', () => {
  it('linux: the first name of the list found on PATH, in the spec order', () => {
    const env = { PATH: '/opt/bin:/usr/bin' };
    const find = (...f: string[]) => findBrowser(env, 'linux', onlyExists(...f));
    expect(find()).toBeNull();
    expect(find('/usr/bin/microsoft-edge-stable')).toBe('/usr/bin/microsoft-edge-stable');
    expect(find('/usr/bin/chromium', '/usr/bin/microsoft-edge')).toBe('/usr/bin/chromium');
    // Order is by name first, then by PATH entry.
    expect(find('/usr/bin/google-chrome', '/opt/bin/chromium')).toBe('/usr/bin/google-chrome');
    expect(find('/opt/bin/google-chrome-stable', '/usr/bin/google-chrome-stable')).toBe('/opt/bin/google-chrome-stable');
    expect(find('/usr/bin/chromium-browser')).toBe('/usr/bin/chromium-browser');
  });

  it('linux: no PATH, empty entries and relative entries find nothing', () => {
    expect(findBrowser({}, 'linux', () => true)).toBeNull();
    expect(findBrowser({ PATH: '::relative/bin' }, 'linux', () => true)).toBeNull();
  });

  it('macOS: the executable inside the .app bundles in /Applications', () => {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const chromium = '/Applications/Chromium.app/Contents/MacOS/Chromium';
    const edge = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
    expect(findBrowser({ PATH: '/usr/bin' }, 'darwin', onlyExists('/usr/bin/google-chrome'))).toBeNull();
    expect(findBrowser({}, 'darwin', onlyExists(edge, chromium))).toBe(chromium);
    expect(findBrowser({}, 'darwin', onlyExists(edge, chromium, chrome))).toBe(chrome);
    expect(findBrowser({}, 'darwin', onlyExists(edge))).toBe(edge);
  });

  it('windows: chrome.exe, then msedge.exe, under ProgramFiles, ProgramFiles(x86) and LOCALAPPDATA', () => {
    const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' };
    const chromeLocal = path.win32.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe');
    const chromeX86 = path.win32.join(env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe');
    const edgeX86 = path.win32.join(env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    expect(findBrowser(env, 'win32', onlyExists())).toBeNull();
    expect(findBrowser(env, 'win32', onlyExists(edgeX86))).toBe(edgeX86);
    expect(findBrowser(env, 'win32', onlyExists(edgeX86, chromeLocal))).toBe(chromeLocal);
    expect(findBrowser(env, 'win32', onlyExists(chromeLocal, chromeX86))).toBe(chromeX86);
    // A missing variable is skipped, not joined as a relative path.
    expect(findBrowser({}, 'win32', () => true)).toBeNull();
  });

  it('a throwing exists counts as not found', () => {
    expect(findBrowser({ PATH: '/usr/bin' }, 'linux', () => { throw new Error('EACCES'); })).toBeNull();
  });
});

describe('isExecutableFile', () => {
  const st = (file: boolean) => () => ({ isFile: () => file });
  const ok = () => {};
  const denied = () => { throw new Error('EACCES'); };
  it('posix: only a regular file with the execute bit', () => {
    expect(isExecutableFile('/b', 'linux', { stat: st(true) as never, access: ok })).toBe(true);
    expect(isExecutableFile('/b', 'darwin', { stat: st(false) as never, access: ok })).toBe(false);
    expect(isExecutableFile('/b', 'linux', { stat: st(true) as never, access: denied })).toBe(false);
    expect(isExecutableFile('/b', 'linux', { stat: (() => { throw new Error('ENOENT'); }) as never, access: ok })).toBe(false);
  });
  it('windows: a regular file is enough (no execute bit)', () => {
    expect(isExecutableFile('C:\\b.exe', 'win32', { stat: st(true) as never, access: denied })).toBe(true);
    expect(isExecutableFile('C:\\b', 'win32', { stat: st(false) as never, access: ok })).toBe(false);
  });
  it('default check on this machine: a directory is not a browser', () => {
    expect(isExecutableFile(process.cwd())).toBe(false);
  });
});

type Call = { cmd: string; args: string[]; opts: Record<string, unknown> };
const fakeSpawn = (calls: Call[], fail = false) =>
  ((cmd: string, args: string[], opts: Record<string, unknown>) => {
    if (fail) throw new Error('ENOENT');
    const child = { unrefed: false, unref() { child.unrefed = true; }, on() { return child; } };
    calls.push({ cmd, args, opts, child } as Call);
    return child;
  }) as never;

describe('openAppWindow', () => {
  it('spawns the browser detached, without a shell, with --app and --new-window, and unrefs it', () => {
    const calls: Call[] = [];
    const url = 'http://127.0.0.1:7777/#pair=abc';
    expect(openAppWindow('/usr/bin/chromium', url, { spawn: fakeSpawn(calls) })).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('/usr/bin/chromium');
    expect(calls[0].args).toEqual([`--app=${url}`, '--new-window']);
    expect(calls[0].opts).toMatchObject({ detached: true, stdio: 'ignore', shell: false });
    expect((calls[0] as unknown as { child: { unrefed: boolean } }).child.unrefed).toBe(true);
  });

  it('does not pass windowsHide on Windows (it would start a GUI browser hidden)', () => {
    const calls: Call[] = [];
    openAppWindow('C:\\chrome.exe', 'http://127.0.0.1:1/#pair=x', { spawn: fakeSpawn(calls) });
    expect(calls[0].opts).toMatchObject({ detached: true, stdio: 'ignore', shell: false });
    expect(calls[0].opts).not.toHaveProperty('windowsHide');
  });

  it('reports an async spawn error through onError, without the url', () => {
    let handler: ((e: Error) => void) | undefined;
    const spawn = (() => ({ unref() {}, on(ev: string, h: (e: Error) => void) { if (ev === 'error') handler = h; return this; } })) as never;
    const seen: string[] = [];
    const url = 'http://127.0.0.1:1/#pair=secretcode';
    openAppWindow('/usr/bin/chromium', url, { spawn, onError: (m) => seen.push(m) });
    handler!(new Error(`spawn /usr/bin/chromium EACCES ${url}`));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/app window.*EACCES/);
    expect(seen[0]).not.toContain('secretcode');
  });

  it('returns false when spawn throws', () => {
    expect(openAppWindow('/nope', 'http://127.0.0.1:1/#pair=x', { spawn: fakeSpawn([], true) })).toBe(false);
  });
});

describe('launchAppWindow', () => {
  const HUB = 'http://127.0.0.1:7777/#token=secret-token';
  const okFetch = (seen: { url?: string; init?: RequestInit }[]) =>
    (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ code: CODE }), { status: 200 });
    }) as never;

  it('asks the hub for a pair code with the bearer token and opens #pair=<code>, never the token', async () => {
    const calls: Call[] = [];
    const seen: { url?: string; init?: RequestInit }[] = [];
    const r = await launchAppWindow(HUB, { findBrowser: () => '/usr/bin/chromium', fetch: okFetch(seen), spawn: fakeSpawn(calls) });
    expect(r).toBe(true);
    expect(seen[0].url).toBe('http://127.0.0.1:7777/api/pair-code');
    expect(seen[0].init?.method).toBe('POST');
    expect((seen[0].init?.headers as Record<string, string>).authorization).toBe('Bearer secret-token');
    expect(seen[0].init?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0].args).toEqual([`--app=http://127.0.0.1:7777/#pair=${CODE}`, '--new-window']);
    expect(JSON.stringify(calls)).not.toContain('secret-token');
  });

  it('no browser: does not call the hub nor spawn', async () => {
    const calls: Call[] = [];
    const seen: { url?: string }[] = [];
    expect(await launchAppWindow(HUB, { findBrowser: () => null, fetch: okFetch(seen), spawn: fakeSpawn(calls) })).toBe(false);
    expect(seen).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('throws (without the token in the message) when the hub refuses or answers without a valid code', async () => {
    const calls: Call[] = [];
    const deps = (res: () => Response) => ({ findBrowser: () => '/b', fetch: (async () => res()) as never, spawn: fakeSpawn(calls) });
    await expect(launchAppWindow(HUB, deps(() => new Response('{"error":"unauthorized"}', { status: 401 })))).rejects.toThrow(/401/);
    await expect(launchAppWindow(HUB, deps(() => new Response('{"code":"a b"}', { status: 200 })))).rejects.toThrow(/code/);
    await expect(launchAppWindow(HUB, deps(() => new Response('nope', { status: 200 })))).rejects.toThrow();
    try {
      await launchAppWindow(HUB, deps(() => new Response('', { status: 500 })));
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('secret-token');
    }
    expect(calls).toHaveLength(0);
  });

  it('throws on a hub url without a token or not on 127.0.0.1', async () => {
    const d = { findBrowser: () => '/b', fetch: okFetch([]), spawn: fakeSpawn([]) };
    await expect(launchAppWindow('http://127.0.0.1:7777/', d)).rejects.toThrow();
    await expect(launchAppWindow('http://example.com:7777/#token=x', d)).rejects.toThrow();
  });
});
