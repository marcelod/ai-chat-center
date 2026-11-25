// Text search over conversations (spec 2026-11-25-app-batch), shared by the hub (all conversations) and
// the app (the open one). Case and accents are ignored: "acao" finds "ação".
import type { ChatEvent } from './types.js';

export const MIN_QUERY = 2;
export const MAX_QUERY = 100;

/** Lowercase without diacritics. One char in, one char out for the common Latin letters, so indexes match. */
export function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** The searchable text of an event: what was said, not tool calls. */
export function eventText(e: ChatEvent): string | null {
  switch (e.kind) {
    case 'user':
    case 'assistant':
    case 'agent':
    case 'toAgent':
    case 'recap':
      return e.text;
    default:
      return null;
  }
}

export const matches = (e: ChatEvent, q: string): boolean => {
  const text = eventText(e);
  return text !== null && fold(text).includes(fold(q.trim()));
};

/** About `width` characters of `text` around the first match of `q`, on one line, with … where cut. */
export function snippet(text: string, q: string, width = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const at = fold(flat).indexOf(fold(q.trim()));
  if (at < 0 || flat.length <= width) return flat.length <= width ? flat : `${flat.slice(0, width)}…`;
  const start = Math.max(0, at - Math.floor((width - q.length) / 2));
  const end = Math.min(flat.length, start + width);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

export type SearchHit = {
  sessionId: string;
  name: string;
  eventId: string;
  ts: string;
  kind: 'user' | 'assistant' | 'agent' | 'toAgent';
  snippet: string;
};
