import { describe, it, expect, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { paths } from '../../src/core/paths.js';

const orig = process.env.AI_CHAT_CENTER_HOME;
afterEach(() => {
  if (orig === undefined) delete process.env.AI_CHAT_CENTER_HOME;
  else process.env.AI_CHAT_CENTER_HOME = orig;
});

describe('paths', () => {
  it('respects AI_CHAT_CENTER_HOME', () => {
    const tmp = os.tmpdir();
    process.env.AI_CHAT_CENTER_HOME = tmp;
    const p = paths();
    expect(p.home).toBe(tmp);
    expect(p.inboxDir('abc')).toBe(path.join(tmp, 'inbox', 'abc'));
    expect(path.isAbsolute(p.waiterLock('abc'))).toBe(true);
    expect(p.busyFile('abc')).toBe(path.join(tmp, 'busy', 'abc'));
  });
  it('defaults to ~/.ai-chat-center', () => {
    delete process.env.AI_CHAT_CENTER_HOME;
    expect(paths().home).toBe(path.join(os.homedir(), '.ai-chat-center'));
  });
});

describe('assertSessionId', () => {
  it('rejects path-traversal session ids', async () => {
    const { paths, assertSessionId } = await import('../../src/core/paths.js');
    for (const bad of ['../x', 'a/b', 'a\\b', '', 'x'.repeat(129)]) {
      expect(() => assertSessionId(bad)).toThrow();
      expect(() => paths().inboxDir(bad)).toThrow();
      expect(() => paths().waiterLock(bad)).toThrow();
      expect(() => paths().waitingFile(bad)).toThrow();
      expect(() => paths().busyFile(bad)).toThrow();
    }
    expect(() => assertSessionId('ok-1_A')).not.toThrow();
  });
});
