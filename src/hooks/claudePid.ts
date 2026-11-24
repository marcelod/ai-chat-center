import { runClaudeAgentsJson } from '../core/claudeAgents.js';

export interface ResolvePidOptions {
  /** Returns the stdout of `claude agents --json`. Injected in tests. */
  run?: () => Promise<string>;
}

/** Result of one `claude agents --json` lookup: `ok: false` when the lookup itself failed. */
export type PidLookup = { ok: true; pid: number | null } | { ok: false };

/**
 * Hooks run through `sh -c` (probe: process.ppid is a short-lived /bin/sh, the claude process is
 * its parent), so ppid cannot identify the session. Ask `claude agents --json` instead.
 * `pid: null` means the lookup worked but does not list the session.
 */
export async function lookupClaudePid(sessionId: string, opts: ResolvePidOptions = {}): Promise<PidLookup> {
  try {
    const list = JSON.parse(await (opts.run ?? runClaudeAgentsJson)()) as unknown;
    if (!Array.isArray(list)) return { ok: false };
    for (const a of list as Array<{ pid?: unknown; sessionId?: unknown }>) {
      if (a?.sessionId === sessionId && typeof a.pid === 'number') return { ok: true, pid: a.pid };
    }
    return { ok: true, pid: null };
  } catch {
    return { ok: false };
  }
}

/** The claude pid of a session, or null when it is not listed or the lookup fails: a wrong pid is worse than none. */
export async function resolveClaudePid(sessionId: string, opts: ResolvePidOptions = {}): Promise<number | null> {
  const r = await lookupClaudePid(sessionId, opts);
  return r.ok ? r.pid : null;
}

