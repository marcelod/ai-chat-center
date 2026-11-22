import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installSecret, signMessage, verifyMessage } from '../../src/core/secret.js';
import { paths } from '../../src/core/paths.js';

beforeEach(() => {
  process.env.AI_CHAT_CENTER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-'));
});

// Audit S3-L2: any write into inbox/<sid>/ used to become a trusted, keyed message. The hub now signs
// each message with a per-install secret (not the token, which rotates: a queued message must survive a
// hub restart), and the waiter delivers only messages whose signature checks out.
describe('install secret and message signatures', () => {
  it('is created once (0600 on POSIX), then reused', async () => {
    const a = await installSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await installSecret()).toBe(a);
    if (process.platform !== 'win32') expect(fs.statSync(paths().secret).mode & 0o777).toBe(0o600);
  });
  it('concurrent first calls agree on one secret', async () => {
    const all = await Promise.all(Array.from({ length: 8 }, () => installSecret()));
    expect(new Set(all).size).toBe(1);
  });
  it('a corrupt secret file is replaced', async () => {
    fs.mkdirSync(paths().home, { recursive: true });
    fs.writeFileSync(paths().secret, 'junk');
    expect(await installSecret()).toMatch(/^[0-9a-f]{64}$/);
  });
  it('signs id|text; any change to either, or no signature, fails', async () => {
    const m = await signMessage({ id: 'i1', text: 'hello', createdAt: 'x' });
    expect(m.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyMessage(m)).toBe(true);
    expect(await verifyMessage({ ...m, text: 'hellO' })).toBe(false);
    expect(await verifyMessage({ ...m, id: 'i2' })).toBe(false);
    expect(await verifyMessage({ id: 'i1', text: 'hello', createdAt: 'x' })).toBe(false);
    expect(await verifyMessage({ ...m, sig: 'zz' })).toBe(false);
    // the separator cannot be shifted between id and text: an id never contains it
    await expect(signMessage({ id: 'a|b', text: 'c', createdAt: 'x' })).rejects.toThrow();
    expect(await verifyMessage({ id: 'a|b', text: 'c', createdAt: 'x', sig: m.sig })).toBe(false);
  });
  it('survives a token rotation (the token is not the key)', async () => {
    const m = await signMessage({ id: 'i1', text: 'hello', createdAt: 'x' });
    fs.writeFileSync(paths().token, 'f'.repeat(64));
    expect(await verifyMessage(m)).toBe(true);
  });
});
