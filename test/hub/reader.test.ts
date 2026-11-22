import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TranscriptReader } from '../../src/hub/transcript/reader.js';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reader-'));
  file = join(dir, 't.jsonl');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const user = (n: number, text = `msg ${n}`) =>
  JSON.stringify({
    type: 'user',
    uuid: `u${n}`,
    timestamp: '2026-11-19T10:00:00.000Z',
    message: { role: 'user', content: text },
  });

describe('TranscriptReader', () => {
  it('reads only appended lines', async () => {
    writeFileSync(file, `${user(1)}\n${user(2)}\n`);
    const r = new TranscriptReader(file);
    expect((await r.readNew()).map((e) => e.id)).toEqual(['u1', 'u2']);
    appendFileSync(file, `${user(3)}\n`);
    expect((await r.readNew()).map((e) => e.id)).toEqual(['u3']);
    expect(await r.readNew()).toEqual([]);
    expect(r.all().map((e) => e.id)).toEqual(['u1', 'u2', 'u3']);
  });

  it('partial trailing line is buffered until newline', async () => {
    const line = user(1);
    writeFileSync(file, line.slice(0, 30));
    const r = new TranscriptReader(file);
    expect(await r.readNew()).toEqual([]);
    appendFileSync(file, `${line.slice(30)}\n`);
    expect((await r.readNew()).map((e) => e.id)).toEqual(['u1']);
    expect(await r.readNew()).toEqual([]);
    expect(r.all()).toHaveLength(1);
  });

  it('missing file returns []', async () => {
    const r = new TranscriptReader(join(dir, 'nope.jsonl'));
    expect(await r.readNew()).toEqual([]);
    expect(r.all()).toEqual([]);
    writeFileSync(join(dir, 'nope.jsonl'), `${user(1)}\n`);
    expect(await r.readNew()).toHaveLength(1);
  });

  it('handles CRLF', async () => {
    writeFileSync(file, `${user(1)}\r\n${user(2)}\r\n`);
    const r = new TranscriptReader(file);
    expect((await r.readNew()).map((e) => e.id)).toEqual(['u1', 'u2']);
  });

  it('skips invalid JSON lines', async () => {
    writeFileSync(file, `${user(1)}\n{not json\n${user(2)}\n`);
    const r = new TranscriptReader(file);
    expect((await r.readNew()).map((e) => e.id)).toEqual(['u1', 'u2']);
  });

  it('decodes multi-byte characters split across reads', async () => {
    const buf = Buffer.from(`${user(1, 'olá ✓ 日本')}\n`, 'utf8');
    const cut = buf.indexOf(Buffer.from('✓')) + 1; // mid-character
    writeFileSync(file, buf.subarray(0, cut));
    const r = new TranscriptReader(file);
    expect(await r.readNew()).toEqual([]);
    appendFileSync(file, buf.subarray(cut));
    const evs = await r.readNew();
    expect(evs[0]).toMatchObject({ text: 'olá ✓ 日本' });
  });

  it('resets when the file shrinks', async () => {
    writeFileSync(file, `${user(1)}\n${user(2)}\n`);
    const r = new TranscriptReader(file);
    await r.readNew();
    writeFileSync(file, `${user(3)}\n`);
    expect((await r.readNew()).map((e) => e.id)).toEqual(['u3']);
    expect(r.all().map((e) => e.id)).toEqual(['u3']);
  });

  it('serializes concurrent readNew calls without double-reading', async () => {
    writeFileSync(file, `${user(1)}\n${user(2)}\n`);
    const r = new TranscriptReader(file);
    const results = await Promise.all([r.readNew(), r.readNew(), r.readNew()]);
    expect(results.flat().map((e) => e.id)).toEqual(['u1', 'u2']);
    expect(r.all()).toHaveLength(2);
  });

  it('returns updated events with their existing id and consolidates in all()', async () => {
    const asst = JSON.stringify({
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-11-19T10:00:01.000Z',
      message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] },
    });
    const res = JSON.stringify({
      type: 'user',
      uuid: 'u9',
      timestamp: '2026-11-19T10:00:02.000Z',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
    });
    writeFileSync(file, `${asst}\n`);
    const r = new TranscriptReader(file);
    await r.readNew();
    appendFileSync(file, `${res}\n`);
    const upd = await r.readNew();
    expect(upd.map((e) => e.id)).toEqual(['a1']);
    expect(r.all()).toHaveLength(1);
    expect(JSON.stringify(r.all()[0])).toContain('"result":"ok"');
  });
});
