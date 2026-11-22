import { execFile } from 'node:child_process';

/**
 * Runs `claude agents --json` and returns its stdout. Shared by the hub (live status) and the
 * hooks (pid lookup). windowsHide: no console window flashes on Windows; shell: `claude` is a
 * .cmd shim there.
 */
export function runClaudeAgentsJson(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'claude',
      ['agents', '--json'],
      { shell: process.platform === 'win32', windowsHide: true, timeout: 5000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(String(stdout))),
    );
  });
}
