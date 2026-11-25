// The folder browser of the "+" dialog (spec 2026-11-25-any-folder): the subfolders of a folder inside the
// user's home folder, and the check a new session's folder must pass. Everything is decided on real paths
// (fs.realpath), so a link never leads out of the home folder. Errors never carry a path.
import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type FolderErrorCode = 'invalid' | 'outside' | 'not-found' | 'denied';
const MESSAGES: Record<FolderErrorCode, string> = {
  invalid: 'invalid folder path',
  outside: 'folder outside the home folder',
  'not-found': 'no such folder',
  denied: 'permission denied',
};
export class FolderError extends Error {
  constructor(public code: FolderErrorCode) {
    super(MESSAGES[code]);
    this.name = 'FolderError';
  }
}

export const MAX_ENTRIES = 500;
export const MAX_PATH = 4096;

export type FolderEntry = { name: string; path: string };
export type FolderListing = { path: string; parent: string | null; entries: FolderEntry[]; truncated: boolean };

/** Whether `p` is `root` or inside it, by path segments (`/home/ana2` is not inside `/home/ana`). */
export function isInside(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

const errCode = (e: unknown) => (e as NodeJS.ErrnoException | null)?.code;

type Home = { given: string; real: string };
async function realHome(home: string): Promise<Home> {
  try {
    return { given: path.resolve(home), real: await fs.realpath(home) };
  } catch {
    throw new FolderError('not-found');
  }
}

async function assertAncestorInside(given: string, home: Home): Promise<void> {
  let dir = path.dirname(given);
  for (;;) {
    try {
      const real = await fs.realpath(dir);
      if (!isInside(home.real, real)) throw new FolderError('outside');
      return;
    } catch (e) {
      if (e instanceof FolderError) throw e;
      const parent = path.dirname(dir);
      if (parent === dir) return;
      dir = parent;
    }
  }
}

/** The real path of `p`, a folder inside the real home folder. */
async function resolveIn(p: unknown, home: Home): Promise<string> {
  if (typeof p !== 'string' || !p || p.length > MAX_PATH || p.includes('\0') || !path.isAbsolute(p)) throw new FolderError('invalid');
  // A first check on the path as given, so nothing outside the home folder is even looked at (the answer
  // must not tell whether a path out there exists).
  const given = path.resolve(p);
  if (!isInside(home.given, given) && !isInside(home.real, given)) throw new FolderError('outside');
  let real: string;
  try {
    real = await fs.realpath(given);
  } catch (e) {
    if (errCode(e) === 'EACCES' || errCode(e) === 'EPERM') throw new FolderError('denied');
    // Missing: the answer must not tell whether something exists beyond a link that leaves the home
    // folder (`~/x -> /`), so the deepest ancestor that does exist is resolved and judged first.
    if (errCode(e) === 'ENOENT' || errCode(e) === 'ENOTDIR') await assertAncestorInside(given, home);
    throw new FolderError('not-found');
  }
  if (!isInside(home.real, real)) throw new FolderError('outside');
  try {
    if (!(await fs.stat(real)).isDirectory()) throw new FolderError('not-found');
  } catch (e) {
    if (e instanceof FolderError) throw e;
    throw new FolderError(errCode(e) === 'EACCES' ? 'denied' : 'not-found');
  }
  return real;
}

/** The real path of a folder inside the home folder, for a new session. Rejects with FolderError. */
export async function resolveHomeFolder(p: unknown, home: string = os.homedir()): Promise<string> {
  return resolveIn(p, await realHome(home));
}

const byName = (a: FolderEntry, b: FolderEntry) => {
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
};

/**
 * The subfolders of `p` (default: the home folder), sorted by name, at most `limit`. Hidden folders (`.x`)
 * only with `hidden`. A link is listed only when it leads to a folder inside the home folder.
 */
export async function browseFolder(
  p: string | undefined,
  opts: { home?: string; hidden?: boolean; limit?: number } = {},
): Promise<FolderListing> {
  const home = await realHome(opts.home ?? os.homedir());
  const homeReal = home.real;
  const dir = p === undefined ? homeReal : await resolveIn(p, home);
  let dirents: Dirent[];
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    throw new FolderError(errCode(e) === 'EACCES' || errCode(e) === 'EPERM' ? 'denied' : 'not-found');
  }
  const entries: FolderEntry[] = [];
  for (const d of dirents) {
    if (!opts.hidden && d.name.startsWith('.')) continue;
    const full = path.join(dir, d.name);
    if (d.isDirectory()) entries.push({ name: d.name, path: full });
    else if (d.isSymbolicLink()) {
      try {
        const target = await fs.realpath(full);
        if (isInside(homeReal, target) && (await fs.stat(target)).isDirectory()) entries.push({ name: d.name, path: full });
      } catch {
        /* a broken or unreadable link: left out */
      }
    }
  }
  entries.sort(byName);
  const limit = opts.limit ?? MAX_ENTRIES;
  return {
    path: dir,
    parent: dir === homeReal ? null : path.dirname(dir),
    entries: entries.slice(0, limit),
    truncated: entries.length > limit,
  };
}
