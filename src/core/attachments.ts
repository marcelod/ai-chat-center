import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Readable } from 'node:stream';
import { assertSessionId, paths } from './paths.js';
import { DIR_MODE, FILE_MODE, ensureDir } from './fsAtomic.js';

/** Attachments older than this are deleted at the next cleanup (hub start, registration pruning). */
export const ATTACHMENT_MAX_AGE_MS = 30 * 86_400_000;
/** In UTF-8 bytes: with the 17-byte random prefix it stays well under the usual 255-byte file name limit. */
const NAME_MAX_BYTES = 200;
const EXT_MAX_BYTES = 20;

export class AttachmentTooLargeError extends Error {
  constructor() {
    super('attachment too large');
    this.name = 'AttachmentTooLargeError';
  }
}

export function sessionAttachmentsDir(sid: string): string {
  assertSessionId(sid);
  return path.join(paths().attachmentsDir, sid);
}

/**
 * A safe file name from what the browser sent: the base name only, without control characters, path
 * separators or leading dots, at most NAME_MAX_BYTES UTF-8 bytes (cut on whole code points) with the
 * extension kept. Never empty.
 */
export function sanitizeFileName(raw: string): string {
  const base = (raw.split(/[\\/]/).pop() ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[:*?"<>|]/g, '_')
    .trim()
    .replace(/^\.+/, '')
    .trim();
  if (!base) return 'file';
  if (Buffer.byteLength(base) <= NAME_MAX_BYTES) return base;
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 && Buffer.byteLength(base.slice(dot)) <= EXT_MAX_BYTES ? base.slice(dot) : '';
  return truncateUtf8(base.slice(0, base.length - ext.length), NAME_MAX_BYTES - Buffer.byteLength(ext)) + ext;
}

/** The longest prefix of `s` made of whole code points that fits in `max` UTF-8 bytes. */
function truncateUtf8(s: string, max: number): string {
  let out = '';
  let bytes = 0;
  for (const ch of s) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > max) break;
    out += ch;
    bytes += n;
  }
  return out;
}

/**
 * Stores an uploaded file as `<attachmentsDir>/<sid>/<16 hex>-<sanitized name>` (folders 0700, file 0600)
 * and returns its absolute path. Past `max` bytes the rest of the body is read and discarded (so the
 * client still gets the answer), the partial file is removed and AttachmentTooLargeError is thrown.
 */
export async function storeAttachment(sid: string, rawName: string, src: Readable, max: number): Promise<string> {
  const dir = sessionAttachmentsDir(sid);
  await ensureDir(dir);
  await fs.chmod(paths().attachmentsDir, DIR_MODE).catch(() => {});
  await fs.chmod(dir, DIR_MODE).catch(() => {});
  const file = path.join(dir, `${crypto.randomBytes(8).toString('hex')}-${sanitizeFileName(rawName)}`);
  const fh = await fs.open(file, 'wx', FILE_MODE);
  let ok = false;
  try {
    await new Promise<void>((resolve, reject) => {
      let size = 0;
      let tooBig = false;
      let failed: Error | null = null;
      let chain: Promise<void> = Promise.resolve();
      src.on('data', (c: Buffer) => {
        if (tooBig || failed) return;
        size += c.length;
        if (size > max) {
          tooBig = true;
          return;
        }
        src.pause();
        chain = chain
          .then(async () => {
            await fh.write(c);
          })
          .catch((e: Error) => {
            failed = e;
          })
          .finally(() => src.resume());
      });
      src.on('end', () => {
        void chain.then(() => (tooBig ? reject(new AttachmentTooLargeError()) : failed ? reject(failed) : resolve()));
      });
      src.on('error', reject);
    });
    ok = true;
  } finally {
    await fh.close().catch(() => {});
    if (!ok) await fs.rm(file, { force: true }).catch(() => {});
  }
  return file;
}

/**
 * Deletes the attachment folders of sessions not in `alive` (and anything that is not a session folder),
 * and attachment files last modified more than `maxAgeMs` before `now`. Best effort: never throws.
 */
export async function cleanupAttachments(alive: Set<string>, now = Date.now(), maxAgeMs = ATTACHMENT_MAX_AGE_MS): Promise<void> {
  const root = paths().attachmentsDir;
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return;
  }
  for (const name of entries) {
    const dir = path.join(root, name);
    let valid = true;
    try {
      assertSessionId(name);
    } catch {
      valid = false;
    }
    if (!valid || !alive.has(name)) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      continue;
    }
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      const file = path.join(dir, f);
      try {
        const st = await fs.lstat(file);
        if (now - st.mtimeMs > maxAgeMs) await fs.rm(file, { recursive: true, force: true });
      } catch {
        /* gone already */
      }
    }
  }
}
