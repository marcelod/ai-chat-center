import { describe, expect, it } from 'vitest';
import { TranscriptParser } from '../../src/hub/transcript/parse.js';
import type { ChatEvent } from '../../src/shared/types.js';
import { searchAll } from '../../src/hub/search.js';
import type { Provider } from '../../src/hub/provider.js';

type Actions = Extract<ChatEvent, { kind: 'actions' }>;

const tool = (p: TranscriptParser, name: string, input: unknown) =>
  p.push({ type: 'assistant', uuid: 'a', timestamp: 't', message: { content: [{ type: 'tool_use', id: 'x', name, input }] } });

describe('diff limits', () => {
  it('cuts each line to 500 characters and marks the diff truncated', () => {
    const w = tool(new TranscriptParser(), 'Write', { file_path: '/n', content: 'x'.repeat(5000) })[0] as Actions;
    expect(w.items[0].diff?.lines[0].text.length).toBe(500);
    expect(w.items[0].diff?.truncated).toBe(true);
  });
  it('caps the total text of a diff at 32 KB', () => {
    const content = Array.from({ length: 400 }, () => 'y'.repeat(400)).join('\n');
    const w = tool(new TranscriptParser(), 'Write', { file_path: '/n', content })[0] as Actions;
    const d = w.items[0].diff!;
    expect(d.lines.reduce((n, l) => n + l.text.length, 0)).toBeLessThanOrEqual(32 * 1024);
    expect(d.truncated).toBe(true);
  });
  it('{ diffs: false } computes no diff', () => {
    const w = tool(new TranscriptParser(undefined, { diffs: false }), 'Write', { file_path: '/n', content: 'a\nb' })[0] as Actions;
    expect(w.items[0].diff).toBeUndefined();
    expect(w.items[0].summary).toBe('/n');
  });
  it('the search asks the provider for events without diffs', async () => {
    const seen: unknown[] = [];
    const provider = {
      listSessions: async () => ({ connected: [{ sessionId: 's1', name: 'n' }] }),
      events: async (_sid: string, opts?: unknown) => {
        seen.push(opts);
        return [];
      },
    } as unknown as Provider;
    await searchAll(provider, 'x');
    expect(seen).toEqual([{ diffs: false }]);
  });
});
