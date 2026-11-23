import { paths } from './paths.js';
import { readJson, writeJsonAtomic } from './fsAtomic.js';
import { isAlive } from './lock.js';

/** The hub rewrites the file more often than this while a tab is open. */
const FRESH_MS = 45_000;

export async function writePresence(clients: number): Promise<void> {
  await writeJsonAtomic(paths().presenceFile, { clients, pid: process.pid, at: Date.now() });
}

/** An app tab is open: clients > 0, a fresh heartbeat, and the hub process that wrote it is alive. */
export async function appPresent(now = Date.now()): Promise<boolean> {
  const p = await readJson<{ clients?: unknown; pid?: unknown; at?: unknown }>(paths().presenceFile);
  if (!p || typeof p.clients !== 'number' || typeof p.pid !== 'number' || typeof p.at !== 'number') return false;
  return p.clients > 0 && now - p.at < FRESH_MS && isAlive(p.pid);
}
