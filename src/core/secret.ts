import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { paths } from './paths.js';
import { ensureDir, FILE_MODE, withFsRetry } from './fsAtomic.js';
import type { InboxMessage } from './inbox.js';

// Per-install secret (64 hex, 0600, created once). The hub signs every inbox message with it and the
// waiter delivers only messages whose signature checks out, so a file merely written into inbox/<sid>/
// (by another program, or by an action Claude was tricked into) is not a message from the app. It is not
// the token: the token rotates on every hub start, and a queued message must survive that.

const SECRET_RE = /^[0-9a-f]{64}$/;

async function readSecret(): Promise<string | null> {
  try {
    const s = (await fs.readFile(paths().secret, 'utf8')).trim();
    return SECRET_RE.test(s) ? s : null;
  } catch {
    return null;
  }
}

/** The install secret, created on first use. Concurrent first calls agree on one value. */
export async function installSecret(): Promise<string> {
  const have = await readSecret();
  if (have) return have;
  const file = paths().secret;
  await ensureDir(paths().home);
  const fresh = crypto.randomBytes(32).toString('hex');
  try {
    // O_EXCL: of concurrent creators exactly one wins; the others read its value.
    await fs.writeFile(file, fresh, { flag: 'wx', mode: FILE_MODE });
    return fresh;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  for (let i = 0; i < 20; i++) {
    const s = await readSecret();
    if (s) return s;
    await new Promise((r) => setTimeout(r, 10)); // the winner may not have written its value yet
  }
  // Unreadable or corrupt: replace it (messages signed with the old value can no longer be delivered).
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, fresh, { mode: FILE_MODE });
  await withFsRetry(() => fs.rename(tmp, file));
  return (await readSecret()) ?? fresh;
}

const mac = (secret: string, id: string, text: string) => crypto.createHmac('sha256', secret).update(`${id}|${text}`).digest('hex');

/** Adds `sig = HMAC-SHA256(install secret, id|text)`. Ids never contain the separator. */
export async function signMessage(m: InboxMessage): Promise<InboxMessage> {
  if (m.id.includes('|')) throw new Error('invalid message id');
  return { ...m, sig: mac(await installSecret(), m.id, m.text) };
}

/** True only for a message signed with this install's secret. */
export async function verifyMessage(m: InboxMessage): Promise<boolean> {
  if (typeof m?.id !== 'string' || typeof m.text !== 'string' || typeof m.sig !== 'string' || m.id.includes('|')) return false;
  const secret = await readSecret();
  if (!secret) return false;
  const want = Buffer.from(mac(secret, m.id, m.text));
  const got = Buffer.from(m.sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
