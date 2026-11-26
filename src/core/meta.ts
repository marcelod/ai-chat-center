import { paths } from './paths.js';
import { readJson, writeJsonAtomic } from './fsAtomic.js';
import { isContextWindow } from '../shared/context.js';

const EFFORT_RE = /^[a-z]{1,16}$/;
/** Claude Code permission modes are short camelCase words (default, acceptEdits, plan, auto, ...). */
const MODE_RE = /^[a-zA-Z]{1,24}$/;

type Meta = { effort?: unknown; mode?: unknown; contextWindow?: unknown };

/** Per-session info recorded by the hooks and the status line (effort level, permission mode, context window size), in <home>/meta/<sid>.json. */
async function readMeta(sid: string): Promise<Meta> {
  const d = await readJson<Meta>(paths().metaFile(sid));
  return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
}

async function setField(sid: string, key: 'effort' | 'mode', value: string, re: RegExp): Promise<void> {
  paths().metaFile(sid); // validates the session id
  if (typeof value === 'string' && re.test(value)) await writeField(sid, key, value);
}

async function writeField(sid: string, key: keyof Meta, value: string | number): Promise<void> {
  const file = paths().metaFile(sid); // validates the session id
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

/** The context window size Claude Code last reported to the status line for this session (see bin/statusline.ts). */
export async function getContextWindow(sid: string): Promise<number | null> {
  const { contextWindow } = await readMeta(sid);
  return isContextWindow(contextWindow) ? contextWindow : null;
}

/** Anything but a plausible whole number of tokens is ignored (nothing written); an unchanged value is not rewritten. */
export async function setContextWindow(sid: string, size: number): Promise<void> {
  paths().metaFile(sid); // validates the session id
  if (!isContextWindow(size)) return;
  await writeField(sid, 'contextWindow', size);
}

/** The session and its window size in a status line input (`session_id`, `context_window.context_window_size`). */
export function contextWindowFromStatusInput(input: unknown): { sessionId: string; size: number } | null {
  if (!input || typeof input !== 'object') return null;
  const { session_id: sessionId, context_window: cw } = input as { session_id?: unknown; context_window?: unknown };
  const size = cw && typeof cw === 'object' ? (cw as { context_window_size?: unknown }).context_window_size : undefined;
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId) || !isContextWindow(size)) return null;
  return { sessionId, size };
}

const MODEL_RE = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/;

/** claude-opus-5-5 -> "Opus 5.5"; ids outside the pattern come back as they are. */
export function shortModel(id: string): string {
  const m = MODEL_RE.exec(id);
  if (!m) return id;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
}
