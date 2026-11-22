import fs from 'node:fs/promises';
import path from 'node:path';
import { assertSessionId, paths } from './paths.js';
import { readJson, removeFile, writeJsonAtomic } from './fsAtomic.js';
import { clearInbox } from './inbox.js';
import { clearBusy } from './busy.js';
import { clearWaiting } from './waiting.js';
import { clearDelivered } from './delivered.js';
import { withLock } from './lock.js';

/** How long a registration write waits for the per-session lock before proceeding anyway. */
const SESSION_LOCK_WAIT_MS = 2000;
const locked = <T>(sid: string, fn: () => Promise<T>): Promise<T> => withLock(paths().sessionLock(sid), SESSION_LOCK_WAIT_MS, fn);

export type Registration = {
  sessionId: string;
  transcriptPath: string;
  cwd: string;
  /** The claude process, or null when it could not be identified (the hub still detects exits). */
  pid: number | null;
  /** Per-connection secret carried by app message markers (new on each (re)activation). */
  key?: string;
  /** Keys of earlier connections of this session, so their messages still display as app messages. */
  previousKeys?: string[];
  connectedAt: string;
  disconnectedAt?: string;
  disconnectReason?: 'off' | 'clear' | 'exited';
};

function regFile(sid: string): string {
  assertSessionId(sid);
  return path.join(paths().sessionsDir, `${sid}.json`);
}

export const isActive = (r: Registration): boolean => !r.disconnectedAt;

/** Every key whose blocks belong to this session (current last). */
export const trustedKeys = (r: Registration): string[] => [...(r.previousKeys ?? []), ...(r.key ? [r.key] : [])];

/**
 * Writes the registration. Unless it replaces an active one, the inbox starts empty: messages
 * left from an earlier connection must never reach the new one.
 */
export async function register(
  r: Omit<Registration, 'connectedAt'> & { connectedAt?: string },
): Promise<Registration> {
  return locked(r.sessionId, async () => {
    const prev = await getRegistration(r.sessionId);
    if (!prev || !isActive(prev)) await clearInbox(r.sessionId);
    const full: Registration = { ...r, connectedAt: r.connectedAt ?? new Date().toISOString() };
    await writeJsonAtomic(regFile(r.sessionId), full);
    return full;
  });
}

/**
 * Patches an existing registration; returns null (and writes nothing) when there is none. With
 * `ifConnectedAt`, it also writes nothing unless the registration is still that same active connection
 * (a stale writer must never resurrect a session after /cc off).
 */
export async function updateRegistration(
  sid: string,
  patch: Partial<Omit<Registration, 'sessionId'>>,
  opts: { ifConnectedAt?: string } = {},
): Promise<Registration | null> {
  if (!(await getRegistration(sid))) return null;
  return locked(sid, async () => {
    const r = await getRegistration(sid);
    if (!r) return null;
    if (opts.ifConnectedAt !== undefined && (!isActive(r) || r.connectedAt !== opts.ifConnectedAt)) return null;
    const next = { ...r, ...patch };
    await writeJsonAtomic(regFile(sid), next);
    return next;
  });
}

export async function getRegistration(sid: string): Promise<Registration | null> {
  return readJson<Registration>(regFile(sid));
}

export async function listRegistrations(): Promise<Registration[]> {
  let names: string[];
  try {
    names = await fs.readdir(paths().sessionsDir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const out: Registration[] = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const r = await readJson<Registration>(path.join(paths().sessionsDir, n));
    if (r) out.push(r);
  }
  return out;
}

/**
 * Marks the session disconnected and drops what it can no longer receive (queued messages, busy marker).
 * Idempotent: an already disconnected registration keeps its first reason and time.
 */
export async function markDisconnected(
  sid: string,
  reason: NonNullable<Registration['disconnectReason']>,
): Promise<void> {
  const done = await locked(sid, async () => {
    const r = await getRegistration(sid);
    if (!r) return false;
    if (isActive(r)) await writeJsonAtomic(regFile(sid), { ...r, disconnectedAt: new Date().toISOString(), disconnectReason: reason });
    return true;
  });
  if (!done) return;
  await clearInbox(sid);
  await clearBusy(sid);
}

/**
 * Deletes registrations disconnected more than `maxAgeMs` ago, with their inbox, busy and waiting
 * files. Returns the pruned session ids.
 */
export async function pruneRegistrations(maxAgeMs: number, now = Date.now()): Promise<string[]> {
  const pruned: string[] = [];
  for (const r of await listRegistrations()) {
    if (isActive(r)) continue;
    const at = Date.parse(r.disconnectedAt ?? '');
    if (Number.isNaN(at) || now - at <= maxAgeMs) continue;
    const sid = r.sessionId;
    try {
      assertSessionId(sid);
    } catch {
      continue;
    }
    await locked(sid, async () => {
      const cur = await getRegistration(sid);
      if (!cur || isActive(cur) || cur.disconnectedAt !== r.disconnectedAt) return;
      await removeFile(regFile(sid));
      pruned.push(sid);
    });
    if (!pruned.includes(sid)) continue;
    await clearInbox(sid);
    await fs.rm(paths().inboxDir(sid), { recursive: true, force: true }).catch(() => {});
    await clearBusy(sid);
    await clearWaiting(sid);
    await clearDelivered(sid);
  }
  return pruned;
}
