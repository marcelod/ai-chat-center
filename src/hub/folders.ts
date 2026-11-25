// The folders the app offers for a new session (spec 2026-11-25-app-batch, item "nova sessão"): the folders
// of the sessions the user already ran, connected to the app or listed by `claude agents`. Only these may be
// used: the app never starts Claude Code in a folder the user did not work in.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Registration } from '../core/registry.js';
import type { LiveSession } from '../shared/types.js';

export type Folder = { cwd: string; lastUsed: string };
export const MAX_FOLDERS = 50;

const isDir = async (p: string) => {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
};

/** Known folders, most recently used first, only those that still exist. */
export async function knownFolders(regs: Registration[], live: LiveSession[] | null, exists: (p: string) => Promise<boolean> = isDir): Promise<Folder[]> {
  const seen = new Map<string, string>();
  const add = (cwd: string | undefined, at: string) => {
    if (!cwd || !path.isAbsolute(cwd)) return;
    const prev = seen.get(cwd);
    if (!prev || prev < at) seen.set(cwd, at);
  };
  for (const r of regs) add(r.cwd, r.disconnectedAt ?? r.connectedAt ?? '');
  const nowIso = new Date().toISOString();
  for (const l of live ?? []) add(l.cwd, nowIso);
  const all = [...seen].map(([cwd, lastUsed]) => ({ cwd, lastUsed })).sort((a, b) => (a.lastUsed < b.lastUsed ? 1 : a.lastUsed > b.lastUsed ? -1 : 0));
  const out: Folder[] = [];
  for (const f of all) {
    if (out.length >= MAX_FOLDERS) break;
    if (await exists(f.cwd)) out.push(f);
  }
  return out;
}

/** The config dir of the latest registration in `cwd` (undefined: the default). */
export function configDirOf(regs: Registration[], cwd: string): string | undefined {
  const inDir = regs.filter((r) => r.cwd === cwd).sort((a, b) => (a.connectedAt < b.connectedAt ? 1 : -1));
  return inDir[0]?.configDir;
}
