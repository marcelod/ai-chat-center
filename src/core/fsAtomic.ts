import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/** State directories hold the token, keys and messages: owner-only (no effect on Windows ACLs). */
export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: DIR_MODE });
}

/** Windows: a file another process (the hub, an indexer, antivirus) has open cannot be renamed over or deleted for a moment. */
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RETRIES = 5;

/** Runs `op`, retrying up to 5 times with a 20–50 ms backoff on EPERM/EBUSY/EACCES. */
export async function withFsRetry<T>(op: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await op();
    } catch (e) {
      if (attempt >= RETRIES || !TRANSIENT.has((e as NodeJS.ErrnoException).code ?? '')) throw e;
      await new Promise((r) => setTimeout(r, 20 + Math.floor(Math.random() * 31)));
    }
  }
}

/** Deletes a file if present, with the transient-error retry. */
export function removeFile(file: string): Promise<void> {
  return withFsRetry(() => fs.rm(file, { force: true }));
}

export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  // Unique per call: two writes to the same file in the same millisecond must not share a tmp file.
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: FILE_MODE });
    await withFsRetry(() => fs.rename(tmp, file));
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}
