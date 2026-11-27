import { runClaudeAgentsJson } from '../core/claudeAgents.js';
import type { LiveSession, StoppedBackground } from '../shared/types.js';
import { isBgId } from './bgSessions.js';

export type { LiveSession };

function toLive(x: unknown): LiveSession | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.sessionId !== 'string' || !o.sessionId) return null;
  if (typeof o.pid !== 'number' || typeof o.cwd !== 'string') return null;
  if (o.kind !== 'interactive' && o.kind !== 'background') return null;
  const live: LiveSession = {
    pid: o.pid,
    cwd: o.cwd,
    kind: o.kind,
    sessionId: o.sessionId,
    name: typeof o.name === 'string' ? o.name : '',
    // Presence never depends on status: unknown values degrade to idle.
    status: o.status === 'busy' || o.status === 'waiting' ? o.status : 'idle',
  };
  if (o.kind === 'background' && isBgId(o.id)) live.bgId = o.id;
  return live;
}

/** A short, fixed description of a failed command: the error code or signal only, never its text or output. */
function commandFailure(e: unknown): string {
  const { code, signal } = (e ?? {}) as { code?: unknown; signal?: unknown };
  if (typeof code === 'string' && /^E[A-Z0-9_]{1,30}$/.test(code)) return `command failed (${code})`;
  if (typeof code === 'number' && Number.isInteger(code)) return `command failed (exit ${code})`;
  if (typeof signal === 'string' && /^SIG[A-Z0-9]{1,10}$/.test(signal)) return `command failed (${signal})`;
  return 'command failed';
}

/**
 * Like listLiveSessions but returns null when the lookup itself failed (error, timeout, non-JSON, not a
 * list). A non-empty list in which no item has the known shape is a failure too: a new `claude agents`
 * output format must not read as "no sessions", or every session would be marked exited and its queue
 * cleared. `onFail` gets a short reason (never the output or the error text).
 */
export async function queryLiveSessions(
  run: () => Promise<string> = runClaudeAgentsJson,
  onFail?: (reason: string) => void,
): Promise<LiveSession[] | null> {
  let out: string;
  try {
    out = await run();
  } catch (e) {
    onFail?.(commandFailure(e));
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(out);
  } catch {
    onFail?.('not JSON');
    return null;
  }
  if (!Array.isArray(parsed)) {
    onFail?.('not a list');
    return null;
  }
  const live = parsed.map(toLive).filter((s): s is LiveSession => s !== null);
  if (parsed.length > 0 && live.length === 0) {
    onFail?.('unknown item shape');
    return null;
  }
  return live;
}

export interface LoggedLookupOptions {
  /** At most one log line per this interval. Default FAILED_LOOKUP_LOG_MS. */
  everyMs?: number;
  now?: () => number;
  run?: () => Promise<string>;
}

/** How often the hub notes failed `claude agents` lookups (they run every few seconds). */
export const FAILED_LOOKUP_LOG_MS = 5 * 60_000;

/** queryLiveSessions that logs failed lookups, at most once per `everyMs`, with the count held back. */
export function loggedLiveLookup(log: (m: string) => void, opts: LoggedLookupOptions = {}): () => Promise<LiveSession[] | null> {
  const everyMs = opts.everyMs ?? FAILED_LOOKUP_LOG_MS;
  const now = opts.now ?? Date.now;
  let lastAt: number | null = null;
  let held = 0;
  const note = (reason: string) => {
    const t = now();
    if (lastAt !== null && t - lastAt < everyMs) {
      held++;
      return;
    }
    log(`claude agents lookup failed: ${reason}${held ? ` (${held} more since the last note)` : ''}`);
    lastAt = t;
    held = 0;
  };
  return () => queryLiveSessions(opts.run, note);
}

function toStopped(x: unknown): StoppedBackground | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  // A background session with a process is running; one without (seen live: `done`, `blocked`) is not.
  if (o.kind !== 'background' || typeof o.pid === 'number') return null;
  if (!isBgId(o.id) || typeof o.sessionId !== 'string' || !o.sessionId || typeof o.cwd !== 'string') return null;
  const s: StoppedBackground = { bgId: o.id, sessionId: o.sessionId, cwd: o.cwd, name: typeof o.name === 'string' ? o.name : '' };
  if (typeof o.state === 'string' && /^[a-z_-]{1,20}$/.test(o.state)) s.state = o.state;
  if (typeof o.startedAt === 'number' && Number.isFinite(o.startedAt)) s.startedAt = o.startedAt;
  return s;
}

/**
 * The background sessions `claude agents --json --all` lists that no longer run (spec
 * 2026-11-26-stop-respawn-rm); null when the lookup itself failed.
 */
export async function queryStoppedBackground(run: () => Promise<string> = () => runClaudeAgentsJson(process.platform, true)): Promise<StoppedBackground[] | null> {
  try {
    const parsed: unknown = JSON.parse(await run());
    if (!Array.isArray(parsed)) return null;
    return parsed.map(toStopped).filter((s): s is StoppedBackground => s !== null);
  } catch {
    return null;
  }
}

/** Runs `claude agents --json`. Any failure or non-JSON reply yields []; malformed items are dropped. */
export async function listLiveSessions(run?: () => Promise<string>): Promise<LiveSession[]> {
  return (await queryLiveSessions(run)) ?? [];
}
