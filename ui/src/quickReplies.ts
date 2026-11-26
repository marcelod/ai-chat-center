import { useSyncExternalStore } from 'react';

// Quick replies (spec 2026-11-26-context-quick-replies): short messages the user sends often, kept per browser in
// localStorage like the other preferences. Until the user edits the list, the defaults of the app's language are
// used (null here). Storage failures only mean the list lasts until the page reloads.
const KEY = 'acc.quickReplies';
export const MAX_QUICK_REPLIES = 12;
export const MAX_QUICK_REPLY_LENGTH = 500;
export const DEFAULT_QUICK_REPLY_KEYS = ['ui.quickReplies.defaults.d1', 'ui.quickReplies.defaults.d2', 'ui.quickReplies.defaults.d3'];

let memory: string[] | null | undefined; // set only when storage failed to save
let cache: { raw: string | null; list: string[] | null } | undefined;
const listeners = new Set<() => void>();

/** Trimmed, without blanks or repeats, each one and the list capped. */
export function cleanQuickReplies(list: unknown[]): string[] {
  const out: string[] = [];
  for (const v of list) {
    if (typeof v !== 'string') continue;
    const s = v.trim().slice(0, MAX_QUICK_REPLY_LENGTH);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= MAX_QUICK_REPLIES) break;
  }
  return out;
}

/** The saved list, or null when the user never edited it (the defaults apply). */
export function loadQuickReplies(): string[] | null {
  if (memory !== undefined) return memory;
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (cache && cache.raw === raw) return cache.list; // same array while unchanged (useSyncExternalStore)
  let list: string[] | null = null;
  try {
    const d: unknown = raw === null ? null : JSON.parse(raw);
    list = Array.isArray(d) ? cleanQuickReplies(d) : null;
  } catch {
    list = null;
  }
  cache = { raw, list };
  return list;
}

export function saveQuickReplies(list: string[]): void {
  const clean = cleanQuickReplies(list);
  try {
    localStorage.setItem(KEY, JSON.stringify(clean));
    memory = undefined;
  } catch {
    memory = clean;
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** The saved list (null: defaults); re-renders when it changes. */
export const useQuickReplies = (): string[] | null => useSyncExternalStore(subscribe, loadQuickReplies);

/** For tests: forget what was kept in memory. */
export function resetQuickRepliesMemory(): void {
  memory = undefined;
  cache = undefined;
}
