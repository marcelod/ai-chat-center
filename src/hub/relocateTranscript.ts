import fs from 'node:fs/promises';
import path from 'node:path';
import { assertSessionId } from '../core/paths.js';

// Claude Code moves the transcript of a session that enters a worktree into the worktree's project folder
// (<projects>/<project>--claude-worktrees-<name>/<id>.jsonl), so the path the hook registered disappears.
// The hub looks for <id>.jsonl in the other project folders, the worktree folders of the same project first.

const CWD_TAIL_BYTES = 64 * 1024;

async function regularFile(p: string): Promise<number | null> {
  try {
    const st = await fs.lstat(p); // a symbolic link is never followed
    return st.isFile() ? st.mtimeMs : null;
  } catch {
    return null;
  }
}

async function newest(dirs: string[], projectsDir: string, name: string): Promise<string | null> {
  let best: { p: string; m: number } | null = null;
  for (const d of dirs) {
    const p = path.join(projectsDir, d, name);
    const m = await regularFile(p);
    if (m !== null && (!best || m > best.m)) best = { p, m };
  }
  return best?.p ?? null;
}

/** The moved transcript of the session, or null when it is nowhere under `projectsDir`. */
export async function findMovedTranscript(oldPath: string, sid: string, projectsDir: string): Promise<string | null> {
  assertSessionId(sid);
  let dirs: string[];
  try {
    dirs = (await fs.readdir(projectsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return null;
  }
  const project = path.basename(path.dirname(oldPath));
  const name = `${sid}.jsonl`;
  const prefix = `${project}--claude-worktrees-`;
  const own = dirs.filter((d) => d.startsWith(prefix));
  return (await newest(own, projectsDir, name)) ?? (await newest(dirs.filter((d) => d !== project && !d.startsWith(prefix)), projectsDir, name));
}

/** The working folder recorded in the last transcript line that has one. */
export async function transcriptCwd(file: string): Promise<string | undefined> {
  let fh: fs.FileHandle | undefined;
  try {
    fh = await fs.open(file, 'r');
    const { size } = await fh.stat();
    const len = Math.min(size, CWD_TAIL_BYTES);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const cwd = (JSON.parse(lines[i]) as { cwd?: unknown } | null)?.cwd;
        if (typeof cwd === 'string' && cwd) return cwd;
      } catch {
        /* partial or bad line */
      }
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    await fh?.close();
  }
}
