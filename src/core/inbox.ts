import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths } from './paths.js';
import { ensureDir, FILE_MODE, withFsRetry } from './fsAtomic.js';
import { signMessage } from './secret.js';

/** `sig`: HMAC by the hub (secret.ts); the waiter delivers only messages whose signature checks out. */
export type InboxMessage = { id: string; text: string; createdAt: string; sig?: string };

// File name: <epochMs zero-padded to 15>-<counter zero-padded to 6>-<uuid>.msg.
// Lexical order == time order; the in-process counter breaks ties within the same ms
// (the uuid is only for uniqueness across processes).
let counter = 0;

// ENOENT: already taken by another drain. EPERM/EBUSY: Windows races on a file being deleted/opened.
const isRace = (e: unknown) => ['ENOENT', 'EPERM', 'EBUSY'].includes((e as NodeJS.ErrnoException).code ?? '');

export async function enqueue(sid: string, text: string): Promise<InboxMessage> {
  const dir = paths().inboxDir(sid);
  await ensureDir(dir);
  const now = Date.now();
  const msg = await signMessage({ id: crypto.randomUUID(), text, createdAt: new Date(now).toISOString() });
  counter = (counter + 1) % 1_000_000;
  const name = `${String(now).padStart(15, '0')}-${String(counter).padStart(6, '0')}-${msg.id}.msg`;
  const tmp = path.join(dir, `.${msg.id}.tmp`); // never ends in .msg
  try {
    await fs.writeFile(tmp, JSON.stringify(msg), { encoding: 'utf8', mode: FILE_MODE });
    await withFsRetry(() => fs.rename(tmp, path.join(dir, name)));
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
  return msg;
}

async function list(sid: string): Promise<string[]> {
  const dir = paths().inboxDir(sid);
  try {
    return (await fs.readdir(dir)).filter((n) => n.endsWith('.msg')).sort().map((n) => path.join(dir, n));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

async function readMsg(file: string): Promise<InboxMessage | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as InboxMessage;
  } catch (e) {
    if (isRace(e)) return null;
    if (e instanceof SyntaxError) return null;
    throw e;
  }
}

export async function peek(sid: string): Promise<InboxMessage[]> {
  const out: InboxMessage[] = [];
  for (const f of await list(sid)) {
    const m = await readMsg(f);
    if (m) out.push(m);
  }
  return out;
}

const READ_RETRIES = 3;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Claimed files are named `<name>.msg.claimed-<claim epoch ms>-<uuid>`. */
const CLAIMED_RE = /\.msg\.claimed-(?:(\d{13,})-)?/;

/** Reads a claimed message, retrying a failed read 3 times. 'malformed' for bad JSON, 'unreadable' if every try failed. */
async function readClaimed(file: string): Promise<InboxMessage | 'malformed' | 'unreadable'> {
  for (let attempt = 0; ; attempt++) {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8')) as InboxMessage;
    } catch (e) {
      if (e instanceof SyntaxError) return 'malformed';
      if (attempt >= READ_RETRIES) return 'unreadable';
      await sleep(20 + Math.floor(Math.random() * 31));
    }
  }
}

/** Suffix of the exclusive claim marker of a queued `<name>.msg`. */
const CLAIM_MARK = '.claim';
/** A drain holds a claim marker for one rename (milliseconds): one older than this was left behind. */
const MARKER_STALE_MS = 60_000;

/** A marker that cannot be removed is swept later (sweepClaimed); until then it only delays that message. */
async function removeMarker(marker: string): Promise<void> {
  try {
    await withFsRetry(() => fs.rm(marker, { force: true }));
  } catch {
    /* swept later */
  }
}

/**
 * Takes every queued message, in name order. Each file is first CLAIMED with an atomic rename to a
 * unique name; only the drain whose rename succeeds reads, deletes and returns it. A failed rename
 * (ENOENT, or EPERM/EBUSY on Windows) means another drain claimed it. Plain read-then-unlink let two
 * drains both read a file before either deleted it (double delivery on macOS and Windows).
 *
 * Once claimed and read, a message IS returned: deleting the claimed file is best effort (a leftover is
 * never listed again, and sweepClaimed removes it later). A claimed file that cannot be read after 3
 * retries is renamed back to its .msg name for the next pass; it is never dropped silently. A malformed
 * message is dropped (it would fail forever).
 */
export async function drain(sid: string): Promise<InboxMessage[]> {
  const out: InboxMessage[] = [];
  for (const f of await list(sid)) {
    const claimed = `${f}.claimed-${Date.now()}-${crypto.randomUUID()}`;
    // Exclusive marker first (O_EXCL is atomic everywhere): Windows renames through an open handle, so two
    // drains renaming the same file could both succeed (the second moving the first one's claimed file)
    // and both read it. Only the marker's holder renames.
    const marker = `${f}${CLAIM_MARK}`;
    try {
      await fs.writeFile(marker, '', { flag: 'wx', mode: FILE_MODE });
    } catch (e) {
      if (isRace(e) || ['EEXIST', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')) continue; // held
      if (out.length > 0) break;
      throw e;
    }
    try {
      // Transient EPERM/EBUSY/EACCES (antivirus) is retried; ENOENT still means another drain took it.
      await withFsRetry(() => fs.rename(f, claimed));
    } catch (e) {
      await removeMarker(marker);
      if (isRace(e)) continue; // someone else took it
      if (out.length > 0) break; // deliver what is already claimed; the rest waits for the next pass
      throw e;
    }
    await removeMarker(marker);
    const m = await readClaimed(claimed);
    if (m === 'unreadable') {
      try {
        await withFsRetry(() => fs.rename(claimed, f));
      } catch {
        /* still claimed: sweepClaimed is the last resort */
      }
      continue;
    }
    if (m !== 'malformed') out.push(m);
    try {
      await withFsRetry(() => fs.rm(claimed, { force: true }));
    } catch {
      /* delivered anyway; sweepClaimed removes the leftover */
    }
  }
  return out;
}

/**
 * Removes claim markers older than a minute (or maxAgeMs if shorter), never the message they guarded.
 * Deletes claimed files older than `maxAgeMs` (by the claim time in their name, else their mtime): left
 * behind by a drain that delivered them but could not delete them. Call it only while holding the
 * session's waiter lock. Returns how many were removed.
 */
export async function sweepClaimed(sid: string, maxAgeMs: number): Promise<number> {
  const dir = paths().inboxDir(sid);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  const now = Date.now();
  for (const n of names) {
    if (n.endsWith(`.msg${CLAIM_MARK}`)) {
      // A claim marker left behind (its holder died, or could not delete it): remove the marker only.
      // The message, if still queued, becomes claimable again.
      try {
        if (now - (await fs.stat(path.join(dir, n))).mtimeMs <= Math.min(maxAgeMs, MARKER_STALE_MS)) continue;
        await withFsRetry(() => fs.rm(path.join(dir, n), { force: true }));
        removed++;
      } catch {
        /* next time */
      }
      continue;
    }
    const m = CLAIMED_RE.exec(n);
    if (!m) continue;
    const file = path.join(dir, n);
    try {
      const at = m[1] ? Number(m[1]) : (await fs.stat(file)).mtimeMs;
      if (now - at <= maxAgeMs) continue;
      await withFsRetry(() => fs.rm(file, { force: true }));
      removed++;
    } catch {
      /* gone, or still held: next time */
    }
  }
  return removed;
}

/** Deletes every queued message (and stray temp file) of a session. Used when it disconnects or reconnects. */
export async function clearInbox(sid: string): Promise<void> {
  const dir = paths().inboxDir(sid);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }
  for (const n of names) {
    if (!n.endsWith('.msg') && !n.endsWith('.tmp') && !n.includes('.msg.claimed-') && !n.endsWith(`.msg${CLAIM_MARK}`)) continue;
    try {
      await withFsRetry(() => fs.rm(path.join(dir, n), { force: true }));
    } catch (e) {
      if (!isRace(e)) throw e;
    }
  }
}
