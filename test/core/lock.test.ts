import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { acquireLock, releaseLock, reclaimStaleLock, touchLock, withLock, LOCK_STALE_MS } from '../../src/core/lock.js';

const owner = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as { pid: number; ts: string };

async function deadPid(): Promise<number> {
  const c = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise((r) => c.on('exit', r));
  return c.pid!;
}

let file: string;
beforeEach(() => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'acc-')), 'sub', 'x.lock');
});

describe('lock', () => {
  it('lock is exclusive', async () => {
    expect(await acquireLock(file)).toBe(true);
    expect(await acquireLock(file)).toBe(false);
    await releaseLock(file);
    expect(await acquireLock(file)).toBe(true);
  });
  it('stale lock is reclaimed', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, String(await deadPid()));
    expect(await acquireLock(file)).toBe(true);
    expect(owner(file).pid).toBe(process.pid);
  });
  it('lock file is never empty and holds {pid, ts}', async () => {
    await acquireLock(file);
    expect(owner(file).pid).toBe(process.pid);
    expect(Number.isNaN(Date.parse(owner(file).ts))).toBe(false);
    expect(fs.readdirSync(path.dirname(file))).toEqual(['x.lock']);
  });
  it('concurrent stale reclaim yields exactly one holder', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, String(await deadPid()));
    const r = await Promise.all(Array.from({ length: 10 }, () => acquireLock(file)));
    expect(r.filter(Boolean)).toHaveLength(1);
  });
  it('empty lock file younger than grace is treated as held', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
    expect(await acquireLock(file)).toBe(false);
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(file, old, old);
    expect(await acquireLock(file)).toBe(true);
  });
  it('late reclaimer cannot displace a fresh live lock', async () => {
    const dead = String(await deadPid());
    expect(await acquireLock(file)).toBe(true); // A's fresh lock
    expect(await reclaimStaleLock(file, dead)).toBe(false); // B observed the old dead pid
    expect(owner(file).pid).toBe(process.pid);
    expect(await acquireLock(file)).toBe(false); // C
    expect(fs.existsSync(`${file}.reclaim`)).toBe(false);
  });
  it('stale reclaim guard expires', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, String(await deadPid()));
    fs.writeFileSync(`${file}.reclaim`, '1');
    expect(await acquireLock(file)).toBe(false); // guard fresh: someone is reclaiming
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(`${file}.reclaim`, old, old);
    expect(await acquireLock(file)).toBe(false); // expired guard removed, this attempt yields
    expect(await acquireLock(file)).toBe(true);
  });
  // Audit RT9: on Windows a killed waiter leaves its pid behind and the pid can be reused by an
  // unrelated live process. A lock whose heartbeat (mtime) is older than 90 s is stale anyway.
  it('a lock held by a live pid but with an old heartbeat is stale', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ pid: process.ppid, ts: new Date().toISOString() }));
    expect(await acquireLock(file)).toBe(false);
    const old = new Date(Date.now() - LOCK_STALE_MS - 5_000);
    fs.utimesSync(file, old, old);
    expect(await acquireLock(file)).toBe(true);
    expect(owner(file).pid).toBe(process.pid);
  });
  it('touchLock refreshes the heartbeat of a lock this process holds, and only that', async () => {
    expect(LOCK_STALE_MS).toBe(90_000);
    expect(await acquireLock(file)).toBe(true);
    const old = new Date(Date.now() - 120_000);
    fs.utimesSync(file, old, old);
    await touchLock(file);
    expect(Date.now() - fs.statSync(file).mtimeMs).toBeLessThan(5_000);
    expect(await acquireLock(file)).toBe(false);
    fs.writeFileSync(file, JSON.stringify({ pid: process.ppid, ts: '' }));
    fs.utimesSync(file, old, old);
    await touchLock(file); // not ours: untouched
    expect(Date.now() - fs.statSync(file).mtimeMs).toBeGreaterThan(100_000);
  });
  it('a legacy plain-pid lock of a live process is still honoured', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, String(process.ppid));
    expect(await acquireLock(file)).toBe(false);
  });
  it('withLock serializes callers and proceeds after the wait when the lock stays held', async () => {
    const order: string[] = [];
    await Promise.all([
      withLock(file, 2000, async () => { order.push('a1'); await new Promise((r) => setTimeout(r, 50)); order.push('a2'); }),
      withLock(file, 2000, async () => { order.push('b1'); order.push('b2'); }),
    ]);
    expect(order.join()).toMatch(/^(a1,a2,b1,b2|b1,b2,a1,a2)$/);
    expect(fs.existsSync(file)).toBe(false);
    fs.writeFileSync(file, JSON.stringify({ pid: process.ppid, ts: '' }));
    const t = Date.now();
    expect(await withLock(file, 100, async () => 'ran')).toBe('ran');
    expect(Date.now() - t).toBeGreaterThanOrEqual(90);
    expect(fs.existsSync(file)).toBe(true); // someone else's lock is left alone
  });
});
