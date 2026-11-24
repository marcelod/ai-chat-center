import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { runWaiter, type WaiterOptions, type WaiterEvent, type PidLookup } from '../../src/hooks/waiter.js';
import { register, markDisconnected, markRemoved, getRegistration, updateRegistration } from '../../src/core/registry.js';
import { setBusy, isBusy } from '../../src/core/busy.js';
import { setWaiting, getWaiting } from '../../src/core/waiting.js';
import { enqueue, peek } from '../../src/core/inbox.js';
import { signMessage } from '../../src/core/secret.js';
import { unwrapMessages } from '../../src/core/protocol.js';
import { paths } from '../../src/core/paths.js';
import { PROTOCOL, VERSION } from '../../src/core/version.js';
import { tmpDir } from '../helpers/tmp.js';
import { getMode } from '../../src/core/meta.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errno = (code: string) => Object.assign(new Error(code), { code });
const reg = (sid: string) => register({ sessionId: sid, transcriptPath: '/t.jsonl', cwd: '/x', pid: process.pid });
const notListed = async (): Promise<PidLookup> => ({ ok: true, pid: null });
const opts: WaiterOptions = { pollMs: 10, lookup: notListed };
const input = (o: Record<string, unknown> = {}) => ({ session_id: 's1', transcript_path: '/t.jsonl', ...o });
const wait = (event: WaiterEvent, o: Record<string, unknown> = {}, extra: WaiterOptions = {}) =>
  runWaiter(event, input(o) as never, { ...opts, ...extra });

beforeEach(() => {
  process.env.AI_CHAT_CENTER_HOME = tmpDir('acc-');
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
  it('ends when the app removes the session', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: process.pid });
    const p = wait('stop');
    await sleep(40);
    await markRemoved('s1');
    expect(await p).toEqual({ exitCode: 0, stderr: '' });
  });
  it('pid still unknown: ends when the hub marks the session exited', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: null });
    const p = wait('stop');
    await sleep(40);
    await markDisconnected('s1', 'exited');
    expect(await p).toEqual({ exitCode: 0, stderr: '' });
  });
  // Audit R5-M1: a session restarted after a plugin update (exit, `claude --resume`) runs the new code: its
  // start waiter stamps the registration, so the hub accepts sends to it again. Any waiter does the same.
  it('start on resume records the plugin version and protocol in the registration', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: 111 });
    const p = wait('start', { source: 'resume' }, { lookup: async () => ({ ok: true, pid: process.pid }), deadlineMs: 200 });
    await p;
    expect(await getRegistration('s1')).toMatchObject({ pid: process.pid, version: VERSION, protocol: PROTOCOL });
  });
  it('any waiter re-stamps a registration written by another version (connection unchanged)', async () => {
    const r0 = await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: process.pid, version: '0.0.1', protocol: 1 });
    await wait('stop', {}, { deadlineMs: 100 });
    expect(await getRegistration('s1')).toMatchObject({ version: VERSION, protocol: PROTOCOL, connectedAt: r0.connectedAt });
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
    // connected 2 h ago: the stale message (31 min old, re-signed with that time) is not older than the connection
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: process.pid, connectedAt: new Date(Date.now() - 2 * 3600_000).toISOString() });
    await enqueue('s1', 'stale');
    await enqueue('s1', 'fresh');
    const now = Date.now();
    const dir = paths().inboxDir('s1');
    for (const n of fs.readdirSync(dir)) {
      const f = path.join(dir, n);
      const m = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (m.text === 'stale') fs.writeFileSync(f, JSON.stringify(await signMessage('s1', { ...m, createdAt: new Date(now - 31 * 60_000).toISOString() })));
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
  // Audit R4-L3: a claimed file older than 1 hour was left by a waiter that died mid-drain. Unless its id
  // was delivered, it is put back and delivered (a second delivery is safer than a lost message).
  it('at start, puts back claimed files older than 1 hour (deleting those already delivered)', async () => {
    await reg('s1');
    const dir = paths().inboxDir('s1');
    const a = await enqueue('s1', 'left behind');
    const b = await enqueue('s1', 'already delivered');
    const old = Date.now() - 2 * 3600_000;
    for (const n of fs.readdirSync(dir)) fs.renameSync(path.join(dir, n), path.join(dir, `${n}.claimed-${old}-u`));
    const { recordDelivered } = await import('../../src/core/delivered.js');
    await recordDelivered('s1', [b.id]);
    const r = await wait('stop');
    expect(unwrapMessages(r.stderr).map((m) => m.text)).toEqual(['left behind']);
    expect(unwrapMessages(r.stderr).map((m) => m.id)).toEqual([a.id]);
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
    // A fake clock that advances 25 ms per lookup: the limit is reached after a known number of lookups,
    // whatever the machine load (stress: real time let it pass after a single lookup).
    let t = 0;
    const r = await wait('stop', {}, {
      reresolveMs: 5,
      lookupFailMs: 60,
      now: () => t,
      lookup: async () => ((t += 25), lookups++, { ok: false }),
    });
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
  it('an unresolvable own pid disconnects no registration with a known pid (null never matches)', async () => {
    await register({ sessionId: 'A', transcriptPath: '/a', cwd: '/x', pid: 42 });
    await wait('start', { session_id: 'B', source: 'clear' });
    expect((await getRegistration('A'))?.disconnectedAt).toBeUndefined();
  });
  // Audit S3-L5: a registration whose pid was never resolved survived /clear, so the old conversation
  // stayed "connected" and its waiter could deliver app messages into the cleared one. Resolve it first.
  describe('clear: registrations with an unknown pid', () => {
    const byId = (m: Record<string, PidLookup>) => async (id: string): Promise<PidLookup> => m[id] ?? { ok: true, pid: null };
    it('not listed by claude agents: disconnected', async () => {
      await register({ sessionId: 'A', transcriptPath: '/a', cwd: '/x', pid: null });
      await wait('start', { session_id: 'B', source: 'clear', cwd: '/y' }, { lookup: byId({ B: { ok: true, pid: 42 } }) });
      expect((await getRegistration('A'))?.disconnectReason).toBe('clear');
    });
    it('listed with this very claude pid: disconnected', async () => {
      await register({ sessionId: 'A', transcriptPath: '/a', cwd: '/x', pid: null });
      await wait('start', { session_id: 'B', source: 'clear' }, { lookup: byId({ A: { ok: true, pid: 42 }, B: { ok: true, pid: 42 } }) });
      expect((await getRegistration('A'))?.disconnectReason).toBe('clear');
    });
    it('listed with another pid: its pid is recorded and it stays connected', async () => {
      await register({ sessionId: 'A', transcriptPath: '/a', cwd: '/x', pid: null });
      await wait('start', { session_id: 'B', source: 'clear' }, { lookup: byId({ A: { ok: true, pid: 55 }, B: { ok: true, pid: 42 } }) });
      const a = await getRegistration('A');
      expect(a?.disconnectedAt).toBeUndefined();
      expect(a?.pid).toBe(55);
    });
    // Audit S4-U3: `claude agents` only sees sessions of its own CLAUDE_CONFIG_DIR.
    it('a registration from another Claude config dir is never touched by a /clear here', async () => {
      await register({ sessionId: 'A', transcriptPath: '/a', cwd: '/x', pid: null, configDir: '/other/claude-config' });
      let asked = 0;
      await wait('start', { session_id: 'B', source: 'clear', cwd: '/x' }, { lookup: async (id) => (id === 'A' && asked++, { ok: true, pid: id === 'B' ? 42 : null }) });
      expect((await getRegistration('A'))?.disconnectedAt).toBeUndefined();
      expect(asked).toBe(0);
    });
    it('lookup failing: disconnected when in the same folder, kept otherwise', async () => {
      await register({ sessionId: 'A', transcriptPath: '/a', cwd: '/x', pid: null });
      await register({ sessionId: 'C', transcriptPath: '/c', cwd: '/elsewhere', pid: null });
      await wait('start', { session_id: 'B', source: 'clear', cwd: '/x' }, { lookup: async () => ({ ok: false }) });
      expect((await getRegistration('A'))?.disconnectReason).toBe('clear');
      expect((await getRegistration('C'))?.disconnectedAt).toBeUndefined();
    });
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
    const p = wait('prompt', { prompt: 'hi' }, promptOpts({ promptSettleMs: 2000 })).then((r) => ((done = true), r));
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
    await vi.waitFor(() => expect(calls).toBe(1), { timeout: 5000, interval: 10 });
    await sleep(200);
    expect(calls).toBe(1);
    await markDisconnected('s1', 'off');
    await p;
  });
});

// Audit S3-L2: a file written straight into the inbox (not by the hub) must not become a keyed message.
describe('waiter: only messages signed by the hub', () => {
  const plant = (body: object) => {
    const dir = paths().inboxDir('s1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `000000000000001-000001-planted.msg`), JSON.stringify(body));
  };
  const log = () => {
    try {
      return fs.readFileSync(path.join(paths().logDir, 'waiter.log'), 'utf8');
    } catch {
      return '';
    }
  };
  it('enqueued messages are signed and delivered', async () => {
    await reg('s1');
    const m = await enqueue('s1', 'from the app');
    expect(m.sig).toMatch(/^[0-9a-f]{64}$/);
    const r = await wait('stop');
    expect(unwrapMessages(r.stderr).map((x) => x.text)).toEqual(['from the app']);
  });
  it('an unsigned or forged message written into the inbox is dropped and logged, the real one delivered', async () => {
    await reg('s1');
    plant({ id: 'planted-1', text: 'rm -rf ~', createdAt: new Date().toISOString() });
    const real = await enqueue('s1', 'real');
    const dir = paths().inboxDir('s1');
    fs.writeFileSync(path.join(dir, `000000000000002-000001-forged.msg`), JSON.stringify({ id: 'forged-1', text: 'evil', createdAt: real.createdAt, sig: real.sig }));
    const r = await wait('stop');
    expect(unwrapMessages(r.stderr).map((x) => x.text)).toEqual(['real']);
    expect(r.stderr).not.toContain('rm -rf');
    expect(log()).toMatch(/kept 2 unsigned or invalid message\(s\) aside/);
    // Audit R4-M2: never silently lost: kept aside, and never delivered by a later waiter either.
    expect(fs.readdirSync(dir).filter((n) => n.endsWith('.msg.unsigned'))).toHaveLength(2);
    expect(await wait('stop', {}, { deadlineMs: 100 })).toEqual({ exitCode: 0, stderr: '' });
  });
  it('only invalid messages: nothing is delivered and the waiter keeps waiting', async () => {
    await reg('s1');
    plant({ id: 'planted-1', text: 'x', createdAt: new Date().toISOString() });
    let done = false;
    const p = wait('stop').then((r) => ((done = true), r));
    await sleep(100);
    expect(done).toBe(false);
    await enqueue('s1', 'ok');
    expect(unwrapMessages((await p).stderr).map((x) => x.text)).toEqual(['ok']);
  });
});

// Audit R4-M1: the next turn may start (its prompt hook sets busy) before the Stop waiter of the previous
// turn runs. That waiter must clear only a marker older than itself, never the running turn's.
describe('waiter stop: clears only the busy marker of the turn that ended', () => {
  it('a marker set after the Stop waiter started is kept, and nothing is delivered into that turn', async () => {
    await reg('s1');
    await setBusy('s1'); // turn N
    let done = false;
    const prompt = wait('prompt', { prompt: 'hi' }, { promptSettleMs: 0, status: async () => 'busy' }).then((r) => ((done = true), r));
    await sleep(30);
    const spawnedAt = Date.now(); // Stop of turn N fires: its waiter process starts here
    await sleep(20);
    await setBusy('s1'); // turn N+1 starts before that waiter runs
    await enqueue('s1', 'queued');
    expect(await wait('stop', {}, { spawnedAt })).toEqual({ exitCode: 0, stderr: '' }); // lost the lock
    expect(await isBusy('s1')).toBe(true);
    await sleep(100);
    expect(done).toBe(false); // nothing delivered into turn N+1
    expect((await peek('s1')).map((m) => m.text)).toEqual(['queued']);
    fs.rmSync(paths().busyFile('s1')); // turn N+1 ends
    expect(unwrapMessages((await prompt).stderr).map((m) => m.text)).toEqual(['queued']);
  });
  it('a marker older than the Stop waiter is cleared', async () => {
    await reg('s1');
    await setBusy('s1');
    const old = new Date(Date.now() - 5000);
    await fsp.utimes(paths().busyFile('s1'), old, old);
    await enqueue('s1', 'x');
    const r = await wait('stop', {}, { spawnedAt: Date.now() - 1000 });
    expect(r.exitCode).toBe(2);
    expect(await isBusy('s1')).toBe(false);
  });
});

// Audit S4-S1 / S4-S2: the signature binds the session and the time; a delivered id is never delivered
// again; the secret is read (with retries) before anything is claimed, and is never needed to delete.
describe('waiter: signature scope, replay and the secret', () => {
  const waiterLog = () => {
    try {
      return fs.readFileSync(path.join(paths().logDir, 'waiter.log'), 'utf8');
    } catch {
      return '';
    }
  };
  const put = (sid: string, m: object, name = `000000000000009-000001-${(m as { id: string }).id}.msg`) => {
    const dir = paths().inboxDir(sid);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), JSON.stringify(m));
    return path.join(dir, name);
  };
  const inbox = (sid: string) => fs.readdirSync(paths().inboxDir(sid));

  it('a message signed for another session is not delivered (kept aside)', async () => {
    await reg('s1');
    await reg('s2');
    const m = await enqueue('s1', 'for s1 only');
    fs.rmSync(paths().inboxDir('s1'), { recursive: true });
    put('s2', m);
    expect(await wait('stop', { session_id: 's2' }, { deadlineMs: 150 })).toEqual({ exitCode: 0, stderr: '' });
    expect(inbox('s2').filter((n) => n.endsWith('.msg.unsigned'))).toHaveLength(1);
  });
  it('a delivered message dropped into the inbox again is not delivered twice (replay)', async () => {
    await reg('s1');
    const m = await enqueue('s1', 'once');
    expect(unwrapMessages((await wait('stop')).stderr).map((x) => x.text)).toEqual(['once']);
    put('s1', m);
    expect(await wait('stop', {}, { deadlineMs: 150 })).toEqual({ exitCode: 0, stderr: '' });
    expect(inbox('s1')).toEqual([]);
    expect(waiterLog()).toMatch(/already delivered/);
  });
  it('a signed message dated in the future, or before this connection, is dropped', async () => {
    await reg('s1');
    const base = { text: 'x' };
    put('s1', await signMessage('s1', { ...base, id: 'future', createdAt: new Date(Date.now() + 10 * 60_000).toISOString() }));
    put('s1', await signMessage('s1', { ...base, id: 'before', createdAt: new Date(Date.now() - 3600_000).toISOString() }), '000000000000008-000001-before.msg');
    const ok = await enqueue('s1', 'ok');
    const r = await wait('stop');
    expect(unwrapMessages(r.stderr).map((x) => x.id)).toEqual([ok.id]);
    expect(waiterLog()).toMatch(/future \(dated in the future\)/);
    expect(waiterLog()).toMatch(/before \(older than this connection\)/);
    expect(inbox('s1')).toEqual([]);
  });
  it('a message signed within the clock skew (2 min ahead) is delivered', async () => {
    await reg('s1');
    put('s1', await signMessage('s1', { id: 'soon', text: 'skew', createdAt: new Date(Date.now() + 60_000).toISOString() }));
    expect(unwrapMessages((await wait('stop')).stderr).map((x) => x.text)).toEqual(['skew']);
  });
  for (const code of ['EACCES', 'EBUSY']) {
    it(`a secret that cannot be read (${code}) claims nothing: messages stay queued and are delivered once it can`, async () => {
      await reg('s1');
      await enqueue('s1', 'kept safe');
      const before = fs.readFileSync(paths().secret, 'utf8');
      const real = fsp.readFile.bind(fsp);
      let blocked = true;
      vi.spyOn(fsp, 'readFile').mockImplementation((async (file: unknown, ...rest: unknown[]) => {
        if (blocked && String(file) === paths().secret) throw errno(code);
        return (real as (...a: unknown[]) => Promise<unknown>)(file, ...rest);
      }) as typeof fsp.readFile);
      let done = false;
      const p = wait('stop').then((r) => ((done = true), r));
      await sleep(1500);
      expect(done).toBe(false);
      expect(inbox('s1').filter((n) => n.endsWith('.msg'))).toHaveLength(1); // untouched: not claimed, not deleted
      expect(waiterLog()).toMatch(/install secret is unreadable/);
      blocked = false;
      expect(unwrapMessages((await p).stderr).map((x) => x.text)).toEqual(['kept safe']);
      expect(fs.readFileSync(paths().secret, 'utf8')).toBe(before); // never replaced
    });
  }
  it('a missing secret claims nothing either', async () => {
    await reg('s1');
    await enqueue('s1', 'x');
    fs.rmSync(paths().secret);
    expect(await wait('stop', {}, { deadlineMs: 200 })).toEqual({ exitCode: 0, stderr: '' });
    expect(inbox('s1').filter((n) => n.endsWith('.msg'))).toHaveLength(1);
    expect(waiterLog()).toMatch(/install secret is missing/);
  });
});

// Audit S4-U1: Claude Code leaves async hooks running when it exits. A waiter of a closed claude process
// kept the lock after the session was resumed elsewhere and drained messages into a pipe nobody reads.
// Each waiter is pinned to the claude process it serves (its parent with exec-form hooks).
describe('waiter: pinned to the claude process it serves', () => {
  const PARENT = 9001;
  const OTHER = 9002;
  const live = new Set<number>();
  const aliveFn = (pid: number) => live.has(pid);
  beforeEach(() => {
    live.clear();
    live.add(PARENT);
    live.add(OTHER);
  });
  const regWith = (pid: number | null) => register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid });

  it('exits without draining once the registration names another claude process (resumed elsewhere)', async () => {
    await regWith(PARENT);
    await setBusy('s1');
    let done = false;
    const p = wait('stop', {}, { parentPid: PARENT, isAlive: aliveFn, spawnedAt: 0 }).then((r) => ((done = true), r));
    await sleep(40);
    expect(done).toBe(false);
    await updateRegistration('s1', { pid: OTHER });
    fs.rmSync(paths().busyFile('s1'));
    await enqueue('s1', 'for the resumed session');
    expect(await p).toEqual({ exitCode: 0, stderr: '' });
    expect((await peek('s1')).map((m) => m.text)).toEqual(['for the resumed session']);
    expect(fs.existsSync(paths().waiterLock('s1'))).toBe(false); // the new process's waiter can take over
  });
  it('exits without draining when its claude process dies, even if a lookup would find a new one', async () => {
    await regWith(PARENT);
    await setBusy('s1');
    let lookups = 0;
    const p = wait('stop', {}, { parentPid: PARENT, isAlive: aliveFn, spawnedAt: 0, lookup: async () => (lookups++, { ok: true, pid: OTHER }) });
    await sleep(40);
    live.delete(PARENT);
    fs.rmSync(paths().busyFile('s1'));
    await enqueue('s1', 'x');
    expect(await p).toEqual({ exitCode: 0, stderr: '' });
    expect(lookups).toBe(0);
    expect(await peek('s1')).toHaveLength(1);
  });
  it('exits when it is re-parented (POSIX: its claude process is gone)', async () => {
    await regWith(PARENT);
    await setBusy('s1');
    let parentNow = PARENT;
    const p = wait('stop', {}, { parentPid: PARENT, currentParentPid: () => parentNow, isAlive: aliveFn, spawnedAt: 0 });
    await sleep(40);
    parentNow = 1;
    expect(await p).toEqual({ exitCode: 0, stderr: '' });
  });
  it('a registration not yet updated to this (resumed) process: one lookup confirms the parent and records it', async () => {
    await regWith(OTHER); // claude #1 (exited), still listed in the registration
    live.delete(OTHER);
    await enqueue('s1', 'for claude #2');
    const r = await wait('stop', {}, { parentPid: PARENT, isAlive: aliveFn, lookup: async () => ({ ok: true, pid: PARENT }) });
    expect(unwrapMessages(r.stderr).map((m) => m.text)).toEqual(['for claude #2']);
    expect((await getRegistration('s1'))!.pid).toBe(PARENT);
  });
  it('a parent that is not the claude process (a node shim): falls back to the registered pid and still delivers', async () => {
    await regWith(OTHER);
    await enqueue('s1', 'through a shim');
    const r = await wait('stop', {}, { parentPid: PARENT, isAlive: aliveFn, lookup: async () => ({ ok: true, pid: OTHER }) });
    expect(unwrapMessages(r.stderr).map((m) => m.text)).toEqual(['through a shim']);
    expect((await getRegistration('s1'))!.pid).toBe(OTHER);
  });
  // Audit R5-L1 (r5rt/resume-elsewhere.mjs): the session is resumed in claude B while claude A is still open.
  // B's start waiter records B and finds the lock held by A's waiter, which exits within a poll once it sees
  // B in the registration. B's waiter used to give up at once, leaving no waiter at all.
  it('resumed in a second terminal: the new pinned waiter retries the lock and takes over', async () => {
    await regWith(PARENT); // claude A
    await setBusy('s1');
    const a = wait('stop', {}, { parentPid: PARENT, isAlive: aliveFn, spawnedAt: 0, pollMs: 300 });
    await sleep(40);
    fs.rmSync(paths().busyFile('s1'));
    const b = wait('start', { source: 'resume' }, { parentPid: OTHER, isAlive: aliveFn, lookup: async () => ({ ok: true, pid: OTHER }) });
    expect(await a).toEqual({ exitCode: 0, stderr: '' });
    await enqueue('s1', 'sent after the resume in B');
    const r = await b;
    expect(r.exitCode).toBe(2);
    expect(unwrapMessages(r.stderr).map((m) => m.text)).toEqual(['sent after the resume in B']);
  });
  it('a pinned waiter gives up after about 3 s when the lock stays held', async () => {
    await regWith(PARENT);
    const holder = paths().waiterLock('s1');
    fs.mkdirSync(path.dirname(holder), { recursive: true });
    fs.writeFileSync(holder, JSON.stringify({ pid: process.pid, ts: Date.now() })); // a live holder that never leaves
    const t = Date.now();
    expect(await wait('stop', {}, { parentPid: PARENT, isAlive: aliveFn, spawnedAt: 0 })).toEqual({ exitCode: 0, stderr: '' });
    expect(Date.now() - t).toBeGreaterThanOrEqual(2500);
    expect(Date.now() - t).toBeLessThan(6000);
  });
  it('an unpinned waiter that finds the lock held still exits at once', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: OTHER });
    const holder = paths().waiterLock('s1');
    fs.mkdirSync(path.dirname(holder), { recursive: true });
    fs.writeFileSync(holder, JSON.stringify({ pid: process.pid, ts: Date.now() }));
    const t = Date.now();
    expect(await wait('stop', {}, { isAlive: aliveFn })).toEqual({ exitCode: 0, stderr: '' });
    expect(Date.now() - t).toBeLessThan(1000);
  });
  // Audit S5-L2: Windows never re-parents, so a waiter whose claude process exited cannot tell when another
  // process reuses that pid. Right before claiming, it confirms once with `claude agents` that the session
  // runs in its parent. A failed lookup delivers as before.
  describe('on Windows, one lookup confirms the parent before claiming', () => {
    const win = { platform: 'win32' as const, parentPid: PARENT, isAlive: aliveFn };
    it('the session runs in its parent: delivered, one lookup', async () => {
      await regWith(PARENT);
      await enqueue('s1', 'x');
      let lookups = 0;
      const r = await wait('stop', {}, { ...win, lookup: async () => (lookups++, { ok: true, pid: PARENT }) });
      expect(unwrapMessages(r.stderr).map((m) => m.text)).toEqual(['x']);
      expect(lookups).toBe(1);
    });
    it('the session runs in another process, or is not listed (the parent pid was reused): nothing is taken', async () => {
      for (const found of [OTHER, null]) {
        await regWith(PARENT);
        await enqueue('s1', 'x');
        const r = await wait('stop', {}, { ...win, lookup: async () => ({ ok: true, pid: found }) });
        expect(r).toEqual({ exitCode: 0, stderr: '' });
        expect((await peek('s1')).map((m) => m.text)).toEqual(['x']);
        await markDisconnected('s1', 'off');
      }
    });
    it('the lookup fails: delivered as before', async () => {
      await regWith(PARENT);
      await enqueue('s1', 'x');
      const r = await wait('stop', {}, { ...win, lookup: async () => ({ ok: false }) as PidLookup });
      expect(unwrapMessages(r.stderr).map((m) => m.text)).toEqual(['x']);
    });
    it('no lookup while nothing is queued, and none on other platforms', async () => {
      await regWith(PARENT);
      let lookups = 0;
      const lookup = async () => (lookups++, { ok: true, pid: PARENT } as PidLookup);
      expect(await wait('stop', {}, { ...win, lookup, deadlineMs: 150 })).toEqual({ exitCode: 0, stderr: '' });
      expect(lookups).toBe(0);
      await enqueue('s1', 'x');
      const r = await wait('stop', {}, { ...win, platform: 'linux', lookup });
      expect(r.exitCode).toBe(2);
      expect(lookups).toBe(0);
    });
  });
  it('with a shim parent, it still exits once the registration names another process', async () => {
    await regWith(OTHER);
    await setBusy('s1');
    const p = wait('stop', {}, { parentPid: PARENT, isAlive: aliveFn, spawnedAt: 0, lookup: async () => ({ ok: true, pid: OTHER }) });
    await sleep(40);
    live.add(9003);
    await updateRegistration('s1', { pid: 9003 });
    fs.rmSync(paths().busyFile('s1'));
    await enqueue('s1', 'x');
    expect(await p).toEqual({ exitCode: 0, stderr: '' });
    expect(await peek('s1')).toHaveLength(1);
  });
});

describe('waiter: permission mode', () => {
  it('Stop records the mode the turn ended in, for an active session only', async () => {
    await wait('stop', { permission_mode: 'plan' });
    expect(await getMode('s1')).toBeNull();
    await reg('s1');
    await enqueue('s1', 'oi'); // returns at once
    await wait('stop', { permission_mode: 'plan' });
    expect(await getMode('s1')).toBe('plan');
  });
});
