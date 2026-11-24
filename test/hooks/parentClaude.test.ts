import { describe, expect, it } from 'vitest';
import { isClaudeArgv, parentClaudePid } from '../../src/hooks/parentClaude.js';

describe('parentClaudePid', () => {
  it('recognizes the claude binary and node running the npm package', () => {
    expect(isClaudeArgv(['claude'])).toBe(true);
    expect(isClaudeArgv(['/home/u/.local/bin/claude', '--resume'])).toBe(true);
    expect(isClaudeArgv(['node', '/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js'])).toBe(true);
    expect(isClaudeArgv(['node', '/x/vitest.mjs'])).toBe(false);
    expect(isClaudeArgv(['/bin/sh', '-c', 'claude'])).toBe(false);
    expect(isClaudeArgv([])).toBe(false);
  });
  it('returns the parent only when it is claude; never on Windows or for init', () => {
    expect(parentClaudePid(42, 'linux', () => ['claude', ''])).toBe(42);
    expect(parentClaudePid(42, 'darwin', () => ['node', '/x/@anthropic-ai/claude-code/cli.js'])).toBe(42);
    expect(parentClaudePid(42, 'linux', () => ['/bin/sh'])).toBeNull();
    expect(parentClaudePid(42, 'linux', () => null)).toBeNull();
    expect(parentClaudePid(42, 'win32', () => ['claude'])).toBeNull();
    expect(parentClaudePid(1, 'linux', () => ['claude'])).toBeNull();
  });
});
