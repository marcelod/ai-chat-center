import fs from 'node:fs/promises';
import path from 'node:path';

const HASH_RE = /^[0-9a-f]{40,64}$/i;

function parseHead(head: string): string | null {
  const text = head.trim();
  const ref = /^ref:\s*(\S+)$/.exec(text)?.[1];
  if (ref) return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) || null : ref;
  return HASH_RE.test(text) ? text.slice(0, 7) : null;
}

/**
 * Current git branch of `cwd`, read from files only (no `git` process): walks up to the first `.git`,
 * follows `gitdir:` for worktrees. Detached HEAD gives the first 7 hash chars. Any failure gives null.
 */
export async function readGitBranch(cwd: string): Promise<string | null> {
  try {
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return null;
    let dir = path.resolve(cwd);
    for (;;) {
      const dotGit = path.join(dir, '.git');
      let st;
      try {
        st = await fs.stat(dotGit);
      } catch {
        st = null;
      }
      if (st) {
        let gitDir = dotGit;
        if (st.isFile()) {
          const target = /^gitdir:\s*(.+?)\s*$/m.exec(await fs.readFile(dotGit, 'utf8'))?.[1];
          if (!target) return null;
          gitDir = path.resolve(dir, target);
        }
        return parseHead(await fs.readFile(path.join(gitDir, 'HEAD'), 'utf8'));
      }
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  } catch {
    return null;
  }
}
