import { describe, it, expect } from 'vitest';
import { lookupClaudePid, resolveClaudePid } from '../../src/hooks/claudePid.js';

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

describe('lookupClaudePid', () => {
  it('an empty list is a working lookup that does not list the session', async () => {
    expect(await lookupClaudePid('a', { run: async () => '[]' })).toEqual({ ok: true, pid: null });
    expect(await lookupClaudePid('zzz', { run: async () => list })).toEqual({ ok: true, pid: null });
  });
  it('a non-empty list with no item of the known shape is a failed lookup, never a miss', async () => {
    const unknown = JSON.stringify([{ session_id: 'a', processId: 10 }, { sessionId: 'b', pid: '20' }, null]);
    expect(await lookupClaudePid('a', { run: async () => unknown })).toEqual({ ok: false });
    expect(await resolveClaudePid('a', { run: async () => unknown })).toBeNull();
  });
  it('one known item is enough for the lookup to count', async () => {
    const mixed = JSON.stringify([{ session_id: 'x' }, { pid: 10, sessionId: 'a' }]);
    expect(await lookupClaudePid('b', { run: async () => mixed })).toEqual({ ok: true, pid: null });
  });
});
