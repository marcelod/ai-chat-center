import { paths } from './paths.js';
import { readJson, writeJsonAtomic } from './fsAtomic.js';

const EFFORT_RE = /^[a-z]{1,16}$/;
/** Claude Code permission modes are short camelCase words (default, acceptEdits, plan, auto, ...). */
const MODE_RE = /^[a-zA-Z]{1,24}$/;

type Meta = { effort?: unknown; mode?: unknown };

/** Per-session info recorded by the hooks (effort level, permission mode), in <home>/meta/<sid>.json. */
async function readMeta(sid: string): Promise<Meta> {
  const d = await readJson<Meta>(paths().metaFile(sid));
  return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
}

async function setField(sid: string, key: 'effort' | 'mode', value: string, re: RegExp): Promise<void> {
  const file = paths().metaFile(sid); // validates the session id
  if (typeof value !== 'string' || !re.test(value)) return;
  const meta = await readMeta(sid);
  if (meta[key] === value) return;
  await writeJsonAtomic(file, { ...meta, [key]: value });
}

export async function getEffort(sid: string): Promise<string | null> {
  const { effort } = await readMeta(sid);
  return typeof effort === 'string' && EFFORT_RE.test(effort) ? effort : null;
}

/** Anything but a short lowercase word is ignored (nothing written). */
export async function setEffort(sid: string, level: string): Promise<void> {
  await setField(sid, 'effort', level, EFFORT_RE);
}

/** The permission mode Claude Code sent with the last hook (`permission_mode`). */
export async function getMode(sid: string): Promise<string | null> {
  const { mode } = await readMeta(sid);
  return typeof mode === 'string' && MODE_RE.test(mode) ? mode : null;
}

/** Anything but a short word of letters is ignored (nothing written). */
export async function setMode(sid: string, mode: string): Promise<void> {
  await setField(sid, 'mode', mode, MODE_RE);
}

const MODEL_RE = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/;

/** claude-opus-5-5 -> "Opus 5.5"; ids outside the pattern come back as they are. */
export function shortModel(id: string): string {
  const m = MODEL_RE.exec(id);
  if (!m) return id;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
}
