import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths } from './paths.js';
import { ensureDir, FILE_MODE, withFsRetry } from './fsAtomic.js';

export type InboxMessage = { id: string; text: string; createdAt: string };

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
  const msg: InboxMessage = { id: crypto.randomUUID(), text, createdAt: new Date(now).toISOString() };
  counter = (counter + 1) % 1_000_000;
  const name = `${String(now).padStart(15, '0')}-${String(counter).padStart(6, '0')}-${msg.id}.msg`;
  const tmp = path.join(dir, `.${msg.id}.tmp`); // never ends in .msg
  try {
    await fs.writeFile(tmp, JSON.stringify(msg), { encoding: 'utf8', mode: FILE_MODE });
    await fs.rename(tmp, path.join(dir, name));
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

/**
 * Takes every queued message, in name order. Each file is first CLAIMED with an atomic rename to a
 * unique name; only the drain whose rename succeeds reads, deletes and returns it. A failed rename
 * (ENOENT, or EPERM/EBUSY on Windows) means another drain claimed it. Plain read-then-unlink let two
 * drains both read a file before either deleted it (double delivery on macOS and Windows).
 */
export async function drain(sid: string): Promise<InboxMessage[]> {
  const out: InboxMessage[] = [];
  for (const f of await list(sid)) {
    const claimed = `${f}.claimed-${crypto.randomUUID()}`;
    try {
      await fs.rename(f, claimed);
    } catch (e) {
      if (isRace(e)) continue; // someone else took it
      throw e;
    }
    let m: InboxMessage | null = null;
    try {
      m = JSON.parse(await fs.readFile(claimed, 'utf8')) as InboxMessage;
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e; // a malformed message is dropped, not re-read forever
    }
    await withFsRetry(() => fs.rm(claimed, { force: true }));
    if (m) out.push(m);
  }
  return out;
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
    if (!n.endsWith('.msg') && !n.endsWith('.tmp') && !n.includes('.msg.claimed-')) continue;
    try {
      await withFsRetry(() => fs.rm(path.join(dir, n), { force: true }));
    } catch (e) {
      if (!isRace(e)) throw e;
    }
  }
}
