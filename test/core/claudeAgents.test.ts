import { describe, it, expect, vi } from 'vitest';

const execFile = vi.fn();
vi.mock('node:child_process', () => ({ execFile: (...a: unknown[]) => execFile(...a) }));

describe('runClaudeAgentsJson', () => {
  // Audit SEC-F4: hooks run with the project folder as cwd; on Windows a repo's claude.cmd would win.
  it('runs `claude agents --json` hidden, from the home folder, with timeout and buffer limits', async () => {
    execFile.mockImplementation((_c: string, _a: string[], _o: object, cb: (e: null, out: string) => void) => cb(null, '[]'));
    const { runClaudeAgentsJson } = await import('../../src/core/claudeAgents.js');
    expect(await runClaudeAgentsJson('linux')).toBe('[]');
    const [cmd, args, opts] = execFile.mock.calls[0]!;
    expect(cmd).toBe('claude');
    expect(args).toEqual(['agents', '--json']);
    expect(opts).toEqual({
      cwd: (await import('node:os')).default.homedir(),
      shell: false,
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 10 * 1024 * 1024,
    });
  });
  // CI, Windows + Node 24: execFile with args AND shell: true prints DEP0190 on stderr. A waiter's stderr
  // is the message Claude receives, so the warning was prepended to every delivery. On Windows the
  // whole command line goes in as one string (claude is a .cmd shim, so a shell is still needed).
  it('on Windows runs the .cmd shim through the shell as one command line, with no args array', async () => {
    execFile.mockReset();
    execFile.mockImplementation((_c: string, _a: string[], _o: object, cb: (e: null, out: string) => void) => cb(null, '[]'));
    const { runClaudeAgentsJson } = await import('../../src/core/claudeAgents.js');
    expect(await runClaudeAgentsJson('win32')).toBe('[]');
    const [cmd, args, opts] = execFile.mock.calls[0]!;
    expect(cmd).toBe('claude agents --json');
    expect(args).toEqual([]);
    expect(opts).toMatchObject({ shell: true, windowsHide: true, cwd: (await import('node:os')).default.homedir() });
  });
  it('with all: `claude agents --json --all` (exited background sessions too)', async () => {
    execFile.mockReset();
    execFile.mockImplementation((_c: string, _a: string[], _o: object, cb: (e: null, out: string) => void) => cb(null, '[]'));
    const { runClaudeAgentsJson } = await import('../../src/core/claudeAgents.js');
    await runClaudeAgentsJson('linux', true);
    expect(execFile.mock.calls[0]![1]).toEqual(['agents', '--json', '--all']);
    await runClaudeAgentsJson('win32', true);
    expect(execFile.mock.calls[1]![0]).toBe('claude agents --json --all');
  });
  it('rejects on error', async () => {
    execFile.mockImplementation((_c: string, _a: string[], _o: object, cb: (e: Error) => void) => cb(new Error('nope')));
    const { runClaudeAgentsJson } = await import('../../src/core/claudeAgents.js');
    await expect(runClaudeAgentsJson()).rejects.toThrow('nope');
  });
  it('status and claudePid both use it (no other execFile of claude)', async () => {
    const fs = await import('node:fs');
    for (const f of ['src/hub/status.ts', 'src/hooks/claudePid.ts']) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src, f).toContain('runClaudeAgentsJson');
      expect(src, f).not.toContain('execFile');
    }
  });
});
