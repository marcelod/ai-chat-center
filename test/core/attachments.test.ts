import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { paths } from '../../src/core/paths.js';
import {
  AttachmentTooLargeError,
  cleanupAttachments,
  sanitizeFileName,
  sessionAttachmentsDir,
  storeAttachment,
} from '../../src/core/attachments.js';
import { tmpDir } from '../helpers/tmp.js';

const posix = process.platform !== 'win32';

beforeEach(() => {
  process.env.AI_CHAT_CENTER_HOME = path.join(tmpDir('acc-'), 'home');
});

describe('sanitizeFileName', () => {
  it('keeps the base name only', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\me\\shot.png')).toBe('shot.png');
    expect(sanitizeFileName('report final.pdf')).toBe('report final.pdf');
  });
  it('strips control characters and never returns a dot name or an empty one', () => {
    expect(sanitizeFileName('a\u0000b\nc\u007f.txt')).toBe('abc.txt');
    expect(sanitizeFileName('..')).toBe('file');
    expect(sanitizeFileName('')).toBe('file');
    expect(sanitizeFileName('/')).toBe('file');
    expect(sanitizeFileName('.bashrc')).toBe('bashrc');
  });
  it('caps the length and keeps the extension', () => {
    const s = sanitizeFileName(`${'x'.repeat(500)}.png`);
    expect(Buffer.byteLength(s)).toBeLessThanOrEqual(200);
    expect(s.endsWith('.png')).toBe(true);
    expect(Buffer.byteLength(sanitizeFileName('y'.repeat(300)))).toBeLessThanOrEqual(200);
  });
  it('caps by UTF-8 bytes without splitting characters', () => {
    const emoji = sanitizeFileName(`${'\u{1F600}'.repeat(150)}.png`); // 4 bytes and 2 UTF-16 units each
    expect(Buffer.byteLength(emoji)).toBeLessThanOrEqual(200);
    expect(emoji.endsWith('.png')).toBe(true);
    expect([...emoji.slice(0, -4)].every((c) => c === '\u{1F600}')).toBe(true);
    const cjk = sanitizeFileName('\u65e5'.repeat(100)); // 3 bytes each, 100 UTF-16 units
    expect(Buffer.byteLength(cjk)).toBeLessThanOrEqual(200);
    expect([...cjk].every((c) => c === '\u65e5')).toBe(true);
    const ext = sanitizeFileName(`${'a'.repeat(300)}.\u00e9\u00e9\u00e9`);
    expect(Buffer.byteLength(ext)).toBeLessThanOrEqual(200);
    expect(ext.endsWith('.\u00e9\u00e9\u00e9')).toBe(true);
  });
  it('stores a long non-ASCII name', async () => {
    const p = await storeAttachment('s1', `${'\u65e5'.repeat(120)}.txt`, Readable.from([Buffer.from('x')]), 100);
    expect(fs.readFileSync(p, 'utf8')).toBe('x');
  });
});

describe('storeAttachment', () => {
  it('writes <dir>/<sid>/<16 hex>-<name>, dir 0700, file 0600', async () => {
    const p = await storeAttachment('s1', 'shot.png', Readable.from([Buffer.from('abc'), Buffer.from('def')]), 100);
    expect(path.isAbsolute(p)).toBe(true);
    expect(path.dirname(p)).toBe(path.join(paths().attachmentsDir, 's1'));
    expect(path.basename(p)).toMatch(/^[0-9a-f]{16}-shot\.png$/);
    expect(fs.readFileSync(p, 'utf8')).toBe('abcdef');
    if (posix) {
      expect(fs.statSync(p).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(p)).mode & 0o777).toBe(0o700);
      expect(fs.statSync(paths().attachmentsDir).mode & 0o777).toBe(0o700);
    }
  });
  it('rejects a body over the limit and leaves no partial file', async () => {
    const src = Readable.from([Buffer.alloc(60), Buffer.alloc(60)]);
    await expect(storeAttachment('s1', 'big.bin', src, 100)).rejects.toBeInstanceOf(AttachmentTooLargeError);
    expect(fs.readdirSync(sessionAttachmentsDir('s1'))).toEqual([]);
  });
  it('rejects an invalid session id', async () => {
    await expect(storeAttachment('../x', 'a', Readable.from([]), 100)).rejects.toThrow();
  });
});

describe('cleanupAttachments', () => {
  const day = 86_400_000;
  it('deletes folders of sessions that no longer exist and files older than 30 days', async () => {
    const now = Date.now();
    const keepOld = await storeAttachment('alive', 'old.txt', Readable.from([Buffer.from('o')]), 100);
    const keepNew = await storeAttachment('alive', 'new.txt', Readable.from([Buffer.from('n')]), 100);
    await storeAttachment('gone', 'x.txt', Readable.from([Buffer.from('x')]), 100);
    fs.mkdirSync(path.join(paths().attachmentsDir, 'bad name!'));
    const old = new Date(now - 31 * day);
    fs.utimesSync(keepOld, old, old);
    await cleanupAttachments(new Set(['alive']), now);
    expect(fs.existsSync(keepOld)).toBe(false);
    expect(fs.existsSync(keepNew)).toBe(true);
    expect(fs.existsSync(sessionAttachmentsDir('gone'))).toBe(false);
    expect(fs.existsSync(path.join(paths().attachmentsDir, 'bad name!'))).toBe(false);
  });
  it('keeps the folder of a session that registered after the snapshot', async () => {
    const late = await storeAttachment('late', 'x.txt', Readable.from([Buffer.from('x')]), 100);
    await storeAttachment('gone', 'y.txt', Readable.from([Buffer.from('y')]), 100);
    const asked: string[] = [];
    await cleanupAttachments(new Set(), Date.now(), undefined, async (sid) => {
      asked.push(sid);
      return sid === 'late';
    });
    expect(fs.existsSync(late)).toBe(true);
    expect(fs.existsSync(sessionAttachmentsDir('gone'))).toBe(false);
    expect(asked.sort()).toEqual(['gone', 'late']);
  });
  it('does nothing when there is no attachments folder', async () => {
    await expect(cleanupAttachments(new Set(), Date.now())).resolves.toBeUndefined();
  });
});
