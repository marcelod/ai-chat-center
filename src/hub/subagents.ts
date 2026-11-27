// The subagents of a session (spec 2026-11-26-side-panel): Claude Code keeps, next to the session's
// transcript, `<sessionId>/subagents/agent-<id>.meta.json` (description, type, model, `finished`) and
// `agent-<id>.jsonl` (the subagent's own transcript, side-chain lines). Read only. A transcript is never read
// whole for the list: its first and last bytes, and only again when its size or time changed.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChatEvent, SubagentInfo } from '../shared/types.js';
import { assertSessionId } from '../core/paths.js';
import { TranscriptReader } from './transcript/reader.js';
import { shortModel } from '../core/meta.js';

/** A subagent with no new line for this long is not counted as working (it may have died with its session). */
export const STALE_MS = 10 * 60_000;
/** Most subagents listed (newest first). */
export const MAX_LIST = 50;
const HEAD_BYTES = 16 * 1024;
const TAIL_BYTES = 256 * 1024;
const MAX_META = 64 * 1024;

const AGENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const isAgentId = (v: unknown): v is string => typeof v === 'string' && AGENT_ID_RE.test(v);

/** `<transcript folder>/<sessionId>/subagents`. */
export function subagentsDir(transcriptPath: string, sid: string): string {
  assertSessionId(sid);
  return path.join(path.dirname(transcriptPath), sid, 'subagents');
}

type Meta = { description: string; agentType: string; model?: string; background: boolean; finished: boolean; stopped: boolean };
/** `pending`: background tasks the agent launched (in the tail read) with no task-notification yet. */
type Tail = { startedAt?: string; lastAt?: string; lastTool?: string; pending?: number };
type Entry = { metaKey: string; meta: Meta | null; logKey: string; tail: Tail; mtimeMs: number };
/** Per file path: what was read, and the size and time it was read at. */
const cache = new Map<string, Entry>();
export function clearSubagentCache(): void {
  cache.clear();
}

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : undefined);

function parseMeta(raw: string): Meta | null {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const m = j as Record<string, unknown>;
  return {
    description: str(m.description) ?? '',
    agentType: str(m.agentType, 100) ?? '',
    model: str(m.model, 100) ? shortModel(str(m.model, 100)!) : undefined,
    background: m.requestShape === 'background',
    finished: m.finished === true || m.stoppedByUser === true,
    stopped: m.stoppedByUser === true,
  };
}

async function readRange(file: string, start: number, length: number): Promise<string> {
  const fh = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, start);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fh.close();
  }
}

/** Whole JSON lines of a piece of a file (`cutStart`: its first line may be cut). */
function jsonLines(text: string, cutStart: boolean): Record<string, unknown>[] {
  const lines = text.split('\n');
  if (cutStart) lines.shift();
  const out: Record<string, unknown>[] = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    try {
      const j = JSON.parse(l) as unknown;
      if (j && typeof j === 'object' && !Array.isArray(j)) out.push(j as Record<string, unknown>);
    } catch {
      /* a line cut at the end of the piece */
    }
  }
  return out;
}

function lastToolOf(lines: Record<string, unknown>[]): string | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.type !== 'assistant') continue;
    const content = (l.message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (let k = content.length - 1; k >= 0; k--) {
      const b = content[k] as { type?: unknown; name?: unknown } | null;
      if (b && b.type === 'tool_use' && typeof b.name === 'string') return b.name.slice(0, 100);
    }
  }
  return undefined;
}

const NOTIFIED_RE = /<tool-use-id>([^<\s]{1,200})<\/tool-use-id>/g;

/** The text of a user line's content (a string, or its text blocks). */
function userText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => (b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' ? String((b as { text?: unknown }).text ?? '') : '')).join('\n');
}

/**
 * Background tasks the agent launched itself and still waits for (spec 2026-11-27-subagent-background-task):
 * a tool_use with `run_in_background: true` whose result was not an error (a refused launch never ran) and no
 * `<task-notification>` naming its `<tool-use-id>` later. Claude Code marks the agent finished when it ends its
 * turn to wait, and wakes it with that notification.
 */
function pendingTasks(lines: Record<string, unknown>[]): number {
  const launched = new Set<string>();
  for (const l of lines) {
    const content = (l.message as { content?: unknown } | undefined)?.content;
    if (l.type === 'assistant' && Array.isArray(content)) {
      for (const b of content) {
        const u = b as { type?: unknown; id?: unknown; input?: { run_in_background?: unknown } } | null;
        if (u?.type === 'tool_use' && typeof u.id === 'string' && u.input?.run_in_background === true) launched.add(u.id);
      }
    } else if (l.type === 'user') {
      if (Array.isArray(content)) {
        for (const b of content) {
          const r = b as { type?: unknown; tool_use_id?: unknown; is_error?: unknown; content?: unknown } | null;
          if (r?.type !== 'tool_result' || typeof r.tool_use_id !== 'string') continue;
          const refused = r.is_error === true || (typeof r.content === 'string' && r.content.startsWith('<tool_use_error>'));
          if (refused) launched.delete(r.tool_use_id);
        }
      }
      const text = userText(content);
      if (text.includes('<task-notification>')) for (const m of text.matchAll(NOTIFIED_RE)) launched.delete(m[1]);
    }
  }
  return launched.size;
}

async function readTail(file: string, size: number, prev: Tail | undefined, onRead?: (f: string) => void): Promise<Tail> {
  onRead?.(file);
  let startedAt = prev?.startedAt;
  if (!startedAt) {
    const head = jsonLines(await readRange(file, 0, Math.min(size, HEAD_BYTES)), false);
    startedAt = head.map((l) => str(l.timestamp, 40)).find(Boolean);
  }
  const from = Math.max(0, size - TAIL_BYTES);
  const tail = jsonLines(await readRange(file, from, size - from), from > 0);
  let lastAt: string | undefined;
  for (let i = tail.length - 1; i >= 0 && !lastAt; i--) lastAt = str(tail[i].timestamp, 40);
  return { startedAt, lastAt: lastAt ?? prev?.lastAt, lastTool: lastToolOf(tail) ?? prev?.lastTool, pending: pendingTasks(tail) };
}

type ListOpts = { now?: () => number; limit?: number; onRead?: (file: string) => void };

async function readAgent(dir: string, id: string, onRead?: (f: string) => void): Promise<Entry | null> {
  const metaFile = path.join(dir, `agent-${id}.meta.json`);
  const logFile = path.join(dir, `agent-${id}.jsonl`);
  let metaSt;
  try {
    metaSt = await fs.stat(metaFile);
  } catch {
    return null;
  }
  const logSt = await fs.stat(logFile).catch(() => null);
  const metaKey = `${metaSt.size}:${metaSt.mtimeMs}`;
  const logKey = logSt ? `${logSt.size}:${logSt.mtimeMs}` : '';
  const prev = cache.get(metaFile);
  if (prev && prev.metaKey === metaKey && prev.logKey === logKey) return prev;
  let meta = prev?.meta ?? null;
  if (!prev || prev.metaKey !== metaKey) {
    meta = null;
    if (metaSt.size <= MAX_META) {
      onRead?.(metaFile);
      meta = parseMeta(await fs.readFile(metaFile, 'utf8').catch(() => ''));
    }
  }
  let tail: Tail = prev?.tail ?? {};
  if (logSt && (!prev || prev.logKey !== logKey)) tail = await readTail(logFile, logSt.size, prev?.tail, onRead).catch(() => tail);
  // A first line too long for the head (a long prompt): the transcript's creation time instead.
  if (!tail.startedAt && logSt && logSt.birthtimeMs > 0) tail = { ...tail, startedAt: new Date(logSt.birthtimeMs).toISOString() };
  // Activity is the transcript's: the meta is rewritten when the agent ends, not while it works.
  const entry: Entry = { metaKey, meta, logKey, tail, mtimeMs: logSt?.mtimeMs ?? metaSt.mtimeMs };
  cache.set(metaFile, entry);
  return entry;
}

function info(id: string, e: Entry, now: number): SubagentInfo | null {
  if (!e.meta) return null;
  const lineAt = e.tail.lastAt ? Date.parse(e.tail.lastAt) : NaN;
  const last = Math.max(Number.isFinite(lineAt) ? lineAt : 0, e.mtimeMs);
  const fresh = now - last < STALE_MS;
  // Finished but waiting on a background task of its own: it comes back when the task ends. An orphan (no
  // news for STALE_MS) or an agent the user stopped never holds this state.
  const waiting = e.meta.finished && !e.meta.stopped && (e.tail.pending ?? 0) > 0 && fresh;
  const status = waiting ? 'waiting' : e.meta.finished ? 'finished' : fresh ? 'running' : 'stale';
  const out: SubagentInfo = { id, description: e.meta.description, agentType: e.meta.agentType, background: e.meta.background, status };
  if (e.meta.model) out.model = e.meta.model;
  if (e.tail.startedAt) out.startedAt = e.tail.startedAt;
  if (last > 0) out.lastActivityAt = new Date(last).toISOString();
  if (e.tail.lastTool) out.lastTool = e.tail.lastTool;
  return out;
}

async function agentIds(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const ids: string[] = [];
  for (const n of names) {
    const m = /^agent-(.+)\.meta\.json$/.exec(n);
    if (m && isAgentId(m[1])) ids.push(m[1]);
  }
  return ids;
}

/** The subagents in `dir`, newest activity first, at most `limit`. A missing folder lists none. */
export async function listSubagents(dir: string, opts: ListOpts = {}): Promise<SubagentInfo[]> {
  const now = (opts.now ?? Date.now)();
  const out: SubagentInfo[] = [];
  for (const id of await agentIds(dir)) {
    const e = await readAgent(dir, id, opts.onRead).catch(() => null);
    const i = e && info(id, e, now);
    if (i) out.push(i);
  }
  const at = (a: SubagentInfo) => (a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0);
  out.sort((a, b) => at(b) - at(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out.slice(0, opts.limit ?? MAX_LIST);
}

/**
 * How many subagents in `dir` are working: not finished (or finished but waiting on a background task of its
 * own), with news in the last STALE_MS. Cheap: a finished agent with nothing pending (it never comes back) is
 * not looked at again, the others cost a stat of their two files, and a transcript is read (its ends only)
 * only when it changed.
 */
export async function runningSubagents(dir: string, now: () => number = Date.now): Promise<number> {
  const t = now();
  let n = 0;
  for (const id of await agentIds(dir)) {
    const known = cache.get(path.join(dir, `agent-${id}.meta.json`));
    if (known?.meta?.finished && (known.meta.stopped || !known.tail.pending)) continue;
    const e = await readAgent(dir, id).catch(() => null);
    const status = e && info(id, e, t)?.status;
    if (status === 'running' || status === 'waiting') n++;
  }
  return n;
}

/** The events of one subagent's transcript, or null when there is no such subagent. Rejects for a bad id. */
export async function subagentEvents(dir: string, id: string): Promise<ChatEvent[] | null> {
  if (!isAgentId(id)) throw new Error('invalid agent id');
  const file = path.join(dir, `agent-${id}.jsonl`);
  try {
    await fs.stat(file);
  } catch {
    return null;
  }
  const r = new TranscriptReader(file, undefined, { diffs: false, sidechain: true });
  await r.readNew();
  return r.all();
}
