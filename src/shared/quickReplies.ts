// Quick reply suggestions (spec 2026-11-27-suggested-quick-replies), shared by the hub (counting) and the app
// (hiding what is already in the list or was dismissed).
import { fold } from './search.js';

export type SuggestedReply = { text: string; count: number };

/** Lowercase, without accents, every run of non-letters/digits as one space, trimmed: "Pode seguir!" → "pode seguir". */
export function normalizeReply(s: string): string {
  return fold(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
