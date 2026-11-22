import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJson, withFsRetry, writeJsonAtomic } from '../../src/core/fsAtomic.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-fs-'));
});

describe('writeJsonAtomic', () => {
  // Audit RT3 (repro A): the tmp name was pid + Date.now(), so two writes in the same ms collided (ENOENT).
  it('parallel writes to one file in the same process never fail', async () => {
    const f = path.join(dir, 'x.json');
    let errors = 0;
    for (let i = 0; i < 100; i++) {
      const r = await Promise.allSettled([writeJsonAtomic(f, { a: 1 }), writeJsonAtomic(f, { a: 2 })]);
      errors += r.filter((x) => x.status === 'rejected').length;
    }
    expect(errors).toBe(0);
    expect([1, 2]).toContain((await readJson<{ a: number }>(f))!.a);
    expect(fs.readdirSync(dir)).toEqual(['x.json']);
  });
});

describe('withFsRetry', () => {
  const err = (code: string) => Object.assign(new Error(code), { code });
  it('retries EPERM/EBUSY/EACCES and then succeeds', async () => {
    for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
      let calls = 0;
      const r = await withFsRetry(async () => {
        if (++calls < 3) throw err(code);
        return 'ok';
      });
      expect(r).toBe('ok');
      expect(calls).toBe(3);
    }
  });
  it('gives up after 5 retries and does not retry other errors', async () => {
    let calls = 0;
    await expect(withFsRetry(async () => { calls++; throw err('EPERM'); })).rejects.toThrow('EPERM');
    expect(calls).toBe(6);
    calls = 0;
    await expect(withFsRetry(async () => { calls++; throw err('ENOENT'); })).rejects.toThrow('ENOENT');
    expect(calls).toBe(1);
  });
});
