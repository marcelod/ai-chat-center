import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createHub, type HubOptions } from '../../src/hub/server.js';
import type { Provider } from '../../src/hub/provider.js';
import { tmpDir } from '../helpers/tmp.js';
import { fakePng } from '../helpers/png.js';
import { paths } from '../../src/core/paths.js';
import { register, markRemoved, markDisconnected } from '../../src/core/registry.js';
import { installSecret } from '../../src/core/secret.js';
import type { LiveSession } from '../../src/shared/types.js';

// Spec 2026-11-26-side-panel: the routes behind the side panel.

const TOKEN = 'a'.repeat(64);
let home: string;
let hub: Awaited<ReturnType<typeof createHub>> | undefined;
let prevHome: string | undefined;

const provider: Provider = {
  listSessions: async () => ({ connected: [], others: [] }),
  events: async () => [],
  poll: async () => [],
  send: async () => ({ id: 'm1' }),
};

async function start(bg: HubOptions['bg'] = {}) {
  hub = await createHub({ provider, token: TOKEN, port: 0, staticDir: path.join(home, 'nope'), pollMs: 20, bg });
  return new URL(hub.url);
}

function req(u: URL, p: string, o: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const r = http.request(
      { host: '127.0.0.1', port: u.port, path: p, method: o.method ?? 'GET', headers: { host: `127.0.0.1:${u.port}`, ...o.headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    r.on('error', reject);
    r.end(o.body);
  });
}
const auth = { authorization: `Bearer ${TOKEN}` };
const json = { ...auth, 'content-type': 'application/json' };
const parse = (b: Buffer) => JSON.parse(b.toString('utf8'));

let cwd: string;
let outside: string;
let subDir: string;

beforeEach(async () => {
  home = tmpDir('acc-panel-');
  prevHome = process.env.AI_CHAT_CENTER_HOME;
  process.env.AI_CHAT_CENTER_HOME = home;
  const root = fs.realpathSync.native(tmpDir('acc-panel-proj-'));
  cwd = path.join(root, 'proj');
  outside = path.join(root, 'outside');
  fs.mkdirSync(path.join(cwd, 'docs'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(cwd, 'docs', 'spec.md'), '# Spec\n\n<script>x</script>');
  fs.writeFileSync(path.join(cwd, 'shot.png'), fakePng(3, 3));
  fs.writeFileSync(path.join(cwd, 'main.ts'), 'const a = 1;\n');
  fs.writeFileSync(path.join(cwd, 'doc.pdf'), '%PDF-1.7\n%%EOF\n');
  fs.writeFileSync(path.join(outside, 'secret.md'), '# Secret');
  fs.symlinkSync(path.join(outside, 'secret.md'), path.join(cwd, 'out.md'));
  const att = path.join(paths().attachmentsDir, 's1');
  fs.mkdirSync(att, { recursive: true });
  fs.writeFileSync(path.join(att, '0123456789abcdef-pic.png'), fakePng(1, 1));
  await register({ sessionId: 's1', transcriptPath: path.join(root, 's1.jsonl'), cwd, pid: 42 });
  subDir = path.join(root, 's1', 'subagents');
  fs.mkdirSync(subDir, { recursive: true });
  fs.writeFileSync(path.join(subDir, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Find things', model: 'claude-opus-5-5' }));
  const line = (o: Record<string, unknown>) => JSON.stringify({ isSidechain: true, timestamp: new Date().toISOString(), ...o });
  fs.writeFileSync(
    path.join(subDir, 'agent-a1.jsonl'),
    [
      line({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'find things' } }),
      line({ type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Grep', input: {} }] } }),
    ].join('\n') + '\n',
  );
});
afterEach(async () => {
  await hub?.close();
  hub = undefined;
  if (prevHome === undefined) delete process.env.AI_CHAT_CENTER_HOME;
  else process.env.AI_CHAT_CENTER_HOME = prevHome;
  await fsp.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('GET /api/sessions/:sid/file', () => {
  const get = (u: URL, p: string, sid = 's1', headers: Record<string, string> = auth) =>
    req(u, `/api/sessions/${sid}/file?path=${encodeURIComponent(p)}`, { headers });

  it('serves a Markdown file of the session folder as is, with a fixed type and nosniff', async () => {
    const u = await start();
    const r = await get(u, 'docs/spec.md');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body.toString()).toBe('# Spec\n\n<script>x</script>');
  });

  it('serves a code file as plain text and a PDF as a sandboxed PDF (spec 2026-11-27-side-panel-file-types)', async () => {
    const u = await start();
    let r = await get(u, 'main.ts');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(r.body.toString()).toBe('const a = 1;\n');
    r = await get(u, 'doc.pdf');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toContain('sandbox');
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('serves an image of the folder and of the session attachments', async () => {
    const u = await start();
    let r = await get(u, path.join(cwd, 'shot.png'));
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.body.equals(fakePng(3, 3))).toBe(true);
    r = await get(u, path.join(paths().attachmentsDir, 's1', '0123456789abcdef-pic.png'));
    expect(r.status).toBe(200);
  });

  it('refuses outside files and links out with 403, missing with 404, other types with 415; never says the path', async () => {
    const u = await start();
    for (const [p, status, code] of [
      [path.join(outside, 'secret.md'), 403, 'file-outside'],
      ['out.md', 403, 'file-outside'],
      ['../outside/secret.md', 403, 'file-outside'],
      ['nope.md', 404, 'file-not-found'],
      ['docs', 415, 'file-type'],
      ['', 400, 'file-invalid'],
    ] as const) {
      const r = await get(u, p);
      expect(r.status, p).toBe(status);
      expect(parse(r.body).code).toBe(code);
      expect(r.body.toString()).not.toContain(cwd);
      expect(r.body.toString()).not.toContain(outside);
    }
  });

  it('a session in the home folder: its dot folders and secret names are refused with 403 file-private', async () => {
    const fakeHome = path.dirname(cwd);
    fs.mkdirSync(path.join(fakeHome, '.config', 'gh'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.config', 'gh', 'hosts.yml'), 'oauth_token: t');
    fs.writeFileSync(path.join(cwd, 'credentials.json'), '{}');
    await register({ sessionId: 's2', transcriptPath: path.join(fakeHome, 's2.jsonl'), cwd: fakeHome, pid: 43 });
    const u = await start({ home: fakeHome });
    for (const p of ['.config/gh/hosts.yml', 'proj/credentials.json']) {
      const r = await get(u, p, 's2');
      expect(r.status, p).toBe(403);
      expect(parse(r.body).code).toBe('file-private');
      expect(r.body.toString()).not.toContain(fakeHome);
    }
    expect((await get(u, 'proj/docs/spec.md', 's2')).status).toBe(200);
  });

  it('401 without the token, 404 for an unknown, invalid or removed session', async () => {
    const u = await start();
    expect((await get(u, 'docs/spec.md', 's1', {})).status).toBe(401);
    expect((await get(u, 'docs/spec.md', 'nope')).status).toBe(404);
    expect((await get(u, 'docs/spec.md', '..%2Fx')).status).toBe(404);
    await markRemoved('s1');
    expect((await get(u, 'docs/spec.md')).status).toBe(404);
  });

  it('403 for another origin', async () => {
    const u = await start();
    const r = await req(u, `/api/sessions/s1/file?path=docs%2Fspec.md`, { headers: { ...auth, origin: 'http://evil.example' } });
    expect(r.status).toBe(403);
  });
});

describe('POST /api/sessions/:sid/files/exists', () => {
  const post = (u: URL, body: unknown, headers: Record<string, string> = json) =>
    req(u, '/api/sessions/s1/files/exists', { method: 'POST', headers, body: JSON.stringify(body) });

  it('answers which of the paths the panel can open', async () => {
    const u = await start();
    const r = await post(u, { paths: ['docs/spec.md', 'nope.md', 'out.md', path.join(outside, 'secret.md'), 'shot.png'] });
    expect(r.status).toBe(200);
    expect(parse(r.body)).toEqual({ exists: ['docs/spec.md', 'shot.png'] });
  });

  it('400 for a bad body, 401 without the token, 415 without JSON', async () => {
    const u = await start();
    expect((await post(u, { paths: 'x' })).status).toBe(400);
    expect((await post(u, null)).status).toBe(400);
    expect((await post(u, { paths: [] }, auth)).status).toBe(415);
    expect((await post(u, { paths: [] }, { 'content-type': 'application/json' })).status).toBe(401);
  });
});

describe('GET /api/sessions/:sid/subagents', () => {
  it('lists the subagents of the session', async () => {
    const u = await start();
    const r = await req(u, '/api/sessions/s1/subagents', { headers: auth });
    expect(r.status).toBe(200);
    const { subagents } = parse(r.body);
    expect(subagents).toHaveLength(1);
    expect(subagents[0]).toMatchObject({ id: 'a1', description: 'Find things', agentType: 'Explore', status: 'running', lastTool: 'Grep' });
  });
  it("gives one subagent's events; 404 for an unknown agent or a bad id; 401 without the token", async () => {
    const u = await start();
    const r = await req(u, '/api/sessions/s1/subagents/a1/events', { headers: auth });
    expect(r.status).toBe(200);
    expect(parse(r.body).map((e: { kind: string }) => e.kind)).toEqual(['user', 'actions']);
    expect((await req(u, '/api/sessions/s1/subagents/nope/events', { headers: auth })).status).toBe(404);
    expect((await req(u, '/api/sessions/s1/subagents/a.b/events', { headers: auth })).status).toBe(404);
    expect((await req(u, '/api/sessions/s1/subagents/..%2F..%2Fx/events', { headers: auth })).status).toBe(404);
    expect((await req(u, '/api/sessions/s1/subagents')).status).toBe(401);
    expect((await req(u, '/api/sessions/zz/subagents', { headers: auth })).status).toBe(404);
  });
});

describe('GET /api/sessions/:sid/screen', () => {
  const KEY = '1234567890abcdef'.repeat(2);
  const bgLive = (over: Partial<LiveSession> = {}): LiveSession => ({ pid: 7, cwd, kind: 'background', bgId: '5e1b5e9b', sessionId: 's1', name: 'n', status: 'idle', ...over });
  beforeEach(async () => {
    await register({ sessionId: 's1', transcriptPath: path.join(cwd, 's1.jsonl'), cwd, pid: 42, key: KEY, configDir: '/home/u/.claude-work' });
  });

  it('answers the cleaned screen: no app link, token, key or install secret', async () => {
    const secret = await installSecret();
    const calls: unknown[][] = [];
    const u = await start({
      listLive: async () => [bgLive()],
      screen: async (...a) => {
        calls.push(a);
        return `\x1b[32mhello\x1b[0m\nhttp://127.0.0.1:7777/#token=${TOKEN}\nAI Chat Center key: ${KEY}\nsecret ${secret}\n/status shown`;
      },
    });
    const r = await req(u, '/api/sessions/s1/screen', { headers: auth });
    expect(r.status).toBe(200);
    const { text } = parse(r.body);
    expect(text).toContain('hello\n[app link removed]');
    expect(text).toContain('/status shown');
    for (const bad of [TOKEN, KEY, secret, '127.0.0.1', '\x1b']) expect(text).not.toContain(bad);
    expect(calls).toEqual([['5e1b5e9b', '/home/u/.claude-work']]);
  });

  it('answers the final screen of the terminal stream, not every frame (spec 2026-11-27-session-screen-terminal)', async () => {
    let raw = '\x1b[2J\x1b[1;1H';
    for (let i = 0; i < 30; i++) raw += `\r\x1b[K✻ Doodling… ${i}`;
    raw += '\r\x1b[KFala\x1b[1Cmeu\x1b[1Crei';
    const u = await start({ listLive: async () => [bgLive()], screen: async () => raw });
    const r = await req(u, '/api/sessions/s1/screen', { headers: auth });
    expect(parse(r.body).text).toBe('Fala meu rei');
  });

  it('409 for an interactive or disconnected session, 503 failed lookup, 502 failed read, 401 without token', async () => {
    let list: LiveSession[] | null = [bgLive({ kind: 'interactive', bgId: undefined })];
    let fail = false;
    const u = await start({ listLive: async () => list, screen: async () => { if (fail) throw new Error(`boom ${TOKEN}`); return 'ok'; } });
    let r = await req(u, '/api/sessions/s1/screen', { headers: auth });
    expect(r.status).toBe(409);
    expect(parse(r.body).code).toBe('not-background');
    list = null;
    expect((await req(u, '/api/sessions/s1/screen', { headers: auth })).status).toBe(503);
    list = [bgLive()];
    fail = true;
    r = await req(u, '/api/sessions/s1/screen', { headers: auth });
    expect(r.status).toBe(502);
    expect(r.body.toString()).not.toContain(TOKEN);
    expect((await req(u, '/api/sessions/s1/screen')).status).toBe(401);
    await markDisconnected('s1', 'exited');
    r = await req(u, '/api/sessions/s1/screen', { headers: auth });
    expect(r.status).toBe(409);
    expect(parse(r.body).code).toBe('session-disconnected');
  });

  it('501 on Windows', async () => {
    const u = await start({ platform: 'win32', listLive: async () => [bgLive()], screen: async () => 'x' });
    expect((await req(u, '/api/sessions/s1/screen', { headers: auth })).status).toBe(501);
  });
});
