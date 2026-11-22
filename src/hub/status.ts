import { runClaudeAgentsJson } from '../core/claudeAgents.js';
import type { LiveSession } from '../shared/types.js';

export type { LiveSession };

function toLive(x: unknown): LiveSession | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.sessionId !== 'string' || !o.sessionId) return null;
  if (typeof o.pid !== 'number' || typeof o.cwd !== 'string') return null;
  if (o.kind !== 'interactive' && o.kind !== 'background') return null;
  return {
    pid: o.pid,
    cwd: o.cwd,
    kind: o.kind,
    sessionId: o.sessionId,
    name: typeof o.name === 'string' ? o.name : '',
    // Presence never depends on status: unknown values degrade to idle.
    status: o.status === 'busy' || o.status === 'waiting' ? o.status : 'idle',
  };
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

/** Runs `claude agents --json`. Any failure or non-JSON reply yields []; malformed items are dropped. */
export async function listLiveSessions(run?: () => Promise<string>): Promise<LiveSession[]> {
  return (await queryLiveSessions(run)) ?? [];
}
