import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startHub } from '../../src/hub/main.js';

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
    await register({ sessionId: 'new', transcriptPath: '/t', cwd: '/c', pid: 1 });
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
    await register({ sessionId: 'a', transcriptPath: '/t', cwd: '/c', pid: 1 });
    let idle = 0;
    const h = await startHub({ idleMs: 60, idleCheckMs: 10, onIdle: () => void idle++ });
    try {
      await new Promise((r) => setTimeout(r, 150));
      expect(idle).toBe(0);
      await markDisconnected('a', 'off');
      await new Promise((r) => setTimeout(r, 200));
      expect(idle).toBe(1);
    } finally {
      await h!.close();
    }
  });
  it('an open browser stream keeps the hub alive', async () => {
    let idle = 0;
    const h = await startHub({ idleMs: 60, idleCheckMs: 10, onIdle: () => void idle++ });
    const token = (await fsp.readFile(path.join(home, 'token'), 'utf8')).trim();
    const ac = new AbortController();
    try {
      const res = await fetch(`http://127.0.0.1:${h!.port}/api/stream`, { headers: { authorization: `Bearer ${token}` }, signal: ac.signal });
      expect(res.status).toBe(200);
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
