import { paths } from './paths.js';
import { readJson, removeFile, writeJsonAtomic } from './fsAtomic.js';

export const MAX_DISPLAY_NAME = 80;

/** A custom display name: "" (clears) or 1-80 chars with no leading/trailing whitespace. Otherwise null. */
export function validDisplayName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  if (v === '') return '';
  if (v !== v.trim() || v.length > MAX_DISPLAY_NAME) return null;
  return v;
}

export async function getDisplayName(sid: string): Promise<string | null> {
  const d = await readJson<{ name?: unknown }>(paths().namesFile(sid));
  return d && typeof d.name === 'string' && validDisplayName(d.name) ? d.name : null;
}

/** "" removes the custom name. The file is per session id; the name is only its content. */
export async function setDisplayName(sid: string, name: string): Promise<void> {
  const file = paths().namesFile(sid);
  if (name === '') await removeFile(file);
  else await writeJsonAtomic(file, { name });
}
