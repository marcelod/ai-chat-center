import { describe, expect, it } from 'vitest';
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  attachmentDisplayName,
  attachmentLine,
  splitAttachments,
  attachmentPaths,
  withAttachments,
} from '../../src/shared/attachments.js';

describe('attachment lines', () => {
  it('limits', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(20 * 1024 * 1024);
    expect(MAX_ATTACHMENTS).toBe(10);
  });
  it('one fixed form, one per line, after the text', () => {
    expect(attachmentLine('/a/b.png')).toBe('[Attachment: /a/b.png]');
    expect(withAttachments('hello ', ['/a/x.png', '/a/y.txt'])).toBe('hello\n[Attachment: /a/x.png]\n[Attachment: /a/y.txt]');
    expect(withAttachments('  ', ['/a/x.png'])).toBe('[Attachment: /a/x.png]');
    expect(withAttachments('only text', [])).toBe('only text');
  });
  it('display name drops the folder and the random prefix', () => {
    expect(attachmentDisplayName('/h/attachments/s1/0123456789abcdef-shot.png')).toBe('shot.png');
    expect(attachmentDisplayName('C:\\h\\att\\s1\\0123456789abcdef-a b.pdf')).toBe('a b.pdf');
    expect(attachmentDisplayName('/x/plain.txt')).toBe('plain.txt');
  });
  it('splits attachment lines out of the text', () => {
    const body = withAttachments('look at this', ['/h/a/s/0123456789abcdef-x.png', '/h/a/s/fedcba9876543210-notes [v2].txt']);
    expect(splitAttachments(body)).toEqual({ text: 'look at this', attachments: ['x.png', 'notes [v2].txt'] });
    expect(splitAttachments(withAttachments('', ['/p/0123456789abcdef-a.png']))).toEqual({ text: '', attachments: ['a.png'] });
    expect(splitAttachments('plain\ntext')).toEqual({ text: 'plain\ntext', attachments: [] });
    expect(splitAttachments('a\r\n[Attachment: /p/0123456789abcdef-a.png]\r\n')).toEqual({ text: 'a', attachments: ['a.png'] });
  });
  it('gives the full paths of the attachment lines, in order (the side panel opens images by path)', () => {
    const body = withAttachments('look', ['/h/a/s/0123456789abcdef-x.png', '/h/a/s/fedcba9876543210-y.txt']);
    expect(attachmentPaths(body)).toEqual(['/h/a/s/0123456789abcdef-x.png', '/h/a/s/fedcba9876543210-y.txt']);
    expect(attachmentPaths('plain')).toEqual([]);
  });
  it('leaves lines that are not exactly the form (relative path, inline) in the text', () => {
    const s = 'see [Attachment: /a.png] inline\n[Attachment: rel/a.png]';
    expect(splitAttachments(s)).toEqual({ text: s, attachments: [] });
  });
});
