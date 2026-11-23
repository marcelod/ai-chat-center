import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { installSecret, loadSecret, signMessage, verifyMessage } from '../../src/core/secret.js';
import { paths } from '../../src/core/paths.js';
import { tmpDir } from '../helpers/tmp.js';

beforeEach(() => {
  process.env.AI_CHAT_CENTER_HOME = tmpDir('acc-');
});
afterEach(() => {
  vi.restoreAllMocks();
});

const errno = (code: string) => Object.assign(new Error(code), { code });
/** Makes every read of the install secret fail with `code` (other files read normally). */
const secretReadFails = (code: string) => {
  const real = fsp.readFile.bind(fsp);
  return vi.spyOn(fsp, 'readFile').mockImplementation((async (file: unknown, ...rest: unknown[]) => {
    if (String(file) === paths().secret) throw errno(code);
    return (real as (...a: unknown[]) => Promise<unknown>)(file, ...rest);
  }) as typeof fsp.readFile);
};

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
  // Audit S4-S1: the MAC covers v2|sid|id|createdAt|text, so a message cannot be moved to another session,
  // re-dated, or have its text changed.
  it('signs v2|sid|id|createdAt|text; a change to any of them, or no signature, fails', async () => {
    const secret = await installSecret();
    const m = await signMessage('s1', { id: 'i1', text: 'hello', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(m.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyMessage(m, 's1', secret)).toBe(true);
    expect(verifyMessage(m, 's2', secret)).toBe(false);
    expect(verifyMessage({ ...m, text: 'hellO' }, 's1', secret)).toBe(false);
    expect(verifyMessage({ ...m, id: 'i2' }, 's1', secret)).toBe(false);
    expect(verifyMessage({ ...m, createdAt: '2026-01-01T00:00:00.001Z' }, 's1', secret)).toBe(false);
    expect(verifyMessage({ id: 'i1', text: 'hello', createdAt: m.createdAt }, 's1', secret)).toBe(false);
    expect(verifyMessage({ ...m, sig: 'zz' }, 's1', secret)).toBe(false);
    expect(verifyMessage(m, 's1', 'b'.repeat(64))).toBe(false);
    // the separator cannot be shifted between fields: neither an id nor a createdAt contains it
    await expect(signMessage('s1', { id: 'a|b', text: 'c', createdAt: 'x' })).rejects.toThrow();
    await expect(signMessage('s1', { id: 'a', text: 'c', createdAt: 'x|y' })).rejects.toThrow();
    expect(verifyMessage({ id: 'a|b', text: 'c', createdAt: 'x', sig: m.sig }, 's1', secret)).toBe(false);
  });
  it('survives a token rotation (the token is not the key)', async () => {
    const m = await signMessage('s1', { id: 'i1', text: 'hello', createdAt: 'x' });
    fs.writeFileSync(paths().token, 'f'.repeat(64));
    expect(verifyMessage(m, 's1', await installSecret())).toBe(true);
  });
});

// Audit S4-S2: a secret that cannot be read for a moment (antivirus, an indexer: EBUSY/EPERM/EACCES on
// Windows) must never be replaced: messages queued under it could then never be delivered.
describe('install secret robustness', () => {
  it('loadSecret retries a transient read error and then succeeds', async () => {
    const s = await installSecret();
    const real = fsp.readFile.bind(fsp);
    let fails = 3;
    vi.spyOn(fsp, 'readFile').mockImplementation((async (file: unknown, ...rest: unknown[]) => {
      if (String(file) === paths().secret && fails-- > 0) throw errno('EBUSY');
      return (real as (...a: unknown[]) => Promise<unknown>)(file, ...rest);
    }) as typeof fsp.readFile);
    expect(await loadSecret({ tries: 5, delayMs: 5 })).toEqual({ ok: true, secret: s });
  });
  it('loadSecret tells unreadable, missing and malformed apart', async () => {
    expect(await loadSecret({ tries: 2, delayMs: 1 })).toEqual({ ok: false, reason: 'missing' });
    fs.mkdirSync(paths().home, { recursive: true });
    fs.writeFileSync(paths().secret, 'junk');
    expect(await loadSecret({ tries: 2, delayMs: 1 })).toEqual({ ok: false, reason: 'malformed' });
    secretReadFails('EACCES');
    expect(await loadSecret({ tries: 2, delayMs: 1 })).toEqual({ ok: false, reason: 'unreadable' });
  });
  for (const code of ['EACCES', 'EPERM', 'EBUSY']) {
    it(`installSecret never replaces a secret it cannot read (${code}): it fails instead`, async () => {
      const s = await installSecret();
      secretReadFails(code);
      await expect(installSecret()).rejects.toThrow();
      vi.restoreAllMocks();
      expect(fs.readFileSync(paths().secret, 'utf8')).toBe(s);
    });
  }
});
