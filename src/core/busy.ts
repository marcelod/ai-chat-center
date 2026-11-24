import fs from 'node:fs/promises';
import { paths } from './paths.js';
import { removeFile, writeJsonAtomic } from './fsAtomic.js';

// Busy marker: a turn is running, so the waiter must not inject app messages mid-turn. Set by the
// UserPromptSubmit hook of an active registration, which fires for every turn: typed in the terminal,
// the turn a delivery wakes (hook feedback), and the /cc turn itself (written fresh by connect). Cleared
// by the Stop waiter (the turn ended; only a marker older than that waiter, see clearBusyIfOlder) and on
// disconnect. A turn that ends without Stop (Esc, an API error) leaves it behind: the waiter and
// the hub drop a marker older than 10 s once `claude agents` reports the session idle.

export async function setBusy(sid: string): Promise<void> {
  await writeJsonAtomic(paths().busyFile(sid), { at: new Date().toISOString() });
}

export async function clearBusy(sid: string): Promise<void> {
  await removeFile(paths().busyFile(sid));
}

/**
 * Clears the marker only when it was written before `before` (epoch ms): the Stop waiter of turn N may
 * run after the prompt hook of turn N+1 has set a fresh marker (audit R4-M1), which must stay. True when
 * there is no marker left that predates `before`.
 */
export async function clearBusyIfOlder(sid: string, before: number): Promise<boolean> {
  let mtimeMs: number;
  try {
    mtimeMs = (await fs.stat(paths().busyFile(sid))).mtimeMs;
  } catch {
    return true;
  }
  // Same millisecond counts as older: file times carry sub-ms digits that Date.now() lacks.
  if (Math.floor(mtimeMs) > before) return false;
  await removeFile(paths().busyFile(sid));
  return true;
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
