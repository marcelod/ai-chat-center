import { paths } from './paths.js';
import { readJson, removeFile, writeJsonAtomic } from './fsAtomic.js';

// Replay protection (audit S4-S1): the ids of the last messages delivered to each session. A file dropped
// again into the inbox after its delivery (a copy of a signed message) carries a known id and is dropped.
// Written only by the waiter that holds the session's lock.

/** How many ids are kept per session. */
export const DELIVERED_KEEP = 500;

export async function readDelivered(sid: string): Promise<Set<string>> {
  const ids = await readJson<unknown>(paths().deliveredFile(sid));
  return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
}

/** Appends `ids` (keeping the last DELIVERED_KEEP). */
export async function recordDelivered(sid: string, ids: string[]): Promise<void> {
  const prev = [...(await readDelivered(sid))];
  const next = [...prev.filter((x) => !ids.includes(x)), ...ids].slice(-DELIVERED_KEEP);
  await writeJsonAtomic(paths().deliveredFile(sid), next);
}

export async function clearDelivered(sid: string): Promise<void> {
  await removeFile(paths().deliveredFile(sid));
}
