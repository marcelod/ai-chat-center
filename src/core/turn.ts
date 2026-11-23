import { paths } from './paths.js';
import { readJson, removeFile, writeJsonAtomic } from './fsAtomic.js';
import { unwrapMessages } from './protocol.js';

// Origin of the running turn, set by the UserPromptSubmit hook: 'app' when the prompt carries a message
// the hub delivered (keyed block, see protocol.ts), 'terminal' otherwise. Cleared on /cc.

export type TurnOrigin = 'app' | 'terminal';

export async function setTurnOrigin(sid: string, origin: TurnOrigin): Promise<void> {
  await writeJsonAtomic(paths().turnFile(sid), { origin, at: new Date().toISOString() });
}

export async function getTurnOrigin(sid: string): Promise<TurnOrigin | null> {
  const t = await readJson<{ origin?: unknown }>(paths().turnFile(sid));
  return t?.origin === 'app' || t?.origin === 'terminal' ? t.origin : null;
}

export async function clearTurnOrigin(sid: string): Promise<void> {
  await removeFile(paths().turnFile(sid));
}

/** 'app' when the prompt holds at least one block signed with `key` (anywhere in the text). */
export function promptOrigin(prompt: unknown, key: string | undefined): TurnOrigin {
  if (typeof prompt !== 'string' || !key) return 'terminal';
  return unwrapMessages(prompt, key).length > 0 ? 'app' : 'terminal';
}
