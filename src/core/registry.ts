import fs from 'node:fs/promises';
import path from 'node:path';
import { assertSessionId, paths } from './paths.js';
import { readJson, writeJsonAtomic } from './fsAtomic.js';
import { clearInbox } from './inbox.js';
import { clearBusy } from './busy.js';

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
  const prev = await getRegistration(r.sessionId);
  if (!prev || !isActive(prev)) await clearInbox(r.sessionId);
  const full: Registration = { ...r, connectedAt: r.connectedAt ?? new Date().toISOString() };
  await writeJsonAtomic(regFile(r.sessionId), full);
  return full;
}

/** Patches an existing registration; returns null (and writes nothing) when there is none. */
export async function updateRegistration(
  sid: string,
  patch: Partial<Omit<Registration, 'sessionId'>>,
): Promise<Registration | null> {
  const r = await getRegistration(sid);
  if (!r) return null;
  const next = { ...r, ...patch };
  await writeJsonAtomic(regFile(sid), next);
  return next;
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

/** Marks the session disconnected and drops what it can no longer receive (queued messages, busy marker). */
export async function markDisconnected(
  sid: string,
  reason: NonNullable<Registration['disconnectReason']>,
): Promise<void> {
  const r = await getRegistration(sid);
  if (!r) return;
  await writeJsonAtomic(regFile(sid), { ...r, disconnectedAt: new Date().toISOString(), disconnectReason: reason });
  await clearInbox(sid);
  await clearBusy(sid);
}
