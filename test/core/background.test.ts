import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  clearBackground,
  getBackground,
  readBackgroundImage,
  saveBackgroundImage,
  setBackground,
  sniffImage,
  validBackgroundPreset,
} from '../../src/core/background.js';
import { paths } from '../../src/core/paths.js';
import { fakePng } from '../helpers/png.js';
import { tmpDir } from '../helpers/tmp.js';

beforeEach(() => {
  process.env.AI_CHAT_CENTER_HOME = tmpDir('acc-');
});

const images = () => {
  try {
    return fs.readdirSync(paths().backgroundsDir).filter((n) => !n.endsWith('.json'));
  } catch {
    return [];
  }
};

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

describe('background', () => {
  it('validBackgroundPreset accepts preset ids and null only', () => {
    expect(validBackgroundPreset(null)).toEqual({ ok: true, value: null });
    expect(validBackgroundPreset({ kind: 'color', value: 'rose' })).toEqual({ ok: true, value: { kind: 'color', value: 'rose' } });
    expect(validBackgroundPreset({ kind: 'gradient', value: 'ocean' })).toEqual({ ok: true, value: { kind: 'gradient', value: 'ocean' } });
    for (const bad of [
      undefined,
      5,
      'rose',
      [],
      {},
      { kind: 'color', value: 'red; background: url(x)' },
      { kind: 'color', value: 'ocean' },
      { kind: 'gradient', value: 'rose' },
      { kind: 'image', file: 'x.png' },
      { kind: 'color', value: 'rose', extra: 1 },
    ]) {
      expect(validBackgroundPreset(bad).ok).toBe(false);
    }
  });

  it('sets, gets and clears a preset', async () => {
    expect(await getBackground('s1')).toBeNull();
    await setBackground('s1', { kind: 'color', value: 'sky' });
    expect(await getBackground('s1')).toEqual({ kind: 'color', value: 'sky' });
    await setBackground('s1', null);
    expect(await getBackground('s1')).toBeNull();
  });

  it('ignores a tampered file', async () => {
    fs.mkdirSync(paths().backgroundsDir, { recursive: true });
    for (const bad of [{ kind: 'color', value: 'nope' }, { kind: 'image', file: '../token' }, { kind: 'image', file: 's2-0123456789abcdef.png' }, 'x']) {
      fs.writeFileSync(paths().backgroundFile('s1'), JSON.stringify(bad));
      expect(await getBackground('s1')).toBeNull();
      expect(await readBackgroundImage('s1')).toBeNull();
    }
  });

  it('rejects an invalid session id', async () => {
    await expect(setBackground('../x', null)).rejects.toThrow();
    await expect(getBackground('../x')).rejects.toThrow();
  });

  it('sniffImage knows png, jpeg, webp and gif by their first bytes', () => {
    expect(sniffImage(fakePng(1, 1))).toBe('png');
    expect(sniffImage(JPEG)).toBe('jpg');
    expect(sniffImage(GIF)).toBe('gif');
    expect(sniffImage(WEBP)).toBe('webp');
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImage(Buffer.from('RIFF\x00\x00\x00\x00WAVE', 'latin1'))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });

  it('saves an image (0600), reads it back, and replaces the previous one', async () => {
    const png = fakePng(2, 2);
    const bg = await saveBackgroundImage('s1', png);
    expect(bg).not.toBeNull();
    expect(bg!.kind).toBe('image');
    expect(await getBackground('s1')).toEqual(bg);
    const file = path.join(paths().backgroundsDir, bg!.file);
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(await readBackgroundImage('s1')).toEqual({ data: png, type: 'image/png' });

    const bg2 = await saveBackgroundImage('s1', GIF);
    expect(bg2!.file).not.toBe(bg!.file);
    expect(images()).toEqual([bg2!.file]);
    expect(await readBackgroundImage('s1')).toEqual({ data: GIF, type: 'image/gif' });
  });

  it('refuses an unknown format and keeps the current background', async () => {
    await setBackground('s1', { kind: 'gradient', value: 'dusk' });
    expect(await saveBackgroundImage('s1', Buffer.from('hello'))).toBeNull();
    expect(await getBackground('s1')).toEqual({ kind: 'gradient', value: 'dusk' });
    expect(images()).toEqual([]);
  });

  it('a preset or none removes the stored image; images of other sessions stay', async () => {
    const other = await saveBackgroundImage('s2', JPEG);
    await saveBackgroundImage('s1', fakePng(1, 1));
    await setBackground('s1', { kind: 'color', value: 'mint' });
    expect(images()).toEqual([other!.file]);
    await saveBackgroundImage('s1', fakePng(1, 1));
    await setBackground('s1', null);
    expect(images()).toEqual([other!.file]);
    expect(await readBackgroundImage('s1')).toBeNull();
  });

  it('clearBackground removes the setting and the image', async () => {
    await saveBackgroundImage('s1', WEBP);
    await clearBackground('s1');
    expect(await getBackground('s1')).toBeNull();
    expect(images()).toEqual([]);
    await clearBackground('s1'); // nothing there: no error
  });
});
