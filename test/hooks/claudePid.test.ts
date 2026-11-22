import { describe, it, expect } from 'vitest';
import { resolveClaudePid } from '../../src/hooks/claudePid.js';

const list = JSON.stringify([
  { pid: 10, sessionId: 'a' },
  { pid: 20, sessionId: 'b' },
]);

describe('resolveClaudePid', () => {
  it('returns the pid of the matching session', async () => {
    expect(await resolveClaudePid('b', { run: async () => list })).toBe(20);
  });
  it('returns null when there is no match (no ppid fallback)', async () => {
    expect(await resolveClaudePid('zzz', { run: async () => list })).toBeNull();
    expect(await resolveClaudePid('a', { run: async () => '[]' })).toBeNull();
  });
  it('returns null on command error or bad json', async () => {
    expect(await resolveClaudePid('a', { run: async () => { throw new Error('x'); } })).toBeNull();
    expect(await resolveClaudePid('a', { run: async () => 'nope' })).toBeNull();
    expect(await resolveClaudePid('a', { run: async () => '{}' })).toBeNull();
  });
});
