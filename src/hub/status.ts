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

/** Like listLiveSessions but returns null when the lookup itself failed (error, timeout, non-JSON). */
export async function queryLiveSessions(run: () => Promise<string> = runClaudeAgentsJson): Promise<LiveSession[] | null> {
  try {
    const parsed: unknown = JSON.parse(await run());
    if (!Array.isArray(parsed)) return null;
    return parsed.map(toLive).filter((s): s is LiveSession => s !== null);
  } catch {
    return null;
  }
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
