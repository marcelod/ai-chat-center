import { execFile } from 'node:child_process';
import os from 'node:os';

/**
 * Runs `claude agents --json` and returns its stdout. Shared by the hub (live status) and the
 * hooks (pid lookup). windowsHide: no console window flashes on Windows; shell: `claude` is a
 * .cmd shim there. cwd: the home folder, never the project the hook runs in (on Windows the
 * current folder is searched first, so a repository's own `claude.cmd` would run).
 */
export function runClaudeAgentsJson(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'claude',
      ['agents', '--json'],
      { cwd: os.homedir(), shell: process.platform === 'win32', windowsHide: true, timeout: 5000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(String(stdout))),
    );
  });
}
