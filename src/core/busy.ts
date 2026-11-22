import fs from 'node:fs/promises';
import { paths } from './paths.js';
import { removeFile, writeJsonAtomic } from './fsAtomic.js';

// Busy marker: a turn is running, so the waiter must not inject app messages mid-turn. Set by the
// UserPromptSubmit hook of an active registration, which fires for every turn: typed in the terminal,
// and also the turn a delivery wakes (hook feedback). Cleared by the Stop waiter (the turn ended), on /cc
// and on disconnect. A turn that ends without Stop (Esc, an API error) leaves it behind: the waiter and
// the hub drop a marker older than 10 s once `claude agents` reports the session idle.

export async function setBusy(sid: string): Promise<void> {
  await writeJsonAtomic(paths().busyFile(sid), { at: new Date().toISOString() });
}

export async function clearBusy(sid: string): Promise<void> {
  await removeFile(paths().busyFile(sid));
}

export async function isBusy(sid: string): Promise<boolean> {
  try {
    await fs.access(paths().busyFile(sid));
    return true;
  } catch {
    return false;
  }
}

/** Age of the marker in ms, or null when absent. */
export async function busyAge(sid: string, now = Date.now()): Promise<number | null> {
  try {
    return now - (await fs.stat(paths().busyFile(sid))).mtimeMs;
  } catch {
    return null;
  }
}
