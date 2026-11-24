import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { isPinned, setPinned } from '../../src/core/pins.js';
import { register, markDisconnected, pruneRegistrations } from '../../src/core/registry.js';
import { tmpDir } from '../helpers/tmp.js';

beforeEach(() => {
  process.env.AI_CHAT_CENTER_HOME = path.join(tmpDir('acc-'), 'home');
});

describe('pins', () => {
  it('sets, gets and clears', async () => {
    expect(await isPinned('s1')).toBe(false);
    await setPinned('s1', true);
    expect(await isPinned('s1')).toBe(true);
    await setPinned('s1', false);
    expect(await isPinned('s1')).toBe(false);
  });
  it('rejects an invalid session id', async () => {
    await expect(setPinned('../x', true)).rejects.toThrow();
  });
  it('survives disconnect and a new register; goes away when the registration is pruned', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t', cwd: '/c', pid: 1 });
    await setPinned('s1', true);
    await markDisconnected('s1', 'off');
    expect(await isPinned('s1')).toBe(true);
    await register({ sessionId: 's1', transcriptPath: '/t', cwd: '/c', pid: 1 });
    expect(await isPinned('s1')).toBe(true);
    await markDisconnected('s1', 'off');
    await pruneRegistrations(-1, Date.now() + 1000);
    expect(await isPinned('s1')).toBe(false);
  });
});
