import fs from 'node:fs';
import path from 'node:path';
import { assertSessionId, paths } from '../core/paths.js';
import { codeStamp, getRegistration, isActive, listRegistrations, markDisconnected, sameConfigDir, stampedByThisCode, updateRegistration } from '../core/registry.js';
import { clearBusy, clearBusyIfOlder, isBusy } from '../core/busy.js';
import { lookupClaudePid, type PidLookup } from './claudePid.js';
import { drain, sweepClaimed } from '../core/inbox.js';
import { clearWaiting } from '../core/waiting.js';
import { acquireLockContent, releaseLock, touchLock, lockPid, isAlive as pidAlive } from '../core/lock.js';
import { wrapMessages } from '../core/protocol.js';
import { isCcCommand } from '../core/ccCommand.js';
import { busyAge } from '../core/busy.js';
import { queryLiveSessions } from '../hub/status.js';
import { loadSecret, verifyMessage } from '../core/secret.js';
import { readDelivered, recordDelivered } from '../core/delivered.js';
import { setMode } from '../core/meta.js';

export type { PidLookup };
/**
 * `stop`: spawned by Stop (a turn just ended). `start`: spawned by SessionStart. `prompt`: spawned by
 * UserPromptSubmit (a turn starts, typed in the terminal or woken by a delivery), so a waiter exists
 * during every turn: an interrupted turn (Esc) fires no Stop, and before this nothing re-armed delivery.
 */
export type WaiterEvent = 'start' | 'stop' | 'prompt';
export type WaiterInput = { session_id: string; source?: string; transcript_path?: string; prompt?: string; cwd?: string; permission_mode?: unknown };
/** Live status of a session from `claude agents`, or null when the lookup failed or does not list it. */
export type LiveStatus = 'busy' | 'idle' | 'waiting' | null;

export interface WaiterResult {
  exitCode: 0 | 2;
  stderr: string;
}

/** The `timeout` of the waiter entries in hooks.json: Claude Code enforces it on asyncRewake hooks. */
export const HOOK_TIMEOUT_S = 86_400;
/** The waiter exits 0 on its own a minute before Claude Code would kill it. */
export const WAITER_BUDGET_MS = (HOOK_TIMEOUT_S - 60) * 1000;
/**
 * When an old session is resumed (start waiter, source "resume"), app messages older than this are
 * discarded (and logged), never delivered: the user moved on. At the end of a turn (stop) messages are
 * delivered whatever their age: a long turn must not eat the messages sent while it ran.
 */
export const MAX_MESSAGE_AGE_MS = 30 * 60_000;
/** A waiter with an unknown pid exits after `claude agents` has failed this long in a row. */
export const LOOKUP_FAIL_EXIT_MS = 30 * 60_000;
/** Claimed inbox files older than this (delivered, but their delete failed) are swept when a waiter starts. */
const CLAIMED_SWEEP_MS = 3600_000;
const RERESOLVE_MS = 60_000;
/** Lookups in a row that do not list the session before a waiter with an unknown pid gives up. */
const MAX_MISSES = 3;
const HEARTBEAT_MS = 10_000;
/**
 * A busy marker older than this, while the session is idle according to `claude agents`, was left by a
 * turn that ended without Stop (Esc, an API error): it is dropped so queued messages are delivered.
 */
export const STALE_BUSY_MS = 10_000;
/** With messages queued behind a stale busy marker, the live status is checked at most this often. */
export const BUSY_CHECK_MS = 15_000;
/**
 * A prompt waiter starts in parallel with the prompt hook that sets the busy marker: it does not drain
 * before this delay, so it never delivers into the turn that has just started.
 */
export const PROMPT_SETTLE_MS = 3000;
/** A signed message dated more than this in the future is dropped. */
export const MAX_CLOCK_SKEW_MS = 2 * 60_000;
/** A pinned waiter that finds the lock held retries it this long (the holder may be about to exit). */
export const PINNED_LOCK_WAIT_MS = 3000;
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
  /** Clock for message ages and for the lookup-failure limit. Default Date.now. */
  now?: () => number;
  /** How often the waiter lock heartbeat is refreshed. Default 10 s. */
  heartbeatMs?: number;
  /** With an unknown pid, exit once lookups have failed for this long in a row. Default LOOKUP_FAIL_EXIT_MS. */
  lookupFailMs?: number;
  /** Live status lookup (one `claude agents`). Default: liveStatus. */
  status?: (sid: string) => Promise<LiveStatus>;
  /** Default STALE_BUSY_MS. */
  staleBusyMs?: number;
  /** Default BUSY_CHECK_MS. */
  busyCheckMs?: number;
  /** Default PROMPT_SETTLE_MS. */
  promptSettleMs?: number;
  /**
   * When this waiter's process started (epoch ms). A Stop waiter clears only a busy marker written before
   * it: a newer one belongs to the next turn. Default: when runWaiter was called; main passes the
   * process start time.
   */
  spawnedAt?: number;
  /**
   * This process's parent when it started (main: process.ppid). With exec-form hooks it is the claude
   * process the waiter serves; tests leave it unset.
   */
  parentPid?: number | null;
  /** The parent now (main: () => process.ppid); POSIX re-parents an orphan, so a change means claude is gone. */
  currentParentPid?: () => number;
  /** How long a pinned waiter retries a lock held by another waiter. Default PINNED_LOCK_WAIT_MS. */
  pinnedLockWaitMs?: number;
  /** Default process.platform (tests). */
  platform?: NodeJS.Platform;
}

/** The session's status from `claude agents --json`; null when the lookup fails or does not list it. */
export async function liveStatus(sid: string): Promise<LiveStatus> {
  const list = await queryLiveSessions();
  return list?.find((l) => l.sessionId === sid)?.status ?? null;
}

async function hasQueued(sid: string): Promise<boolean> {
  try {
    return (await fs.promises.readdir(paths().inboxDir(sid))).some((n) => n.endsWith('.msg'));
  } catch {
    return false;
  }
}

/** Like hasQueued, but a read error other than a missing folder is thrown (logged by the loop). */
async function inboxHasMessages(sid: string): Promise<boolean> {
  try {
    return (await fs.promises.readdir(paths().inboxDir(sid))).some((n) => n.endsWith('.msg'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}

/**
 * SessionStart in the same claude process (/clear, /resume, fork, or a new startup) means any other
 * active registration with this claude pid belongs to a conversation that is no longer on screen:
 * disconnect it. On resume/startup of this session's own active registration, refresh its pid and
 * transcript path (a resumed session may run in a new process and write a new transcript).
 */
async function sessionSwitch(
  sid: string,
  input: WaiterInput,
  lookup: () => Promise<PidLookup>,
  lookupOther: (id: string) => Promise<PidLookup>,
): Promise<void> {
  const source = input.source ?? '';
  if (!SWITCH_SOURCES.has(source)) return;
  // Only sessions this process's `claude agents` can see (same Claude config dir): another one is never
  // judged by a lookup that cannot list it (audit S4-U3).
  const active = (await listRegistrations()).filter((r) => isActive(r) && (r.sessionId === sid || sameConfigDir(r)));
  const others = active.filter((r) => r.sessionId !== sid && r.pid !== null);
  if (source === 'clear') {
    // A registration whose pid was never resolved could be the conversation this /clear replaced: resolve
    // it now. Listed: record its pid (compared below). Not listed: it is gone or replaced, disconnect it.
    // Lookup failed: disconnect it only when it ran in this same folder.
    for (const u of active.filter((r) => r.sessionId !== sid && r.pid === null)) {
      const r = await lookupOther(u.sessionId);
      if (r.ok && r.pid !== null) {
        await updateRegistration(u.sessionId, { pid: r.pid }, { ifConnectedAt: u.connectedAt });
        others.push({ ...u, pid: r.pid });
      } else if (r.ok || (typeof input.cwd === 'string' && u.cwd === input.cwd)) {
        await markDisconnected(u.sessionId, 'clear');
      }
    }
  }
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
    await updateRegistration(sid, { pid, ...tp, ...codeStamp() }, { ifConnectedAt: own.connectedAt });
  }
}

/**
 * Waits for app messages. Exit 2 + messages on stderr wakes the session; 0 means "nothing to do".
 * `stop` (a turn just ended) first clears the busy marker and the waiting state; `start` and `prompt`
 * never do (SessionStart can fire mid-turn; a prompt starts a turn). None drains while a busy marker
 * exists, except one left by an interrupted turn: with messages queued, a marker older than 10 s is
 * dropped once `claude agents` reports the session idle. One waiter per session (the lock): a prompt
 * waiter that finds the previous turn's waiter still waiting simply exits.
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
  const lookupFailMs = opts.lookupFailMs ?? LOOKUP_FAIL_EXIT_MS;
  const discardOld = event === 'start' && input.source === 'resume';
  const statusFn = opts.status ?? liveStatus;
  const staleBusyMs = opts.staleBusyMs ?? STALE_BUSY_MS;
  const busyCheckMs = opts.busyCheckMs ?? BUSY_CHECK_MS;
  const settleUntil = event === 'prompt' ? startedAt + (opts.promptSettleMs ?? PROMPT_SETTLE_MS) : 0;
  // /cc, /cc off: the hook connects or disconnects; the Stop of that turn arms the next waiter.
  if (event === 'prompt' && isCcCommand(input.prompt) !== null) return NOTHING;

  let misses = 0;
  let lastLookupAt = 0;
  let lookups = 0;
  /** Start of the current run of failed lookups, or null. */
  let failingSince: number | null = null;
  const lookup = async (): Promise<PidLookup> => {
    lookups++;
    lastLookupAt = Date.now();
    const r = await lookupFn(sid);
    if (r.ok) {
      misses = r.pid === null ? misses + 1 : 0;
      failingSince = null;
    } else failingSince ??= now();
    return r;
  };
  const failingTooLong = () => failingSince !== null && now() - failingSince >= lookupFailMs;

  if (event === 'start') {
    try {
      await sessionSwitch(sid, input, lookup, lookupFn);
    } catch (e) {
      logError(e);
    }
  }

  const first = await activeReg(sid);
  if (!first) return NOTHING;
  if (!stampedByThisCode(first)) {
    // The session runs this code (restarted after a plugin update): the hub may send to it again (R5-M1).
    try {
      await updateRegistration(sid, codeStamp(), { ifConnectedAt: first.connectedAt });
    } catch (e) {
      logError(e);
    }
  }
  if (event === 'stop' && typeof input.permission_mode === 'string') {
    // Shift+Tab during the turn: the app shows the mode the turn ended in (display-only).
    try {
      await setMode(sid, input.permission_mode);
    } catch (e) {
      logError(e);
    }
  }
  if (event === 'stop') {
    // The turn has ended: before the lock, so a waiter that loses the lock still unblocks the holder. Only
    // a marker older than this process: the next turn may already have started and set its own.
    try {
      if (!(await clearBusyIfOlder(sid, opts.spawnedAt ?? startedAt))) logError(`stop of session ${sid}: the busy marker is newer than this waiter (the next turn started): kept`);
      await clear(sid);
    } catch (e) {
      logError(e);
    }
  }

  /** Persists a pid found by a later lookup, unless the connection changed meanwhile. */
  const adopt = async (found: number) => {
    await updateRegistration(sid, { pid: found, ...codeStamp() }, { ifConnectedAt: first.connectedAt });
  };
  let pid = first.pid ?? null;
  if (pid === null && lookups === 0) {
    const r = await lookup();
    if (r.ok && r.pid !== null) {
      pid = r.pid;
      await adopt(pid);
    }
  }
  // Audit S4-U1: the claude process this waiter serves. Claude Code leaves async hooks running when it
  // exits, so a waiter can outlive its claude process and must never deliver for a later one (its stderr
  // goes nowhere). With exec-form hooks the parent IS that process: the waiter is then PINNED to it. A
  // parent that is not the session's claude process (a node shim that waits for its child) is only
  // watched: the waiter serves the registered pid, as before.
  const parent = opts.parentPid ?? null;
  const parentWatched = parent !== null && parent > 1 && isAlive(parent);
  let pinned = parentWatched && pid === parent;
  if (parentWatched && !pinned && pid !== null && !isAlive(pid)) {
    // The registration names another process, and it is dead: this session was resumed here and its start
    // waiter has not recorded this process yet. One lookup tells. (Alive: the parent is a shim; no lookup
    // on every turn for that.)
    const r = await lookup();
    if (r.ok && r.pid === parent) {
      pinned = true;
      pid = parent;
      await adopt(parent);
    }
  }

  const lock = paths().waiterLock(sid);
  // The exact content we published ({pid, ts}): touchLock only changes the mtime, so any other content
  // means the lock was reclaimed (our heartbeat lapsed, e.g. a suspended machine) by another waiter.
  let mine = await acquireLockContent(lock);
  if (mine === null && pinned) {
    // Audit R5-L1: the session was resumed in this claude process while the previous one is still open. Its
    // waiter holds the lock and exits within a poll once it sees this process in the registration: wait for
    // it a little (it polls every second) instead of leaving the session with no waiter at all.
    const until = Date.now() + (opts.pinnedLockWaitMs ?? PINNED_LOCK_WAIT_MS);
    while (mine === null && Date.now() < until) {
      await sleep(Math.min(pollMs, 100));
      mine = await acquireLockContent(lock);
    }
  }
  if (mine === null) return NOTHING;
  let lastBeat = Date.now();
  let deadChecked = false;
  // Audit S5-L2: Windows never re-parents, so a pinned waiter whose claude process exited cannot tell that
  // another process reused that pid. Before the first claim, one `claude agents` lookup confirms that the
  // session runs in this waiter's parent (kept for the waiter's lifetime). A failed lookup delivers as before.
  let parentConfirmed = !(pinned && (opts.platform ?? process.platform) === 'win32');
  let lastStatusAt = -Infinity;
  let secretWarned = false;
  /**
   * True once a busy marker left by an interrupted turn was dropped. Only with messages queued (the
   * lookup costs a `claude agents` run), a marker older than staleBusyMs, at most every busyCheckMs.
   */
  const dropStaleBusy = async (): Promise<boolean> => {
    const age = await busyAge(sid);
    if (age === null) return true;
    if (age <= staleBusyMs || Date.now() - lastStatusAt < busyCheckMs || !(await hasQueued(sid))) return false;
    lastStatusAt = Date.now();
    if ((await statusFn(sid)) !== 'idle') return false;
    const again = await busyAge(sid);
    if (again !== null && again <= staleBusyMs) return false; // a new turn set it meanwhile
    await clearBusy(sid);
    logError(`dropped a busy marker left by an interrupted turn of session ${sid}`);
    return true;
  };
  try {
    try {
      await sweepClaimed(sid, CLAIMED_SWEEP_MS, await readDelivered(sid), async () => {
        const sec = await loadSecret();
        return sec.ok ? (m) => verifyMessage(m, sid, sec.secret) : null;
      });
    } catch (e) {
      logError(e);
    }
    for (;;) {
      if (Date.now() - startedAt >= deadlineMs) return NOTHING;
      // Never exit on a transient fs error: log it, wait, try again.
      try {
        const lockLost = async () => {
          if ((await readLock(lock)) === mine) return false;
          logError(`waiter lock for session ${sid} is no longer ours: exiting without draining`);
          return true;
        };
        if (await lockLost()) return NOTHING;
        const reg = await activeReg(sid);
        if (!reg) return NOTHING;
        if (Date.now() - lastBeat >= heartbeatMs) {
          lastBeat = Date.now();
          await touchLock(lock);
        }
        if (parentWatched && (!isAlive(parent) || (opts.currentParentPid && opts.currentParentPid() !== parent))) {
          logError(`waiter for session ${sid}: its claude process ${parent} is gone: exiting without draining`);
          return NOTHING;
        }
        if (pid !== null && reg.pid !== null && reg.pid !== pid) {
          logError(`waiter for session ${sid}: the session now runs in claude process ${reg.pid}, not ${pid}: exiting without draining`);
          return NOTHING;
        }
        const regPid = reg.pid ?? pid;
        if (pinned) {
          // pinned: the parent checks above are the liveness checks; never re-resolved to another process
        } else if (regPid === null) {
          // Unknown pid: look it up again now and then; give up once `claude agents` keeps not listing
          // it, or keeps failing.
          if (misses >= MAX_MISSES || failingTooLong()) return NOTHING;
          if (Date.now() - lastLookupAt >= reresolveMs) {
            const r = await lookup();
            if (misses >= MAX_MISSES || failingTooLong()) return NOTHING;
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
        if (Date.now() < settleUntil) {
          // a prompt waiter: let the prompt hook set the busy marker first
        } else if ((await isBusy(sid)) && !(await dropStaleBusy())) {
          // a turn is running
        } else {
          if (await lockLost()) return NOTHING; // again, right before draining
          // Only what the hub signed is delivered. Anything else (written by an older hub that did not sign,
          // or by something else) is kept aside as .unsigned, judged before anything is deleted; the app
          // tells the user it was not delivered.
          // The secret is read (with retries) BEFORE anything is claimed: when it cannot be read, this pass is
          // skipped and every message stays queued (audit S4-S2). A signed message is still dropped when its
          // id was already delivered (a replay), when it is dated in the future, or when it predates this
          // connection (S4-S1).
          const queued = await inboxHasMessages(sid);
          if (queued && !parentConfirmed) {
            const r = await lookup();
            if (r.ok && r.pid !== parent) {
              logError(`waiter for session ${sid}: claude agents lists it ${r.pid === null ? 'nowhere' : `in process ${r.pid}`}, not in this waiter's parent ${parent}: exiting without draining`);
              return NOTHING;
            }
            if (r.ok) parentConfirmed = true;
          }
          const sec = queued ? await loadSecret() : null;
          let drained: Awaited<ReturnType<typeof drain>> = [];
          if (sec && !sec.ok) {
            if (!secretWarned) logError(`the install secret is ${sec.reason}: nothing is taken from the inbox of session ${sid} until it can be read`);
            secretWarned = true;
          } else if (sec?.ok) {
            secretWarned = false;
            const delivered = await readDelivered(sid);
            const t = Date.now(); // the wall clock: createdAt was written by the hub on this machine
            const since = Date.parse(reg.connectedAt);
            let unsigned = 0;
            const dropped: string[] = [];
            drained = await drain(
              sid,
              (m) => {
                if (!verifyMessage(m, sid, sec.secret)) return (unsigned++, 'unsigned');
                const at = Date.parse(m.createdAt);
                if (delivered.has(m.id)) return (dropped.push(`${m.id} (already delivered)`), 'drop');
                if (!(at <= t + MAX_CLOCK_SKEW_MS)) return (dropped.push(`${m.id} (dated in the future)`), 'drop');
                if (Number.isFinite(since) && at < since) return (dropped.push(`${m.id} (older than this connection)`), 'drop');
                return 'deliver';
              },
              async (ms) => {
                try {
                  await recordDelivered(sid, ms.map((m) => m.id));
                } catch (e) {
                  logError(e);
                }
              },
            );
            if (unsigned > 0) {
              logError(`kept ${unsigned} unsigned or invalid message(s) aside (not delivered) in the inbox of session ${sid}`);
            }
            if (dropped.length > 0) logError(`dropped signed message(s) in the inbox of session ${sid}: ${dropped.join(', ')}`);
          }
          let msgs = drained;
          if (discardOld) {
            const cutoff = now() - MAX_MESSAGE_AGE_MS;
            msgs = drained.filter((m) => !(Date.parse(m.createdAt) < cutoff));
            if (msgs.length < drained.length) {
              logError(`discarded ${drained.length - msgs.length} message(s) older than 30 min on resume of session ${sid}`);
            }
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
      } catch (e) {
        logError(e);
      }
      await sleep(pollMs);
    }
  } finally {
    // Only our own lock: after a reclaim, the file belongs to the new holder.
    if ((await readLock(lock)) === mine) await releaseLock(lock);
  }
}

async function readLock(file: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(file, 'utf8');
  } catch {
    return null;
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
    if (event !== 'start' && event !== 'stop' && event !== 'prompt') return;
    const input = JSON.parse(await readStdin());
    const onSignal = () => {
      releaseOwnLockSync(input?.session_id);
      process.exit(0);
    };
    process.on('SIGTERM', onSignal);
    process.on('SIGINT', onSignal);
    result = await runWaiter(event, input, {
      spawnedAt: Date.now() - process.uptime() * 1000,
      parentPid: process.ppid,
      currentParentPid: () => process.ppid,
    });
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
