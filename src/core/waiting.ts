import fs from 'node:fs/promises';
import { paths } from './paths.js';
import { readJson, writeJsonAtomic } from './fsAtomic.js';

export type WaitingKind = 'permission' | 'input';

export async function setWaiting(sid: string, kind: WaitingKind): Promise<void> {
  await writeJsonAtomic(paths().waitingFile(sid), { kind, at: new Date().toISOString() });
}

export async function clearWaiting(sid: string): Promise<void> {
  await fs.rm(paths().waitingFile(sid), { force: true });
}

export async function getWaiting(sid: string): Promise<{ kind: WaitingKind; at: string } | null> {
  return readJson(paths().waitingFile(sid));
}
