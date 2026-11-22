import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { acquireLock, releaseLock, reclaimStaleLock } from '../../src/core/lock.js';

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
    expect(fs.readFileSync(file, 'utf8')).toBe(String(process.pid));
  });
  it('lock file is never empty', async () => {
    await acquireLock(file);
    expect(fs.readFileSync(file, 'utf8')).toBe(String(process.pid));
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
    expect(fs.readFileSync(file, 'utf8')).toBe(String(process.pid));
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
});
