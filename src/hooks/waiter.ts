import fs from 'node:fs';
import path from 'node:path';
import { assertSessionId, paths } from '../core/paths.js';
import { getRegistration, isActive, listRegistrations, markDisconnected, updateRegistration } from '../core/registry.js';
import { clearBusy, isBusy } from '../core/busy.js';
import { lookupClaudePid, type PidLookup } from './claudePid.js';
import { drain } from '../core/inbox.js';
import { clearWaiting } from '../core/waiting.js';
import { acquireLock, releaseLock, touchLock, lockPid, isAlive as pidAlive } from '../core/lock.js';
import { wrapMessages } from '../core/protocol.js';

export type { PidLookup };
/** `stop`: spawned by Stop (a turn just ended). `start`: spawned by SessionStart. */
export type WaiterEvent = 'start' | 'stop';
export type WaiterInput = { session_id: string; source?: string; transcript_path?: string };

export interface WaiterResult {
  exitCode: 0 | 2;
  stderr: string;
}

/** The `timeout` of the waiter entries in hooks.json: Claude Code enforces it on asyncRewake hooks. */
export const HOOK_TIMEOUT_S = 86_400;
/** The waiter exits 0 on its own a minute before Claude Code would kill it. */
export const WAITER_BUDGET_MS = (HOOK_TIMEOUT_S - 60) * 1000;
/** App messages older than this are discarded (and logged), never delivered: the user moved on. */
export const MAX_MESSAGE_AGE_MS = 30 * 60_000;
const RERESOLVE_MS = 60_000;
/** Lookups in a row that do not list the session before a waiter with an unknown pid gives up. */
const MAX_MISSES = 3;
const HEARTBEAT_MS = 10_000;
const SWITCH_SOURCES = new Set(['startup', 'resume', 'clear', 'fork']);

const NOTHING: WaiterResult = { exitCode: 0, stderr: '' };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function activeReg(sid: string) {
  const r = await getRegistration(sid);
  return r && isActive(r) ? r : null;
}

export interface WaiterOptions {
  pollMs?: number;
  isAlive?: (pid: number) => boolean;
  clearWaiting?: (sid: string) => Promise<void>;
  /** One `claude agents` lookup. Default: lookupClaudePid. */
  lookup?: (sid: string) => Promise<PidLookup>;
  /** How often a waiter with an unknown pid looks it up again. Default 60 s. */
  reresolveMs?: number;
  /** Time budget, after which the waiter exits 0. Default WAITER_BUDGET_MS. */
  deadlineMs?: number;
  /** Clock for message ages. Default Date.now. */
  now?: () => number;
  /** How often the waiter lock heartbeat is refreshed. Default 10 s. */
  heartbeatMs?: number;
}

/**
 * SessionStart in the same claude process (/clear, /resume, fork, or a new startup) means any other
 * active registration with this claude pid belongs to a conversation that is no longer on screen:
 * disconnect it. On resume/startup of this session's own active registration, refresh its pid and
 * transcript path (a resumed session may run in a new process and write a new transcript).
 */
async function sessionSwitch(sid: string, input: WaiterInput, lookup: () => Promise<PidLookup>): Promise<void> {
  const source = input.source ?? '';
  if (!SWITCH_SOURCES.has(source)) return;
  const active = (await listRegistrations()).filter(isActive);
  const others = active.filter((r) => r.sessionId !== sid && r.pid !== null);
  const own = active.find((r) => r.sessionId === sid);
  const refresh = own !== undefined && (source === 'resume' || source === 'startup');
  if (others.length === 0 && !refresh) return; // only pay for `claude agents` when someone uses the plugin
  const r = await lookup();
  const pid = r.ok ? r.pid : null;
  if (pid !== null) {
    for (const o of others) if (o.pid === pid) await markDisconnected(o.sessionId, 'clear');
  }
  if (refresh) {
    const tp = typeof input.transcript_path === 'string' && input.transcript_path ? { transcriptPath: input.transcript_path } : {};
    await updateRegistration(sid, { pid, ...tp }, { ifConnectedAt: own.connectedAt });
  }
}

/**
 * Waits for app messages. Exit 2 + messages on stderr wakes the session; 0 means "nothing to do".
 * `stop` (a turn just ended) first clears the busy marker and the waiting state; `start` never does,
 * since SessionStart can fire mid-turn. Neither drains while a busy marker exists.
 */
export async function runWaiter(event: WaiterEvent, input: WaiterInput, opts: WaiterOptions = {}): Promise<WaiterResult> {
  const sid = input?.session_id;
  try {
    assertSessionId(sid);
  } catch {
    return NOTHING;
  }
  const startedAt = Date.now();
  const pollMs = opts.pollMs ?? 1000;
  const isAlive = opts.isAlive ?? pidAlive;
  const clear = opts.clearWaiting ?? clearWaiting;
  const reresolveMs = opts.reresolveMs ?? RERESOLVE_MS;
  const deadlineMs = opts.deadlineMs ?? WAITER_BUDGET_MS;
  const now = opts.now ?? Date.now;
  const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
  const lookupFn = opts.lookup ?? ((id: string) => lookupClaudePid(id));

  let misses = 0;
  let lastLookupAt = 0;
  let lookups = 0;
  const lookup = async (): Promise<PidLookup> => {
    lookups++;
    lastLookupAt = Date.now();
    const r = await lookupFn(sid);
    if (r.ok) misses = r.pid === null ? misses + 1 : 0;
    return r;
  };

  if (event === 'start') {
    try {
      await sessionSwitch(sid, input, lookup);
    } catch (e) {
      logError(e);
    }
  }

  const first = await activeReg(sid);
  if (!first) return NOTHING;
  if (event === 'stop') {
    // The turn has ended: before the lock, so a waiter that loses the lock still unblocks the holder.
    try {
      await clearBusy(sid);
      await clear(sid);
    } catch (e) {
      logError(e);
    }
  }

  /** Persists a pid found by a later lookup, unless the connection changed meanwhile. */
  const adopt = async (found: number) => {
    await updateRegistration(sid, { pid: found }, { ifConnectedAt: first.connectedAt });
  };
  let pid = first.pid ?? null;
  if (pid === null && lookups === 0) {
    const r = await lookup();
    if (r.ok && r.pid !== null) {
      pid = r.pid;
      await adopt(pid);
    }
  }

  const lock = paths().waiterLock(sid);
  if (!(await acquireLock(lock))) return NOTHING;
  let lastBeat = Date.now();
  let deadChecked = false;
  try {
    for (;;) {
      if (Date.now() - startedAt >= deadlineMs) return NOTHING;
      const reg = await activeReg(sid);
      if (!reg) return NOTHING;
      if (Date.now() - lastBeat >= heartbeatMs) {
        lastBeat = Date.now();
        await touchLock(lock);
      }
      const regPid = reg.pid ?? pid;
      if (regPid === null) {
        // Unknown pid: look it up again now and then; give up once `claude agents` keeps not listing it.
        if (misses >= MAX_MISSES) return NOTHING;
        if (Date.now() - lastLookupAt >= reresolveMs) {
          const r = await lookup();
          if (misses >= MAX_MISSES) return NOTHING;
          if (r.ok && r.pid !== null) {
            pid = r.pid;
            await adopt(pid);
          }
        }
      } else if (!isAlive(regPid)) {
        // A resumed session runs in a new process; its start waiter may not have updated the pid yet.
        if (deadChecked) return NOTHING;
        deadChecked = true;
        const r = await lookup();
        const fresh = r.ok ? r.pid : null;
        if (fresh === null || fresh === regPid || !isAlive(fresh)) return NOTHING;
        pid = fresh;
        await adopt(fresh);
        continue;
      }
      if (!(await isBusy(sid))) {
        const drained = await drain(sid);
        const cutoff = now() - MAX_MESSAGE_AGE_MS;
        const msgs = drained.filter((m) => !(Date.parse(m.createdAt) < cutoff));
        if (msgs.length < drained.length) {
          logError(`discarded ${drained.length - msgs.length} message(s) older than 30 min for session ${sid}`);
        }
        if (msgs.length > 0) {
          // Drained messages are gone from disk: delivery must not depend on anything else.
          const result: WaiterResult = { exitCode: 2, stderr: wrapMessages(msgs, reg.key) };
          try {
            await clear(sid);
          } catch (e) {
            logError(e);
          }
          return result;
        }
      }
      await sleep(pollMs);
    }
  } finally {
    await releaseLock(lock);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function logError(e: unknown): void {
  try {
    const dir = paths().logDir;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(
      path.join(dir, 'waiter.log'),
      `${new Date().toISOString()} ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`,
    );
  } catch {
    /* never break the session */
  }
}

/** Best-effort: remove the lock only if this process owns it. */
function releaseOwnLockSync(sid: unknown): void {
  try {
    assertSessionId(sid as string);
    const lock = paths().waiterLock(sid as string);
    if (lockPid(fs.readFileSync(lock, 'utf8')) === process.pid) fs.rmSync(lock, { force: true });
  } catch {
    /* ignore */
  }
}

export async function main(): Promise<void> {
  let result: WaiterResult = NOTHING;
  try {
    const event = process.argv[2];
    if (event !== 'start' && event !== 'stop') return;
    const input = JSON.parse(await readStdin());
    const onSignal = () => {
      releaseOwnLockSync(input?.session_id);
      process.exit(0);
    };
    process.on('SIGTERM', onSignal);
    process.on('SIGINT', onSignal);
    result = await runWaiter(event, input);
  } catch (e) {
    logError(e);
  }
  if (result.stderr) {
    // Flush before exiting: a pipe write may be async (always on Windows).
    process.stderr.write(result.stderr, () => process.exit(result.exitCode));
  } else {
    process.exitCode = result.exitCode;
  }
}
