import { useSyncExternalStore } from 'react';

// On/off choices kept per browser in localStorage like the theme; storage failures only mean the choice
// lasts until the page reloads.
function booleanPref(key: string) {
  let memory: boolean | null = null; // set only when storage failed to save
  const listeners = new Set<() => void>();
  const read = (): boolean => {
    if (memory !== null) return memory;
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  };
  const save = (on: boolean): void => {
    try {
      localStorage.setItem(key, on ? '1' : '0');
      memory = null;
    } catch {
      memory = on; // storage unavailable: the choice lasts until the page reloads
    }
    listeners.forEach((l) => l());
  };
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
  };
  /** The current choice; re-renders when it changes. */
  const use = (): boolean => useSyncExternalStore(subscribe, read);
  return { read, save, use };
}

// "Show file changes": whether Edit/MultiEdit/Write actions offer their diff. Off by default.
const showDiffs = booleanPref('acc.showDiffs');
export const readShowDiffs = showDiffs.read;
export const saveShowDiffs = showDiffs.save;
export const useShowDiffs = showDiffs.use;

// "System notifications": off by default. The key predates 0.6.7 (per-reply notifications), so a choice made
// then still holds. Whether a notification can show also depends on the browser permission (see notify.ts).
const systemNotifications = booleanPref('acc.notify');
export const readSystemNotifications = systemNotifications.read;
export const saveSystemNotifications = systemNotifications.save;
export const useSystemNotificationsPref = systemNotifications.use;

// "Group by project": the session list grouped by folder (spec 2026-11-27-group-by-project). Off by default.
const groupByProject = booleanPref('acc.groupByProject');
export const readGroupByProject = groupByProject.read;
export const saveGroupByProject = groupByProject.save;
export const useGroupByProject = groupByProject.use;

// Folders whose group is closed in the session list; groups are open unless listed here.
const CLOSED_GROUPS = 'acc.closedGroups';
let closedMemory: string[] | null = null; // set only when storage failed to save
let closedCache: { raw: string | null; list: string[] } | null = null;
const closedListeners = new Set<() => void>();
function readClosedGroups(): string[] {
  if (closedMemory) return closedMemory;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(CLOSED_GROUPS);
  } catch {
    /* storage unavailable: all open */
  }
  // The same array while the stored text is unchanged, as useSyncExternalStore requires.
  if (closedCache && closedCache.raw === raw) return closedCache.list;
  let list: string[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) list = parsed.filter((k): k is string => typeof k === 'string');
  } catch {
    /* corrupt entry: all open */
  }
  closedCache = { raw, list };
  return list;
}
function subscribeClosedGroups(l: () => void) {
  closedListeners.add(l);
  return () => void closedListeners.delete(l);
}
/** Opens or closes the group of a folder, remembering the choice. */
export function toggleClosedGroup(key: string): void {
  const now = readClosedGroups();
  const next = now.includes(key) ? now.filter((k) => k !== key) : [...now, key];
  try {
    localStorage.setItem(CLOSED_GROUPS, JSON.stringify(next));
    closedMemory = null;
  } catch {
    closedMemory = next; // storage unavailable: the choice lasts until the page reloads
  }
  closedListeners.forEach((l) => l());
}
/** The folders whose group is closed; re-renders when it changes. */
export function useClosedGroups(): string[] {
  return useSyncExternalStore(subscribeClosedGroups, readClosedGroups);
}
