import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, saveConfig } from '../../src/core/config.js';
import { readJson, writeJsonAtomic } from '../../src/core/fsAtomic.js';
import { tmpDir } from '../helpers/tmp.js';

let tmp: string;
beforeEach(() => {
  tmp = tmpDir('acc-');
  process.env.AI_CHAT_CENTER_HOME = tmp;
});

describe('config', () => {
  it('loadConfig defaults to en, then persists pt-BR', async () => {
    expect(await loadConfig()).toEqual({ language: 'en', answersFromApp: false, openWindow: true });
    await saveConfig({ language: 'pt-BR' });
    expect((await loadConfig()).language).toBe('pt-BR');
  });
  it('saveConfig merges the patch and returns the result', async () => {
    await saveConfig({ answersFromApp: true });
    expect(await saveConfig({ language: 'pt-BR' })).toEqual({ language: 'pt-BR', answersFromApp: true, openWindow: true });
    expect(await loadConfig()).toEqual({ language: 'pt-BR', answersFromApp: true, openWindow: true });
  });
  it('openWindow is on by default and only a saved false turns it off', async () => {
    expect((await loadConfig()).openWindow).toBe(true);
    await saveConfig({ openWindow: false });
    expect((await loadConfig()).openWindow).toBe(false);
    await writeJsonAtomic(path.join(tmp, 'config.json'), { language: 'en', openWindow: 'no' });
    expect((await loadConfig()).openWindow).toBe(true);
  });
  it('an old file without answersFromApp loads as false', async () => {
    await writeJsonAtomic(path.join(tmp, 'config.json'), { language: 'en' });
    expect(await loadConfig()).toEqual({ language: 'en', answersFromApp: false, openWindow: true });
  });
});

describe('config windowSize', () => {
  it('is absent until saved, then loads normalized', async () => {
    expect(await loadConfig()).not.toHaveProperty('windowSize');
    await saveConfig({ windowSize: { width: 1400, height: 900 } });
    expect((await loadConfig()).windowSize).toEqual({ width: 1400, height: 900 });
  });
  it('a hand-edited value is clamped or dropped', async () => {
    await writeJsonAtomic(path.join(tmp, 'config.json'), { language: 'en', windowSize: { width: 99999, height: 10 } });
    expect((await loadConfig()).windowSize).toEqual({ width: 8192, height: 480 });
    await writeJsonAtomic(path.join(tmp, 'config.json'), { language: 'en', windowSize: { width: 'big', height: 900 } });
    expect(await loadConfig()).not.toHaveProperty('windowSize');
  });
});

describe('fsAtomic', () => {
  it('readJson returns null on corrupt or missing file', async () => {
    const f = path.join(tmp, 'bad.json');
    expect(await readJson(f)).toBeNull();
    fs.writeFileSync(f, '{not json');
    expect(await readJson(f)).toBeNull();
  });
  it('writeJsonAtomic creates dirs and leaves no tmp file', async () => {
    const f = path.join(tmp, 'a', 'b.json');
    await writeJsonAtomic(f, { x: 1 });
    expect(await readJson(f)).toEqual({ x: 1 });
    expect(fs.readdirSync(path.dirname(f))).toEqual(['b.json']);
  });
});
