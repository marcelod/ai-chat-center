// File helpers shared by the launchers of the three systems: an atomic "write only if it changed", and the
// ICO (Windows) and ICNS (macOS) containers built around one PNG, so no image library is needed.
import fs from 'node:fs';
import path from 'node:path';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Writes a file atomically, only when its bytes differ (a same-content file only gets its mode fixed). */
export function writeIfChanged(file: string, data: Buffer, mode = 0o644): void {
  try {
    if (fs.readFileSync(file).equals(data)) {
      if (process.platform !== 'win32' && (fs.statSync(file).mode & 0o777) !== mode) fs.chmodSync(file, mode);
      return;
    }
  } catch {
    /* missing: write it */
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode });
  // The umask may have narrowed the mode given to writeFileSync.
  if (process.platform !== 'win32') fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
}

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE) || png.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error('icon: not a PNG');
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** An ICO with the PNG as its only image (PNG-in-ICO, read by Windows since Vista). At most 256x256. */
export function pngToIco(png: Buffer): Buffer {
  const { width, height } = pngSize(png);
  if (width > 256 || height > 256) throw new Error('icon: an ICO image is at most 256x256');
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); // reserved
  head.writeUInt16LE(1, 2); // 1 = icon
  head.writeUInt16LE(1, 4); // one image
  head[6] = width === 256 ? 0 : width; // 0 means 256
  head[7] = height === 256 ? 0 : height;
  head[8] = 0; // no palette
  head[9] = 0; // reserved
  head.writeUInt16LE(1, 10); // colour planes
  head.writeUInt16LE(32, 12); // bits per pixel
  head.writeUInt32LE(png.length, 14);
  head.writeUInt32LE(22, 18); // the image starts right after this header
  return Buffer.concat([head, png]);
}

/** An ICNS with the PNG as its ic09 (512x512) element. */
export function pngToIcns(png: Buffer): Buffer {
  const { width, height } = pngSize(png);
  if (width !== 512 || height !== 512) throw new Error('icon: the ic09 element must be 512x512');
  const head = Buffer.alloc(16);
  head.write('icns', 0, 'latin1');
  head.writeUInt32BE(16 + png.length, 4);
  head.write('ic09', 8, 'latin1');
  head.writeUInt32BE(8 + png.length, 12);
  return Buffer.concat([head, png]);
}
