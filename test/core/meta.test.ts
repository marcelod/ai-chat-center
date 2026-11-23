import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import { getEffort, setEffort, shortModel } from '../../src/core/meta.js';
import { paths } from '../../src/core/paths.js';
import { tmpDir } from '../helpers/tmp.js';

beforeEach(() => {
  process.env.AI_CHAT_CENTER_HOME = tmpDir('acc-');
});

describe('meta', () => {
  it('sets and gets effort', async () => {
    expect(await getEffort('s1')).toBeNull();
    await setEffort('s1', 'high');
    expect(await getEffort('s1')).toBe('high');
    await setEffort('s1', 'low');
    expect(await getEffort('s1')).toBe('low');
  });
  it('ignores values that are not a short lowercase word', async () => {
    for (const bad of ['', 'High', 'a'.repeat(17), 'x y', '../x', 5, null, undefined, {}]) {
      await setEffort('s1', bad as never);
    }
    expect(await getEffort('s1')).toBeNull();
    expect(fs.existsSync(paths().metaFile('s1'))).toBe(false);
  });
  it('rejects an invalid session id', async () => {
    await expect(setEffort('../x', 'high')).rejects.toThrow();
  });
  it('does not trust a tampered file', async () => {
    fs.mkdirSync(paths().home, { recursive: true });
    fs.mkdirSync(paths().metaFile('s1').replace(/s1\.json$/, ''), { recursive: true });
    fs.writeFileSync(paths().metaFile('s1'), JSON.stringify({ effort: '<b>' }));
    expect(await getEffort('s1')).toBeNull();
  });
});

describe('shortModel', () => {
  it('shortens known families', () => {
    expect(shortModel('claude-opus-5-5')).toBe('Opus 5.5');
    expect(shortModel('claude-sonnet-5-5')).toBe('Sonnet 5.5');
    expect(shortModel('claude-haiku-5-5')).toBe('Haiku 5.5');
    expect(shortModel('claude-fable-5-2')).toBe('Fable 5.2');
    expect(shortModel('claude-opus-4-1-20250805')).toBe('Opus 4.1');
    expect(shortModel('claude-opus-4-20250514')).toBe('Opus 4');
    expect(shortModel('claude-opus-5')).toBe('Opus 5');
  });
  it('leaves unknown ids as they came', () => {
    expect(shortModel('gpt-x')).toBe('gpt-x');
    expect(shortModel('claude-weird-1')).toBe('claude-weird-1');
  });
});
