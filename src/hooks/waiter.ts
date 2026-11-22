import fs from 'node:fs';
import path from 'node:path';
import { assertSessionId, paths } from '../core/paths.js';
import { getRegistration, isActive, updateRegistration } from '../core/registry.js';
import { clearBusy, isBusy } from '../core/busy.js';
import { resolveClaudePid } from './claudePid.js';
import { drain } from '../core/inbox.js';
import { clearWaiting } from '../core/waiting.js';
import { acquireLock, releaseLock, isAlive as pidAlive } from '../core/lock.js';
import { wrapMessages } from '../core/protocol.js';

export interface WaiterResult {
  exitCode: 0 | 2;
  stderr: string;
}

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
  /** Pid lookup when the registration has none. Default: resolveClaudePid. */
  resolvePid?: (sid: string) => Promise<number | null>;
}

/**
 * Waits for app messages. Exit 2 + messages on stderr wakes the session; 0 means "nothing to do".
 * Spawned by Stop and SessionStart, i.e. when no turn is running: it first clears the busy marker
 * and the waiting state, then never drains while a new busy marker exists (a terminal turn started).
 */
export async function runWaiter(input: { session_id: string }, opts: WaiterOptions = {}): Promise<WaiterResult> {
  const sid = input?.session_id;
  try {
    assertSessionId(sid);
  } catch {
    return NOTHING;
  }
  const pollMs = opts.pollMs ?? 1000;
  const isAlive = opts.isAlive ?? pidAlive;
  const clear = opts.clearWaiting ?? clearWaiting;

  const first = await activeReg(sid);
  if (!first) return NOTHING;
  // The turn has ended: before the lock, so a waiter that loses the lock still unblocks the holder.
  try {
    await clearBusy(sid);
    await clear(sid);
  } catch (e) {
    logError(e);
  }

  const lookup = opts.resolvePid ?? resolveClaudePid;
  let resolved = false;
  /** One `claude agents` lookup per waiter at most; the result is persisted into the registration. */
  const reresolve = async (): Promise<number | null> => {
    resolved = true;
    const found = await lookup(sid);
    if (found !== null) {
      const cur = await activeReg(sid);
      if (cur && cur.connectedAt === first.connectedAt) await updateRegistration(sid, { pid: found });
    }
    return found;
  };
  let pid = first.pid ?? null;
  if (pid === null) pid = await reresolve();

  const lock = paths().waiterLock(sid);
  if (!(await acquireLock(lock))) return NOTHING;
  try {
    for (;;) {
      const reg = await activeReg(sid);
      if (!reg) return NOTHING;
      const regPid = reg.pid ?? pid;
      // Unknown pid: skip the check; the hub marks exited sessions inactive, which ends this loop.
      if (regPid !== null && !isAlive(regPid)) {
        // A resumed session runs in a new process; its SessionStart hook may not have updated the pid yet.
        const fresh = resolved ? null : await reresolve();
        if (fresh === null || fresh === regPid || !isAlive(fresh)) return NOTHING;
        pid = fresh;
        continue;
      }
      if (!(await isBusy(sid))) {
        const msgs = await drain(sid);
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
    if (fs.readFileSync(lock, 'utf8') === String(process.pid)) fs.rmSync(lock, { force: true });
  } catch {
    /* ignore */
  }
}

export async function main(): Promise<void> {
  let result: WaiterResult = NOTHING;
  try {
    const input = JSON.parse(await readStdin());
    const onSignal = () => {
      releaseOwnLockSync(input?.session_id);
      process.exit(0);
    };
    process.on('SIGTERM', onSignal);
    process.on('SIGINT', onSignal);
    result = await runWaiter(input);
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
