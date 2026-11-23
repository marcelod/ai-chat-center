import { paths } from './paths.js';
import { readJson, writeJsonAtomic } from './fsAtomic.js';

const EFFORT_RE = /^[a-z]{1,16}$/;

/** Per-session info recorded by the prompt-submit hook (the effort level), in <home>/meta/<sid>.json. */
export async function getEffort(sid: string): Promise<string | null> {
  const d = await readJson<{ effort?: unknown }>(paths().metaFile(sid));
  return d && typeof d.effort === 'string' && EFFORT_RE.test(d.effort) ? d.effort : null;
}

/** Anything but a short lowercase word is ignored (nothing written). */
export async function setEffort(sid: string, level: string): Promise<void> {
  const file = paths().metaFile(sid); // validates the session id
  if (typeof level !== 'string' || !EFFORT_RE.test(level)) return;
  if ((await getEffort(sid)) === level) return;
  await writeJsonAtomic(file, { effort: level });
}

const MODEL_RE = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/;

/** claude-opus-5-5 -> "Opus 5.5"; ids outside the pattern come back as they are. */
export function shortModel(id: string): string {
  const m = MODEL_RE.exec(id);
  if (!m) return id;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
}
