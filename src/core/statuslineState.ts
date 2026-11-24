import { paths } from './paths.js';
import { readJson } from './fsAtomic.js';

export type StatusLine = { type?: unknown; command?: unknown; padding?: unknown; [k: string]: unknown };
/** What `/cc usage on` replaced in settings.json: null when there was no status line. */
export type StatuslineState = { original: StatusLine | null };

/** Kept apart from hooks/statusline.ts so the wrapper, which runs at every status line refresh, stays small. */
export async function readStatuslineState(): Promise<StatuslineState | null> {
  const d = await readJson<StatuslineState>(paths().statuslineFile);
  if (!d || typeof d !== 'object' || !('original' in d)) return null;
  const o = d.original;
  return { original: o && typeof o === 'object' && !Array.isArray(o) ? o : null };
}
