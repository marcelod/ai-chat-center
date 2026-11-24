import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { register, getRegistration, listRegistrations, markDisconnected, markRemoved, isActive, isRemoved, updateRegistration, pruneRegistrations } from '../../src/core/registry.js';
import { enqueue } from '../../src/core/inbox.js';
import { setBusy, clearBusy, isBusy } from '../../src/core/busy.js';
import { paths } from '../../src/core/paths.js';
import { setWaiting, getWaiting, clearWaiting } from '../../src/core/waiting.js';
import { tmpDir } from '../helpers/tmp.js';
import { Readable } from 'node:stream';
import { sessionAttachmentsDir, storeAttachment } from '../../src/core/attachments.js';

beforeEach(() => {
  process.env.AI_CHAT_CENTER_HOME = path.join(tmpDir('acc-'), 'home');
});

describe('registry', () => {
  it('markDisconnected keeps history', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t', cwd: '/c', pid: 1 });
    expect(isActive((await getRegistration('s1'))!)).toBe(true);
    await markDisconnected('s1', 'clear');
    const r = await getRegistration('s1');
    expect(r).not.toBeNull();
    expect(r!.disconnectReason).toBe('clear');
    expect(isActive(r!)).toBe(false);
    expect(await listRegistrations()).toHaveLength(1);
    expect(await getRegistration('nope')).toBeNull();
    await expect(getRegistration('../x')).rejects.toThrow();
  });
  it('waiting state roundtrip', async () => {
    expect(await getWaiting('s1')).toBeNull();
    await setWaiting('s1', 'permission');
    expect((await getWaiting('s1'))!.kind).toBe('permission');
    await clearWaiting('s1');
    expect(await getWaiting('s1')).toBeNull();
  });
});

describe('registry: inbox and busy lifecycle', () => {
  const inboxFiles = (sid: string) => {
    try {
      return fs.readdirSync(paths().inboxDir(sid));
    } catch {
      return [];
    }
  };
  it('markDisconnected deletes queued and stray tmp inbox files and the busy marker', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t', cwd: '/c', pid: 1 });
    await enqueue('s1', 'one');
    fs.writeFileSync(path.join(paths().inboxDir('s1'), '.x.tmp'), '{}');
    await setBusy('s1');
    await markDisconnected('s1', 'off');
    expect(inboxFiles('s1')).toEqual([]);
    expect(await isBusy('s1')).toBe(false);
  });
  it('register reactivating an inactive registration clears the inbox; re-register while active keeps it', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t', cwd: '/c', pid: 1 });
    await enqueue('s1', 'keep');
    await register({ sessionId: 's1', transcriptPath: '/t', cwd: '/c', pid: 1 });
    expect(inboxFiles('s1')).toHaveLength(1);
    await markDisconnected('s1', 'off');
    // a message that slipped in after the disconnect must not survive reactivation
    fs.mkdirSync(paths().inboxDir('s1'), { recursive: true });
    fs.writeFileSync(path.join(paths().inboxDir('s1'), '000000000000001-000001-x.msg'), '{"id":"x","text":"old","createdAt":""}');
    await register({ sessionId: 's1', transcriptPath: '/t', cwd: '/c', pid: 1 });
    expect(inboxFiles('s1')).toEqual([]);
  });
  it('updateRegistration patches an existing registration only', async () => {
    expect(await updateRegistration('nope', { pid: 5 })).toBeNull();
    expect(fs.existsSync(paths().sessionsDir)).toBe(false);
    await register({ sessionId: 's1', transcriptPath: '/t', cwd: '/c', pid: null });
    await updateRegistration('s1', { pid: 5, transcriptPath: '/t2' });
    expect(await getRegistration('s1')).toMatchObject({ pid: 5, transcriptPath: '/t2' });
  });
  it('busy marker roundtrip', async () => {
    expect(await isBusy('s1')).toBe(false);
    await setBusy('s1');
    expect(await isBusy('s1')).toBe(true);
    expect(fs.existsSync(paths().busyFile('s1'))).toBe(true);
    await clearBusy('s1');
    expect(await isBusy('s1')).toBe(false);
  });
  it.skipIf(process.platform === 'win32')('state dirs are 0700 and registration files 0600', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t', cwd: '/c', pid: 1, key: 'secret' });
    await enqueue('s1', 'x');
    await setBusy('s1');
    for (const d of [paths().home, paths().sessionsDir, paths().inboxDir('s1'), path.dirname(paths().busyFile('s1'))]) {
      expect((fs.statSync(d).mode & 0o777).toString(8), d).toBe('700');
    }
    expect((fs.statSync(path.join(paths().sessionsDir, 's1.json')).mode & 0o777).toString(8)).toBe('600');
  });

  // Audit RT3 (repro A2): poll and GET /api/sessions both marked an exited session at once.
  it('concurrent markDisconnected calls never fail and keep the first reason', async () => {
    for (let i = 0; i < 30; i++) {
      const sid = `s${i}`;
      await register({ sessionId: sid, transcriptPath: '/t', cwd: '/c', pid: 1 });
      const r = await Promise.allSettled([markDisconnected(sid, 'exited'), markDisconnected(sid, 'off')]);
      expect(r.filter((x) => x.status === 'rejected')).toEqual([]);
      expect(isActive((await getRegistration(sid))!)).toBe(false);
    }
    await register({ sessionId: 'k', transcriptPath: '/t', cwd: '/c', pid: 1 });
    await markDisconnected('k', 'off');
    const first = (await getRegistration('k'))!;
    await markDisconnected('k', 'exited');
    expect(await getRegistration('k')).toEqual(first);
  });
  // Audit RT12: a stale read-modify-write must not resurrect a session after /cc off.
  it('updateRegistration with ifConnectedAt never writes over a disconnected or newer registration', async () => {
    for (let i = 0; i < 50; i++) {
      const sid = `r${i}`;
      const reg = await register({ sessionId: sid, transcriptPath: '/t', cwd: '/c', pid: null });
      await Promise.all([updateRegistration(sid, { pid: 42 }, { ifConnectedAt: reg.connectedAt }), markDisconnected(sid, 'off')]);
      expect(isActive((await getRegistration(sid))!)).toBe(false);
    }
    const reg = await register({ sessionId: 'z', transcriptPath: '/t', cwd: '/c', pid: null });
    expect(await updateRegistration('z', { pid: 1 }, { ifConnectedAt: 'other' })).toBeNull();
    expect(await updateRegistration('z', { pid: 1 }, { ifConnectedAt: reg.connectedAt })).toMatchObject({ pid: 1 });
  });
  it('registration writes take a short per-session lock that is released afterwards', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t', cwd: '/c', pid: 1 });
    await updateRegistration('s1', { pid: 2 });
    await markDisconnected('s1', 'off');
    expect(fs.readdirSync(paths().sessionsDir)).toEqual(['s1.json']);
  });
});

describe('registry: pruning (audit RT13)', () => {
  it('deletes disconnected registrations older than the limit with their inbox, busy and waiting files', async () => {
    const day = 86_400_000;
    const now = Date.parse('2026-06-01T00:00:00Z');
    await register({ sessionId: 'old', transcriptPath: '/t', cwd: '/c', pid: 1 });
    await register({ sessionId: 'recent', transcriptPath: '/t', cwd: '/c', pid: 1 });
    await register({ sessionId: 'active', transcriptPath: '/t', cwd: '/c', pid: 1, connectedAt: new Date(now - 90 * day).toISOString() });
    await markDisconnected('old', 'off');
    await markDisconnected('recent', 'off');
    await updateRegistration('old', { disconnectedAt: new Date(now - 31 * day).toISOString() });
    await updateRegistration('recent', { disconnectedAt: new Date(now - 29 * day).toISOString() });
    for (const sid of ['old', 'recent']) {
      fs.mkdirSync(paths().inboxDir(sid), { recursive: true });
      fs.writeFileSync(path.join(paths().inboxDir(sid), '.x.tmp'), '');
      await setBusy(sid);
      await setWaiting(sid, 'permission');
    }
    expect(await pruneRegistrations(30 * day, now)).toEqual(['old']);
    expect((await listRegistrations()).map((r) => r.sessionId).sort()).toEqual(['active', 'recent']);
    expect(fs.existsSync(paths().inboxDir('old'))).toBe(false);
    expect(await isBusy('old')).toBe(false);
    expect(await getWaiting('old')).toBeNull();
    expect(await isBusy('recent')).toBe(true);
  });
  it('also deletes the attachments of sessions that no longer exist and attachments older than 30 days', async () => {
    const day = 86_400_000;
    const now = Date.now();
    await register({ sessionId: 'old', transcriptPath: '/t', cwd: '/c', pid: 1 });
    await register({ sessionId: 'alive', transcriptPath: '/t', cwd: '/c', pid: 1 });
    await markDisconnected('old', 'off');
    await updateRegistration('old', { disconnectedAt: new Date(now - 31 * day).toISOString() });
    const oldFile = await storeAttachment('old', 'a.txt', Readable.from([Buffer.from('a')]), 100);
    const stale = await storeAttachment('alive', 'b.txt', Readable.from([Buffer.from('b')]), 100);
    const fresh = await storeAttachment('alive', 'c.txt', Readable.from([Buffer.from('c')]), 100);
    await storeAttachment('never', 'd.txt', Readable.from([Buffer.from('d')]), 100);
    const t = new Date(now - 31 * day);
    fs.utimesSync(stale, t, t);
    expect(await pruneRegistrations(30 * day, now)).toEqual(['old']);
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(sessionAttachmentsDir('never'))).toBe(false);
  });
});

describe('registry: removed from the app', () => {
  it('markRemoved disconnects an active session with reason removed, drops its inbox and busy marker, and marks it', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t', cwd: '/c', pid: 1 });
    await enqueue('s1', 'one');
    await setBusy('s1');
    expect(await markRemoved('s1')).toBe(true);
    const r = (await getRegistration('s1'))!;
    expect(isActive(r)).toBe(false);
    expect(r.disconnectReason).toBe('removed');
    expect(isRemoved(r)).toBe(true);
    expect(await peekCount('s1')).toBe(0);
    expect(await isBusy('s1')).toBe(false);
  });
  it('markRemoved keeps the reason of an already disconnected session and still marks it', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t', cwd: '/c', pid: 1 });
    await markDisconnected('s1', 'exited');
    const before = (await getRegistration('s1'))!;
    expect(await markRemoved('s1')).toBe(true);
    const r = (await getRegistration('s1'))!;
    expect(r.disconnectReason).toBe('exited');
    expect(r.disconnectedAt).toBe(before.disconnectedAt);
    expect(isRemoved(r)).toBe(true);
  });
  it('markRemoved returns false for an unknown session', async () => {
    expect(await markRemoved('nope')).toBe(false);
    expect(await getRegistration('nope')).toBeNull();
  });
  it('a new register clears the mark', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t', cwd: '/c', pid: 1 });
    await markRemoved('s1');
    await register({ sessionId: 's1', transcriptPath: '/t', cwd: '/c', pid: 1 });
    const r = (await getRegistration('s1'))!;
    expect(isActive(r)).toBe(true);
    expect(isRemoved(r)).toBe(false);
  });
});

async function peekCount(sid: string): Promise<number> {
  try {
    return fs.readdirSync(paths().inboxDir(sid)).filter((n) => n.endsWith('.msg')).length;
  } catch {
    return 0;
  }
}
