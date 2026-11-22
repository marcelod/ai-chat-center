import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureDir } from './fsAtomic.js';

const EMPTY_GRACE_MS = 10_000;
/** A held lock whose heartbeat (mtime) is older than this is stale even if its pid is alive (pid reuse). */
export const LOCK_STALE_MS = 90_000;
/** Holders of long-lived locks must call touchLock at least this often. */
export const LOCK_HEARTBEAT_MS = 30_000;

export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'; // ESRCH => dead
  }
}

const code = (e: unknown) => (e as NodeJS.ErrnoException).code;

/** Lock content is JSON `{pid, ts}`; a bare pid (older versions) is still understood. */
export function lockPid(content: string): number | null {
  const t = content.trim();
  let pid: unknown = null;
  if (/^\d+$/.test(t)) pid = parseInt(t, 10);
  else {
    try {
      pid = (JSON.parse(t) as { pid?: unknown } | null)?.pid;
    } catch {
      /* unreadable */
    }
  }
  return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** Publish the lock atomically: write `{pid, ts}` to a unique tmp file, then link() it
 *  (fails with EEXIST if held). The lock file is never observable empty. Returns the content
 *  published, or null when the lock is held. */
async function publish(file: string): Promise<string | null> {
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  const content = JSON.stringify({ pid: process.pid, ts: new Date().toISOString() });
  try {
    await fs.writeFile(tmp, content, { flag: 'wx' });
    await fs.link(tmp, file);
    return content;
  } catch (e) {
    if (['EEXIST', 'EPERM', 'EBUSY'].includes(code(e) ?? '')) return null;
    throw e;
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

/**
 * Returns the raw content if the lock is stale, else null. Stale: the holder pid is dead, or its
 * heartbeat (mtime) is older than LOCK_STALE_MS, or the file is empty/unreadable past a short grace.
 */
async function staleContent(file: string): Promise<string | null> {
  let content: string;
  let mtimeMs: number;
  try {
    content = await fs.readFile(file, 'utf8');
  } catch (e) {
    if (code(e) === 'ENOENT') return null; // gone; caller's retry handles it
    content = '';
  }
  try {
    mtimeMs = (await fs.stat(file)).mtimeMs;
  } catch {
    return null;
  }
  const age = Date.now() - mtimeMs;
  const pid = lockPid(content);
  if (pid !== null) return !isAlive(pid) || age > LOCK_STALE_MS ? content : null;
  return age > EMPTY_GRACE_MS ? content : null;
}

const GUARD_STALE_MS = 10_000;
const contention = (e: unknown) => ['EEXIST', 'EPERM', 'EBUSY'].includes(code(e) ?? '');

/**
 * Reclaim a stale lock under a guard file. The lock file itself is never renamed or moved:
 * it is only unlinked after being re-verified, while holding the guard, to still be the
 * exact stale content `seen`. Exported for tests.
 */
export async function reclaimStaleLock(file: string, seen: string): Promise<boolean> {
  return (await reclaim(file, seen)) !== null;
}

async function reclaim(file: string, seen: string): Promise<string | null> {
  const guard = `${file}.reclaim`;
  if ((await publish(guard)) === null) {
    try {
      const st = await fs.stat(guard);
      if (Date.now() - st.mtimeMs > GUARD_STALE_MS) await fs.rm(guard, { force: true });
    } catch {
      /* ignore */
    }
    return null;
  }
  try {
    if ((await staleContent(file)) !== seen) return null;
    try {
      await fs.unlink(file);
    } catch (e) {
      if (code(e) !== 'ENOENT') {
        if (contention(e)) return null;
        throw e;
      }
    }
    return await publish(file);
  } finally {
    try {
      if (lockPid(await fs.readFile(guard, 'utf8')) === process.pid) await fs.rm(guard, { force: true });
    } catch {
      /* ignore */
    }
  }
}

export async function acquireLock(file: string): Promise<boolean> {
  return (await acquireLockContent(file)) !== null;
}

/**
 * Like acquireLock, but returns the exact content published (`{pid, ts}`), or null when not acquired.
 * A long-lived holder compares the file against it to tell whether it still owns the lock: the heartbeat
 * (touchLock) changes only the mtime, so any other content means the lock was reclaimed.
 */
export async function acquireLockContent(file: string): Promise<string | null> {
  await ensureDir(path.dirname(file));
  const mine = await publish(file);
  if (mine !== null) return mine;
  const seen = await staleContent(file);
  if (seen === null) return null;
  return reclaim(file, seen);
}

/** Heartbeat: refreshes the mtime of a lock this process holds. Best effort. */
export async function touchLock(file: string): Promise<void> {
  try {
    if (lockPid(await fs.readFile(file, 'utf8')) !== process.pid) return;
    const now = new Date();
    await fs.utimes(file, now, now);
  } catch {
    /* gone or unreadable: nothing to refresh */
  }
}

/** Releases the lock only if this process holds it. */
export async function releaseLock(file: string): Promise<void> {
  try {
    if (lockPid(await fs.readFile(file, 'utf8')) !== process.pid) return;
  } catch {
    return;
  }
  await fs.rm(file, { force: true });
}

/**
 * Runs `fn` under a short lock. Waits up to `waitMs` for it; if the lock is still held after that,
 * runs `fn` anyway (a stuck holder must not block a registration write forever).
 */
export async function withLock<T>(file: string, waitMs: number, fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + waitMs;
  let held = false;
  for (;;) {
    if (await acquireLock(file)) {
      held = true;
      break;
    }
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, 10 + Math.floor(Math.random() * 15)));
  }
  try {
    return await fn();
  } finally {
    if (held) await releaseLock(file);
  }
}
