import type { SessionView } from '@shared/types';

// Grouping of the session list by folder (spec 2026-11-27-group-by-project).

export type SessionGroup = {
  /** The folder without trailing separators; identifies the group (and its open/closed state). */
  key: string;
  /** Last part of the folder path. */
  name: string;
  /** Full folder path, as the first conversation reports it. */
  path: string;
  sessions: SessionView[];
};

/** The folder path without trailing `/` or `\` (a root keeps its separator). */
export function folderKey(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/, '');
  return trimmed === '' || /^[A-Za-z]:$/.test(trimmed) ? cwd : trimmed;
}

/** Last part of a folder path; the path itself for a root, `?` when empty. */
export function folderName(cwd: string): string {
  if (!cwd) return '?';
  const key = folderKey(cwd);
  const parts = key.split(/[\\/]/);
  const last = parts[parts.length - 1];
  return last && !/^[A-Za-z]:$/.test(last) ? last : cwd;
}

/**
 * Pinned conversations apart, the rest grouped by folder. The input is the hub's order (most recent first),
 * so keeping it orders the groups by their most recent conversation and each group's members too.
 */
export function groupByFolder(sessions: SessionView[]): { pinned: SessionView[]; groups: SessionGroup[] } {
  const pinned: SessionView[] = [];
  const groups = new Map<string, SessionGroup>();
  for (const s of sessions) {
    if (s.pinned) {
      pinned.push(s);
      continue;
    }
    const key = folderKey(s.cwd);
    let g = groups.get(key);
    if (!g) {
      g = { key, name: folderName(s.cwd), path: s.cwd, sessions: [] };
      groups.set(key, g);
    }
    g.sessions.push(s);
  }
  return { pinned, groups: [...groups.values()] };
}

/** What a closed group shows: a conversation working, subagents working, new messages. */
export function groupActivity(g: SessionGroup, unread: Record<string, number>): { busy: boolean; agents: number; unread: number } {
  let busy = false;
  let agents = 0;
  let total = 0;
  for (const s of g.sessions) {
    if (s.state === 'busy') busy = true;
    if (s.state !== 'disconnected') agents += s.agentsWorking ?? 0;
    total += unread[s.sessionId] ?? 0;
  }
  return { busy, agents, unread: total };
}
