import { useSyncExternalStore } from 'react';

// "Show file changes": whether Edit/MultiEdit/Write actions offer their diff. Off by default, kept per browser
// in localStorage like the theme; storage failures only mean the choice lasts until the page reloads.
const KEY = 'acc.showDiffs';
let memory: boolean | null = null; // set only when storage failed to save
const listeners = new Set<() => void>();

export function readShowDiffs(): boolean {
  if (memory !== null) return memory;
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function saveShowDiffs(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
    memory = null;
  } catch {
    memory = on; // storage unavailable: the choice lasts until the page reloads
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** The current choice; re-renders when the settings menu changes it. */
export const useShowDiffs = (): boolean => useSyncExternalStore(subscribe, readShowDiffs);
