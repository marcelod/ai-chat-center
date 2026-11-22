import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enqueue, drain, peek, clearInbox } from '../../src/core/inbox.js';
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
    for (let i = 0; i < 50; i++) await enqueue('s1', String(i));
    const got = await Promise.all([drain('s1'), drain('s1'), drain('s1'), drain('s1')]);
    const all = got.flat().map((m) => m.text);
    expect(all).toHaveLength(50);
    expect(new Set(all).size).toBe(50);
    // each drain keeps queue order among the messages it claimed
    for (const g of got) expect(g.map((m) => Number(m.text))).toEqual([...g.map((m) => Number(m.text))].sort((a, b) => a - b));
    expect(await drain('s1')).toEqual([]);
    expect(fs.readdirSync(paths().inboxDir('s1'))).toEqual([]);
  });
  it('a message is claimed by rename before it is read: a claimed file is never delivered again', async () => {
    await enqueue('s1', 'a');
    const [f] = fs.readdirSync(paths().inboxDir('s1'));
    fs.renameSync(path.join(paths().inboxDir('s1'), f), path.join(paths().inboxDir('s1'), `${f}.claimed-other`));
    expect(await drain('s1')).toEqual([]);
    expect(await peek('s1')).toEqual([]);
    await clearInbox('s1');
    expect(fs.readdirSync(paths().inboxDir('s1'))).toEqual([]);
  });
  it('a malformed message is claimed and dropped, not re-read forever', async () => {
    fs.mkdirSync(paths().inboxDir('s1'), { recursive: true });
    fs.writeFileSync(path.join(paths().inboxDir('s1'), '000000000000001-000001-x.msg'), '{not json');
    await enqueue('s1', 'ok');
    expect((await drain('s1')).map((m) => m.text)).toEqual(['ok']);
    expect(fs.readdirSync(paths().inboxDir('s1'))).toEqual([]);
  });
  it('leaves no tmp files named .msg', async () => {
    await enqueue('s1', 'a');
    const files = fs.readdirSync(paths().inboxDir('s1'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{15}-\d{6}-.+\.msg$/);
  });
});
