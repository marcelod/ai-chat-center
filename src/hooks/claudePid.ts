import { runClaudeAgentsJson } from '../core/claudeAgents.js';

export interface ResolvePidOptions {
  /** Returns the stdout of `claude agents --json`. Injected in tests. */
  run?: () => Promise<string>;
}

/**
 * Hooks run through `sh -c` (probe: process.ppid is a short-lived /bin/sh, the claude process is
 * its parent), so ppid cannot identify the session. Ask `claude agents --json` instead.
 * Returns null when the session is not listed or the lookup fails: a wrong pid is worse than none.
 */
export async function resolveClaudePid(sessionId: string, opts: ResolvePidOptions = {}): Promise<number | null> {
  try {
    const list = JSON.parse(await (opts.run ?? runClaudeAgentsJson)()) as unknown;
    if (Array.isArray(list)) {
      for (const a of list as Array<{ pid?: unknown; sessionId?: unknown }>) {
        if (a?.sessionId === sessionId && typeof a.pid === 'number') return a.pid;
      }
    }
  } catch {
    /* fall through */
  }
  return null;
}
