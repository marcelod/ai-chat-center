import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureDir } from './fsAtomic.js';

const EMPTY_GRACE_MS = 10_000;

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

/** Publish the lock atomically: write the pid to a unique tmp file, then link() it
 *  (fails with EEXIST if held). The lock file is never observable empty. */
async function publish(file: string): Promise<boolean> {
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, String(process.pid), { flag: 'wx' });
    await fs.link(tmp, file);
    return true;
  } catch (e) {
    if (['EEXIST', 'EPERM', 'EBUSY'].includes(code(e) ?? '')) return false;
    throw e;
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

/** Returns the raw content if the lock is stale (dead holder, or empty/unreadable and older than grace), else null. */
async function staleContent(file: string): Promise<string | null> {
  let content: string;
  try {
    content = await fs.readFile(file, 'utf8');
  } catch (e) {
    if (code(e) === 'ENOENT') return null; // gone; caller's retry handles it
    content = '';
  }
  const pid = parseInt(content, 10);
  if (Number.isInteger(pid) && pid > 0) return isAlive(pid) ? null : content;
  try {
    const st = await fs.stat(file);
    return Date.now() - st.mtimeMs > EMPTY_GRACE_MS ? content : null;
  } catch {
    return null;
  }
}

const GUARD_STALE_MS = 10_000;
const contention = (e: unknown) => ['EEXIST', 'EPERM', 'EBUSY'].includes(code(e) ?? '');

/**
 * Reclaim a stale lock under a guard file. The lock file itself is never renamed or moved:
 * it is only unlinked after being re-verified, while holding the guard, to still be the
 * exact stale content `seen`. Exported for tests.
 */
export async function reclaimStaleLock(file: string, seen: string): Promise<boolean> {
  const guard = `${file}.reclaim`;
  if (!(await publish(guard))) {
    try {
      const st = await fs.stat(guard);
      if (Date.now() - st.mtimeMs > GUARD_STALE_MS) await fs.rm(guard, { force: true });
    } catch {
      /* ignore */
    }
    return false;
  }
  try {
    if ((await staleContent(file)) !== seen) return false;
    try {
      await fs.unlink(file);
    } catch (e) {
      if (code(e) !== 'ENOENT') {
        if (contention(e)) return false;
        throw e;
      }
    }
    return await publish(file);
  } finally {
    try {
      if ((await fs.readFile(guard, 'utf8')) === String(process.pid)) await fs.rm(guard, { force: true });
    } catch {
      /* ignore */
    }
  }
}

export async function acquireLock(file: string): Promise<boolean> {
  await ensureDir(path.dirname(file));
  if (await publish(file)) return true;
  const seen = await staleContent(file);
  if (seen === null) return false;
  return reclaimStaleLock(file, seen);
}

export async function releaseLock(file: string): Promise<void> {
  await fs.rm(file, { force: true });
}
