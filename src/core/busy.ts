import fs from 'node:fs/promises';
import { paths } from './paths.js';
import { writeJsonAtomic } from './fsAtomic.js';

// Busy marker: a terminal-started turn is running, so the waiter must not inject app messages
// mid-turn. Set on prompt submit (active registrations only), cleared when a waiter starts
// (Stop/SessionStart: the turn ended), on /cc and on disconnect.

export async function setBusy(sid: string): Promise<void> {
  await writeJsonAtomic(paths().busyFile(sid), { at: new Date().toISOString() });
}

export async function clearBusy(sid: string): Promise<void> {
  await fs.rm(paths().busyFile(sid), { force: true });
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
