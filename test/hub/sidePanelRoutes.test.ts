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
import { register, markRemoved } from '../../src/core/registry.js';

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
  fs.writeFileSync(path.join(outside, 'secret.md'), '# Secret');
  fs.symlinkSync(path.join(outside, 'secret.md'), path.join(cwd, 'out.md'));
  const att = path.join(paths().attachmentsDir, 's1');
  fs.mkdirSync(att, { recursive: true });
  fs.writeFileSync(path.join(att, '0123456789abcdef-pic.png'), fakePng(1, 1));
  await register({ sessionId: 's1', transcriptPath: path.join(root, 's1.jsonl'), cwd, pid: 42 });
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
