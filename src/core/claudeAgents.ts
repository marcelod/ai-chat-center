import { execFile } from 'node:child_process';
import os from 'node:os';

/**
 * Runs `claude agents --json` and returns its stdout. Shared by the hub (live status) and the
 * hooks (pid lookup). windowsHide: no console window flashes on Windows. cwd: the home folder, never
 * the project the hook runs in (on Windows the current folder is searched first, so a repository's own
 * `claude.cmd` would run).
 *
 * On Windows `claude` is a .cmd shim, so it needs the shell, and the command line is passed as ONE
 * string with no args array: Node 24 prints a DEP0190 warning on stderr for args combined with
 * `shell: true`, and a waiter's stderr is the very text Claude receives. The line is constant, so
 * nothing needs escaping.
 */
export function runClaudeAgentsJson(platform: NodeJS.Platform = process.platform, all = false): Promise<string> {
  const win = platform === 'win32';
  // `--all`: also the background sessions that are no longer running (stopped or finished).
  const argv = all ? ['agents', '--json', '--all'] : ['agents', '--json'];
  return new Promise((resolve, reject) => {
    execFile(
      win ? `claude ${argv.join(' ')}` : 'claude',
      win ? [] : argv,
      { cwd: os.homedir(), shell: win, windowsHide: true, timeout: 5000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(String(stdout))),
    );
  });
}
