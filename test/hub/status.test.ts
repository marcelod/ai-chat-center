import { describe, it, expect } from 'vitest';
import { loggedLiveLookup, queryLiveSessions, queryStoppedBackground } from '../../src/hub/status.js';

describe('queryStoppedBackground', () => {
  it('keeps background sessions with no process (stopped or exited), with a valid short id', async () => {
    const list = await queryStoppedBackground(async () =>
      JSON.stringify([
        { pid: 1, cwd: '/a', kind: 'interactive', sessionId: 's0', name: 'i', status: 'idle' },
        { pid: 2, id: '11111111', cwd: '/a', kind: 'background', sessionId: 's1', name: 'running', status: 'idle', state: 'done' },
        { id: '22222222', cwd: '/b', kind: 'background', sessionId: 's2', name: 'stopped', state: 'blocked', startedAt: 1700000000000 },
        { id: '33333333', cwd: '/c', kind: 'background', sessionId: 's3', name: 'done', state: 'done' },
        { id: 'bad id', cwd: '/c', kind: 'background', sessionId: 's4', name: 'x', state: 'done' },
        { id: '44444444', cwd: 3, kind: 'background', sessionId: 's5', name: 'x' },
        { id: '55555555', cwd: '/d', kind: 'background', name: 'no session id' },
        null,
      ]),
    );
    expect(list).toEqual([
      { bgId: '22222222', sessionId: 's2', cwd: '/b', name: 'stopped', state: 'blocked', startedAt: 1700000000000 },
      { bgId: '33333333', sessionId: 's3', cwd: '/c', name: 'done', state: 'done' },
    ]);
  });

  it('null when the lookup fails or is not a list', async () => {
    expect(await queryStoppedBackground(async () => 'nope')).toBeNull();
    expect(await queryStoppedBackground(async () => '{}')).toBeNull();
    expect(
      await queryStoppedBackground(async () => {
        throw new Error('x');
      }),
    ).toBeNull();
  });
});

describe('queryLiveSessions', () => {
  const good = { pid: 1, cwd: '/a', kind: 'interactive', sessionId: 's1', name: 'n', status: 'idle' };
  it('an empty list is a working lookup', async () => {
    expect(await queryLiveSessions(async () => '[]')).toEqual([]);
  });
  it('drops malformed items next to known ones', async () => {
    const list = await queryLiveSessions(async () => JSON.stringify([good, { sessionId: 's2' }]));
    expect(list?.map((l) => l.sessionId)).toEqual(['s1']);
  });
  it('a non-empty list with no item of the known shape is a failed lookup (null), not "no sessions"', async () => {
    const reasons: string[] = [];
    const run = async () => JSON.stringify([{ session_id: 's1', processId: 1 }, null]);
    expect(await queryLiveSessions(run, (r) => reasons.push(r))).toBeNull();
    expect(reasons).toEqual(['unknown item shape']);
  });
  it('reports why a lookup failed, without the output or the error text', async () => {
    const reasons: string[] = [];
    const note = (r: string) => reasons.push(r);
    await queryLiveSessions(async () => 'nope secret', note);
    await queryLiveSessions(async () => '{"a":"secret"}', note);
    await queryLiveSessions(async () => { throw Object.assign(new Error('secret'), { code: 'ENOENT' }); }, note);
    await queryLiveSessions(async () => { throw new Error('secret'); }, note);
    expect(reasons).toEqual(['not JSON', 'not a list', 'command failed (ENOENT)', 'command failed']);
  });
});

describe('loggedLiveLookup', () => {
  it('logs a failed lookup at most once per interval, with the count of the ones it held back', async () => {
    let now = 0;
    let out = '[]';
    const lines: string[] = [];
    const lookup = loggedLiveLookup((m) => lines.push(m), { everyMs: 300_000, now: () => now, run: async () => out });
    expect(await lookup()).toEqual([]);
    expect(lines).toEqual([]);
    out = '[{"x":1}]';
    expect(await lookup()).toBeNull();
    expect(lines).toEqual(['claude agents lookup failed: unknown item shape']);
    now = 1000;
    await lookup();
    await lookup();
    expect(lines).toHaveLength(1);
    now = 300_000;
    out = 'nope';
    await lookup();
    expect(lines).toEqual(['claude agents lookup failed: unknown item shape', 'claude agents lookup failed: not JSON (2 more since the last note)']);
    now = 300_001;
    out = '[]';
    expect(await lookup()).toEqual([]);
    expect(lines).toHaveLength(2);
  });
});
