import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '@shared/types';
import { applyEvents, baseline, emptyUnread, markSeen } from './unread';

const a = (id: string, ts: string): ChatEvent => ({ kind: 'assistant', id, ts, text: id });
const u = (id: string, ts: string): ChatEvent => ({ kind: 'user', id, ts, text: id, origin: 'terminal' });
const now = new Date('2026-01-10T12:00:00Z');

describe('unread', () => {
  it('counts only assistant events newer than lastSeen', () => {
    let s = baseline(emptyUnread(), 's', '2026-01-10T10:00:00Z', now);
    s = applyEvents(s, 's', [a('old', '2026-01-10T09:00:00Z'), u('u1', '2026-01-10T11:00:00Z'), a('n1', '2026-01-10T11:00:00Z'), a('n2', '2026-01-10T11:05:00Z')], null, now);
    expect(s.counts.s).toBe(2);
  });

  it('keeps the selected session at 0 and advances lastSeen', () => {
    let s = baseline(emptyUnread(), 's', '2026-01-10T10:00:00Z', now);
    s = applyEvents(s, 's', [a('n1', '2026-01-10T11:00:00Z')], 's', now);
    expect(s.counts.s).toBe(0);
    expect(s.lastSeen.s).toBe('2026-01-10T11:00:00Z');
  });

  it('does not count watched messages as unread after deselecting', () => {
    let s = baseline(emptyUnread(), 's', '2026-01-10T10:00:00Z', now);
    s = applyEvents(s, 's', [a('n1', '2026-01-10T11:00:00Z')], 's', now);
    s = markSeen(s, 's', '2026-01-10T11:30:00Z');
    s = applyEvents(s, 's', [a('n1', '2026-01-10T11:00:00Z')], null, now);
    expect(s.counts.s).toBe(0);
    s = applyEvents(s, 's', [a('n2', '2026-01-10T11:40:00Z')], null, now);
    expect(s.counts.s).toBe(1);
  });

  it('does not double-count a re-emitted id', () => {
    let s = baseline(emptyUnread(), 's', '2026-01-10T10:00:00Z', now);
    const ev = [a('n1', '2026-01-10T11:00:00Z')];
    s = applyEvents(s, 's', ev, null, now);
    s = applyEvents(s, 's', ev, null, now);
    expect(s.counts.s).toBe(1);
  });

  it('baseline is a no-op for known sessions and starts at 0', () => {
    const s = baseline(emptyUnread(), 's', '2026-01-10T10:00:00Z', now);
    expect(s.counts.s).toBe(0);
    expect(baseline(s, 's', '2030-01-01T00:00:00Z', now)).toBe(s);
  });
});
