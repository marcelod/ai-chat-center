import { describe, it, expect, beforeEach } from 'vitest';
import { appPresent, writePresence } from '../../src/core/presence.js';
import { writeJsonAtomic } from '../../src/core/fsAtomic.js';
import { paths } from '../../src/core/paths.js';
import { tmpDir } from '../helpers/tmp.js';

beforeEach(() => {
  process.env.AI_CHAT_CENTER_HOME = tmpDir('acc-');
});

const put = (o: object) => writeJsonAtomic(paths().presenceFile, o);

describe('appPresent', () => {
  it('is false without a file', async () => {
    expect(await appPresent()).toBe(false);
  });
  it('is true for the happy path', async () => {
    await writePresence(1);
    expect(await appPresent()).toBe(true);
  });
  it('is false with clients 0', async () => {
    await writePresence(0);
    expect(await appPresent()).toBe(false);
  });
  it('is false when at is 46 s old and true at 44 s', async () => {
    await put({ clients: 1, pid: process.pid, at: Date.now() - 46_000 });
    expect(await appPresent()).toBe(false);
    await put({ clients: 1, pid: process.pid, at: Date.now() - 44_000 });
    expect(await appPresent()).toBe(true);
  });
  it('is false with a dead pid', async () => {
    await put({ clients: 1, pid: 2 ** 22 + 12345, at: Date.now() });
    expect(await appPresent()).toBe(false);
  });
});
