import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startHub } from '../../src/hub/main.js';
import { ensureHub } from '../../src/hooks/ensureHub.js';

/**
 * Audit S2-N1: a squatter on the port recorded in a stale hub.json that relays every health challenge
 * to the real hub (rewriting nothing but the target) and records any token it is handed.
 */
async function relaySquatter(target: () => number) {
  const seen = { relayed: 0, tokens: [] as string[] };
  const srv = http.createServer(async (q, s) => {
    const u = new URL(q.url ?? '/', 'http://x');
    const tok = u.searchParams.get('token');
    if (tok) seen.tokens.push(tok);
    const ch = u.searchParams.get('challenge');
    if (u.pathname === '/api/health' && ch) {
      try {
        const r = await fetch(`http://127.0.0.1:${target()}/api/health?challenge=${ch}`, { signal: AbortSignal.timeout(500) });
        const body = await r.text();
        seen.relayed++;
        s.writeHead(r.status, { 'content-type': 'application/json' });
        return void s.end(body);
      } catch {
        /* nothing to relay to */
      }
    }
    s.writeHead(404);
    s.end();
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, port: (srv.address() as { port: number }).port, seen };
}

async function freePort(): Promise<number> {
  const s = http.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const p = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}

let home: string;
let prev: string | undefined;
let prevPort: string | undefined;
beforeEach(async () => {
  home = await fsp.mkdtemp(path.join(os.tmpdir(), 'acc-main-'));
  prev = process.env.AI_CHAT_CENTER_HOME;
  prevPort = process.env.AI_CHAT_CENTER_PORT;
  process.env.AI_CHAT_CENTER_HOME = home;
  process.env.AI_CHAT_CENTER_PORT = '0';
});
afterEach(async () => {
  if (prev === undefined) delete process.env.AI_CHAT_CENTER_HOME; else process.env.AI_CHAT_CENTER_HOME = prev;
  if (prevPort === undefined) delete process.env.AI_CHAT_CENTER_PORT; else process.env.AI_CHAT_CENTER_PORT = prevPort;
  await fsp.rm(home, { recursive: true, force: true });
});

describe('main', () => {
  // Audit SEC-F2: the token rotates on every hub start (a copy kept anywhere goes stale).
  it('rotates the token on start (0600) and writes hub.json', async () => {
    await fsp.writeFile(path.join(home, 'token'), 'f'.repeat(64));
    const h = await startHub();
    try {
      expect(h).not.toBeNull();
      const t = await fsp.readFile(path.join(home, 'token'), 'utf8');
      expect(t).toMatch(/^[0-9a-f]{64}$/);
      expect(t).not.toBe('f'.repeat(64));
      if (process.platform !== 'win32') expect((fs.statSync(path.join(home, 'token')).mode & 0o777).toString(8)).toBe('600');
      const info = JSON.parse(await fsp.readFile(path.join(home, 'hub.json'), 'utf8'));
      expect(info.pid).toBe(process.pid);
      expect(info.port).toBeGreaterThan(0);
      const r = await fetch(`http://127.0.0.1:${info.port}/api/health`);
      expect(r.status).toBe(200);
    } finally {
      await h!.close();
    }
    await expect(fsp.stat(path.join(home, 'hub.json'))).rejects.toThrow();
  });
  // Audit SEC-F1: an impostor answering {ok:true} on the recorded port must not stop the real hub.
  it('a server on the recorded port that cannot prove the token is not a live hub: start on the next port', async () => {
    const fake = http.createServer((q, s) => s.end(JSON.stringify({ ok: true, pid: 1, version: '0.2.0' })));
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
    const port = (fake.address() as { port: number }).port;
    await fsp.writeFile(path.join(home, 'hub.json'), JSON.stringify({ pid: 1, port }));
    await fsp.writeFile(path.join(home, 'token'), 'f'.repeat(64));
    process.env.AI_CHAT_CENTER_PORT = String(port);
    const h = await startHub();
    try {
      expect(h).not.toBeNull();
      expect(h!.port).not.toBe(port);
      expect(JSON.parse(await fsp.readFile(path.join(home, 'hub.json'), 'utf8')).port).toBe(h!.port);
    } finally {
      await h?.close();
      fake.close();
    }
  });
  // Audit S2-N1 (DoS variant): the squatter relays the new hub's own self-check back to it. The proof is
  // for the hub's own port, not the recorded one, so the hub does not take it for a live hub and stays up.
  it('squatter cannot make new hubs shut down', async () => {
    const base = await freePort();
    const sq = await relaySquatter(() => base);
    await fsp.writeFile(path.join(home, 'hub.json'), JSON.stringify({ pid: 1, port: sq.port }));
    await fsp.writeFile(path.join(home, 'token'), 'f'.repeat(64));
    process.env.AI_CHAT_CENTER_PORT = String(base);
    const h = await startHub();
    try {
      expect(h).not.toBeNull();
      expect(h!.port).not.toBe(sq.port);
      expect(JSON.parse(await fsp.readFile(path.join(home, 'hub.json'), 'utf8')).port).toBe(h!.port);
    } finally {
      await h?.close();
      sq.srv.close();
    }
  });
  // Audit S2-N1: between the token rotation and the hub.json write, hub.json still names the squatter
  // port while the token on disk is live. A relayed (genuine) proof must not earn the squatter the URL.
  it('a port-forwarding squatter never gets a url: ensureHub only pairs the token with the verified port', async () => {
    const h = await startHub();
    const sq = await relaySquatter(() => h!.port);
    const hubJson = path.join(home, 'hub.json');
    const real = await fsp.readFile(hubJson, 'utf8');
    await fsp.writeFile(hubJson, JSON.stringify({ pid: 1, port: sq.port })); // stale record, live token
    try {
      const url = await ensureHub({
        spawnHub: () => void setTimeout(() => void fsp.writeFile(hubJson, real), 300),
        pollMs: 20,
        timeoutMs: 5000,
      });
      expect(sq.seen.relayed).toBeGreaterThan(1);
      expect(new URL(url).port).toBe(String(h!.port));
      expect(new URL(url).port).not.toBe(String(sq.port));
      expect(sq.seen.tokens).toEqual([]);
    } finally {
      await h!.close();
      sq.srv.close();
    }
  });
  it('creates a token when missing, and a second start defers to the live hub', async () => {
    const h = await startHub();
    try {
      const t = await fsp.readFile(path.join(home, 'token'), 'utf8');
      expect(t).toMatch(/^[0-9a-f]{64}$/);
      expect(await startHub()).toBeNull();
    } finally {
      await h!.close();
    }
  });
  it('two concurrent startHub calls yield one hub', async () => {
    const results = await Promise.all([startHub(), startHub()]);
    const hubs = results.filter((r) => r !== null);
    try {
      expect(hubs).toHaveLength(1);
      const info = JSON.parse(await fsp.readFile(path.join(home, 'hub.json'), 'utf8'));
      expect(info.port).toBe(hubs[0]!.port);
    } finally {
      for (const h of hubs) await h!.close();
    }
  });
  it('an invalid token file is replaced by a valid one', async () => {
    await fsp.writeFile(path.join(home, 'token'), 'garbage');
    const h = await startHub();
    try {
      expect(await fsp.readFile(path.join(home, 'token'), 'utf8')).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await h!.close();
    }
  });
  // Audit RT13: old disconnected registrations are pruned when the hub starts.
  it('prunes disconnected registrations older than 30 days on start', async () => {
    const { register, markDisconnected, updateRegistration, listRegistrations } = await import('../../src/core/registry.js');
    await register({ sessionId: 'old', transcriptPath: '/t', cwd: '/c', pid: 1 });
    await register({ sessionId: 'new', transcriptPath: '/t', cwd: '/c', pid: process.pid });
    await markDisconnected('old', 'off');
    await updateRegistration('old', { disconnectedAt: new Date(Date.now() - 31 * 86_400_000).toISOString() });
    const h = await startHub();
    try {
      expect((await listRegistrations()).map((r) => r.sessionId)).toEqual(['new']);
    } finally {
      await h!.close();
    }
  });

  // Audit AI-F11: the hub exits on its own after 2 h with no browser connected and no active session.
  it('calls onIdle once nothing has used it for idleMs, and not while a session is active', async () => {
    const { register, markDisconnected } = await import('../../src/core/registry.js');
    // A pid that is alive on every OS (Windows has no pid 1): this very test process.
    await register({ sessionId: 'a', transcriptPath: '/t', cwd: '/c', pid: process.pid });
    let idle = 0;
    const h = await startHub({ idleMs: 60, idleCheckMs: 10, onIdle: () => void idle++ });
    try {
      await new Promise((r) => setTimeout(r, 150));
      expect(idle).toBe(0);
      await markDisconnected('a', 'off');
      await vi.waitFor(() => expect(idle).toBe(1), { timeout: 5000, interval: 10 });
    } finally {
      await h!.close();
    }
  });
  // Audit S2-N3 / R2-N1: claude quit without /cc off and no browser is open. The registration must not
  // keep the hub up forever: a dead stored pid does not count as active.
  it('a registration whose stored pid is dead does not keep the hub up', async () => {
    const { register } = await import('../../src/core/registry.js');
    const { spawnSync } = await import('node:child_process');
    const dead = spawnSync(process.execPath, ['-e', '']).pid!; // exited: its pid is dead
    await register({ sessionId: 'gone', transcriptPath: path.join(home, 'none.jsonl'), cwd: home, pid: dead, key: 'k' });
    let idle = 0;
    const h = await startHub({ idleMs: 60, idleCheckMs: 10, onIdle: () => void idle++ });
    try {
      await vi.waitFor(() => expect(idle).toBe(1), { timeout: 5000, interval: 20 });
    } finally {
      await h!.close();
    }
  });
  // Audit S2-N3: exits are detected in the background (every 5 min by default) even with no browser,
  // so a session whose pid is unknown or alive-but-reused is still marked exited and the hub can idle out.
  it('background exit detection runs without a browser and lets the idle exit fire', async () => {
    const { register, getRegistration } = await import('../../src/core/registry.js');
    const old = new Date(Date.now() - 3600_000).toISOString(); // past the grace period
    await register({ sessionId: 'nopid', transcriptPath: path.join(home, 'none.jsonl'), cwd: home, pid: null, key: 'k', connectedAt: old });
    let idle = 0;
    let lookups = 0;
    const h = await startHub({
      idleMs: 60,
      idleCheckMs: 10,
      exitCheckMs: 10,
      listLive: async () => (lookups++, []),
      onIdle: () => void idle++,
    });
    try {
      await vi.waitFor(() => expect(idle).toBe(1), { timeout: 5000, interval: 20 });
      expect(lookups).toBeGreaterThanOrEqual(3);
      expect((await getRegistration('nopid'))!.disconnectReason).toBe('exited');
    } finally {
      await h!.close();
    }
  });
  it('background exit detection never marks a session when the lookup fails', async () => {
    const { register, getRegistration } = await import('../../src/core/registry.js');
    const old = new Date(Date.now() - 3600_000).toISOString();
    await register({ sessionId: 'nopid', transcriptPath: path.join(home, 'none.jsonl'), cwd: home, pid: null, key: 'k', connectedAt: old });
    let lookups = 0;
    const h = await startHub({ exitCheckMs: 10, listLive: async () => (lookups++, null) });
    try {
      await vi.waitFor(() => expect(lookups).toBeGreaterThanOrEqual(5), { timeout: 5000, interval: 20 });
      expect((await getRegistration('nopid'))!.disconnectedAt).toBeUndefined();
    } finally {
      await h!.close();
    }
  });
  it('the background exit check runs every 5 minutes by default', async () => {
    const { EXIT_CHECK_MS } = await import('../../src/hub/main.js');
    expect(EXIT_CHECK_MS).toBe(5 * 60_000);
  });
  it('an open browser stream keeps the hub alive', async () => {
    // An active session holds the hub until the stream is open, however slow the machine is.
    const { register, markDisconnected } = await import('../../src/core/registry.js');
    await register({ sessionId: 'a', transcriptPath: '/t', cwd: '/c', pid: process.pid });
    let idle = 0;
    const h = await startHub({ idleMs: 60, idleCheckMs: 10, onIdle: () => void idle++ });
    const token = (await fsp.readFile(path.join(home, 'token'), 'utf8')).trim();
    const ac = new AbortController();
    try {
      const res = await fetch(`http://127.0.0.1:${h!.port}/api/stream`, { headers: { authorization: `Bearer ${token}` }, signal: ac.signal });
      expect(res.status).toBe(200);
      await markDisconnected('a', 'off');
      await new Promise((r) => setTimeout(r, 150));
      expect(idle).toBe(0);
    } finally {
      ac.abort();
      await h!.close();
    }
  });
  it('the default idle limit is 2 hours', async () => {
    const { IDLE_EXIT_MS } = await import('../../src/hub/main.js');
    expect(IDLE_EXIT_MS).toBe(2 * 3600_000);
  });
});

// Audit R3-F4: a hub that hub.json no longer names (a twin replaced it, or the state folder was deleted)
// exits on its own instead of lingering with an old token.
describe('hub ownership check', () => {
  it('calls onReplaced once hub.json names another pid or port, or is gone', async () => {
    for (const change of ['other-pid', 'other-port', 'gone'] as const) {
      let replaced = 0;
      const h = await startHub({ ownershipCheckMs: 10, onReplaced: () => void replaced++ });
      try {
        await new Promise((r) => setTimeout(r, 60));
        expect(replaced).toBe(0);
        const file = path.join(home, 'hub.json');
        if (change === 'gone') await fsp.rm(file);
        else {
          const cur = JSON.parse(await fsp.readFile(file, 'utf8'));
          await fsp.writeFile(file, JSON.stringify(change === 'other-pid' ? { ...cur, pid: cur.pid + 1 } : { ...cur, port: cur.port + 1 }));
        }
        await vi.waitFor(() => expect(replaced).toBe(1), { timeout: 5000, interval: 10 });
        await new Promise((r) => setTimeout(r, 50));
        expect(replaced).toBe(1);
      } finally {
        await h!.close();
      }
    }
  });
});
