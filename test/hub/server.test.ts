import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { createHub, WINDOW_FRESH_MS, type HubOptions } from '../../src/hub/server.js';
import { isResuming, resetResumeStates, resumeView } from '../../src/hub/resumeState.js';
import type { LiveSession } from '../../src/shared/types.js';
import { SessionDisconnectedError, SessionProtocolError, type Provider } from '../../src/hub/provider.js';
import type { ProviderChange } from '../../src/shared/types.js';
import { PROTOCOL, VERSION } from '../../src/core/version.js';
import { tmpDir } from '../helpers/tmp.js';
import { fakePng } from '../helpers/png.js';
import { saveConfig, loadConfig } from '../../src/core/config.js';
import { putPending, readAnswer } from '../../src/core/questions.js';
import { paths } from '../../src/core/paths.js';
import { getDisplayName } from '../../src/core/names.js';
import { isPinned } from '../../src/core/pins.js';
import { register, markDisconnected, markRemoved, getRegistration, isActive, isRemoved } from '../../src/core/registry.js';

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

async function start(provider: Provider, extra: { staticDir?: string; pollMs?: number; now?: () => number; bg?: HubOptions['bg'] } = {}) {
  hub = await createHub({ provider, token: TOKEN, port: 0, staticDir: extra.staticDir ?? path.join(home, 'nope'), pollMs: extra.pollMs ?? 20, now: extra.now, bg: extra.bg });
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
      "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'",
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
    expect(JSON.parse((await req(u, '/api/config', { headers: auth })).body)).toEqual({ language: 'en', answersFromApp: false, openWindow: true });
    const put = await req(u, '/api/config', { method: 'PUT', headers: json, body: JSON.stringify({ language: 'pt-BR' }) });
    expect(put.status).toBe(200);
    expect(JSON.parse((await req(u, '/api/config', { headers: auth })).body)).toEqual({ language: 'pt-BR', answersFromApp: false, openWindow: true });
  });
  it('invalid language returns 400', async () => {
    const u = await start(fakeProvider());
    const r = await req(u, '/api/config', { method: 'PUT', headers: json, body: JSON.stringify({ language: 'xx' }) });
    expect(r.status).toBe(400);
  });
  it('PUT /api/window-size saves a normalized size that GET /api/config returns', async () => {
    const u = await start(fakeProvider());
    const put = await req(u, '/api/window-size', { method: 'PUT', headers: json, body: JSON.stringify({ width: 1400.4, height: 900, extra: 'x' }) });
    expect(put.status).toBe(200);
    expect(JSON.parse(put.body)).toEqual({ windowSize: { width: 1400, height: 900 } });
    expect(JSON.parse((await req(u, '/api/config', { headers: auth })).body).windowSize).toEqual({ width: 1400, height: 900 });
    await req(u, '/api/window-size', { method: 'PUT', headers: json, body: JSON.stringify({ width: 1e9, height: 1 }) });
    expect((await loadConfig()).windowSize).toEqual({ width: 8192, height: 480 });
  });
  it('PUT /api/window-size refuses no token, a bad body or a non-JSON body, and keeps the other settings', async () => {
    const u = await start(fakeProvider());
    await saveConfig({ language: 'pt-BR', openWindow: false });
    const body = JSON.stringify({ width: 1400, height: 900 });
    expect((await req(u, '/api/window-size', { method: 'PUT', headers: { 'content-type': 'application/json' }, body })).status).toBe(401);
    expect((await req(u, '/api/window-size', { method: 'PUT', headers: json, body: JSON.stringify({ width: '1400', height: 900 }) })).status).toBe(400);
    expect((await req(u, '/api/window-size', { method: 'PUT', headers: json, body: '[]' })).status).toBe(400);
    expect((await req(u, '/api/window-size', { method: 'PUT', headers: { ...auth, 'content-type': 'text/plain' }, body })).status).toBe(415);
    expect((await loadConfig()).windowSize).toBeUndefined();
    await req(u, '/api/window-size', { method: 'PUT', headers: json, body });
    expect(await loadConfig()).toEqual({ language: 'pt-BR', answersFromApp: false, openWindow: false, windowSize: { width: 1400, height: 900 } });
  });
  it('PUT /api/config keeps the saved window size', async () => {
    const u = await start(fakeProvider());
    await saveConfig({ windowSize: { width: 1400, height: 900 } });
    await req(u, '/api/config', { method: 'PUT', headers: json, body: JSON.stringify({ language: 'pt-BR', windowSize: { width: 600, height: 600 } }) });
    expect((await loadConfig()).windowSize).toEqual({ width: 1400, height: 900 });
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
    expect(await loadConfig()).toEqual({ language: 'en', answersFromApp: true, openWindow: true });
  });
  it('PUT /api/config preserves openWindow', async () => {
    const u = await start(fakeProvider());
    await saveConfig({ openWindow: false });
    await req(u, '/api/config', { method: 'PUT', headers: json, body: JSON.stringify({ language: 'pt-BR', openWindow: true }) });
    expect(await loadConfig()).toMatchObject({ language: 'pt-BR', openWindow: false });
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

describe('background endpoints', () => {
  const put = (u: URL, body: unknown, sid = 's1', headers: Record<string, string> = json) =>
    req(u, `/api/sessions/${sid}/background`, { method: 'PUT', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const upload = (u: URL, body: Buffer, sid = 's1', headers: Record<string, string> = { ...auth, 'content-type': 'application/octet-stream' }) =>
    req(u, `/api/sessions/${sid}/background-image`, { method: 'POST', headers, body });
  const image = (u: URL, sid = 's1', headers: Record<string, string> = auth) => req(u, `/api/sessions/${sid}/background-image`, { headers });
  /** Like req, but keeps the body as bytes. */
  const rawGet = (u: URL, p: string) =>
    new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: u.port, path: p, headers: { host: `127.0.0.1:${u.port}`, ...auth } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      r.on('error', reject);
      r.end();
    });
  const imagesOnDisk = () => {
    try {
      return fs.readdirSync(paths().backgroundsDir).filter((n) => !n.endsWith('.json'));
    } catch {
      return [];
    }
  };
  beforeEach(async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: 42 });
  });

  it('PUT sets a preset or none, and tells open pages at once', async () => {
    const { getBackground } = await import('../../src/core/background.js');
    const u = await start(fakeProvider(), { pollMs: 60_000 });
    const s = await openStream(u, '/api/stream', auth);
    try {
      const r = await put(u, { kind: 'gradient', value: 'aurora' });
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body)).toEqual({ background: { kind: 'gradient', value: 'aurora' } });
      expect(await getBackground('s1')).toEqual({ kind: 'gradient', value: 'aurora' });
      await s.next(/event: sessions/);
      expect((await put(u, null)).status).toBe(200);
      expect(await getBackground('s1')).toBeNull();
    } finally {
      s.req.destroy();
    }
  });
  it('PUT: 400 for raw CSS, unknown ids or an image; 404 for an unknown session; 401/403', async () => {
    const { getBackground } = await import('../../src/core/background.js');
    const u = await start(fakeProvider());
    for (const b of ['nope', '[]', '"rose"', {}, { kind: 'color', value: 'url(x)' }, { kind: 'image', file: 's1-0123456789abcdef.png' }]) {
      expect((await put(u, b)).status).toBe(400);
    }
    expect((await put(u, { kind: 'color', value: 'rose' }, 'nope')).status).toBe(404);
    expect((await put(u, { kind: 'color', value: 'rose' }, '..%2Fx')).status).toBe(404);
    expect((await put(u, { kind: 'color', value: 'rose' }, 's1', { 'content-type': 'application/json' })).status).toBe(401);
    expect((await put(u, { kind: 'color', value: 'rose' }, 's1', { ...json, origin: 'http://evil.com' })).status).toBe(403);
    expect(await getBackground('s1')).toBeNull();
  });

  it('POST image stores it; GET returns it with its type; a new upload replaces it; a preset removes it', async () => {
    const u = await start(fakeProvider());
    const png = fakePng(3, 3);
    const r = await upload(u, png);
    expect(r.status).toBe(200);
    const bg = JSON.parse(r.body).background;
    expect(bg).toMatchObject({ kind: 'image' });
    const g = await rawGet(u, '/api/sessions/s1/background-image');
    expect(g.status).toBe(200);
    expect(g.headers['content-type']).toBe('image/png');
    expect(g.headers['cache-control']).toBe('no-store');
    expect(g.body.equals(png)).toBe(true);
    const gif = Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1');
    const r2 = await upload(u, gif, 's1', { ...auth, 'content-type': 'image/gif' });
    expect(r2.status).toBe(200);
    expect(imagesOnDisk()).toEqual([JSON.parse(r2.body).background.file]);
    if (process.platform !== 'win32') expect(fs.statSync(path.join(paths().backgroundsDir, imagesOnDisk()[0])).mode & 0o777).toBe(0o600);
    expect((await put(u, { kind: 'color', value: 'slate' })).status).toBe(200);
    expect(imagesOnDisk()).toEqual([]);
    expect((await image(u)).status).toBe(404);
  });
  it('POST image: 415 for something that is not png/jpeg/webp/gif (an SVG, say)', async () => {
    const u = await start(fakeProvider());
    const r = await upload(u, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 's1', {
      ...auth,
      'content-type': 'image/png',
    });
    expect(r.status).toBe(415);
    expect(imagesOnDisk()).toEqual([]);
  });
  it('POST image: 413 over 5 MB, declared or streamed, and nothing is stored', async () => {
    const u = await start(fakeProvider());
    const big = Buffer.concat([fakePng(1, 1), Buffer.alloc(5 * 1024 * 1024)]);
    expect((await upload(u, big)).status).toBe(413);
    // Chunked: no content-length, the limit applies while reading.
    const status = await new Promise<number>((resolve, reject) => {
      const r = http.request(
        {
          host: '127.0.0.1',
          port: u.port,
          path: '/api/sessions/s1/background-image',
          method: 'POST',
          headers: { host: `127.0.0.1:${u.port}`, ...auth, 'transfer-encoding': 'chunked' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      r.on('error', (e) => ((e as NodeJS.ErrnoException).code === 'EPIPE' || (e as NodeJS.ErrnoException).code === 'ECONNRESET' ? undefined : reject(e)));
      r.write(fakePng(1, 1));
      for (let i = 0; i < 6; i++) r.write(Buffer.alloc(1024 * 1024));
      r.end();
    });
    expect(status).toBe(413);
    expect(imagesOnDisk()).toEqual([]);
  });
  it('image routes: 404 for an unknown session; 401 without the bearer (also with ?token=); 403 for a foreign Origin', async () => {
    const u = await start(fakeProvider());
    expect((await upload(u, fakePng(1, 1), 'nope')).status).toBe(404);
    expect((await upload(u, fakePng(1, 1), 's1', {})).status).toBe(401);
    expect((await upload(u, fakePng(1, 1), 's1', { ...auth, origin: 'http://evil.com' })).status).toBe(403);
    expect(imagesOnDisk()).toEqual([]);
    expect((await upload(u, fakePng(1, 1))).status).toBe(200);
    expect((await image(u, 's1', {})).status).toBe(401);
    expect((await req(u, `/api/sessions/s1/background-image?token=${TOKEN}`)).status).toBe(401);
    expect((await image(u, 's1', { ...auth, origin: 'http://evil.com' })).status).toBe(403);
    expect((await image(u, 'nope')).status).toBe(404);
  });
  it('the page CSP lets the app show the image from a blob: URL', async () => {
    const dir = tmpDir('acc-static-');
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
    const u = await start(fakeProvider(), { staticDir: dir });
    const r = await req(u, '/', { headers: { accept: 'text/html' } });
    expect(r.headers['content-security-policy']).toMatch(/img-src 'self' data: blob:/);
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

describe('attachments endpoint', () => {
  const up = (u: URL, body: Buffer | string, o: { sid?: string; name?: string | null; headers?: Record<string, string> } = {}) =>
    req(u, `/api/sessions/${o.sid ?? 's1'}/attachments`, {
      method: 'POST',
      headers: {
        ...auth,
        'content-type': 'image/png',
        ...(o.name === null ? {} : { 'x-file-name': encodeURIComponent(o.name ?? 'shot é.png') }),
        ...o.headers,
      },
      body,
    });
  const stored = () => {
    const dir = path.join(paths().attachmentsDir, 's1');
    return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  };
  beforeEach(async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: 42, protocol: PROTOCOL });
  });
  it('stores the raw body and returns its absolute path', async () => {
    const u = await start(fakeProvider());
    const r = await up(u, Buffer.from([1, 2, 3, 4]));
    expect(r.status).toBe(200);
    const { path: p } = JSON.parse(r.body) as { path: string };
    expect(path.isAbsolute(p)).toBe(true);
    expect(path.dirname(p)).toBe(path.join(paths().attachmentsDir, 's1'));
    expect(path.basename(p)).toMatch(/^[0-9a-f]{16}-shot é\.png$/);
    expect([...fs.readFileSync(p)]).toEqual([1, 2, 3, 4]);
    if (process.platform !== 'win32') expect(fs.statSync(p).mode & 0o777).toBe(0o600);
  });
  it('sanitizes the name: base name only', async () => {
    const u = await start(fakeProvider());
    const r = await up(u, 'x', { name: '../../evil.sh' });
    expect(r.status).toBe(200);
    const p = JSON.parse(r.body).path as string;
    expect(path.dirname(p)).toBe(path.join(paths().attachmentsDir, 's1'));
    expect(path.basename(p)).toMatch(/^[0-9a-f]{16}-evil\.sh$/);
  });
  it('400 without a file name or with a badly encoded one', async () => {
    const u = await start(fakeProvider());
    expect((await up(u, 'x', { name: null })).status).toBe(400);
    expect((await req(u, '/api/sessions/s1/attachments', { method: 'POST', headers: { ...auth, 'x-file-name': '%E0%A4%A' }, body: 'x' })).status).toBe(400);
    expect(stored()).toEqual([]);
  });
  it('413 over 20 MB (declared or streamed) and nothing is kept', async () => {
    const u = await start(fakeProvider());
    expect((await up(u, Buffer.alloc(20 * 1024 * 1024 + 1))).status).toBe(413);
    expect(stored()).toEqual([]);
    // Chunked (no Content-Length): caught while streaming.
    const status = await new Promise<number>((resolve, reject) => {
      const r = http.request(
        {
          host: '127.0.0.1', port: u.port, path: '/api/sessions/s1/attachments', method: 'POST',
          headers: { host: `127.0.0.1:${u.port}`, ...auth, 'x-file-name': 'a.bin', 'transfer-encoding': 'chunked' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      r.on('error', reject);
      for (let i = 0; i < 21; i++) r.write(Buffer.alloc(1024 * 1024));
      r.end();
    });
    expect(status).toBe(413);
    expect(stored()).toEqual([]);
  });
  it('404 for an unknown session or an invalid id, 409 for a disconnected one', async () => {
    const u = await start(fakeProvider());
    expect((await up(u, 'x', { sid: 'nope' })).status).toBe(404);
    expect((await up(u, 'x', { sid: '..%2Fx' })).status).toBe(404);
    await markDisconnected('s1', 'off');
    const r = await up(u, 'x');
    expect(r.status).toBe(409);
    expect(JSON.parse(r.body).code).toBe('session-disconnected');
    expect(stored()).toEqual([]);
  });
  it('409 with the version code for a session of another protocol, and nothing is stored', async () => {
    const u = await start(fakeProvider());
    for (const [protocol, direction] of [[PROTOCOL - 1, 'older'], [PROTOCOL + 1, 'newer'], [undefined, 'older']] as const) {
      await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: 42, protocol });
      const r = await up(u, 'x');
      expect(r.status).toBe(409);
      expect(JSON.parse(r.body).code).toBe(`session-${direction}-version`);
    }
    expect(stored()).toEqual([]);
  });
  it('401 without token and 403 for a foreign Origin; nothing is stored', async () => {
    const u = await start(fakeProvider());
    expect((await up(u, 'x', { headers: { authorization: '' } })).status).toBe(401);
    expect((await up(u, 'x', { headers: { origin: 'http://evil.com' } })).status).toBe(403);
    expect(fs.existsSync(paths().attachmentsDir)).toBe(false);
  });
  it('only POST', async () => {
    const u = await start(fakeProvider());
    expect((await req(u, '/api/sessions/s1/attachments', { headers: auth })).status).toBe(404);
  });
});

describe('resume endpoint (background sessions)', () => {
  const post = (u: URL, sid = 's1', headers: Record<string, string> = auth) => req(u, `/api/sessions/${sid}/resume`, { method: 'POST', headers });
  const live = (over: Partial<LiveSession> = {}): LiveSession => ({ pid: 7, cwd: '/x', kind: 'interactive', sessionId: 's1', name: 'n', status: 'idle', ...over });
  beforeEach(async () => {
    resetResumeStates();
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: 42 });
  });
  it('202 starts claude --bg --resume for an ended session that no longer runs', async () => {
    await markDisconnected('s1', 'exited');
    const resume = vi.fn(async () => ({ ok: true as const }));
    const u = await start(fakeProvider(), { bg: { listLive: async () => [live({ sessionId: 'other' })], resume } });
    const r = await post(u);
    expect(r.status).toBe(202);
    expect(resume).toHaveBeenCalledTimes(1);
    expect((resume.mock.calls[0] as unknown as [{ sessionId: string; cwd: string }])[0]).toMatchObject({ sessionId: 's1', cwd: '/x' });
    expect(isResuming('s1')).toBe(true);
    expect((await post(u)).status).toBe(409); // already resuming
  });
  it('409 for a connected session, and for one still running in a terminal (after /cc off)', async () => {
    const resume = vi.fn(async () => ({ ok: true as const }));
    const u = await start(fakeProvider(), { bg: { listLive: async () => [live()], resume } });
    expect((await post(u)).status).toBe(409);
    await markDisconnected('s1', 'off');
    expect((await post(u)).status).toBe(409);
    expect(resume).not.toHaveBeenCalled();
  });
  it('503 when running sessions cannot be listed: never guesses', async () => {
    await markDisconnected('s1', 'exited');
    const resume = vi.fn(async () => ({ ok: true as const }));
    const u = await start(fakeProvider(), { bg: { listLive: async () => null, resume } });
    expect((await post(u)).status).toBe(503);
    expect(resume).not.toHaveBeenCalled();
  });
  it('a failure of claude --bg becomes the resume error', async () => {
    await markDisconnected('s1', 'exited');
    const u = await start(fakeProvider(), { bg: { listLive: async () => [], resume: async () => ({ ok: false as const, error: 'Workspace not trusted.' }) } });
    expect((await post(u)).status).toBe(202);
    await new Promise((r) => setTimeout(r, 20));
    expect(resumeView('s1', null)).toEqual({ resumeError: 'Workspace not trusted.' });
  });
  it('404 for unknown or removed sessions; 401 without token', async () => {
    const u = await start(fakeProvider(), { bg: { listLive: async () => [], resume: async () => ({ ok: true as const }) } });
    expect((await post(u, 'nope')).status).toBe(404);
    expect((await post(u, 's1', {})).status).toBe(401);
    await markRemoved('s1');
    expect((await post(u)).status).toBe(404);
  });
});

describe('command endpoint (background sessions)', () => {
  const post = (u: URL, body: unknown, sid = 's1', headers: Record<string, string> = json) =>
    req(u, `/api/sessions/${sid}/command`, { method: 'POST', headers, body: JSON.stringify(body) });
  const bgLive = (over: Partial<LiveSession> = {}): LiveSession => ({ pid: 7, cwd: '/x', kind: 'background', bgId: '5e1b5e9b', sessionId: 's1', name: 'n', status: 'idle', ...over });
  beforeEach(async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: 42 });
  });
  it('200 types the command into the background session', async () => {
    const type = vi.fn(async () => {});
    const u = await start(fakeProvider(), { bg: { listLive: async () => [bgLive()], type, platform: 'linux' } });
    const r = await post(u, { text: '/compact' });
    expect(r.status).toBe(200);
    expect(type).toHaveBeenCalledWith('5e1b5e9b', '/compact');
  });
  it('400 for anything but a one-line slash command', async () => {
    const type = vi.fn(async () => {});
    const u = await start(fakeProvider(), { bg: { listLive: async () => [bgLive()], type, platform: 'linux' } });
    for (const text of ['compact', '/compact\n/clear', 7, '']) expect((await post(u, { text })).status).toBe(400);
    expect(type).not.toHaveBeenCalled();
  });
  it('404 for an interactive session or an ended one; 409 while busy; 501 on Windows', async () => {
    const type = vi.fn(async () => {});
    let list: LiveSession[] = [bgLive({ kind: 'interactive', bgId: undefined })];
    const u = await start(fakeProvider(), { bg: { listLive: async () => list, type, platform: 'linux' } });
    expect((await post(u, { text: '/compact' })).status).toBe(404);
    list = [bgLive({ status: 'busy' })];
    expect((await post(u, { text: '/compact' })).status).toBe(409);
    list = [bgLive({ status: 'waiting' })];
    expect((await post(u, { text: '/compact' })).status).toBe(409);
    await markDisconnected('s1', 'exited');
    list = [bgLive()];
    expect((await post(u, { text: '/compact' })).status).toBe(404);
    expect(type).not.toHaveBeenCalled();
    await hub!.close();
    hub = undefined;
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: 42 });
    const w = await start(fakeProvider(), { bg: { listLive: async () => list, type, platform: 'win32' } });
    expect((await post(w, { text: '/compact' })).status).toBe(501);
  });
  it('one command at a time per session; a failure is 502', async () => {
    let release!: () => void;
    const type = vi.fn(() => new Promise<void>((r) => (release = r)));
    const u = await start(fakeProvider(), { bg: { listLive: async () => [bgLive()], type, platform: 'linux' } });
    const first = post(u, { text: '/compact' });
    await vi.waitFor(() => expect(type).toHaveBeenCalledTimes(1));
    expect((await post(u, { text: '/compact' })).status).toBe(409);
    release();
    expect((await first).status).toBe(200);
    await hub!.close();
    hub = undefined;
    const f = await start(fakeProvider(), { bg: { listLive: async () => [bgLive()], type: async () => { throw new Error('the session prompt did not show'); }, platform: 'linux' } });
    expect((await post(f, { text: '/compact' })).status).toBe(502);
  });
});

describe('open-terminal endpoint (background sessions)', () => {
  const post = (u: URL, sid = 's1', headers: Record<string, string> = auth) => req(u, `/api/sessions/${sid}/open-terminal`, { method: 'POST', headers });
  const bgLive = (over: Partial<LiveSession> = {}): LiveSession => ({ pid: 7, cwd: '/x', kind: 'background', bgId: '5e1b5e9b', sessionId: 's1', name: 'n', status: 'waiting', ...over });
  beforeEach(async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/proj/x', pid: 42, configDir: '/home/u/.claude-work' });
  });
  it('200 opens a terminal on the background session, in its folder, even while it waits', async () => {
    const openTerminal = vi.fn(async () => ({ ok: true as const }));
    const u = await start(fakeProvider(), { bg: { listLive: async () => [bgLive()], openTerminal } });
    const r = await post(u);
    expect(r.status).toBe(200);
    expect(openTerminal).toHaveBeenCalledWith({ bgId: '5e1b5e9b', cwd: '/proj/x', configDir: '/home/u/.claude-work' });
  });
  it('409 for an interactive session and for a disconnected one; 404 unknown; 401 without token; 503 failed lookup', async () => {
    const openTerminal = vi.fn(async () => ({ ok: true as const }));
    let list: LiveSession[] | null = [bgLive({ kind: 'interactive', bgId: undefined })];
    const u = await start(fakeProvider(), { bg: { listLive: async () => list, openTerminal } });
    let r = await post(u);
    expect(r.status).toBe(409);
    expect(JSON.parse(r.body).code).toBe('not-background');
    list = null;
    expect((await post(u)).status).toBe(503);
    list = [bgLive()];
    expect((await post(u, 'nope')).status).toBe(404);
    expect((await post(u, 's1', {})).status).toBe(401);
    await markDisconnected('s1', 'exited');
    r = await post(u);
    expect(r.status).toBe(409);
    expect(JSON.parse(r.body).code).toBe('session-disconnected');
    expect(openTerminal).not.toHaveBeenCalled();
  });
  it('502 with a code when no terminal opens; the message carries no token', async () => {
    const u = await start(fakeProvider(), {
      bg: { listLive: async () => [bgLive()], openTerminal: async () => ({ ok: false as const, code: 'no-terminal' as const, error: 'no terminal program found' }) },
    });
    const r = await post(u);
    expect(r.status).toBe(502);
    expect(JSON.parse(r.body)).toEqual({ error: 'no terminal program found', code: 'no-terminal' });
    expect(r.body).not.toContain(TOKEN);
  });
  it('409 folder-missing when the session folder is gone', async () => {
    const u = await start(fakeProvider(), {
      bg: { listLive: async () => [bgLive()], openTerminal: async () => ({ ok: false as const, code: 'folder-missing' as const, error: 'the session folder does not exist' }) },
    });
    const r = await post(u);
    expect(r.status).toBe(409);
    expect(JSON.parse(r.body).code).toBe('folder-missing');
  });
});

describe('stop, respawn and rm endpoints (spec 2026-11-26-stop-respawn-rm)', () => {
  const post = (u: URL, action: string, sid = 's1', headers: Record<string, string> = auth) => req(u, `/api/sessions/${sid}/${action}`, { method: 'POST', headers });
  const bgLive = (over: Partial<LiveSession> = {}): LiveSession => ({ pid: 7, cwd: '/x', kind: 'background', bgId: '5e1b5e9b', sessionId: 's1', name: 'n', status: 'idle', ...over });
  const ok = () => vi.fn(async (_a: string, _id: string, _c?: string) => ({ ok: true as const }));
  beforeEach(async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: 42, configDir: '/home/u/.claude-work' });
  });

  it('stop runs claude stop <bgId> with the session config dir and disconnects it at once', async () => {
    const manage = ok();
    const u = await start(fakeProvider(), { bg: { listLive: async () => [bgLive()], manage } });
    const r = await post(u, 'stop');
    expect(r.status).toBe(200);
    expect(manage).toHaveBeenCalledWith('stop', '5e1b5e9b', '/home/u/.claude-work');
    const reg = (await getRegistration('s1'))!;
    expect(reg.disconnectReason).toBe('exited');
    expect(isRemoved(reg)).toBe(false);
  });

  it('respawn runs claude respawn <bgId>, keeps the session connected and tells the provider a restart is coming', async () => {
    const manage = ok();
    const expectRestart = vi.fn();
    const u = await start(fakeProvider({ expectRestart }), { bg: { listLive: async () => [bgLive({ status: 'busy' })], manage } });
    expect((await post(u, 'respawn')).status).toBe(200);
    expect(manage).toHaveBeenCalledWith('respawn', '5e1b5e9b', '/home/u/.claude-work');
    expect(expectRestart).toHaveBeenCalledWith('s1');
    expect(isActive((await getRegistration('s1'))!)).toBe(true);
  });

  it('rm runs claude rm <bgId> and takes the session out of the app', async () => {
    const manage = ok();
    const u = await start(fakeProvider(), { bg: { listLive: async () => [bgLive()], manage } });
    expect((await post(u, 'rm')).status).toBe(200);
    expect(manage).toHaveBeenCalledWith('rm', '5e1b5e9b', '/home/u/.claude-work');
    expect(isRemoved((await getRegistration('s1'))!)).toBe(true);
  });

  it('rm of an ended session finds its short id among the stopped ones', async () => {
    await markDisconnected('s1', 'exited');
    const manage = ok();
    const listStopped = async () => [{ bgId: 'abcdef01', sessionId: 's1', cwd: '/x', name: 'n' }];
    const u = await start(fakeProvider(), { bg: { listLive: async () => [], listStopped, manage } });
    expect((await post(u, 'rm')).status).toBe(200);
    expect(manage).toHaveBeenCalledWith('rm', 'abcdef01', '/home/u/.claude-work');
    // stop and respawn need a running session
    expect((await post(u, 'stop')).status).toBe(404);
  });

  it('409 not-background for an interactive session; 409 for a disconnected one; 503 when the lookup fails', async () => {
    const manage = ok();
    let list: LiveSession[] | null = [bgLive({ kind: 'interactive', bgId: undefined })];
    const u = await start(fakeProvider(), { bg: { listLive: async () => list, listStopped: async () => [], manage } });
    for (const a of ['stop', 'respawn', 'rm']) {
      const r = await post(u, a);
      expect(r.status).toBe(409);
      expect(JSON.parse(r.body).code).toBe('not-background');
    }
    list = null;
    expect((await post(u, 'stop')).status).toBe(503);
    list = [bgLive()];
    await markDisconnected('s1', 'off');
    const r = await post(u, 'respawn');
    expect(r.status).toBe(409);
    expect(JSON.parse(r.body).code).toBe('session-disconnected');
    expect(manage).not.toHaveBeenCalled();
  });

  it('a refusal of claude is 502 with its output, and the registration is untouched', async () => {
    const u = await start(fakeProvider(), {
      bg: { listLive: async () => [bgLive()], manage: async () => ({ ok: false as const, error: 'Not safe to remove: unpushed commits' }) },
    });
    const r = await post(u, 'rm');
    expect(r.status).toBe(502);
    expect(JSON.parse(r.body)).toEqual({ error: 'Not safe to remove: unpushed commits', code: 'claude-failed' });
    expect(r.body).not.toContain(TOKEN);
    const reg = (await getRegistration('s1'))!;
    expect(isActive(reg)).toBe(true);
    expect(isRemoved(reg)).toBe(false);
  });

  it('one action at a time per session', async () => {
    let release!: () => void;
    const manage = vi.fn(() => new Promise<{ ok: true }>((r) => (release = () => r({ ok: true }))));
    const u = await start(fakeProvider(), { bg: { listLive: async () => [bgLive()], manage } });
    const first = post(u, 'respawn');
    await vi.waitFor(() => expect(manage).toHaveBeenCalledTimes(1));
    expect((await post(u, 'stop')).status).toBe(409);
    release();
    expect((await first).status).toBe(200);
  });

  it('404 unknown or removed; 401 without token; 403 foreign Origin; only POST', async () => {
    const manage = ok();
    const u = await start(fakeProvider(), { bg: { listLive: async () => [bgLive()], manage } });
    expect((await post(u, 'stop', 'nope')).status).toBe(404);
    expect((await post(u, 'stop', 's1', {})).status).toBe(401);
    expect((await post(u, 'stop', 's1', { ...auth, origin: 'http://evil.com' })).status).toBe(403);
    expect((await req(u, '/api/sessions/s1/stop', { headers: auth })).status).toBe(404);
    await markRemoved('s1');
    expect((await post(u, 'rm')).status).toBe(404);
    expect(manage).not.toHaveBeenCalled();
  });
});

describe('stopped background sessions (spec 2026-11-26-stop-respawn-rm)', () => {
  const stopped = [
    { bgId: 'abcdef01', sessionId: 's1', cwd: '/x', name: 'old', state: 'done' },
    { bgId: 'abcdef02', sessionId: 's9', cwd: '/y', name: 'other' },
  ];
  const rm = (u: URL, id: string, headers: Record<string, string> = auth) => req(u, `/api/background/${id}/rm`, { method: 'POST', headers });

  it('GET lists them; 503 when the lookup fails; 401 without token', async () => {
    let list: typeof stopped | null = stopped;
    const u = await start(fakeProvider(), { bg: { listStopped: async () => list } });
    const r = await req(u, '/api/background/stopped', { headers: auth });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ sessions: stopped });
    expect((await req(u, '/api/background/stopped')).status).toBe(401);
    list = null;
    expect((await req(u, '/api/background/stopped', { headers: auth })).status).toBe(503);
  });

  it('rm removes a stopped one and takes its conversation out of the app', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: 42 });
    await markDisconnected('s1', 'exited');
    const manage = vi.fn(async () => ({ ok: true as const }));
    const u = await start(fakeProvider(), { bg: { listStopped: async () => stopped, manage } });
    expect((await rm(u, 'abcdef01')).status).toBe(200);
    expect(manage).toHaveBeenCalledWith('rm', 'abcdef01', undefined);
    expect(isRemoved((await getRegistration('s1'))!)).toBe(true);
    expect((await rm(u, 'abcdef02')).status).toBe(200); // no registration: fine
  });

  it('refuses an id that is not a stopped session (400 invalid, 409 not stopped), and 502 on a refusal', async () => {
    const manage = vi.fn(async () => ({ ok: false as const, error: 'nope' }));
    const u = await start(fakeProvider(), { bg: { listStopped: async () => stopped, manage } });
    expect((await rm(u, 'ABCDEF01')).status).toBe(400);
    expect((await rm(u, '11111111')).status).toBe(409);
    expect(manage).not.toHaveBeenCalled();
    expect((await rm(u, 'abcdef01', {})).status).toBe(401);
    const r = await rm(u, 'abcdef01');
    expect(r.status).toBe(502);
    expect(JSON.parse(r.body).error).toBe('nope');
  });
});

describe('new session endpoint (spec 2026-11-25-app-batch)', () => {
  const live = (over: Partial<LiveSession> = {}): LiveSession => ({ pid: 7, cwd: '/live/dir', kind: 'interactive', sessionId: 'l1', name: 'n', status: 'idle', ...over });
  const post = (u: URL, body: unknown) => req(u, '/api/sessions', { method: 'POST', headers: json, body: JSON.stringify(body) });
  beforeEach(async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/proj/a', pid: 42 });
  });
  const exists = async (p: string) => p !== '/gone';

  it('lists the known folders: of registrations and of running sessions, only existing ones', async () => {
    await register({ sessionId: 's2', transcriptPath: '/t2.jsonl', cwd: '/gone', pid: 43 });
    const u = await start(fakeProvider(), { bg: { listLive: async () => [live()], folderExists: exists } });
    const r = await req(u, '/api/folders', { headers: auth });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).folders.map((f: { cwd: string }) => f.cwd).sort()).toEqual(['/live/dir', '/proj/a']);
    expect((await req(u, '/api/folders')).status).toBe(401);
  });

  it('201 starts claude --bg in a known folder with the validated options and returns the short id', async () => {
    const startFn = vi.fn(async () => ({ ok: true as const, bgId: 'abcd1234' }));
    const u = await start(fakeProvider(), { bg: { listLive: async () => [], start: startFn, folderExists: exists } });
    const r = await post(u, { cwd: '/proj/a', name: 'minha sessão', model: 'opus', effort: 'high' });
    expect(r.status).toBe(201);
    expect(JSON.parse(r.body)).toEqual({ ok: true, bgId: 'abcd1234' });
    expect(startFn).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/proj/a', name: 'minha sessão', model: 'opus', effort: 'high' }));
  });

  it('400 for an unknown folder or an invalid option; nothing is started', async () => {
    const startFn = vi.fn(async () => ({ ok: true as const }));
    const u = await start(fakeProvider(), { bg: { listLive: async () => [], start: startFn, folderExists: exists } });
    for (const body of [{ cwd: '/etc' }, { cwd: '/proj/a', name: 'a"; rm' }, { cwd: '/proj/a', model: 'x y' }, { cwd: '/proj/a', effort: 'huge' }, { cwd: 3 }, []]) {
      expect((await post(u, body)).status).toBe(400);
    }
    expect(startFn).not.toHaveBeenCalled();
  });

  it('502 with the output of claude --bg when it fails', async () => {
    const u = await start(fakeProvider(), { bg: { listLive: async () => [], start: async () => ({ ok: false as const, error: 'Workspace not trusted.' }), folderExists: exists } });
    const r = await post(u, { cwd: '/proj/a' });
    expect(r.status).toBe(502);
    expect(JSON.parse(r.body).error).toBe('Workspace not trusted.');
  });
});

describe('folder browser and any folder (spec 2026-11-25-any-folder)', () => {
  const post = (u: URL, body: unknown) => req(u, '/api/sessions', { method: 'POST', headers: json, body: JSON.stringify(body) });
  let me: string;
  let root: string;
  beforeEach(() => {
    root = fs.realpathSync.native(tmpDir('acc-anyfolder-'));
    me = path.join(root, 'me');
    fs.mkdirSync(path.join(me, 'new-proj', 'src'), { recursive: true });
    fs.mkdirSync(path.join(me, '.secret'));
    fs.mkdirSync(path.join(root, 'other'));
  });
  const q = (p: string) => encodeURIComponent(p);

  it('lists the subfolders of the home folder by default; needs the token', async () => {
    const u = await start(fakeProvider(), { bg: { listLive: async () => [], home: me } });
    expect((await req(u, '/api/folders/browse')).status).toBe(401);
    const r = await req(u, '/api/folders/browse', { headers: auth });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ path: me, parent: null, entries: [{ name: 'new-proj', path: path.join(me, 'new-proj') }], truncated: false });
  });

  it('enters a subfolder; hidden=1 shows hidden folders', async () => {
    const u = await start(fakeProvider(), { bg: { listLive: async () => [], home: me } });
    const r = JSON.parse((await req(u, `/api/folders/browse?path=${q(path.join(me, 'new-proj'))}`, { headers: auth })).body);
    expect(r.parent).toBe(me);
    expect(r.entries.map((e: { name: string }) => e.name)).toEqual(['src']);
    const h = JSON.parse((await req(u, '/api/folders/browse?hidden=1', { headers: auth })).body);
    expect(h.entries.map((e: { name: string }) => e.name)).toEqual(['.secret', 'new-proj']);
  });

  it('403 outside the home folder, 400 for a relative path, 404 for a missing one; no path in the error', async () => {
    const u = await start(fakeProvider(), { bg: { listLive: async () => [], home: me } });
    const out = await req(u, `/api/folders/browse?path=${q(path.join(root, 'other'))}`, { headers: auth });
    expect(out.status).toBe(403);
    expect(JSON.parse(out.body)).toEqual({ error: 'folder outside the home folder', code: 'folder-outside' });
    expect(out.body).not.toContain(root);
    expect((await req(u, `/api/folders/browse?path=${q('me/new-proj')}`, { headers: auth })).status).toBe(400);
    expect((await req(u, `/api/folders/browse?path=${q(path.join(me, 'nope'))}`, { headers: auth })).status).toBe(404);
  });

  it('starts a new session in a folder never used, inside the home folder, with no CLAUDE_CONFIG_DIR', async () => {
    const startFn = vi.fn(async () => ({ ok: true as const, bgId: 'abcd1234' }));
    const u = await start(fakeProvider(), { bg: { listLive: async () => [], start: startFn, home: me } });
    const r = await post(u, { cwd: path.join(me, 'new-proj', 'src', '..'), name: 'novo' });
    expect(r.status).toBe(201);
    expect(startFn).toHaveBeenCalledWith({ cwd: path.join(me, 'new-proj'), name: 'novo', model: undefined, effort: undefined, configDir: undefined });
  });

  it('a folder with an earlier session keeps its config dir', async () => {
    await register({ sessionId: 's9', transcriptPath: '/t9.jsonl', cwd: path.join(me, 'new-proj'), pid: 9, configDir: '/custom/cfg' });
    const startFn = vi.fn(async () => ({ ok: true as const }));
    const u = await start(fakeProvider(), { bg: { listLive: async () => [], start: startFn, home: me } });
    expect((await post(u, { cwd: path.join(me, 'new-proj') })).status).toBe(201);
    expect(startFn).toHaveBeenCalledWith(expect.objectContaining({ configDir: '/custom/cfg' }));
  });

  it('400 for a folder outside the home folder or missing; nothing is started', async () => {
    const startFn = vi.fn(async () => ({ ok: true as const }));
    const u = await start(fakeProvider(), { bg: { listLive: async () => [], start: startFn, home: me } });
    for (const cwd of [path.join(root, 'other'), path.join(me, 'nope'), 'me/new-proj', path.join(me + '2')]) {
      const r = await post(u, { cwd });
      expect(r.status).toBe(400);
      expect(r.body).not.toContain(root);
    }
    expect(startFn).not.toHaveBeenCalled();
  });

  it('502 with code "untrusted" when claude --bg refuses the folder as not trusted', async () => {
    const u = await start(fakeProvider(), { bg: { listLive: async () => [], start: async () => ({ ok: false as const, error: 'Error: Workspace not trusted. Run claude here first.' }), home: me } });
    const r = await post(u, { cwd: path.join(me, 'new-proj') });
    expect(r.status).toBe(502);
    expect(JSON.parse(r.body)).toEqual({ error: 'Error: Workspace not trusted. Run claude here first.', code: 'untrusted' });
  });
});

describe('search endpoint (spec 2026-11-25-app-batch)', () => {
  const ev = (id: string, ts: string, text: string, kind: 'user' | 'assistant' = 'assistant') =>
    kind === 'user' ? { kind, id, ts, text, origin: 'app' as const } : { kind, id, ts, text };
  const provider = () =>
    fakeProvider({
      listSessions: async () => ({
        connected: [
          { sessionId: 's1', name: 'billing', cwd: '/b', state: 'idle' as const, pendingAppMessageIds: [] },
          { sessionId: 's2', name: 'site', cwd: '/s', state: 'disconnected' as const, pendingAppMessageIds: [] },
        ],
        others: [],
      }),
      events: async (sid: string) =>
        sid === 's1'
          ? [ev('a', '2026-11-25T01:00:00.000Z', 'Corrigi a função de cobrança'), ev('b', '2026-11-25T02:00:00.000Z', 'nada aqui')]
          : [ev('c', '2026-11-25T03:00:00.000Z', 'A COBRANÇA do site', 'user'), { kind: 'actions' as const, id: 'd', ts: '2026-11-25T04:00:00.000Z', items: [] }],
    });

  it('finds the text in every conversation, ignoring case and accents, newest first', async () => {
    const u = await start(provider());
    const r = await req(u, `/api/search?q=${encodeURIComponent('cobranca')}`, { headers: auth });
    expect(r.status).toBe(200);
    const hits = JSON.parse(r.body).hits;
    expect(hits.map((h: { eventId: string }) => h.eventId)).toEqual(['c', 'a']);
    expect(hits[0]).toMatchObject({ sessionId: 's2', name: 'site', kind: 'user', snippet: 'A COBRANÇA do site' });
  });

  it('400 for a query too short or too long; 401 without the token', async () => {
    const u = await start(provider());
    expect((await req(u, '/api/search?q=a', { headers: auth })).status).toBe(400);
    expect((await req(u, `/api/search?q=${'x'.repeat(101)}`, { headers: auth })).status).toBe(400);
    expect((await req(u, '/api/search?q=abc')).status).toBe(401);
  });
});

describe('quick reply suggestions (spec 2026-11-27-suggested-quick-replies)', () => {
  it('suggests the messages repeated in the known transcripts, leaving out removed sessions', async () => {
    const cfg = path.join(home, 'claude');
    const dir = path.join(cfg, 'projects', 'p');
    fs.mkdirSync(dir, { recursive: true });
    const line = (text: string) =>
      JSON.stringify({ type: 'user', uuid: crypto.randomUUID(), timestamp: new Date().toISOString(), message: { role: 'user', content: text } });
    fs.writeFileSync(path.join(dir, 'a.jsonl'), ['go on', 'Go on!', 'go on'].map(line).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'b.jsonl'), ['hidden', 'hidden', 'hidden'].map(line).join('\n') + '\n');
    await register({ sessionId: 's1', transcriptPath: path.join(dir, 'a.jsonl'), cwd: '/x', pid: null, configDir: cfg });
    await register({ sessionId: 's2', transcriptPath: path.join(dir, 'b.jsonl'), cwd: '/x', pid: null, configDir: cfg });
    await markRemoved('s2');
    const u = await start(fakeProvider());
    const r = await req(u, '/api/quick-replies/suggestions', { headers: auth });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ suggestions: [{ text: 'go on', count: 3 }] });
  });

  it('401 without the token; 403 from another origin', async () => {
    const u = await start(fakeProvider());
    expect((await req(u, '/api/quick-replies/suggestions')).status).toBe(401);
    expect((await req(u, '/api/quick-replies/suggestions', { headers: { ...auth, origin: 'http://evil.example' } })).status).toBe(403);
  });
});
