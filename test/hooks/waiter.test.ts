import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runWaiter, type WaiterOptions, type WaiterEvent, type PidLookup } from '../../src/hooks/waiter.js';
import { register, markDisconnected, getRegistration } from '../../src/core/registry.js';
import { setBusy, isBusy } from '../../src/core/busy.js';
import { setWaiting, getWaiting } from '../../src/core/waiting.js';
import { enqueue, peek } from '../../src/core/inbox.js';
import { unwrapMessages } from '../../src/core/protocol.js';
import { paths } from '../../src/core/paths.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errno = (code: string) => Object.assign(new Error(code), { code });
const reg = (sid: string) => register({ sessionId: sid, transcriptPath: '/t.jsonl', cwd: '/x', pid: process.pid });
const notListed = async (): Promise<PidLookup> => ({ ok: true, pid: null });
const opts: WaiterOptions = { pollMs: 10, lookup: notListed };
const input = (o: Record<string, unknown> = {}) => ({ session_id: 's1', transcript_path: '/t.jsonl', ...o });
const wait = (event: WaiterEvent, o: Record<string, unknown> = {}, extra: WaiterOptions = {}) =>
  runWaiter(event, input(o) as never, { ...opts, ...extra });

beforeEach(() => {
  process.env.AI_CHAT_CENTER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-'));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('waiter', () => {
  it('exits 0 immediately for unregistered session', async () => {
    const t = Date.now();
    for (const ev of ['stop', 'start'] as const) {
      expect(await wait(ev, { source: 'startup' })).toEqual({ exitCode: 0, stderr: '' });
    }
    expect(Date.now() - t).toBeLessThan(3000); // no waiting at all (generous: CI runners under load)
    expect(fs.readdirSync(paths().home)).toEqual([]);
  });
  it('exits 0 silently for an invalid session id', async () => {
    expect(await wait('stop', { session_id: '../evil' })).toEqual({ exitCode: 0, stderr: '' });
  });
  it('delivers queued messages in order as one wake', async () => {
    await reg('s1');
    await enqueue('s1', 'um');
    await enqueue('s1', 'dois');
    const r = await wait('stop');
    expect(r.exitCode).toBe(2);
    expect(unwrapMessages(r.stderr).map((m) => m.text)).toEqual(['um', 'dois']);
    expect(fs.existsSync(paths().waiterLock('s1'))).toBe(false);
  });
  it('wakes on message enqueued while waiting', async () => {
    await reg('s1');
    const p = wait('stop');
    await sleep(30);
    await enqueue('s1', 'oi');
    const r = await p;
    expect(r.exitCode).toBe(2);
    expect(unwrapMessages(r.stderr).map((m) => m.text)).toEqual(['oi']);
  });
  it('exits 0 when disconnected while waiting', async () => {
    await reg('s1');
    const p = wait('stop');
    await sleep(30);
    await markDisconnected('s1', 'off');
    expect(await p).toEqual({ exitCode: 0, stderr: '' });
    expect(fs.existsSync(paths().waiterLock('s1'))).toBe(false);
  });
  it('exits when parent process is gone', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: 4242 });
    let alive = true;
    const seen = new Set<number>();
    const p = wait('stop', {}, { isAlive: (pid) => (seen.add(pid), alive) });
    await sleep(30);
    alive = false;
    expect(await p).toEqual({ exitCode: 0, stderr: '' });
    expect([...seen]).toEqual([4242]);
    expect(fs.existsSync(paths().waiterLock('s1'))).toBe(false);
  });
  it('second waiter for same session exits 0 and the first keeps waiting', async () => {
    await reg('s1');
    const first = wait('stop');
    await sleep(30);
    expect(await wait('stop')).toEqual({ exitCode: 0, stderr: '' });
    await enqueue('s1', 'x');
    expect((await first).exitCode).toBe(2);
  });
  it('drained messages are delivered even if clearing waiting state fails', async () => {
    await reg('s1');
    await enqueue('s1', 'um');
    const r = await wait('stop', {}, {
      clearWaiting: async () => {
        throw new Error('boom');
      },
    });
    expect(r.exitCode).toBe(2);
    expect(unwrapMessages(r.stderr).map((m) => m.text)).toEqual(['um']);
    expect(fs.existsSync(paths().waiterLock('s1'))).toBe(false);
  });
  it('stop clears the busy marker and the waiting state (the turn ended)', async () => {
    await reg('s1');
    await setBusy('s1');
    await setWaiting('s1', 'permission');
    await enqueue('s1', 'x');
    const r = await wait('stop');
    expect(r.exitCode).toBe(2);
    expect(await isBusy('s1')).toBe(false);
    expect(await getWaiting('s1')).toBeNull();
  });
  // Audit RT6 / AI-F4: SessionStart also fires on (auto-)compaction mid-turn. A start waiter must
  // never clear the busy marker, or a queued app message would be injected mid-turn.
  it('start never clears the busy or waiting markers and does not drain while busy', async () => {
    await reg('s1');
    await setBusy('s1');
    await setWaiting('s1', 'permission');
    await enqueue('s1', 'x');
    let done = false;
    const p = wait('start', { source: 'resume' }).then((r) => ((done = true), r));
    await sleep(60);
    expect(done).toBe(false);
    expect(await isBusy('s1')).toBe(true);
    expect(await getWaiting('s1')).not.toBeNull();
    expect((await peek('s1')).map((m) => m.text)).toEqual(['x']);
    fs.rmSync(paths().busyFile('s1'));
    expect((await p).exitCode).toBe(2);
  });
  it('does not drain while the busy marker exists, then drains once it is cleared', async () => {
    await reg('s1');
    let done = false;
    const p = wait('stop').then((r) => ((done = true), r));
    await sleep(30);
    await setBusy('s1'); // a terminal turn started after this waiter was armed
    await enqueue('s1', 'later');
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
    await enqueue('s1', 'oi');
    const r = await wait('stop');
    expect(r.stderr).toContain('key=abc123]');
    expect(unwrapMessages(r.stderr, 'abc123').map((m) => m.text)).toEqual(['oi']);
  });
  it('pid null: resolves it at start and persists it', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: null });
    let lookups = 0;
    const seen: number[] = [];
    await enqueue('s1', 'x');
    const r = await wait('stop', {}, {
      lookup: async () => (lookups++, { ok: true, pid: 4242 }),
      isAlive: (pid) => (seen.push(pid), true),
    });
    expect(r.exitCode).toBe(2);
    expect(lookups).toBe(1);
    expect(seen).toEqual([4242]);
    expect((await getRegistration('s1'))?.pid).toBe(4242);
  });
  // Audit RT10 / AI-F8: with an unknown pid the waiter used to poll until killed.
  it('pid still unknown: re-resolves periodically and exits after 3 lookups that do not list the session', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: null });
    let lookups = 0;
    const answers: PidLookup[] = [{ ok: true, pid: null }, { ok: false }, { ok: true, pid: null }, { ok: false }, { ok: true, pid: null }];
    const r = await wait('stop', {}, {
      reresolveMs: 20,
      lookup: async () => answers[lookups++] ?? { ok: true, pid: null },
      isAlive: () => false,
    });
    expect(r).toEqual({ exitCode: 0, stderr: '' });
    // first lookup at start (miss 1), failed lookups do not count, then 2 more misses
    expect(lookups).toBe(5);
    expect(fs.existsSync(paths().waiterLock('s1'))).toBe(false);
  });
  it('pid still unknown: a later lookup that finds it is persisted and checked from then on', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: null });
    let lookups = 0;
    let alive = true;
    const p = wait('stop', {}, {
      reresolveMs: 20,
      lookup: async () => (++lookups < 2 ? { ok: true, pid: null } : { ok: true, pid: 777 }),
      isAlive: (pid) => pid === 777 && alive,
    });
    await vi.waitFor(async () => expect((await getRegistration('s1'))?.pid).toBe(777), { timeout: 5000, interval: 10 });
    alive = false;
    expect(await p).toEqual({ exitCode: 0, stderr: '' });
  });
  it('pid still unknown: ends when the hub marks the session exited', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: null });
    const p = wait('stop');
    await sleep(40);
    await markDisconnected('s1', 'exited');
    expect(await p).toEqual({ exitCode: 0, stderr: '' });
  });
  it('stale pid (resumed session in a new process): re-resolves once and keeps waiting', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: 111 });
    let lookups = 0;
    const p = wait('stop', {}, { lookup: async () => (lookups++, { ok: true, pid: 222 }), isAlive: (pid) => pid === 222 });
    await sleep(30);
    await enqueue('s1', 'x');
    expect((await p).exitCode).toBe(2);
    expect(lookups).toBe(1);
    expect((await getRegistration('s1'))?.pid).toBe(222);
  });
  // Audit RT1 / AI-F5: Claude Code enforces `timeout` on asyncRewake hooks; exit 0 before it.
  it('exits 0 on its own when its time budget runs out', async () => {
    await reg('s1');
    const t = Date.now();
    expect(await wait('stop', {}, { deadlineMs: 60 })).toEqual({ exitCode: 0, stderr: '' });
    expect(Date.now() - t).toBeLessThan(4000);
    expect(fs.existsSync(paths().waiterLock('s1'))).toBe(false);
  });
  // Audit AI-F10: messages queued long ago (a session asleep for hours) are dropped, not delivered.
  // Audit S2-N6: only when an old session is resumed (start + resume), never at the end of a turn.
  it('start on resume: discards and logs messages older than 30 minutes, delivers the fresh ones', async () => {
    await reg('s1');
    const old = await enqueue('s1', 'stale');
    await enqueue('s1', 'fresh');
    const now = Date.parse(old.createdAt) + 31 * 60_000;
    // only "stale" is older than 30 min at this clock: rewrite "fresh" as recent
    const dir = paths().inboxDir('s1');
    for (const n of fs.readdirSync(dir)) {
      const f = path.join(dir, n);
      const m = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (m.text === 'fresh') fs.writeFileSync(f, JSON.stringify({ ...m, createdAt: new Date(now - 1000).toISOString() }));
    }
    const r = await wait('start', { source: 'resume' }, { now: () => now, lookup: async () => ({ ok: true, pid: process.pid }) });
    expect(unwrapMessages(r.stderr).map((m) => m.text)).toEqual(['fresh']);
    expect(fs.readFileSync(path.join(paths().logDir, 'waiter.log'), 'utf8')).toMatch(/discarded 1 message/);
  });
  it('start on resume, only stale messages: nothing is delivered and the waiter keeps waiting', async () => {
    await reg('s1');
    const old = await enqueue('s1', 'stale');
    const now = Date.parse(old.createdAt) + 31 * 60_000;
    let done = false;
    const p = wait('start', { source: 'resume' }, { now: () => now, lookup: async () => ({ ok: true, pid: process.pid }) }).then((r) => ((done = true), r));
    await vi.waitFor(async () => expect(await peek('s1')).toEqual([]), { timeout: 5000, interval: 10 });
    expect(done).toBe(false);
    await markDisconnected('s1', 'off');
    expect(await p).toEqual({ exitCode: 0, stderr: '' });
  });
  // Audit S2-N6 / R2-N2: a message sent during a turn longer than 30 min used to be dropped when it ended.
  it('stop delivers messages regardless of their age (a long turn)', async () => {
    await reg('s1');
    const old = await enqueue('s1', 'sent during a 40 min turn');
    const now = Date.parse(old.createdAt) + 40 * 60_000;
    const r = await wait('stop', {}, { now: () => now });
    expect(unwrapMessages(r.stderr).map((m) => m.text)).toEqual(['sent during a 40 min turn']);
  });
  it('start on startup (not a resume) also delivers old messages', async () => {
    await reg('s1');
    const old = await enqueue('s1', 'old');
    const now = Date.parse(old.createdAt) + 40 * 60_000;
    const r = await wait('start', { source: 'startup' }, { now: () => now, lookup: async () => ({ ok: true, pid: process.pid }) });
    expect(unwrapMessages(r.stderr).map((m) => m.text)).toEqual(['old']);
  });
  // Audit R2-N2: one fs error used to end the waiter (no per-iteration try/catch), stopping delivery.
  it('a transient fs error in one iteration is logged and the waiter keeps going', async () => {
    await reg('s1');
    await enqueue('s1', 'x');
    const real = fsp.readdir.bind(fsp);
    let fails = 3;
    vi.spyOn(fsp, 'readdir').mockImplementation((async (p: string, o: unknown) => {
      if (String(p).includes(`inbox`) && fails-- > 0) throw errno('EIO');
      return real(p, o as never);
    }) as never);
    const r = await wait('stop');
    expect(r.exitCode).toBe(2);
    expect(unwrapMessages(r.stderr).map((m) => m.text)).toEqual(['x']);
    expect(fs.readFileSync(path.join(paths().logDir, 'waiter.log'), 'utf8')).toMatch(/EIO/);
  });
  it('sweeps claimed files older than 1 hour when it starts', async () => {
    await reg('s1');
    const dir = paths().inboxDir('s1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `x.msg.claimed-${Date.now() - 2 * 3600_000}-u`), '{}');
    expect(await wait('stop', {}, { deadlineMs: 50 })).toEqual({ exitCode: 0, stderr: '' });
    expect(fs.readdirSync(dir)).toEqual([]);
  });
  // Audit R2-N8: a waiter whose lock was reclaimed (its heartbeat lapsed) must stop, not drain alongside.
  it('exits 0 without draining once its lock is no longer its own', async () => {
    await reg('s1');
    await setBusy('s1'); // a turn runs: the only way out of this waiter is noticing the lost lock
    const p = wait('start', { source: 'startup' }, { lookup: async () => ({ ok: true, pid: process.pid }) });
    const lock = paths().waiterLock('s1');
    await vi.waitFor(() => expect(fs.existsSync(lock)).toBe(true), { timeout: 5000, interval: 5 });
    await enqueue('s1', 'x');
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, ts: '2000-01-01T00:00:00.000Z' })); // another holder's content
    expect(await p).toEqual({ exitCode: 0, stderr: '' });
    expect(fs.readFileSync(path.join(paths().logDir, 'waiter.log'), 'utf8')).toMatch(/no longer ours/);
    expect((await peek('s1')).map((m) => m.text)).toEqual(['x']);
    expect(fs.existsSync(lock)).toBe(true); // the other holder's lock is left alone
  });
  // Audit R2-N7 / RT10: with an unknown pid and `claude agents` failing every time, it waited 24 h.
  it('pid unknown and every lookup fails: exits after the failure limit (30 min by default)', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: null });
    let lookups = 0;
    const r = await wait('stop', {}, { reresolveMs: 5, lookupFailMs: 60, lookup: async () => (lookups++, { ok: false }) });
    expect(r).toEqual({ exitCode: 0, stderr: '' });
    expect(lookups).toBeGreaterThan(1);
    const { LOOKUP_FAIL_EXIT_MS } = await import('../../src/hooks/waiter.js');
    expect(LOOKUP_FAIL_EXIT_MS).toBe(30 * 60_000);
  });
  it('pid unknown: a successful lookup resets the failure clock', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: null });
    let lookups = 0;
    let t = 1_000_000; // the failure limit runs on this clock, so wall time under load does not matter
    let done = false;
    // two failed lookups (30 of the 60 allowed), then found and alive: past the limit it keeps waiting
    const p = wait('stop', {}, {
      reresolveMs: 5,
      lookupFailMs: 60,
      now: () => t,
      lookup: async () => (++lookups < 3 ? ((t += 15), { ok: false }) : { ok: true, pid: 4242 }),
      isAlive: (pid) => pid === 4242,
    }).then((r) => ((done = true), r));
    await vi.waitFor(async () => expect((await getRegistration('s1'))?.pid).toBe(4242), { timeout: 5000, interval: 5 });
    t += 10_000;
    await sleep(50);
    expect(done).toBe(false);
    await enqueue('s1', 'still here');
    expect(unwrapMessages((await p).stderr).map((m) => m.text)).toEqual(['still here']);
  });
  it('keeps the waiter lock heartbeat fresh while waiting', async () => {
    await reg('s1');
    const p = wait('stop', {}, { heartbeatMs: 10 });
    const lock = paths().waiterLock('s1');
    await vi.waitFor(() => expect(fs.existsSync(lock)).toBe(true), { timeout: 5000, interval: 5 });
    const old = new Date(Date.now() - 120_000);
    fs.utimesSync(lock, old, old);
    await vi.waitFor(() => expect(Date.now() - fs.statSync(lock).mtimeMs).toBeLessThan(5_000), { timeout: 5000, interval: 10 });
    await enqueue('s1', 'x');
    expect((await p).exitCode).toBe(2);
  });
});

// Audit RT7 / AI-F9: all clear/resume handling runs in the async start waiter, never in a sync hook.
describe('waiter start: same-process session switches', () => {
  const found = (pid: number) => async (): Promise<PidLookup> => ({ ok: true, pid });
  for (const source of ['clear', 'resume', 'startup', 'fork']) {
    it(`${source}: disconnects other active registrations of the same claude pid`, async () => {
      await register({ sessionId: 'A', transcriptPath: '/a', cwd: '/x', pid: 42 });
      await register({ sessionId: 'C', transcriptPath: '/c', cwd: '/x', pid: 43 });
      const r = await wait('start', { session_id: 'B', source }, { lookup: found(42) });
      expect(r).toEqual({ exitCode: 0, stderr: '' });
      expect((await getRegistration('A'))?.disconnectReason).toBe('clear');
      expect((await getRegistration('C'))?.disconnectedAt).toBeUndefined();
      expect(await getRegistration('B')).toBeNull();
    });
  }
  it('skips the pid lookup when no other session is active', async () => {
    let lookups = 0;
    await wait('start', { session_id: 'B', source: 'clear' }, { lookup: async () => (lookups++, { ok: true, pid: 42 }) });
    expect(lookups).toBe(0);
    await register({ sessionId: 'A', transcriptPath: '/a', cwd: '/x', pid: 42 });
    await markDisconnected('A', 'off');
    await wait('start', { session_id: 'B', source: 'clear' }, { lookup: async () => (lookups++, { ok: true, pid: 42 }) });
    expect(lookups).toBe(0);
  });
  it('an unresolvable pid disconnects nothing (null never matches)', async () => {
    await register({ sessionId: 'A', transcriptPath: '/a', cwd: '/x', pid: null });
    await wait('start', { session_id: 'B', source: 'clear' });
    expect((await getRegistration('A'))?.disconnectedAt).toBeUndefined();
  });
  it('compact or an unknown source does nothing', async () => {
    await register({ sessionId: 'A', transcriptPath: '/a', cwd: '/x', pid: 42 });
    let lookups = 0;
    await wait('start', { session_id: 'B', source: 'compact' }, { lookup: async () => (lookups++, { ok: true, pid: 42 }) });
    expect(lookups).toBe(0);
    expect((await getRegistration('A'))?.disconnectedAt).toBeUndefined();
  });
  it('resume/startup of an active registration refreshes pid and transcriptPath, then waits', async () => {
    for (const source of ['resume', 'startup']) {
      await register({ sessionId: 's1', transcriptPath: '/old.jsonl', cwd: '/x', pid: 7, key: 'k' });
      await enqueue('s1', 'hi');
      const r = await wait('start', { source, transcript_path: `/${source}.jsonl` }, { lookup: found(99), isAlive: (p) => p === 99 });
      expect(r.exitCode).toBe(2);
      expect(await getRegistration('s1')).toMatchObject({ pid: 99, transcriptPath: `/${source}.jsonl`, key: 'k' });
    }
  });
  it('resume of an inactive registration does nothing and skips the lookup', async () => {
    await register({ sessionId: 's1', transcriptPath: '/old.jsonl', cwd: '/x', pid: 7 });
    await markDisconnected('s1', 'off');
    let lookups = 0;
    await wait('start', { source: 'resume' }, { lookup: async () => (lookups++, { ok: true, pid: 99 }) });
    expect(lookups).toBe(0);
    expect(await getRegistration('s1')).toMatchObject({ pid: 7, transcriptPath: '/old.jsonl' });
  });
});

// Audit R3-F1: a turn started by an app message and interrupted (Esc) never fires Stop, so no waiter
// was left and every later app message stayed queued. A `prompt` waiter (UserPromptSubmit) is armed
// during every turn; a busy marker left by an interrupted turn is dropped once the session is idle.
describe('waiter prompt: a waiter during every turn', () => {
  const ageBusy = async (sid: string, ms: number) => {
    const t = new Date(Date.now() - ms);
    await fsp.utimes(paths().busyFile(sid), t, t);
  };
  const promptOpts = (extra: WaiterOptions = {}): WaiterOptions => ({ promptSettleMs: 0, status: async () => 'busy', ...extra });

  it('a /cc prompt arms nothing (its own Stop does)', async () => {
    await reg('s1');
    await enqueue('s1', 'x');
    for (const prompt of ['/cc', '/cc off', '/ai-chat-center:cc', '/cc bogus']) {
      expect(await wait('prompt', { prompt }, promptOpts())).toEqual({ exitCode: 0, stderr: '' });
    }
    expect(await peek('s1')).toHaveLength(1);
  });
  it('an unconnected session arms nothing', async () => {
    expect(await wait('prompt', { prompt: 'hi' }, promptOpts())).toEqual({ exitCode: 0, stderr: '' });
  });
  it('never clears busy, holds the lock during the turn, and delivers once the turn ends (Stop clears busy)', async () => {
    await reg('s1');
    await setBusy('s1');
    await setWaiting('s1', 'permission');
    await enqueue('s1', 'during the turn');
    let done = false;
    const p = wait('prompt', { prompt: 'hi' }, promptOpts()).then((r) => ((done = true), r));
    await sleep(80);
    expect(done).toBe(false);
    expect(await isBusy('s1')).toBe(true);
    expect(await getWaiting('s1')).not.toBeNull();
    // Stop fires: its waiter clears busy, loses the lock race and exits; the prompt waiter delivers.
    expect(await wait('stop')).toEqual({ exitCode: 0, stderr: '' });
    const r = await p;
    expect(r.exitCode).toBe(2);
    expect(unwrapMessages(r.stderr).map((m) => m.text)).toEqual(['during the turn']);
  });
  it('does not drain before the prompt hook had time to set busy (settle delay)', async () => {
    await reg('s1');
    await enqueue('s1', 'x');
    let done = false;
    const p = wait('prompt', { prompt: 'hi' }, promptOpts({ promptSettleMs: 300 })).then((r) => ((done = true), r));
    await sleep(100);
    expect(done).toBe(false);
    expect(await peek('s1')).toHaveLength(1);
    expect((await p).exitCode).toBe(2);
  });
  it('interrupted turn: a stale busy marker is dropped once the session is idle, and the message delivered', async () => {
    await reg('s1');
    await setBusy('s1');
    let statusCalls = 0;
    const p = wait('prompt', { prompt: 'hi' }, promptOpts({ staleBusyMs: 1000, busyCheckMs: 0, status: async () => (statusCalls++, 'idle') }));
    await sleep(60);
    expect(statusCalls).toBe(0); // nothing queued: no lookup
    await enqueue('s1', 'after Esc');
    await sleep(60);
    expect(statusCalls).toBe(0); // busy is fresh: a turn may be running
    await ageBusy('s1', 5000);
    const r = await p;
    expect(statusCalls).toBeGreaterThan(0);
    expect(r.exitCode).toBe(2);
    expect(unwrapMessages(r.stderr).map((m) => m.text)).toEqual(['after Esc']);
    expect(await isBusy('s1')).toBe(false);
  });
  it('a stale busy marker stays while the session is still busy or waiting, or the lookup fails', async () => {
    for (const st of ['busy', 'waiting', null] as const) {
      await reg('s1');
      await setBusy('s1');
      await ageBusy('s1', 60_000);
      await enqueue('s1', 'x');
      let calls = 0;
      const p = wait('prompt', { prompt: 'hi' }, promptOpts({ staleBusyMs: 1000, busyCheckMs: 0, status: async () => (calls++, st) }));
      await vi.waitFor(() => expect(calls).toBeGreaterThan(2), { timeout: 5000, interval: 10 });
      expect(await isBusy('s1')).toBe(true);
      expect(await peek('s1')).toHaveLength(1);
      await markDisconnected('s1', 'off');
      expect((await p).exitCode).toBe(0);
    }
  });
  it('other waiters drop a stale busy marker too (a terminal turn interrupted, no browser open)', async () => {
    await reg('s1');
    await setBusy('s1');
    await ageBusy('s1', 60_000);
    await enqueue('s1', 'x');
    const r = await wait('start', { source: 'compact' }, { staleBusyMs: 1000, busyCheckMs: 0, status: async () => 'idle' });
    expect(r.exitCode).toBe(2);
  });
  it('checks the live status at most every busyCheckMs', async () => {
    await reg('s1');
    await setBusy('s1');
    await ageBusy('s1', 60_000);
    await enqueue('s1', 'x');
    let calls = 0;
    const p = wait('prompt', { prompt: 'hi' }, promptOpts({ staleBusyMs: 1000, busyCheckMs: 10_000, status: async () => (calls++, 'busy') }));
    await sleep(200);
    expect(calls).toBe(1);
    await markDisconnected('s1', 'off');
    await p;
  });
});
