import { describe, expect, it } from 'vitest';
import { TranscriptParser } from '../../src/hub/transcript/parse.js';
import type { ChatEvent } from '../../src/shared/types.js';

type Actions = Extract<ChatEvent, { kind: 'actions' }>;

describe('TranscriptParser: recap and diffs', () => {
  const tool = (p: TranscriptParser, name: string, input: unknown) =>
    p.push({ type: 'assistant', uuid: 'a', timestamp: 't', message: { content: [{ type: 'tool_use', id: 'x', name, input }] } });
  it('away_summary becomes a recap without the settings hint', () => {
    const p = new TranscriptParser();
    const sys = (content: string) => ({ type: 'system', subtype: 'away_summary', uuid: 's', timestamp: 't', content });
    expect(p.push(sys('Parou no teste. (disable recaps in /config)'))).toEqual([{ kind: 'recap', id: 's', ts: 't', text: 'Parou no teste.' }]);
    expect(p.push(sys('Done.  ( disable recaps in /config ).'))).toEqual([{ kind: 'recap', id: 's', ts: 't', text: 'Done.' }]);
    expect(p.push(sys('(disable recaps in /config)'))).toEqual([]);
  });
  it('Edit carries a line diff with context', () => {
    const [ev] = tool(new TranscriptParser(), 'Edit', { file_path: '/f.ts', old_string: 'a\nb\nc', new_string: 'a\nB\nc' });
    const a = (ev as Actions).items[0];
    expect(a.summary).toBe('/f.ts');
    expect(a.diff).toEqual({ lines: [{ op: ' ', text: 'a' }, { op: '-', text: 'b' }, { op: '+', text: 'B' }, { op: ' ', text: 'c' }], added: 1, removed: 1 });
  });
  it('MultiEdit separates the edits; Write is all added', () => {
    const m = tool(new TranscriptParser(), 'MultiEdit', { file_path: '/f', edits: [{ old_string: 'x', new_string: 'y' }, { old_string: 'p', new_string: 'q' }] })[0] as Actions;
    expect(m.items[0].summary).toBe('/f');
    expect(m.items[0].diff?.lines.map((l) => l.op).join('')).toBe('-+~-+');
    const w = tool(new TranscriptParser(), 'Write', { file_path: '/n', content: '1\n2' })[0] as Actions;
    expect(w.items[0].diff).toMatchObject({ added: 2, removed: 0 });
  });
  it('a huge edit is cut and marked', () => {
    const big = Array.from({ length: 1000 }, (_, i) => `l${i}`).join('\n');
    const w = tool(new TranscriptParser(), 'Write', { file_path: '/n', content: big })[0] as Actions;
    expect(w.items[0].diff?.lines.length).toBe(400);
    expect(w.items[0].diff?.truncated).toBe(true);
    expect(w.items[0].diff?.added).toBe(1000);
  });
  it('a Read has no diff', () => {
    const r = tool(new TranscriptParser(), 'Read', { file_path: '/f' })[0] as Actions;
    expect(r.items[0].diff).toBeUndefined();
  });
});
