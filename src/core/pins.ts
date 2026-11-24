import { paths } from './paths.js';
import { readJson, removeFile, writeJsonAtomic } from './fsAtomic.js';

/** Whether the conversation is pinned to the top of the list (a per-session file, see names.ts). */
export async function isPinned(sid: string): Promise<boolean> {
  const d = await readJson<{ pinned?: unknown }>(paths().pinsFile(sid));
  return d?.pinned === true;
}

/** false removes the file. Written by the hub so every window agrees. */
export async function setPinned(sid: string, pinned: boolean): Promise<void> {
  const file = paths().pinsFile(sid);
  if (pinned) await writeJsonAtomic(file, { pinned: true });
  else await removeFile(file);
}
