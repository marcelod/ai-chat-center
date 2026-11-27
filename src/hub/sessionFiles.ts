// Files the side panel shows (specs 2026-11-26-side-panel and 2026-11-27-side-panel-file-types): Markdown,
// images, code and plain text, and PDFs cited in a conversation, read
// only from the session folder and the session's attachments folder. Every check is made on real paths
// (fs.realpath), so a link never leads out of those folders; the type comes from the name and, for images,
// is confirmed by the bytes (images, PDFs; a text file must not be binary). Errors never carry a path.
import fs from 'node:fs/promises';
import path from 'node:path';
import { isInside } from './folderBrowse.js';
import { sniffImage } from '../core/background.js';
import { panelFileKind, type PanelFileKind } from '../shared/fileTypes.js';

export const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_BYTES = 1024 * 1024;
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
/** How much of a text file is looked at for a NUL byte (a binary file named `.ts` is refused). */
const BINARY_SNIFF = 8000;
const MAX_PATH = 4096;
/** Most paths one existence check answers. */
export const MAX_EXISTS = 200;

type FileType = { kind: PanelFileKind; type: string; max: number; image?: string };
const MARKDOWN: FileType = { kind: 'markdown', type: 'text/markdown; charset=utf-8', max: MAX_MARKDOWN_BYTES };
const TEXT: FileType = { kind: 'text', type: 'text/plain; charset=utf-8', max: MAX_TEXT_BYTES };
const PDF: FileType = { kind: 'pdf', type: 'application/pdf', max: MAX_PDF_BYTES };
const IMAGES: Record<string, FileType> = {
  '.png': { kind: 'image', type: 'image/png', max: MAX_IMAGE_BYTES, image: 'png' },
  '.jpg': { kind: 'image', type: 'image/jpeg', max: MAX_IMAGE_BYTES, image: 'jpg' },
  '.jpeg': { kind: 'image', type: 'image/jpeg', max: MAX_IMAGE_BYTES, image: 'jpg' },
  '.gif': { kind: 'image', type: 'image/gif', max: MAX_IMAGE_BYTES, image: 'gif' },
  '.webp': { kind: 'image', type: 'image/webp', max: MAX_IMAGE_BYTES, image: 'webp' },
};

export type SessionFileErrorCode = 'invalid' | 'type' | 'outside' | 'not-found' | 'too-large' | 'denied' | 'private';
const MESSAGES: Record<SessionFileErrorCode, string> = {
  invalid: 'invalid file path',
  type: 'file type not supported',
  outside: 'file outside the session folder',
  'not-found': 'no such file',
  'too-large': 'file too large',
  denied: 'permission denied',
  private: 'private file',
};
export class SessionFileError extends Error {
  constructor(public code: SessionFileErrorCode) {
    super(MESSAGES[code]);
    this.name = 'SessionFileError';
  }
}

/**
 * `base`: the folder a relative path is taken from (the session folder); `roots`: the folders files may be in.
 * `home`: the user's home, whose dot folders and dot files are never shown (a session may run in `~`);
 * `open`: folders exempt from the private-file rules (the app's own attachments).
 */
export type FileRoots = { base: string; roots: string[]; home?: string; open?: string[] };
export type SessionFile = { data: Buffer; type: string; kind: FileType['kind'] };

const errCode = (e: unknown) => (e as NodeJS.ErrnoException | null)?.code;
function typeOf(p: string): FileType | undefined {
  const ext = path.extname(p).toLowerCase();
  switch (ext && panelFileKind(ext)) {
    case 'markdown':
      return MARKDOWN;
    case 'text':
      return TEXT;
    case 'pdf':
      return PDF;
    case 'image':
      return IMAGES[ext];
    default:
      return undefined;
  }
}

const isPdf = (b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-';

type Root = { given: string; real: string };
async function realRoots(folders: string[]): Promise<Root[]> {
  const out: Root[] = [];
  for (const g of folders) {
    try {
      out.push({ given: path.resolve(g), real: await fs.realpath(g) });
    } catch {
      /* a folder that does not exist holds no file */
    }
  }
  return out;
}

/**
 * Names that hold secrets wherever they are: `.env*`, keys and certificates, SSH keys, credentials files,
 * and the dot files with tokens of npm, pip and netrc.
 */
const SECRET_NAME = /^\.env(?:\.|$)|\.(?:pem|key)(?:\.|$)|^id_(?:rsa|dsa|ecdsa|ed25519)|credentials|^\.(?:netrc|npmrc|pypirc)(?:\.|$)/i;

/**
 * A file the panel never shows: anything in a dot folder right in the home (`~/.ssh`, `~/.config`, `~/.claude`,
 * `~/.ai-chat-center`…), a dot file right in the home, or a file with a secret's name anywhere. `homes`: the
 * home as given and as real path.
 */
function isPrivate(p: string, homes: string[]): boolean {
  if (SECRET_NAME.test(path.basename(p))) return true;
  for (const h of homes) {
    if (!isInside(h, p)) continue;
    const first = path.relative(h, p).split(path.sep)[0];
    if (first.startsWith('.') && first !== '.' && first !== '..') return true;
  }
  return false;
}

type Ctx = { roots: Root[]; open: Root[]; homes: string[] };
async function context(r: FileRoots): Promise<Ctx> {
  const homes: string[] = [];
  if (r.home) {
    homes.push(path.resolve(r.home));
    try {
      homes.push(await fs.realpath(r.home));
    } catch {
      /* no home: only the given path */
    }
  }
  return { roots: await realRoots(r.roots), open: await realRoots(r.open ?? []), homes };
}

/** Refuses a private file (see isPrivate), unless it is in an `open` folder. */
function assertNotPrivate(p: string, ctx: Ctx, which: 'given' | 'real'): void {
  if (insideAny(ctx.open, p, which)) return;
  if (isPrivate(p, ctx.homes)) throw new SessionFileError('private');
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

async function resolve(p: unknown, r: FileRoots, ctx: Ctx): Promise<{ real: string; ft: FileType; size: number }> {
  const roots = ctx.roots;
  if (typeof p !== 'string' || !p || p.length > MAX_PATH || p.includes('\0')) throw new SessionFileError('invalid');
  const given = path.resolve(r.base, p);
  const ft = typeOf(given);
  if (!ft) throw new SessionFileError('type');
  // Nothing outside the folders is even looked at (the answer must not tell whether it exists).
  if (!insideAny(roots, given, 'both')) throw new SessionFileError('outside');
  assertNotPrivate(given, ctx, 'given');
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
  // A link to a private file is private.
  assertNotPrivate(real, ctx, 'real');
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

/**
 * Reads at most `max` bytes (the size seen by the stat, already within the type's limit). A file that grew
 * since (a log being written) is shown as it was at the stat, never refused; only the size seen is judged
 * against the limit.
 */
export async function readCapped(file: string, max: number): Promise<Buffer> {
  const fh = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(max);
    let n = 0;
    while (n < max) {
      const { bytesRead } = await fh.read(buf, n, max - n, n);
      if (bytesRead === 0) break;
      n += bytesRead;
    }
    return buf.subarray(0, n);
  } finally {
    await fh.close();
  }
}

/** A file of the session the panel shows (Markdown, image, text, PDF). Rejects with SessionFileError. */
export async function readSessionFile(p: unknown, r: FileRoots): Promise<SessionFile> {
  const { real, ft, size } = await resolve(p, r, await context(r));
  let data: Buffer;
  try {
    // Never more than the size seen (a 20 MB buffer for a small PDF is not allocated).
    data = await readCapped(real, Math.min(ft.max, size));
  } catch (e) {
    if (e instanceof SessionFileError) throw e;
    throw new SessionFileError(errCode(e) === 'EACCES' ? 'denied' : 'not-found');
  }
  if (ft.image && sniffImage(data) !== ft.image) throw new SessionFileError('type');
  if (ft === PDF && !isPdf(data)) throw new SessionFileError('type');
  if (ft === TEXT && data.subarray(0, BINARY_SNIFF).includes(0)) throw new SessionFileError('type');
  return { data, type: ft.type, kind: ft.kind };
}

/**
 * The paths among `ps` (at most MAX_EXISTS, duplicates once) that the panel could open: files of a known
 * type inside the folders, within the size limit. The app turns only these into links.
 */
export async function existingSessionFiles(ps: unknown, r: FileRoots): Promise<string[]> {
  if (!Array.isArray(ps)) return [];
  const ctx = await context(r);
  const asked = [...new Set(ps.slice(0, MAX_EXISTS).filter((p): p is string => typeof p === 'string'))];
  const out: string[] = [];
  for (const p of asked) {
    try {
      await resolve(p, r, ctx);
      out.push(p);
    } catch {
      /* not a file the panel can show */
    }
  }
  return out;
}
