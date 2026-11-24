// The claude process from the hook's parent: a fallback for sessions `claude agents` does not list.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

/** True when argv belongs to Claude Code: the `claude` binary, or Node running its npm package. */
export function isClaudeArgv(argv: string[]): boolean {
  const base = (s: string) => s.split(/[\\/]/).pop() ?? '';
  if (/^claude(\.exe)?$/i.test(base(argv[0] ?? ''))) return true;
  return /^node(\.exe)?$/i.test(base(argv[0] ?? '')) && /[\\/]@anthropic-ai[\\/]claude-code[\\/]/.test(argv[1] ?? '');
}

/**
 * Fallback when `claude agents` does not list the session (Claude Code did not write its entry): hooks run
 * in exec form, so the hook's parent is the claude process itself. Its argv is checked first (Linux reads
 * /proc, macOS asks ps); anything else, or Windows, gives null: a wrong pid is worse than none.
 */
export function parentClaudePid(
  ppid: number = process.ppid,
  platform: NodeJS.Platform = process.platform,
  readArgv: (pid: number) => string[] | null = (p) => readProcessArgv(p, platform),
): number | null {
  if (!Number.isInteger(ppid) || ppid <= 1 || platform === 'win32') return null;
  const argv = readArgv(ppid);
  return argv && isClaudeArgv(argv) ? ppid : null;
}

function readProcessArgv(pid: number, platform: NodeJS.Platform): string[] | null {
  try {
    if (platform === 'linux') {
      return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
    }
    const out = execFileSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim().split(/\s+/).filter(Boolean);
  } catch {
    return null;
  }
}
