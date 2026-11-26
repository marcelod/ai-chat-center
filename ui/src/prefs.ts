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
