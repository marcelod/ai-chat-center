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
    expect(s.length).toBeLessThanOrEqual(100);
    expect(s.endsWith('.png')).toBe(true);
    expect(sanitizeFileName('y'.repeat(300)).length).toBeLessThanOrEqual(100);
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
  it('does nothing when there is no attachments folder', async () => {
    await expect(cleanupAttachments(new Set(), Date.now())).resolves.toBeUndefined();
  });
});
