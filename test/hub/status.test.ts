import { describe, it, expect } from 'vitest';
import { queryStoppedBackground } from '../../src/hub/status.js';

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
