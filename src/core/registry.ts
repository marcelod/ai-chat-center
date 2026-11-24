import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertSessionId, paths } from './paths.js';
import { readJson, removeFile, writeJsonAtomic } from './fsAtomic.js';
import { clearInbox } from './inbox.js';
import { clearBusy } from './busy.js';
import { clearWaiting } from './waiting.js';
import { clearDelivered } from './delivered.js';
import { withLock } from './lock.js';
import { PROTOCOL, VERSION } from './version.js';

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
  /**
   * The Claude config dir of the session (CLAUDE_CONFIG_DIR, else ~/.claude). `claude agents` only lists
   * the sessions of its own config dir, so lookups only judge registrations of the same one. Missing in
   * registrations written before 0.2.3: treated as the same.
   */
  configDir?: string;
  /** The plugin version whose hook or waiter last wrote this registration (missing before 0.2.4). */
  version?: string;
  /** The message protocol of that code (see PROTOCOL; missing before 0.2.4). The hub sends only on its own. */
  protocol?: number;
  disconnectedAt?: string;
  disconnectReason?: 'off' | 'clear' | 'exited' | 'removed';
  /**
   * Set when the user removed the session from the app: it stays out of the session list. Only a new
   * registration (a later /cc) clears it, since register() writes the whole record anew.
   */
  removedAt?: string;
};

function regFile(sid: string): string {
  assertSessionId(sid);
  return path.join(paths().sessionsDir, `${sid}.json`);
}

export const isActive = (r: Registration): boolean => !r.disconnectedAt;

/** The user removed the session from the app (see markRemoved). */
export const isRemoved = (r: Registration): boolean => !!r.removedAt;

/** The Claude config dir of this process (CLAUDE_CONFIG_DIR, else ~/.claude), resolved. */
export function claudeConfigDir(): string {
  const raw = process.env.CLAUDE_CONFIG_DIR;
  return path.resolve(raw && raw.trim() ? raw : path.join(os.homedir(), '.claude'));
}

/** True when `claude agents` run by this process can see the session (same config dir, or unknown). */
export function sameConfigDir(r: Registration, mine = claudeConfigDir()): boolean {
  if (!r.configDir) return true;
  const a = path.resolve(r.configDir);
  return process.platform === 'win32' ? a.toLowerCase() === mine.toLowerCase() : a === mine;
}

/** What this code records about itself in a registration it writes. */
export const codeStamp = (): { version: string; protocol: number } => ({ version: VERSION, protocol: PROTOCOL });

/** True when the registration was last written by this very version and protocol. */
export const stampedByThisCode = (r: Registration): boolean => r.version === VERSION && r.protocol === PROTOCOL;

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
 * Removes the session from the app: an active one is disconnected as by /cc off (reason `removed`: its
 * waiter stops, queued messages and the busy marker are dropped); an ended one keeps its reason. Either
 * way it is marked removed and stays out of the app's list until a new /cc registers it again.
 * Returns false (and writes nothing) for an unknown session.
 */
export async function markRemoved(sid: string): Promise<boolean> {
  const done = await locked(sid, async () => {
    const r = await getRegistration(sid);
    if (!r) return false;
    const at = new Date().toISOString();
    const next: Registration = isActive(r) ? { ...r, disconnectedAt: at, disconnectReason: 'removed' } : { ...r };
    next.removedAt = r.removedAt ?? at;
    await writeJsonAtomic(regFile(sid), next);
    return true;
  });
  if (!done) return false;
  await clearInbox(sid);
  await clearBusy(sid);
  return true;
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
    await removeFile(paths().pinsFile(sid)).catch(() => {});
  }
  return pruned;
}
