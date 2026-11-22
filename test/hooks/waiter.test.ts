import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runWaiter } from '../../src/hooks/waiter.js';
import { register, markDisconnected, getRegistration } from '../../src/core/registry.js';
import { setBusy, isBusy } from '../../src/core/busy.js';
import { setWaiting, getWaiting } from '../../src/core/waiting.js';
import { enqueue as enq, peek } from '../../src/core/inbox.js';
import { enqueue } from '../../src/core/inbox.js';
import { unwrapMessages } from '../../src/core/protocol.js';
import { paths } from '../../src/core/paths.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reg = (sid: string) =>
  register({ sessionId: sid, transcriptPath: '/t.jsonl', cwd: '/x', pid: process.pid });
const opts = { pollMs: 10, resolvePid: async (): Promise<number | null> => null };

beforeEach(() => {
  process.env.AI_CHAT_CENTER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-'));
});

describe('waiter', () => {
  it('exits 0 immediately for unregistered session', async () => {
    const t = Date.now();
    const r = await runWaiter({ session_id: 's1' }, opts);
    expect(r).toEqual({ exitCode: 0, stderr: '' });
    expect(Date.now() - t).toBeLessThan(500);
    expect(fs.readdirSync(paths().home)).toEqual([]);
    expect(fs.existsSync(paths().waiterLock('s1'))).toBe(false);
  });
  it('exits 0 silently for an invalid session id', async () => {
    expect(await runWaiter({ session_id: '../evil' }, opts)).toEqual({ exitCode: 0, stderr: '' });
  });
  it('delivers queued messages in order as one wake', async () => {
    await reg('s1');
    await enqueue('s1', 'um');
    await enqueue('s1', 'dois');
    const r = await runWaiter({ session_id: 's1' }, opts);
    expect(r.exitCode).toBe(2);
    expect(unwrapMessages(r.stderr).map((m) => m.text)).toEqual(['um', 'dois']);
    expect(fs.existsSync(paths().waiterLock('s1'))).toBe(false);
  });
  it('wakes on message enqueued while waiting', async () => {
    await reg('s1');
    const p = runWaiter({ session_id: 's1' }, opts);
    await sleep(30);
    await enqueue('s1', 'oi');
    const r = await p;
    expect(r.exitCode).toBe(2);
    expect(unwrapMessages(r.stderr).map((m) => m.text)).toEqual(['oi']);
  });
  it('exits 0 when disconnected while waiting', async () => {
    await reg('s1');
    const p = runWaiter({ session_id: 's1' }, opts);
    await sleep(30);
    await markDisconnected('s1', 'off');
    expect(await p).toEqual({ exitCode: 0, stderr: '' });
    expect(fs.existsSync(paths().waiterLock('s1'))).toBe(false);
  });
  it('exits when parent process is gone', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: 4242 });
    let alive = true;
    const seen = new Set<number>();
    const p = runWaiter(
      { session_id: 's1' },
      {
        ...opts,
        isAlive: (pid) => (seen.add(pid), alive),
      },
    );
    await sleep(30);
    alive = false;
    expect(await p).toEqual({ exitCode: 0, stderr: '' });
    expect([...seen]).toEqual([4242]);
    expect(fs.existsSync(paths().waiterLock('s1'))).toBe(false);
  });
  it('second waiter for same session exits 0 and the first keeps waiting', async () => {
    await reg('s1');
    const first = runWaiter({ session_id: 's1' }, opts);
    await sleep(30);
    expect(await runWaiter({ session_id: 's1' }, opts)).toEqual({ exitCode: 0, stderr: '' });
    await enqueue('s1', 'x');
    expect((await first).exitCode).toBe(2);
  });
  it('drained messages are delivered even if clearing waiting state fails', async () => {
    await reg('s1');
    await enqueue('s1', 'um');
    const r = await runWaiter(
      { session_id: 's1' },
      {
        ...opts,
        clearWaiting: async () => {
          throw new Error('boom');
        },
      },
    );
    expect(r.exitCode).toBe(2);
    expect(unwrapMessages(r.stderr).map((m) => m.text)).toEqual(['um']);
    expect(fs.existsSync(paths().waiterLock('s1'))).toBe(false);
  });
  it('waiter start clears the busy marker and the waiting state (the turn ended)', async () => {
    await reg('s1');
    await setBusy('s1');
    await setWaiting('s1', 'permission');
    await enq('s1', 'x');
    const r = await runWaiter({ session_id: 's1' }, opts);
    expect(r.exitCode).toBe(2);
    expect(await isBusy('s1')).toBe(false);
    expect(await getWaiting('s1')).toBeNull();
  });
  it('does not drain while the busy marker exists, then drains once it is cleared', async () => {
    await reg('s1');
    let done = false;
    const p = runWaiter({ session_id: 's1' }, opts).then((r) => ((done = true), r));
    await sleep(30);
    await setBusy('s1'); // a terminal turn started after this waiter was armed
    await enq('s1', 'later');
    await sleep(80);
    expect(done).toBe(false);
    expect((await peek('s1')).map((m) => m.text)).toEqual(['later']);
    fs.rmSync(paths().busyFile('s1'));
    const r = await p;
    expect(r.exitCode).toBe(2);
    expect(unwrapMessages(r.stderr).map((m) => m.text)).toEqual(['later']);
  });
  it('wraps messages with the registration key', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: process.pid, key: 'abc123' });
    await enq('s1', 'oi');
    const r = await runWaiter({ session_id: 's1' }, opts);
    expect(r.stderr).toContain('key=abc123]');
    expect(unwrapMessages(r.stderr, 'abc123').map((m) => m.text)).toEqual(['oi']);
  });
  it('pid null: resolves it once at start and persists it', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: null });
    let lookups = 0;
    const seen: number[] = [];
    await enq('s1', 'x');
    const r = await runWaiter(
      { session_id: 's1' },
      { ...opts, resolvePid: async () => (lookups++, 4242), isAlive: (pid) => (seen.push(pid), true) },
    );
    expect(r.exitCode).toBe(2);
    expect(lookups).toBe(1);
    expect(seen).toEqual([4242]);
    expect((await getRegistration('s1'))?.pid).toBe(4242);
  });
  it('pid still unknown: skips the liveness check and ends when the hub marks the session exited', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: null });
    let checks = 0;
    const p = runWaiter({ session_id: 's1' }, { ...opts, isAlive: () => (checks++, false) });
    await sleep(40);
    expect(checks).toBe(0);
    expect((await getRegistration('s1'))?.pid).toBeNull();
    await markDisconnected('s1', 'exited');
    expect(await p).toEqual({ exitCode: 0, stderr: '' });
  });
  it('stale pid (resumed session in a new process): re-resolves once and keeps waiting', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: 111 });
    let lookups = 0;
    const p = runWaiter(
      { session_id: 's1' },
      { ...opts, resolvePid: async () => (lookups++, 222), isAlive: (pid) => pid === 222 },
    );
    await sleep(30);
    await enq('s1', 'x');
    expect((await p).exitCode).toBe(2);
    expect(lookups).toBe(1);
    expect((await getRegistration('s1'))?.pid).toBe(222);
  });
});
