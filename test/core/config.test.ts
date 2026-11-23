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
    expect(await loadConfig()).toEqual({ language: 'en', answersFromApp: false, openWindow: false });
    await saveConfig({ language: 'pt-BR' });
    expect((await loadConfig()).language).toBe('pt-BR');
  });
  it('saveConfig merges the patch and returns the result', async () => {
    await saveConfig({ answersFromApp: true });
    expect(await saveConfig({ language: 'pt-BR' })).toEqual({ language: 'pt-BR', answersFromApp: true, openWindow: false });
    expect(await loadConfig()).toEqual({ language: 'pt-BR', answersFromApp: true, openWindow: false });
  });
  it('openWindow is saved and only true counts', async () => {
    await saveConfig({ openWindow: true });
    expect((await loadConfig()).openWindow).toBe(true);
    await writeJsonAtomic(path.join(tmp, 'config.json'), { language: 'en', openWindow: 'yes' });
    expect((await loadConfig()).openWindow).toBe(false);
  });
  it('an old file without answersFromApp loads as false', async () => {
    await writeJsonAtomic(path.join(tmp, 'config.json'), { language: 'en' });
    expect(await loadConfig()).toEqual({ language: 'en', answersFromApp: false, openWindow: false });
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
