import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enqueue, drain, peek } from '../../src/core/inbox.js';
import { paths } from '../../src/core/paths.js';

beforeEach(() => {
  process.env.AI_CHAT_CENTER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-'));
});

describe('inbox', () => {
  it('enqueue/drain keeps order', async () => {
    for (const t of ['a', 'b', 'c']) await enqueue('s1', t);
    expect((await peek('s1')).map((m) => m.text)).toEqual(['a', 'b', 'c']);
    expect((await drain('s1')).map((m) => m.text)).toEqual(['a', 'b', 'c']);
    expect(await drain('s1')).toEqual([]);
  });
  it('concurrent drains never throw and deliver each message once', async () => {
    for (let i = 0; i < 20; i++) await enqueue('s1', String(i));
    const [x, y] = await Promise.all([drain('s1'), drain('s1')]);
    expect(x.length + y.length).toBe(20);
    expect(await drain('s1')).toEqual([]);
  });
  it('leaves no tmp files named .msg', async () => {
    await enqueue('s1', 'a');
    const files = fs.readdirSync(paths().inboxDir('s1'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{15}-\d{6}-.+\.msg$/);
  });
});
