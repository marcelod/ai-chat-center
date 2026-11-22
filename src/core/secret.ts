import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { paths } from './paths.js';
import { ensureDir, FILE_MODE, withFsRetry } from './fsAtomic.js';
import type { InboxMessage } from './inbox.js';

// Per-install secret (64 hex, 0600, created once). The hub signs every inbox message with it and the
// waiter delivers only messages whose signature checks out, so a file merely written into inbox/<sid>/
// (by another program, or by an action Claude was tricked into) is not a message from the app. It is not
// the token: the token rotates on every hub start, and a queued message must survive that.
//
// The secret is replaced ONLY when the file is missing or its content is malformed, never when it cannot
// be read for a moment (antivirus or an indexer holding it on Windows: EBUSY, EPERM, EACCES): messages
// queued under it could then never be delivered (audit S4-S2).

const SECRET_RE = /^[0-9a-f]{64}$/;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type SecretRead = { ok: true; secret: string } | { ok: false; reason: 'missing' | 'malformed' | 'unreadable' };

/** One read of the secret file. */
async function readOnce(): Promise<SecretRead> {
  try {
    const s = (await fs.readFile(paths().secret, 'utf8')).trim();
    return SECRET_RE.test(s) ? { ok: true, secret: s } : { ok: false, reason: 'malformed' };
  } catch (e) {
    return { ok: false, reason: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable' };
  }
}

/**
 * Reads the secret, retrying a failed read (`tries` times, `delayMs` apart: 5 over about 1 s by default).
 * Never creates or replaces anything. The waiter calls it before claiming any message.
 */
export async function loadSecret(opts: { tries?: number; delayMs?: number } = {}): Promise<SecretRead> {
  const tries = opts.tries ?? 5;
  const delayMs = opts.delayMs ?? 250;
  let r: SecretRead = { ok: false, reason: 'unreadable' };
  for (let i = 0; i < tries; i++) {
    r = await readOnce();
    if (r.ok || r.reason === 'missing') return r;
    if (i < tries - 1) await sleep(delayMs);
  }
  return r;
}

/**
 * The install secret, created on first use. Concurrent first calls agree on one value. A secret that
 * cannot be read is never replaced: this throws (the hub's send then fails, and the app offers a retry).
 */
export async function installSecret(): Promise<string> {
  const have = await loadSecret({ tries: 5, delayMs: 40 });
  if (have.ok) return have.secret;
  if (have.reason === 'unreadable') throw new Error('the install secret cannot be read right now');
  const file = paths().secret;
  await ensureDir(paths().home);
  const fresh = crypto.randomBytes(32).toString('hex');
  if (have.reason === 'missing') {
    try {
      // O_EXCL: of concurrent creators exactly one wins; the others read its value.
      await fs.writeFile(file, fresh, { flag: 'wx', mode: FILE_MODE });
      return fresh;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    for (let i = 0; i < 20; i++) {
      const s = await readOnce();
      if (s.ok) return s.secret;
      if (s.reason === 'unreadable') throw new Error('the install secret cannot be read right now');
      await sleep(10); // the winner may not have written its value yet
    }
  }
  // Malformed (or still empty well after its creator's write): replace it. Messages signed with the old
  // value can no longer be delivered (they are kept aside as unsigned).
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, fresh, { mode: FILE_MODE });
  await withFsRetry(() => fs.rename(tmp, file));
  const after = await readOnce();
  return after.ok ? after.secret : fresh;
}

/** v2: the session, the id, the creation time and the text. No field but the last may contain `|`. */
const mac = (secret: string, sid: string, m: { id: string; createdAt: string; text: string }) =>
  crypto.createHmac('sha256', secret).update(`v2|${sid}|${m.id}|${m.createdAt}|${m.text}`).digest('hex');

const separatorFree = (m: { id: unknown; createdAt: unknown }) =>
  typeof m.id === 'string' && typeof m.createdAt === 'string' && !m.id.includes('|') && !m.createdAt.includes('|');

/** Adds `sig = HMAC-SHA256(install secret, v2|sid|id|createdAt|text)` for the inbox of session `sid`. */
export async function signMessage(sid: string, m: InboxMessage): Promise<InboxMessage> {
  if (!separatorFree(m) || sid.includes('|')) throw new Error('invalid message id or time');
  return { ...m, sig: mac(await installSecret(), sid, m) };
}

/** True only for a message signed with `secret` for the inbox of session `sid`. */
export function verifyMessage(m: InboxMessage, sid: string, secret: string): boolean {
  if (!m || typeof m.text !== 'string' || typeof m.sig !== 'string' || !separatorFree(m)) return false;
  const want = Buffer.from(mac(secret, sid, m));
  const got = Buffer.from(m.sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
