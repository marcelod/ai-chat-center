// Quick reply suggestions (spec 2026-11-27-suggested-quick-replies): the short messages the user keeps sending,
// from the app or the terminal, read from the transcripts of the sessions the hub knows. Bounded for CPU and
// memory: only the end of each file, line by line, a cap on files, and a cache in the hub. Read-only, only
// `.jsonl` files inside the session's Claude `projects` folder (real paths). Errors only drop a file.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { unwrapMessages } from '../core/protocol.js';
import { isInside } from './folderBrowse.js';
import { normalizeReply, type SuggestedReply } from '../shared/quickReplies.js';

export const SUGGEST_MIN_COUNT = 3;
export const SUGGEST_WINDOW_MS = 30 * 86_400_000;
export const SUGGEST_MAX_LENGTH = 80;
export const SUGGEST_LIMIT = 10;
export const SUGGEST_TTL_MS = 10 * 60_000;
/** Bytes read from the end of each transcript. */
export const SUGGEST_MAX_BYTES = 8 * 1024 * 1024;
export const SUGGEST_MAX_FILES = 200;
/** A line longer than this is never a short message: skipped without parsing. */
const MAX_LINE = 64 * 1024;
/** Older Claude Code wrote a queued prompt again as a user entry when it ran. */
const QUEUED_DEDUP_MS = 30 * 60_000;

const APP_MARK = '[AI Chat Center message';
const APP_CLOSE = '[/AI Chat Center message]';
const AGENT_MESSAGE_PREFIX = 'Another Claude session sent a message:';
const INTERRUPTED = '[Request interrupted by user';
/** Claude Code wrapper or system text: never something the user typed as a reply. */
const SYSTEM_TEXT = /<\/?(?:command-|local-command-|system-reminder|task-notification|bash-|pasted_content|teammate-message|agent-message)/;

/** A transcript to read: its path, the trusted app-message keys of the session, and the folder it must be in. */
export type TranscriptSource = { path: string; keys: string[]; projects: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The text of a prompt: a string, or text blocks only (an image, document or tool result drops it). */
function promptText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const texts: string[] = [];
  for (const b of content) {
    if (!isRecord(b) || b.type !== 'text' || typeof b.text !== 'string') return null;
    texts.push(b.text);
  }
  return texts.join('\n');
}

/** Plain typed text, or null for system text, commands and the like (app blocks are handled before). */
function typed(text: string): string | null {
  const t = text.trim();
  if (!t || t.startsWith(INTERRUPTED) || t.startsWith(AGENT_MESSAGE_PREFIX)) return null;
  if (SYSTEM_TEXT.test(t) || t.includes(APP_MARK) || t.includes(APP_CLOSE)) return null;
  return t;
}

/** What the user sent in one transcript line (several texts for a delivery of several app messages). */
export function userTexts(line: string, keys: string[]): { text: string; ts: number; queued?: true }[] {
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isRecord(entry) || entry.isSidechain === true || entry.isMeta === true) return [];
  const ts = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN;
  if (!Number.isFinite(ts)) return [];

  if (entry.type === 'attachment') {
    const a = entry.attachment;
    if (!isRecord(a) || a.type !== 'queued_command' || a.commandMode !== 'prompt' || a.humanTurn !== true || a.isMeta === true) return [];
    const raw = promptText(a.prompt);
    const t = raw === null ? null : typed(raw);
    return t ? [{ text: t, ts, queued: true }] : [];
  }

  if (entry.type !== 'user' || entry.isCompactSummary === true) return [];
  if (isRecord(entry.origin) && entry.origin.kind === 'peer') return [];
  const message = isRecord(entry.message) ? entry.message : undefined;
  const raw = message ? promptText(message.content) : null;
  if (raw === null) return [];
  if (raw.includes(APP_MARK)) {
    // Only the inner text of trusted blocks; the block itself never counts.
    return unwrapMessages(raw, keys)
      .map((m) => typed(m.text))
      .filter((t): t is string => t !== null)
      .map((text) => ({ text, ts }));
  }
  const t = typed(raw);
  return t ? [{ text: t, ts }] : [];
}

/** A text worth suggesting: short, not a command, no attachment. */
function candidate(text: string): string | null {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat || flat.length > SUGGEST_MAX_LENGTH || flat.startsWith('/') || flat.startsWith('!')) return null;
  if (text.includes('[Attachment:')) return null;
  return normalizeReply(flat) ? flat : null;
}

/** The real path of a transcript when it is a `.jsonl` regular file inside its projects folder, else null. */
async function safePath(src: TranscriptSource): Promise<string | null> {
  try {
    const real = await fsp.realpath(src.path);
    const root = await fsp.realpath(src.projects);
    if (path.extname(real).toLowerCase() !== '.jsonl' || !isInside(root, real) || real === root) return null;
    return real;
  } catch {
    return null;
  }
}

type Tally = { count: number; text: string; last: number };

async function scanFile(file: string, size: number, keys: string[], since: number, maxBytes: number, tally: Map<string, Tally>): Promise<void> {
  const start = Math.max(0, size - maxBytes);
  const stream = fs.createReadStream(file, { start, end: Math.max(start, size - 1), encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let first = start > 0; // a cut first line is dropped
  const queued: { norm: string; at: number }[] = [];
  try {
    for await (const line of lines) {
      if (first) {
        first = false;
        continue;
      }
      if (line.length > MAX_LINE || (!line.includes('"user"') && !line.includes('queued_command'))) continue;
      for (const u of userTexts(line, keys)) {
        if (u.ts < since) continue;
        const text = candidate(u.text);
        if (!text) continue;
        const norm = normalizeReply(text);
        if (u.queued) queued.push({ norm, at: u.ts });
        else {
          const i = queued.findIndex((q) => q.norm === norm && u.ts - q.at >= 0 && u.ts - q.at <= QUEUED_DEDUP_MS);
          if (i >= 0) {
            queued.splice(i, 1);
            continue;
          }
        }
        const t = tally.get(norm);
        if (!t) tally.set(norm, { count: 1, text, last: u.ts });
        else {
          t.count++;
          if (u.ts >= t.last) {
            t.last = u.ts;
            t.text = text;
          }
        }
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}

export async function suggestReplies(
  sources: TranscriptSource[],
  opts: { now?: () => number; maxBytes?: number; maxFiles?: number; limit?: number } = {},
): Promise<SuggestedReply[]> {
  const now = (opts.now ?? Date.now)();
  const since = now - SUGGEST_WINDOW_MS;
  const maxBytes = opts.maxBytes ?? SUGGEST_MAX_BYTES;
  const files: { file: string; size: number; mtime: number; keys: string[] }[] = [];
  const seen = new Set<string>();
  for (const src of sources) {
    const file = await safePath(src);
    if (!file || seen.has(file)) continue;
    seen.add(file);
    try {
      const st = await fsp.stat(file);
      if (!st.isFile() || st.mtimeMs < since) continue;
      files.push({ file, size: st.size, mtime: st.mtimeMs, keys: src.keys });
    } catch {
      /* gone: nothing to read */
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const tally = new Map<string, Tally>();
  for (const f of files.slice(0, opts.maxFiles ?? SUGGEST_MAX_FILES)) {
    if (f.size === 0) continue;
    try {
      await scanFile(f.file, f.size, f.keys, since, maxBytes, tally);
    } catch {
      /* an unreadable transcript only drops that file */
    }
  }
  return [...tally.values()]
    .filter((t) => t.count >= SUGGEST_MIN_COUNT)
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, opts.limit ?? SUGGEST_LIMIT)
    .map((t) => ({ text: t.text, count: t.count }));
}

/** Keeps a scan's result for `ttlMs`; concurrent calls share one scan; a failure is not kept. */
export function createSuggestionCache(
  scan: () => Promise<SuggestedReply[]>,
  opts: { ttlMs?: number; now?: () => number } = {},
): { get(): Promise<SuggestedReply[]> } {
  const ttl = opts.ttlMs ?? SUGGEST_TTL_MS;
  const now = opts.now ?? Date.now;
  let kept: { at: number; value: SuggestedReply[] } | undefined;
  let running: Promise<SuggestedReply[]> | undefined;
  return {
    get() {
      if (kept && now() - kept.at < ttl) return Promise.resolve(kept.value);
      if (!running) {
        running = scan()
          .then((value) => {
            kept = { at: now(), value };
            return value;
          })
          .finally(() => {
            running = undefined;
          });
      }
      return running;
    },
  };
}
