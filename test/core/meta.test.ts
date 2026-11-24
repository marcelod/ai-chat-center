import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import { getEffort, getMode, setEffort, setMode, shortModel } from '../../src/core/meta.js';
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

describe('meta: permission mode', () => {
  it('sets and gets the mode, keeping the effort', async () => {
    await setEffort('s1', 'high');
    expect(await getMode('s1')).toBeNull();
    await setMode('s1', 'auto');
    await setMode('s1', 'acceptEdits');
    expect(await getMode('s1')).toBe('acceptEdits');
    expect(await getEffort('s1')).toBe('high');
    await setEffort('s1', 'low');
    expect(await getMode('s1')).toBe('acceptEdits');
  });
  it('ignores values that are not a short word of letters', async () => {
    for (const bad of ['', 'a'.repeat(25), 'x y', '../x', '<b>', 5, null, undefined, {}]) {
      await setMode('s1', bad as never);
    }
    expect(await getMode('s1')).toBeNull();
    expect(fs.existsSync(paths().metaFile('s1'))).toBe(false);
  });
  it('does not trust a tampered file', async () => {
    fs.mkdirSync(paths().metaFile('s1').replace(/s1\.json$/, ''), { recursive: true });
    fs.writeFileSync(paths().metaFile('s1'), JSON.stringify({ mode: 'plan<b>' }));
    expect(await getMode('s1')).toBeNull();
    fs.writeFileSync(paths().metaFile('s1'), JSON.stringify('plan'));
    expect(await getMode('s1')).toBeNull();
    await setMode('s1', 'plan');
    expect(await getMode('s1')).toBe('plan');
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
