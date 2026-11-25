// Search across every conversation in the app (spec 2026-11-25-app-batch): the transcripts of the sessions
// the list shows, connected or ended. Newest hits first, a few per conversation.
import type { Provider } from './provider.js';
import { eventText, matches, snippet, type SearchHit } from '../shared/search.js';

export const MAX_HITS = 50;
export const MAX_PER_SESSION = 5;

export async function searchAll(provider: Provider, q: string): Promise<SearchHit[]> {
  const { connected } = await provider.listSessions();
  const hits: SearchHit[] = [];
  for (const s of connected) {
    let events;
    try {
      events = await provider.events(s.sessionId, { diffs: false });
    } catch {
      continue; // an unreadable transcript only drops that conversation
    }
    let n = 0;
    for (let i = events.length - 1; i >= 0 && n < MAX_PER_SESSION; i--) {
      const e = events[i];
      if (!matches(e, q)) continue;
      if (e.kind !== 'user' && e.kind !== 'assistant' && e.kind !== 'agent' && e.kind !== 'toAgent') continue;
      hits.push({ sessionId: s.sessionId, name: s.name, eventId: e.id, ts: e.ts, kind: e.kind, snippet: snippet(eventText(e) ?? '', q) });
      n++;
    }
  }
  hits.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  return hits.slice(0, MAX_HITS);
}
