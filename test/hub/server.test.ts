import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { createHub, WINDOW_FRESH_MS } from '../../src/hub/server.js';
import { SessionDisconnectedError, SessionProtocolError, type Provider } from '../../src/hub/provider.js';
import type { ProviderChange } from '../../src/shared/types.js';
import { VERSION } from '../../src/core/version.js';
import { tmpDir } from '../helpers/tmp.js';
import { saveConfig, loadConfig } from '../../src/core/config.js';
import { putPending, readAnswer } from '../../src/core/questions.js';
import { paths } from '../../src/core/paths.js';
import { getDisplayName } from '../../src/core/names.js';
import { isPinned } from '../../src/core/pins.js';
import { register, markDisconnected, getRegistration, isRemoved } from '../../src/core/registry.js';

const TOKEN = 'a'.repeat(64);
let home: string;
let hub: Awaited<ReturnType<typeof createHub>> | undefined;
let prevHome: string | undefined;

/** Waits (bounded) until the poll count stays the same for 200 ms: the chain stopped. */
async function stopsPolling(p: { pollCalls: number }): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const n = p.pollCalls;
    await new Promise((r) => setTimeout(r, 200));
    if (p.pollCalls === n) return;
    if (Date.now() > deadline) throw new Error('polling never stopped');
  }
}

function fakeProvider(over: Partial<Provider> = {}): Provider & { pollCalls: number; queue: ProviderChange[][] } {
  const p: any = {
    pollCalls: 0,
    queue: [],
    listSessions: async () => ({ connected: [{ sessionId: 's1', name: 'n', cwd: '/x', state: 'idle', pendingAppMessageIds: [] }], others: [] }),
    events: async () => [],
    poll: async () => {
      p.pollCalls++;
      return p.queue.shift() ?? [];
    },
    send: vi.fn(async () => ({ id: 'm1' })),
    ...over,
  };
  return p;
}

async function start(provider: Provider, extra: { staticDir?: string; pollMs?: number; now?: () => number } = {}) {
  hub = await createHub({ provider, token: TOKEN, port: 0, staticDir: extra.staticDir ?? path.join(home, 'nope'), pollMs: extra.pollMs ?? 20, now: extra.now });
  return new URL(hub.url);
}

function req(u: URL, p: string, o: { method?: string; headers?: Record<string, string>; body?: string | Buffer } = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const r = http.request(
      { host: '127.0.0.1', port: u.port, path: p, method: o.method ?? 'GET', headers: { host: `127.0.0.1:${u.port}`, ...o.headers } },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: b }));
      },
    );
    r.on('error', reject);
    r.end(o.body);
  });
}
const auth = { authorization: `Bearer ${TOKEN}` };
const json = { ...auth, 'content-type': 'application/json' };

function openStream(u: URL, p: string, headers: Record<string, string> = {}) {
  return new Promise<{ res: http.IncomingMessage; req: http.ClientRequest; next: (re: RegExp) => Promise<string> }>((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: u.port, path: p, headers: { host: `127.0.0.1:${u.port}`, ...headers } }, (res) => {
      let buf = '';
      const waiters: { re: RegExp; ok: (s: string) => void }[] = [];
      res.setEncoding('utf8');
      res.on('data', (c) => {
        buf += c;
        for (const w of [...waiters]) if (w.re.test(buf)) { waiters.splice(waiters.indexOf(w), 1); w.ok(buf); }
      });
      resolve({
        res, req: r,
        next: (re) => new Promise((ok) => { if (re.test(buf)) ok(buf); else waiters.push({ re, ok }); }),
      });
    });
    r.on('error', reject);
    r.end();
  });
}

beforeEach(async () => {
  home = tmpDir('acc-hub-');
  prevHome = process.env.AI_CHAT_CENTER_HOME;
  process.env.AI_CHAT_CENTER_HOME = home;
});
afterEach(async () => {
  await hub?.close();
  hub = undefined;
  if (prevHome === undefined) delete process.env.AI_CHAT_CENTER_HOME; else process.env.AI_CHAT_CENTER_HOME = prevHome;
  await fsp.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('auth and host checks', () => {
  it('rejects missing token', async () => {
    const u = await start(fakeProvider());
    expect((await req(u, '/api/sessions')).status).toBe(401);
    expect((await req(u, '/api/sessions', { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
    expect((await req(u, '/api/sessions', { headers: { authorization: `Bearer ${'b'.repeat(64)}` } })).status).toBe(401);
  });
  it('health needs no token and reveals no pid', async () => {
    const u = await start(fakeProvider());
    const r = await req(u, '/api/health');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true, version: VERSION });
  });
  // Audit SEC-F1: a squatter on the port could pass the old pid check and receive the token URL.
  // The challenge form proves knowledge of the token: HMAC-SHA256(token, challenge|port|pid|version).
  // Audit S2-N1: the proof binds the port the hub listens on, so a relay on another port is caught.
  it('health with a challenge returns pid and an HMAC proof over challenge, listening port, pid and version', async () => {
    const u = await start(fakeProvider());
    const challenge = crypto.randomBytes(16).toString('hex');
    const r = await req(u, `/api/health?challenge=${challenge}`);
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    const proof = crypto.createHmac('sha256', TOKEN).update(`${challenge}|${u.port}|${process.pid}|${VERSION}`).digest('hex');
    expect(body).toEqual({ ok: true, version: VERSION, pid: process.pid, proof });
    for (const bad of ['xyz', 'a'.repeat(31), 'A'.repeat(32), 'a'.repeat(33)]) {
      expect((await req(u, `/api/health?challenge=${bad}`)).status).toBe(400);
    }
  });
  it('rejects foreign Origin', async () => {
    const u = await start(fakeProvider());
    expect((await req(u, '/api/sessions', { headers: { ...auth, origin: 'http://evil.com' } })).status).toBe(403);
    expect((await req(u, '/api/health', { headers: { origin: 'http://evil.com' } })).status).toBe(403);
    expect((await req(u, '/api/sessions', { headers: { ...auth, origin: `http://localhost:${u.port}` } })).status).toBe(200);
  });
  it('rejects foreign Host', async () => {
    const u = await start(fakeProvider());
    expect((await req(u, '/api/sessions', { headers: { ...auth, host: 'evil.com' } })).status).toBe(403);
    expect((await req(u, '/', { headers: { host: 'evil.com' } })).status).toBe(403);
    expect((await req(u, '/api/health', { headers: { host: `localhost:${u.port}` } })).status).toBe(200);
  });
  it('token via query rejected outside /api/stream', async () => {
    const u = await start(fakeProvider());
    expect((await req(u, `/api/sessions?token=${TOKEN}`)).status).toBe(401);
    const s = await openStream(u, `/api/stream?token=${TOKEN}`);
    expect(s.res.statusCode).toBe(200);
    s.req.destroy();
  });
  it('security headers present', async () => {
    const u = await start(fakeProvider());
    const r = await req(u, '/api/sessions', { headers: auth });
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(Object.keys(r.headers).some((h) => h.startsWith('access-control-'))).toBe(false);
    const h = await req(u, '/');
    expect(h.headers['content-security-policy']).toBe(
      "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    );
    expect(h.headers['x-content-type-options']).toBe('nosniff');
    const bad = await req(u, '/api/sessions');
    expect(bad.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('api', () => {
  it('lists sessions', async () => {
    const u = await start(fakeProvider());
    const r = await req(u, '/api/sessions', { headers: auth });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).connected[0].sessionId).toBe('s1');
  });
  it('lists events', async () => {
    const u = await start(fakeProvider());
    const r = await req(u, '/api/sessions/s1/events', { headers: auth });
    expect(JSON.parse(r.body)).toEqual([]);
  });
  it('posts message returns 202 and calls provider.send', async () => {
    const p = fakeProvider();
    const u = await start(p);
    const r = await req(u, '/api/sessions/s1/messages', { method: 'POST', headers: json, body: JSON.stringify({ text: ' hi ' }) });
    expect(r.status).toBe(202);
    expect(JSON.parse(r.body)).toEqual({ id: 'm1' });
    expect(p.send).toHaveBeenCalledWith('s1', ' hi ');
  });
  it('posting to disconnected returns 409', async () => {
    const u = await start(fakeProvider({ send: async (sid) => { throw new SessionDisconnectedError(sid); } }));
    const r = await req(u, '/api/sessions/s1/messages', { method: 'POST', headers: json, body: JSON.stringify({ text: 'x' }) });
    expect(r.status).toBe(409);
    expect(JSON.parse(r.body)).toEqual({ error: 'session disconnected', code: 'session-disconnected' });
  });
  // Audit R5-M1: the app tells "restart this session" apart from "disconnected".
  it('posting to a session of another protocol returns 409 with its code', async () => {
    for (const direction of ['older', 'newer'] as const) {
      const u = await start(fakeProvider({ send: async (sid) => { throw new SessionProtocolError(sid, direction); } }));
      const r = await req(u, '/api/sessions/s1/messages', { method: 'POST', headers: json, body: JSON.stringify({ text: 'x' }) });
      expect(r.status).toBe(409);
      expect(JSON.parse(r.body)).toEqual({ error: `session runs ${direction === 'older' ? 'an older' : 'a newer'} version`, code: `session-${direction}-version` });
    }
  });
  it('other errors return generic 500', async () => {
    const u = await start(fakeProvider({ send: async () => { throw new Error('secret detail ' + TOKEN); } }));
    const r = await req(u, '/api/sessions/s1/messages', { method: 'POST', headers: json, body: JSON.stringify({ text: 'x' }) });
    expect(r.status).toBe(500);
    expect(r.body).not.toContain('secret');
  });
  it('empty text returns 400', async () => {
    const u = await start(fakeProvider());
    for (const body of [{ text: '   ' }, { text: 5 }, {}, { text: 'x'.repeat(32_001) }]) {
      const r = await req(u, '/api/sessions/s1/messages', { method: 'POST', headers: json, body: JSON.stringify(body) });
      expect(r.status).toBe(400);
    }
  });
  it('invalid JSON returns 400', async () => {
    const u = await start(fakeProvider());
    const r = await req(u, '/api/sessions/s1/messages', { method: 'POST', headers: json, body: '{nope' });
    expect(r.status).toBe(400);
  });
  it('body too large returns 413', async () => {
    const u = await start(fakeProvider());
    const r = await req(u, '/api/sessions/s1/messages', { method: 'POST', headers: json, body: JSON.stringify({ text: 'x'.repeat(70_000) }) });
    expect(r.status).toBe(413);
  });
  it('wrong content type returns 415', async () => {
    const u = await start(fakeProvider());
    const r = await req(u, '/api/sessions/s1/messages', { method: 'POST', headers: { ...auth, 'content-type': 'text/plain' }, body: '{"text":"x"}' });
    expect(r.status).toBe(415);
  });
  it('config roundtrip', async () => {
    const u = await start(fakeProvider());
    expect(JSON.parse((await req(u, '/api/config', { headers: auth })).body)).toEqual({ language: 'en', answersFromApp: false, openWindow: false });
    const put = await req(u, '/api/config', { method: 'PUT', headers: json, body: JSON.stringify({ language: 'pt-BR' }) });
    expect(put.status).toBe(200);
    expect(JSON.parse((await req(u, '/api/config', { headers: auth })).body)).toEqual({ language: 'pt-BR', answersFromApp: false, openWindow: false });
  });
  it('invalid language returns 400', async () => {
    const u = await start(fakeProvider());
    const r = await req(u, '/api/config', { method: 'PUT', headers: json, body: JSON.stringify({ language: 'xx' }) });
    expect(r.status).toBe(400);
  });
  it('unknown api route returns 404', async () => {
    const u = await start(fakeProvider());
    expect((await req(u, '/api/nope', { headers: auth })).status).toBe(404);
  });
});

describe('answers endpoint', () => {
  const Q = { question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] };
  const post = (u: URL, id: string, body: unknown, sid = 's1') =>
    req(u, `/api/sessions/${sid}/questions/${id}`, { method: 'POST', headers: json, body: JSON.stringify(body) });
  const seed = (id = 'tu1') => putPending('s1', { toolUseId: id, questions: [Q], createdAt: '2026-01-01T00:00:00.000Z' });
  beforeEach(async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: 42 });
  });

  it('requires auth and a valid Origin', async () => {
    const u = await start(fakeProvider());
    expect((await req(u, '/api/sessions/s1/questions/tu1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
    expect((await req(u, '/api/sessions/s1/questions/tu1', { method: 'POST', headers: { ...json, origin: 'http://evil.com' }, body: '{}' })).status).toBe(403);
  });
  it('403 when answersFromApp is off (answers and release)', async () => {
    const u = await start(fakeProvider());
    await seed();
    expect((await post(u, 'tu1', { answers: { 'Which?': 'A' } })).status).toBe(403);
    expect((await post(u, 'tu1', { release: true })).status).toBe(403);
    expect(await readAnswer('s1', 'tu1')).toBeNull();
  });
  it('202 writes the answer; a second one is 409', async () => {
    const u = await start(fakeProvider());
    await saveConfig({ answersFromApp: true });
    await seed();
    const r = await post(u, 'tu1', { answers: { 'Which?': 'A' } });
    expect(r.status).toBe(202);
    expect(JSON.parse(r.body)).toEqual({ ok: true });
    expect(await readAnswer('s1', 'tu1')).toEqual({ answers: { 'Which?': 'A' } });
    expect((await post(u, 'tu1', { release: true })).status).toBe(409);
  });
  it('202 for release', async () => {
    const u = await start(fakeProvider());
    await saveConfig({ answersFromApp: true });
    await seed();
    expect((await post(u, 'tu1', { release: true })).status).toBe(202);
    expect(await readAnswer('s1', 'tu1')).toEqual({ release: true });
  });
  it('400 for invalid tool use id, body or answers', async () => {
    const u = await start(fakeProvider());
    await saveConfig({ answersFromApp: true });
    await seed();
    expect((await post(u, 'bad.id', { release: true })).status).toBe(400);
    expect((await post(u, '..%2Fx', { release: true })).status).toBe(400);
    expect((await post(u, 'tu1', {})).status).toBe(400);
    expect((await post(u, 'tu1', { release: false })).status).toBe(400);
    expect((await post(u, 'tu1', 'str')).status).toBe(400);
    expect((await post(u, 'tu1', { answers: { 'Other?': 'A' } })).status).toBe(400);
    expect((await post(u, 'tu1', { answers: { 'Which?': '' } })).status).toBe(400);
    expect(await readAnswer('s1', 'tu1')).toBeNull();
  });
  it('404 when nothing is pending with that id, or the session id is invalid', async () => {
    const u = await start(fakeProvider());
    await saveConfig({ answersFromApp: true });
    expect((await post(u, 'tu1', { release: true })).status).toBe(404);
    await seed('other');
    expect((await post(u, 'tu1', { release: true })).status).toBe(404);
    expect((await post(u, 'tu1', { release: true }, '..%2Fx')).status).toBe(404);
  });
  it('404 when the session is not registered or no longer active (a stale pending question)', async () => {
    const u = await start(fakeProvider());
    await saveConfig({ answersFromApp: true });
    await seed();
    await markDisconnected('s1', 'off');
    expect((await post(u, 'tu1', { answers: { 'Which?': 'A' } })).status).toBe(404);
    expect((await post(u, 'tu1', { release: true })).status).toBe(404);
    await putPending('s2', { toolUseId: 'tu1', questions: [Q], createdAt: '2026-01-01T00:00:00.000Z' });
    expect((await post(u, 'tu1', { release: true }, 's2')).status).toBe(404);
    expect(await readAnswer('s1', 'tu1')).toBeNull();
    expect(await readAnswer('s2', 'tu1')).toBeNull();
  });
  it('PUT /api/config ignores answersFromApp in the body', async () => {
    const u = await start(fakeProvider());
    await req(u, '/api/config', { method: 'PUT', headers: json, body: JSON.stringify({ language: 'pt-BR', answersFromApp: true }) });
    expect((await loadConfig()).answersFromApp).toBe(false);
    await saveConfig({ answersFromApp: true });
    await req(u, '/api/config', { method: 'PUT', headers: json, body: JSON.stringify({ language: 'en', answersFromApp: false }) });
    expect(await loadConfig()).toEqual({ language: 'en', answersFromApp: true, openWindow: false });
  });
  it('PUT /api/config preserves openWindow', async () => {
    const u = await start(fakeProvider());
    await saveConfig({ openWindow: true });
    await req(u, '/api/config', { method: 'PUT', headers: json, body: JSON.stringify({ language: 'pt-BR', openWindow: false }) });
    expect(await loadConfig()).toMatchObject({ language: 'pt-BR', openWindow: true });
  });
});

describe('app presence', () => {
  const readPresence = () => JSON.parse(fs.readFileSync(paths().presenceFile, 'utf8')) as { clients: number; at: number };
  const until = async (f: () => boolean) => {
    const end = Date.now() + 3000;
    while (!f()) {
      if (Date.now() > end) throw new Error('timeout');
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  it('tracks connected tabs and zeroes on close', async () => {
    const u = await start(fakeProvider());
    const a = await openStream(u, '/api/stream', auth);
    await until(() => fs.existsSync(paths().presenceFile) && readPresence().clients === 1);
    const b = await openStream(u, '/api/stream', auth);
    await until(() => readPresence().clients === 2);
    a.req.destroy();
    await until(() => readPresence().clients === 1);
    await hub!.close();
    hub = undefined;
    expect(readPresence().clients).toBe(0);
    b.req.destroy();
  });
  it('the heartbeat refreshes at', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      const u = await start(fakeProvider());
      const s = await openStream(u, '/api/stream', auth);
      await vi.waitFor(() => expect(fs.existsSync(paths().presenceFile)).toBe(true));
      const t0 = readPresence().at;
      await vi.advanceTimersByTimeAsync(16_000);
      await vi.waitFor(() => expect(readPresence().at).toBeGreaterThan(t0));
      s.req.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('stream', () => {
  it('stream delivers events after provider change', async () => {
    const p = fakeProvider();
    const u = await start(p);
    const s = await openStream(u, '/api/stream', auth);
    expect(s.res.headers['content-type']).toContain('text/event-stream');
    await s.next(/retry: 3000/);
    p.queue.push([{ type: 'events', sessionId: 's1', events: [{ kind: 'assistant', id: 'e1', ts: 't', text: 'yo' }] }]);
    const got = await s.next(/event: events\ndata: .*\n\n/);
    expect(got.indexOf('retry: 3000')).toBe(0);
    expect(got).toContain('"sessionId":"s1"');
    s.req.destroy();
  });
  it('stream requires token', async () => {
    const u = await start(fakeProvider());
    const s = await openStream(u, '/api/stream');
    expect(s.res.statusCode).toBe(401);
    s.req.destroy();
  });
  it('one poll timer shared by two stream clients', async () => {
    const p = fakeProvider();
    const u = await start(p, { pollMs: 50 });
    const a = await openStream(u, '/api/stream', auth);
    const b = await openStream(u, '/api/stream', auth);
    await a.next(/retry/); await b.next(/retry/);
    const before = p.pollCalls;
    const t0 = Date.now();
    await vi.waitFor(() => expect(p.pollCalls - before).toBeGreaterThanOrEqual(6), { timeout: 10_000, interval: 10 });
    const calls = p.pollCalls - before;
    // one 50 ms chain: at most elapsed/50 (+1); two timers would give about twice that
    expect(calls).toBeLessThanOrEqual(Math.floor((Date.now() - t0) / 50) + 1);
    p.queue.push([{ type: 'sessions' }]);
    await a.next(/event: sessions/); await b.next(/event: sessions/);
    a.req.destroy(); b.req.destroy();
    await stopsPolling(p);
  });
  it('reconnect during in-flight poll keeps a single poll chain', async () => {
    let active = 0, maxActive = 0, calls = 0;
    const p = fakeProvider({
      poll: async () => {
        calls++; active++; maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 120));
        active--;
        return [];
      },
    });
    const u = await start(p, { pollMs: 20 });
    const a = await openStream(u, '/api/stream', auth);
    await a.next(/retry/);
    await new Promise((r) => setTimeout(r, 60)); // poll is now in flight
    a.req.destroy();
    await new Promise((r) => setTimeout(r, 20));
    const b = await openStream(u, '/api/stream', auth);
    await b.next(/retry/);
    await new Promise((r) => setTimeout(r, 200));
    const before = calls;
    const t0 = Date.now();
    await vi.waitFor(() => expect(calls - before).toBeGreaterThanOrEqual(5), { timeout: 10_000, interval: 10 });
    expect(maxActive).toBe(1);
    // one chain: each poll lasts 120 ms, so at most elapsed/120 (+1); two chains would double it
    expect(calls - before).toBeLessThanOrEqual(Math.floor((Date.now() - t0) / 120) + 1);
    b.req.destroy();
    await stopsPolling({ get pollCalls() { return calls; } });
  });
  it('invalid session id returns 404', async () => {
    const u = await start(fakeProvider());
    expect((await req(u, '/api/sessions/a.b/events', { headers: auth })).status).toBe(404);
    expect((await req(u, '/api/sessions/%E0%A4%A/events', { headers: auth })).status).toBe(404);
  });
  it('survives a throwing poll', async () => {
    let n = 0;
    const p = fakeProvider({ poll: async () => { n++; if (n === 1) throw new Error('boom'); return n === 3 ? [{ type: 'sessions' }] : []; } });
    const u = await start(p);
    const s = await openStream(u, '/api/stream', auth);
    await s.next(/event: sessions/);
    s.req.destroy();
  });
});

describe('static', () => {
  it('serves built-in page when staticDir missing', async () => {
    const u = await start(fakeProvider());
    const r = await req(u, '/');
    expect(r.status).toBe(200);
    expect(r.body).toContain('UI not built');
  });
  it('serves files with content types and SPA fallback', async () => {
    const dir = path.join(home, 'ui');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), '<h1>app</h1>');
    fs.writeFileSync(path.join(dir, 'a.js'), 'x');
    fs.writeFileSync(path.join(dir, 'a.css'), 'x');
    fs.writeFileSync(path.join(dir, 'favicon.svg'), '<svg/>');
    fs.writeFileSync(path.join(dir, 'favicon-32.png'), 'x');
    fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), '{}');
    const u = await start(fakeProvider(), { staticDir: dir });
    expect((await req(u, '/manifest.webmanifest')).headers['content-type']).toBe('application/manifest+json');
    const svg = await req(u, '/favicon.svg');
    expect(svg.status).toBe(200);
    expect(svg.headers['content-type']).toBe('image/svg+xml');
    expect((await req(u, '/favicon-32.png')).headers['content-type']).toBe('image/png');
    const js = await req(u, '/a.js');
    expect(js.headers['content-type']).toContain('text/javascript');
    expect((await req(u, '/a.css')).headers['content-type']).toContain('text/css');
    const spa = await req(u, '/chat/s1', { headers: { accept: 'text/html' } });
    expect(spa.body).toBe('<h1>app</h1>');
    expect(spa.headers['content-security-policy']).toBeDefined();
    expect((await req(u, '/missing.js', { headers: { accept: 'text/html' } })).status).toBe(404);
    expect((await req(u, '/chat/s1', { headers: { accept: 'application/json' } })).status).toBe(404);
    expect((await req(u, '/x', { method: 'POST', headers: { accept: 'text/html' } })).status).toBe(404);
  });
  it('path traversal is blocked', async () => {
    const dir = path.join(home, 'ui');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), 'ok');
    fs.writeFileSync(path.join(home, 'secret.txt'), 'SECRET');
    const u = await start(fakeProvider(), { staticDir: dir });
    for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/%2e%2e%2fsecret.txt', '/a%00b']) {
      const r = await req(u, p);
      expect(r.status).toBe(404);
      expect(r.body).not.toContain('SECRET');
    }
  });
});

// Audit R3-F7: the only 'error' listener was removed once listening, so an accept-time error (EMFILE)
// emitted on the server crashed the hub.
describe('server errors after listen', () => {
  it('are logged and the hub keeps serving', async () => {
    const lines: string[] = [];
    const h = await createHub({ provider: fakeProvider(), token: TOKEN, port: 0, staticDir: path.join(os.tmpdir(), 'nope'), log: (m) => lines.push(m) });
    try {
      expect(() => h.server.emit('error', Object.assign(new Error('too many open files'), { code: 'EMFILE' }))).not.toThrow();
      expect(lines.some((l) => l.includes('EMFILE'))).toBe(true);
      const port = new URL(h.url).port;
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(r.status).toBe(200);
    } finally {
      await h.close();
    }
  });
});

describe('name endpoint', () => {
  const put = (u: URL, body: unknown, sid = 's1', headers: Record<string, string> = json) =>
    req(u, `/api/sessions/${sid}/name`, { method: 'PUT', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
  beforeEach(async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: 42 });
  });
  it('200 sets the name and returns the displayed one; "" clears', async () => {
    const u = await start(fakeProvider());
    const r = await put(u, { name: 'Mine' });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ name: 'Mine' });
    expect(await getDisplayName('s1')).toBe('Mine');
    const c = await put(u, { name: '' });
    expect(c.status).toBe(200);
    expect(JSON.parse(c.body)).toEqual({ name: 'n' });
    expect(await getDisplayName('s1')).toBeNull();
  });
  it('400 for invalid body or name', async () => {
    const u = await start(fakeProvider());
    for (const b of ['not json', '[]', 'null', {}, { name: 5 }, { name: ' a' }, { name: 'a'.repeat(81) }]) {
      expect((await put(u, b)).status).toBe(400);
    }
    expect(await getDisplayName('s1')).toBeNull();
  });
  it('404 for a session without registration or an invalid id', async () => {
    const u = await start(fakeProvider());
    expect((await put(u, { name: 'x' }, 'nope')).status).toBe(404);
    expect((await put(u, { name: 'x' }, '..%2Fx')).status).toBe(404);
  });
  it('401 without token and 403 for a foreign Origin', async () => {
    const u = await start(fakeProvider());
    expect((await put(u, { name: 'x' }, 's1', { 'content-type': 'application/json' })).status).toBe(401);
    expect((await put(u, { name: 'x' }, 's1', { ...json, origin: 'http://evil.com' })).status).toBe(403);
    expect(await getDisplayName('s1')).toBeNull();
  });
});

describe('pairing endpoints', () => {
  const pairCode = (u: URL, headers: Record<string, string> = auth) => req(u, '/api/pair-code', { method: 'POST', headers });
  const pair = (u: URL, body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
    req(u, '/api/pair', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

  it('pair-code needs the token and returns a one-time code that pair trades for the token', async () => {
    const u = await start(fakeProvider());
    expect((await pairCode(u, {})).status).toBe(401);
    expect((await pairCode(u, { authorization: 'Bearer wrong' })).status).toBe(401);
    const r = await pairCode(u);
    expect(r.status).toBe(200);
    const { code } = JSON.parse(r.body);
    expect(code).toMatch(/^[0-9a-f]{64}$/);
    const ok = await pair(u, { code });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ token: TOKEN });
    expect(ok.headers['cache-control']).toBe('no-store');
    const again = await pair(u, { code });
    expect(again.status).toBe(400);
    expect(again.body.includes(TOKEN)).toBe(false);
  });
  it('pair-code only answers POST', async () => {
    const u = await start(fakeProvider());
    expect((await req(u, '/api/pair-code', { headers: auth })).status).toBe(404);
    expect((await req(u, '/api/pair', { headers: auth })).status).toBe(404);
  });
  it('pair rejects unknown codes and bad bodies with 400', async () => {
    const u = await start(fakeProvider());
    for (const body of [{ code: 'f'.repeat(64) }, { code: 1 }, {}, [], null, 'nope']) {
      expect((await pair(u, body)).status).toBe(400);
    }
  });
  it('pair keeps the Origin/Host checks, content type and body limit', async () => {
    const u = await start(fakeProvider());
    const { code } = JSON.parse((await pairCode(u)).body);
    expect((await pair(u, { code }, { 'content-type': 'application/json', origin: 'http://evil.com' })).status).toBe(403);
    expect((await pair(u, { code }, { 'content-type': 'application/json', host: 'evil.com' })).status).toBe(403);
    expect((await pair(u, { code }, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await pair(u, 'x'.repeat(70 * 1024))).status).toBe(413);
    // none of the rejected attempts consumed the code
    const ok = await pair(u, { code }, { 'content-type': 'application/json', origin: `http://127.0.0.1:${u.port}` });
    expect(ok.status).toBe(200);
  });
});

describe('one app window', () => {
  const J = { ...auth, 'content-type': 'application/json' };
  const ping = (u: URL, body: unknown, headers: Record<string, string> = J) =>
    req(u, '/api/window', { method: 'POST', headers, body: JSON.stringify(body) });
  const ask = (u: URL, body?: unknown) =>
    req(u, '/api/pair-code', { method: 'POST', headers: body === undefined ? auth : J, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const W1 = 'a'.repeat(32);
  const W2 = 'b'.repeat(32);

  it('no page open: pair-code issues a code, with or without a body', async () => {
    const u = await start(fakeProvider());
    expect(JSON.parse((await ask(u)).body).code).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse((await ask(u, { sessionId: 's1' })).body).code).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a page that pings counts as open: pair-code answers live, no code, and the page gets the session', async () => {
    const u = await start(fakeProvider());
    expect(JSON.parse((await ping(u, { id: W1 })).body)).toEqual({ focus: null });
    const r = JSON.parse((await ask(u, { sessionId: 's1' })).body);
    expect(r).toEqual({ live: true });
    expect(JSON.parse((await ping(u, { id: W1 })).body)).toEqual({ focus: { seq: 1, sessionId: 's1' } });
    await ask(u, { sessionId: 's2' });
    expect(JSON.parse((await ping(u, { id: W1 })).body).focus).toEqual({ seq: 2, sessionId: 's2' });
    // an invalid session id is not passed on
    await ask(u, { sessionId: '../x' });
    expect(JSON.parse((await ping(u, { id: W1 })).body).focus.seq).toBe(2);
  });

  it('a page with an open stream is told at once that a session asks for it', async () => {
    const u = await start(fakeProvider());
    await ping(u, { id: W1 });
    const st = await openStream(u, '/api/stream', auth);
    await ask(u, { sessionId: 's1' });
    expect(await st.next(/event: focus\ndata: \{\}\n\n/)).toMatch(/event: focus/);
    st.req.destroy();
  });

  it('a page that closed or stopped pinging no longer counts', async () => {
    let t = 1_000_000;
    const u = await start(fakeProvider(), { now: () => t });
    await ping(u, { id: W1 });
    await ping(u, { id: W2 });
    await ping(u, { id: W1, closing: true });
    expect(JSON.parse((await ask(u)).body).live).toBe(true); // W2 still open
    expect(hub!.windows()).toBe(1); // holds the hub up (main.ts idle check)
    t += WINDOW_FRESH_MS;
    expect(hub!.windows()).toBe(0);
    expect(JSON.parse((await ask(u)).body).code).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the window route needs the token and a valid id', async () => {
    const u = await start(fakeProvider());
    expect((await ping(u, { id: W1 }, { 'content-type': 'application/json' })).status).toBe(401);
    for (const body of [{}, { id: 'x' }, { id: 'A'.repeat(32) }, []]) expect((await ping(u, body)).status).toBe(400);
    expect(JSON.parse((await ask(u)).body).code).toBeDefined();
  });
});

describe('pin and disconnect endpoints', () => {
  const call = (u: URL, what: string, method: string, body?: unknown, sid = 's1', headers: Record<string, string> = auth) =>
    req(u, `/api/sessions/${sid}/${what}`, { method, headers: { ...headers, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  beforeEach(async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: 42 });
  });
  it('pin: 200 stores and clears; 400 bad body; 404 unknown; 401/403 without checks', async () => {
    const u = await start(fakeProvider());
    const r = await call(u, 'pin', 'PUT', { pinned: true });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ pinned: true });
    expect(await isPinned('s1')).toBe(true);
    expect((await call(u, 'pin', 'PUT', { pinned: false })).status).toBe(200);
    expect(await isPinned('s1')).toBe(false);
    for (const b of [{}, { pinned: 'yes' }, [], { pinned: 1 }]) expect((await call(u, 'pin', 'PUT', b)).status).toBe(400);
    expect((await call(u, 'pin', 'PUT', { pinned: true }, 'nope')).status).toBe(404);
    expect((await call(u, 'pin', 'PUT', { pinned: true }, 's1', {})).status).toBe(401);
    expect((await call(u, 'pin', 'PUT', { pinned: true }, 's1', { ...auth, origin: 'http://evil.com' })).status).toBe(403);
    expect(await isPinned('s1')).toBe(false);
    expect((await call(u, 'pin', 'POST', { pinned: true })).status).toBe(404);
  });
  it('disconnect: 200 ends an active session like /cc off and keeps it listed (not removed); 409 when already ended', async () => {
    const u = await start(fakeProvider());
    const r = await call(u, 'disconnect', 'POST');
    expect(r.status).toBe(200);
    const reg = (await getRegistration('s1'))!;
    expect(reg.disconnectReason).toBe('off');
    expect(reg.disconnectedAt).toBeDefined();
    expect(isRemoved(reg)).toBe(false);
    expect((await call(u, 'disconnect', 'POST')).status).toBe(409);
  });
  it('disconnect: 404 unknown, 401/403 without checks (nothing changes), only POST', async () => {
    const u = await start(fakeProvider());
    expect((await call(u, 'disconnect', 'POST', undefined, 'nope')).status).toBe(404);
    expect((await call(u, 'disconnect', 'POST', undefined, 's1', {})).status).toBe(401);
    expect((await call(u, 'disconnect', 'POST', undefined, 's1', { ...auth, origin: 'http://evil.com' })).status).toBe(403);
    expect((await call(u, 'disconnect', 'GET')).status).toBe(404);
    expect((await getRegistration('s1'))!.disconnectedAt).toBeUndefined();
  });
});

describe('remove endpoint', () => {
  const post = (u: URL, sid = 's1', headers: Record<string, string> = auth) => req(u, `/api/sessions/${sid}/remove`, { method: 'POST', headers });
  beforeEach(async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: 42 });
  });
  it('200 disconnects an active session with reason removed and marks it removed', async () => {
    const u = await start(fakeProvider());
    const r = await post(u);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true });
    const reg = (await getRegistration('s1'))!;
    expect(reg.disconnectReason).toBe('removed');
    expect(isRemoved(reg)).toBe(true);
  });
  it('200 for an ended session: only marks it', async () => {
    await markDisconnected('s1', 'off');
    const u = await start(fakeProvider());
    expect((await post(u)).status).toBe(200);
    const reg = (await getRegistration('s1'))!;
    expect(reg.disconnectReason).toBe('off');
    expect(isRemoved(reg)).toBe(true);
  });
  it('404 for an unknown session or an invalid id', async () => {
    const u = await start(fakeProvider());
    expect((await post(u, 'nope')).status).toBe(404);
    expect((await post(u, '..%2Fx')).status).toBe(404);
  });
  it('401 without token and 403 for a foreign Origin; nothing changes', async () => {
    const u = await start(fakeProvider());
    expect((await post(u, 's1', {})).status).toBe(401);
    expect((await post(u, 's1', { ...auth, origin: 'http://evil.com' })).status).toBe(403);
    const reg = (await getRegistration('s1'))!;
    expect(reg.disconnectedAt).toBeUndefined();
    expect(isRemoved(reg)).toBe(false);
  });
  it('only POST', async () => {
    const u = await start(fakeProvider());
    expect((await req(u, '/api/sessions/s1/remove', { headers: auth })).status).toBe(404);
  });
  it('open streams get a sessions change at once', async () => {
    const u = await start(fakeProvider(), { pollMs: 60_000 });
    const s = await openStream(u, '/api/stream', auth);
    try {
      expect((await post(u)).status).toBe(200);
      await s.next(/event: sessions/);
    } finally {
      s.req.destroy();
    }
  });
});
