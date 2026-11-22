import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register, getRegistration, listRegistrations, markDisconnected, isActive, updateRegistration } from '../../src/core/registry.js';
import { enqueue } from '../../src/core/inbox.js';
import { setBusy, clearBusy, isBusy } from '../../src/core/busy.js';
import { paths } from '../../src/core/paths.js';
import { setWaiting, getWaiting, clearWaiting } from '../../src/core/waiting.js';

beforeEach(() => {
  process.env.AI_CHAT_CENTER_HOME = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'acc-')), 'home');
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
});
