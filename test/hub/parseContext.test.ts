import { describe, expect, it } from 'vitest';
import { TranscriptParser } from '../../src/hub/transcript/parse.js';

// Context size (spec 2026-11-26-context-quick-replies): the tokens of the last main-thread API response, and the
// last compaction (a `compact_boundary` system entry with the size left after it).

const usage = { input_tokens: 2, cache_creation_input_tokens: 1994, cache_read_input_tokens: 242759, output_tokens: 1696 };
const assistant = (uuid: string, ts: string, u: unknown, extra: Record<string, unknown> = {}) => ({
  type: 'assistant', uuid, timestamp: ts, ...extra,
  message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'x' }], usage: u },
});
const boundary = (uuid: string, ts: string, meta: unknown) => ({
  type: 'system', subtype: 'compact_boundary', uuid, timestamp: ts, isSidechain: false, compactMetadata: meta,
});

describe('TranscriptParser: context size', () => {
  it('is unknown before the first reply', () => {
    expect(new TranscriptParser().contextTokens).toBeUndefined();
  });

  it('sums input, cache read and cache creation tokens of the last reply (not the output)', () => {
    const p = new TranscriptParser();
    p.push(assistant('a1', '2026-11-26T10:00:00Z', { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 5, output_tokens: 999 }));
    expect(p.contextTokens).toBe(115);
    p.push(assistant('a2', '2026-11-26T10:01:00Z', usage));
    expect(p.contextTokens).toBe(244755);
  });

  it('ignores subagent (sidechain) replies, synthetic ones and entries without a usable usage', () => {
    const p = new TranscriptParser();
    p.push(assistant('a1', '2026-11-26T10:00:00Z', { input_tokens: 50 }));
    p.push(assistant('a2', '2026-11-26T10:01:00Z', { input_tokens: 9000 }, { isSidechain: true }));
    p.push({ ...assistant('a3', '2026-11-26T10:02:00Z', { input_tokens: 0 }), message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 0 } } });
    p.push(assistant('a4', '2026-11-26T10:03:00Z', 'nope'));
    p.push(assistant('a5', '2026-11-26T10:04:00Z', { input_tokens: -3, cache_read_input_tokens: 'x' }));
    expect(p.contextTokens).toBe(50);
  });

  it('a compaction sets the size left after it and records when and how it ran; the next reply replaces the size', () => {
    const p = new TranscriptParser();
    p.push(assistant('a1', '2026-11-26T10:00:00Z', usage));
    const evs = p.push(boundary('b1', '2026-11-26T10:05:00Z', { trigger: 'auto', preTokens: 247217, postTokens: 20467 }));
    expect(evs).toEqual([]);
    expect(p.contextTokens).toBe(20467);
    expect(p.lastCompact).toEqual({ at: '2026-11-26T10:05:00Z', trigger: 'auto' });
    p.push(assistant('a2', '2026-11-26T10:06:00Z', { input_tokens: 2, cache_creation_input_tokens: 61996, cache_read_input_tokens: 29441 }));
    expect(p.contextTokens).toBe(91439);
    expect(p.lastCompact?.at).toBe('2026-11-26T10:05:00Z');
  });

  it('a manual compaction without the size after it leaves the size unknown until the next reply', () => {
    const p = new TranscriptParser();
    p.push(assistant('a1', '2026-11-26T10:00:00Z', usage));
    p.push(boundary('b1', '2026-11-26T10:05:00Z', { trigger: 'manual' }));
    expect(p.contextTokens).toBeUndefined();
    expect(p.lastCompact).toEqual({ at: '2026-11-26T10:05:00Z', trigger: 'manual' });
  });

  it('an unknown trigger is left out', () => {
    const p = new TranscriptParser();
    p.push(boundary('b1', '2026-11-26T10:05:00Z', { trigger: '<b>', postTokens: 10 }));
    expect(p.lastCompact).toEqual({ at: '2026-11-26T10:05:00Z' });
  });

  it('the compaction summary that follows still shows the "compacted" notice', () => {
    const p = new TranscriptParser();
    p.push(boundary('b1', '2026-11-26T10:05:00Z', { trigger: 'manual', postTokens: 10 }));
    const evs = p.push({ type: 'user', uuid: 'u1', timestamp: '2026-11-26T10:05:00Z', isCompactSummary: true, message: { role: 'user', content: 'This session is being continued…' } });
    expect(evs).toEqual([{ kind: 'notice', id: 'u1', ts: '2026-11-26T10:05:00Z', code: 'compacted' }]);
  });
});
