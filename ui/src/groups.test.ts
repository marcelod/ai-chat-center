import { describe, expect, it } from 'vitest';
import type { SessionView } from '@shared/types';
import { folderName, folderKey, groupActivity, groupByFolder } from './groups';

const s = (id: string, cwd: string, extra: Partial<SessionView> = {}): SessionView =>
  ({ sessionId: id, name: id, cwd, state: 'idle', pendingAppMessageIds: [], ...extra }) as SessionView;

describe('folderName', () => {
  it('takes the last part of the path', () => {
    expect(folderName('/home/me/ai-chat-center')).toBe('ai-chat-center');
    expect(folderName('/home/me/proj/')).toBe('proj');
    expect(folderName('C:\\Users\\me\\proj')).toBe('proj');
    expect(folderName('C:\\Users\\me\\proj\\')).toBe('proj');
  });
  it('falls back to the path itself for a root or an empty path', () => {
    expect(folderName('/')).toBe('/');
    expect(folderName('C:\\')).toBe('C:\\');
    expect(folderName('')).toBe('?');
  });
});

describe('folderKey', () => {
  it('ignores trailing separators', () => {
    expect(folderKey('/a/b/')).toBe('/a/b');
    expect(folderKey('/a/b')).toBe('/a/b');
    expect(folderKey('/')).toBe('/');
  });
});

describe('groupByFolder', () => {
  it('groups by folder keeping the input order (most recent first) for groups and members', () => {
    const list = [s('1', '/p/a'), s('2', '/p/b'), s('3', '/p/a/'), s('4', '/p/c'), s('5', '/p/b')];
    const { pinned, groups } = groupByFolder(list);
    expect(pinned).toEqual([]);
    expect(groups.map((g) => [g.key, g.name, g.sessions.map((x) => x.sessionId)])).toEqual([
      ['/p/a', 'a', ['1', '3']],
      ['/p/b', 'b', ['2', '5']],
      ['/p/c', 'c', ['4']],
    ]);
  });

  it('keeps pinned conversations out of the groups', () => {
    const list = [s('1', '/p/a'), s('2', '/p/a', { pinned: true }), s('3', '/p/b', { pinned: true })];
    const { pinned, groups } = groupByFolder(list);
    expect(pinned.map((x) => x.sessionId)).toEqual(['2', '3']);
    expect(groups.map((g) => g.key)).toEqual(['/p/a']);
    expect(groups[0].sessions.map((x) => x.sessionId)).toEqual(['1']);
  });

  it('gives the full path of the first member as the group path', () => {
    const { groups } = groupByFolder([s('1', '/p/a/')]);
    expect(groups[0].path).toBe('/p/a/');
  });
});

describe('groupActivity', () => {
  it('sums what a closed group must show', () => {
    const { groups } = groupByFolder([
      s('1', '/p', { state: 'busy' }),
      s('2', '/p', { agentsWorking: 2 }),
      s('3', '/p', { agentsWorking: 1, state: 'disconnected' }),
      s('4', '/p'),
    ]);
    expect(groupActivity(groups[0], { '2': 3, '4': 1, x: 9 })).toEqual({ busy: true, agents: 2, unread: 4 });
  });
  it('reports nothing for a quiet group', () => {
    const { groups } = groupByFolder([s('1', '/p')]);
    expect(groupActivity(groups[0], {})).toEqual({ busy: false, agents: 0, unread: 0 });
  });
});
