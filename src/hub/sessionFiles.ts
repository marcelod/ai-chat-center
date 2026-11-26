// Files the side panel shows (spec 2026-11-26-side-panel): Markdown and images cited in a conversation, read
// only from the session folder and the session's attachments folder. Every check is made on real paths
// (fs.realpath), so a link never leads out of those folders; the type comes from the name and, for images,
// is confirmed by the bytes. Errors never carry a path.
import fs from 'node:fs/promises';
import path from 'node:path';
import { isInside } from './folderBrowse.js';
import { sniffImage } from '../core/background.js';

export const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PATH = 4096;
/** Most paths one existence check answers. */
export const MAX_EXISTS = 200;

type FileType = { kind: 'markdown' | 'image'; type: string; max: number; image?: string };
const FILE_TYPES: Record<string, FileType> = {
  '.md': { kind: 'markdown', type: 'text/markdown; charset=utf-8', max: MAX_MARKDOWN_BYTES },
  '.markdown': { kind: 'markdown', type: 'text/markdown; charset=utf-8', max: MAX_MARKDOWN_BYTES },
  '.png': { kind: 'image', type: 'image/png', max: MAX_IMAGE_BYTES, image: 'png' },
  '.jpg': { kind: 'image', type: 'image/jpeg', max: MAX_IMAGE_BYTES, image: 'jpg' },
  '.jpeg': { kind: 'image', type: 'image/jpeg', max: MAX_IMAGE_BYTES, image: 'jpg' },
  '.gif': { kind: 'image', type: 'image/gif', max: MAX_IMAGE_BYTES, image: 'gif' },
  '.webp': { kind: 'image', type: 'image/webp', max: MAX_IMAGE_BYTES, image: 'webp' },
};

export type SessionFileErrorCode = 'invalid' | 'type' | 'outside' | 'not-found' | 'too-large' | 'denied';
const MESSAGES: Record<SessionFileErrorCode, string> = {
  invalid: 'invalid file path',
  type: 'file type not supported',
  outside: 'file outside the session folder',
  'not-found': 'no such file',
  'too-large': 'file too large',
  denied: 'permission denied',
};
export class SessionFileError extends Error {
  constructor(public code: SessionFileErrorCode) {
    super(MESSAGES[code]);
    this.name = 'SessionFileError';
  }
}

/** `base`: the folder a relative path is taken from (the session folder); `roots`: the folders files may be in. */
export type FileRoots = { base: string; roots: string[] };
export type SessionFile = { data: Buffer; type: string; kind: FileType['kind'] };

const errCode = (e: unknown) => (e as NodeJS.ErrnoException | null)?.code;
const typeOf = (p: string): FileType | undefined => FILE_TYPES[path.extname(p).toLowerCase()];

type Root = { given: string; real: string };
async function realRoots(r: FileRoots): Promise<Root[]> {
  const out: Root[] = [];
  for (const g of r.roots) {
    try {
      out.push({ given: path.resolve(g), real: await fs.realpath(g) });
    } catch {
      /* a folder that does not exist holds no file */
    }
  }
  return out;
}

const insideAny = (roots: Root[], p: string, which: 'given' | 'real' | 'both') =>
  roots.some((r) => (which !== 'real' && isInside(r.given, p)) || (which !== 'given' && isInside(r.real, p)));

/** Like folderBrowse: a missing file is judged by the deepest ancestor that exists, so a link out is never probed. */
async function assertAncestorInside(given: string, roots: Root[]): Promise<void> {
  let dir = path.dirname(given);
  for (;;) {
    try {
      const real = await fs.realpath(dir);
      if (!insideAny(roots, real, 'real')) throw new SessionFileError('outside');
      return;
    } catch (e) {
      if (e instanceof SessionFileError) throw e;
      const parent = path.dirname(dir);
      if (parent === dir) return;
      dir = parent;
    }
  }
}

async function resolve(p: unknown, r: FileRoots, roots: Root[]): Promise<{ real: string; ft: FileType; size: number }> {
  if (typeof p !== 'string' || !p || p.length > MAX_PATH || p.includes('\0')) throw new SessionFileError('invalid');
  const given = path.resolve(r.base, p);
  const ft = typeOf(given);
  if (!ft) throw new SessionFileError('type');
  // Nothing outside the folders is even looked at (the answer must not tell whether it exists).
  if (!insideAny(roots, given, 'both')) throw new SessionFileError('outside');
  let real: string;
  try {
    real = await fs.realpath(given);
  } catch (e) {
    if (errCode(e) === 'EACCES' || errCode(e) === 'EPERM') throw new SessionFileError('denied');
    await assertAncestorInside(given, roots);
    throw new SessionFileError('not-found');
  }
  if (!insideAny(roots, real, 'real')) throw new SessionFileError('outside');
  // A link named `x.md` that points to `.env` is still a `.env`.
  if (typeOf(real) !== ft) throw new SessionFileError('type');
  let size: number;
  try {
    const st = await fs.stat(real);
    if (!st.isFile()) throw new SessionFileError('not-found');
    size = st.size;
  } catch (e) {
    if (e instanceof SessionFileError) throw e;
    throw new SessionFileError(errCode(e) === 'EACCES' ? 'denied' : 'not-found');
  }
  if (size > ft.max) throw new SessionFileError('too-large');
  return { real, ft, size };
}

/** Reads at most `max` bytes; a file that grew past it since the stat is refused. */
async function readCapped(file: string, max: number): Promise<Buffer> {
  const fh = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(max + 1);
    let n = 0;
    for (;;) {
      const { bytesRead } = await fh.read(buf, n, buf.length - n, n);
      if (bytesRead === 0) break;
      n += bytesRead;
      if (n > max) throw new SessionFileError('too-large');
    }
    return buf.subarray(0, n);
  } finally {
    await fh.close();
  }
}

/** A Markdown file or an image of the session. Rejects with SessionFileError. */
export async function readSessionFile(p: unknown, r: FileRoots): Promise<SessionFile> {
  const { real, ft } = await resolve(p, r, await realRoots(r));
  let data: Buffer;
  try {
    data = await readCapped(real, ft.max);
  } catch (e) {
    if (e instanceof SessionFileError) throw e;
    throw new SessionFileError(errCode(e) === 'EACCES' ? 'denied' : 'not-found');
  }
  if (ft.image && sniffImage(data) !== ft.image) throw new SessionFileError('type');
  return { data, type: ft.type, kind: ft.kind };
}

/**
 * The paths among `ps` (at most MAX_EXISTS, duplicates once) that the panel could open: files of a known
 * type inside the folders, within the size limit. The app turns only these into links.
 */
export async function existingSessionFiles(ps: unknown, r: FileRoots): Promise<string[]> {
  if (!Array.isArray(ps)) return [];
  const roots = await realRoots(r);
  const asked = [...new Set(ps.slice(0, MAX_EXISTS).filter((p): p is string => typeof p === 'string'))];
  const out: string[] = [];
  for (const p of asked) {
    try {
      await resolve(p, r, roots);
      out.push(p);
    } catch {
      /* not a file the panel can show */
    }
  }
  return out;
}
