import type { ChatEvent } from '@shared/types';

/** Pure unread bookkeeping (no React). `lastSeen` is persisted; counts and counted ids are in-memory. */
export type UnreadState = {
  lastSeen: Record<string, string>;
  counts: Record<string, number>;
  counted: Record<string, string[]>;
};

const KEY = 'acc.lastSeen';
const MAX_COUNTED = 200;

export const emptyUnread = (): UnreadState => ({ lastSeen: {}, counts: {}, counted: {} });

export function loadUnread(): UnreadState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>;
    return { ...emptyUnread(), lastSeen: raw && typeof raw === 'object' ? raw : {} };
  } catch {
    return emptyUnread();
  }
}

export function saveUnread(state: UnreadState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state.lastSeen));
  } catch {
    /* storage unavailable */
  }
}

const later = (a: string | undefined, b: string) => (a !== undefined && Date.parse(a) >= Date.parse(b) ? a : b);

export function markSeen(state: UnreadState, sid: string, ts: string): UnreadState {
  return {
    ...state,
    lastSeen: { ...state.lastSeen, [sid]: later(state.lastSeen[sid], ts) },
    counts: { ...state.counts, [sid]: 0 },
  };
}

/** First sight of a session: everything up to its last event counts as seen. No-op if already known. */
export function baseline(state: UnreadState, sid: string, lastEventTs: string | undefined, now: Date): UnreadState {
  if (state.lastSeen[sid] !== undefined) return state;
  return markSeen(state, sid, lastEventTs ?? now.toISOString());
}

export function applyEvents(
  state: UnreadState,
  sid: string,
  events: ChatEvent[],
  selectedSid: string | null,
  now: Date,
): UnreadState {
  if (sid === selectedSid) {
    const newest = events.reduce<string | undefined>((m, e) => later(m, e.ts), undefined);
    return markSeen(state, sid, newest ?? now.toISOString());
  }
  const since = Date.parse(state.lastSeen[sid] ?? now.toISOString());
  const seen = state.counted[sid] ?? [];
  const fresh: string[] = [];
  for (const e of events) {
    if (e.kind === 'assistant' && Date.parse(e.ts) > since && !seen.includes(e.id) && !fresh.includes(e.id)) {
      fresh.push(e.id);
    }
  }
  if (fresh.length === 0 && state.lastSeen[sid] !== undefined) return state;
  return {
    lastSeen: { ...state.lastSeen, [sid]: state.lastSeen[sid] ?? now.toISOString() },
    counts: { ...state.counts, [sid]: (state.counts[sid] ?? 0) + fresh.length },
    counted: { ...state.counted, [sid]: [...seen, ...fresh].slice(-MAX_COUNTED) },
  };
}
