import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from '../helpers/tmp.js';
import { fakePng } from '../helpers/png.js';
import { pngSize, pngToIcns, pngToIco, writeIfChanged } from '../../src/hooks/launcherFiles.js';

describe('launcher files', () => {
  it('reads the size of a PNG and rejects anything else', () => {
    expect(pngSize(fakePng(256, 128))).toEqual({ width: 256, height: 128 });
    expect(() => pngSize(Buffer.from('PNG'))).toThrow(/not a PNG/);
  });

  it('an ICO holds one PNG entry (width/height 0 mean 256)', () => {
    const png = fakePng(256, 256);
    const ico = pngToIco(png);
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // icon
    expect(ico.readUInt16LE(4)).toBe(1); // one image
    expect(ico[6]).toBe(0);
    expect(ico[7]).toBe(0);
    expect(ico.readUInt16LE(10)).toBe(1); // planes
    expect(ico.readUInt16LE(12)).toBe(32); // bits per pixel
    expect(ico.readUInt32LE(14)).toBe(png.length);
    expect(ico.readUInt32LE(18)).toBe(22);
    expect(ico.subarray(22).equals(png)).toBe(true);
    expect(pngToIco(fakePng(48, 48))[6]).toBe(48);
    expect(() => pngToIco(fakePng(512, 512))).toThrow(/256/);
  });

  it('an ICNS holds the PNG as an ic09 (512x512) element', () => {
    const png = fakePng(512, 512);
    const icns = pngToIcns(png);
    expect(icns.toString('latin1', 0, 4)).toBe('icns');
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    expect(icns.toString('latin1', 8, 12)).toBe('ic09');
    expect(icns.readUInt32BE(12)).toBe(8 + png.length);
    expect(icns.subarray(16).equals(png)).toBe(true);
    expect(icns.length).toBe(16 + png.length);
    expect(() => pngToIcns(fakePng(256, 256))).toThrow(/512/);
  });

  it('writes only when the content changed, with the given mode', () => {
    const f = path.join(tmpDir(), 'a', 'b', 'x.sh');
    writeIfChanged(f, Buffer.from('1'), 0o755);
    expect(fs.readFileSync(f, 'utf8')).toBe('1');
    if (process.platform !== 'win32') expect(fs.statSync(f).mode & 0o777).toBe(0o755);
    const before = fs.statSync(f).ino;
    writeIfChanged(f, Buffer.from('1'), 0o755);
    expect(fs.statSync(f).ino).toBe(before); // untouched
    if (process.platform !== 'win32') {
      fs.chmodSync(f, 0o644);
      writeIfChanged(f, Buffer.from('1'), 0o755); // same bytes, wrong mode: fixed
      expect(fs.statSync(f).mode & 0o777).toBe(0o755);
    }
    writeIfChanged(f, Buffer.from('2'));
    expect(fs.readFileSync(f, 'utf8')).toBe('2');
    expect(fs.readdirSync(path.dirname(f))).toEqual(['x.sh']); // no temp file left
  });
});
