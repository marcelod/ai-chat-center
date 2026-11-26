import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from '../helpers/tmp.js';
import { fakePng } from '../helpers/png.js';
import { existingSessionFiles, readSessionFile, SessionFileError, type FileRoots } from '../../src/hub/sessionFiles.js';

// Spec 2026-11-26-side-panel: the side panel reads a few file types from the session folder and the
// session's attachments folder only.

function tree() {
  const root = fs.realpathSync.native(tmpDir('acc-files-'));
  const cwd = path.join(root, 'proj');
  const att = path.join(root, 'attachments', 'sid1');
  fs.mkdirSync(path.join(cwd, 'docs'), { recursive: true });
  fs.mkdirSync(att, { recursive: true });
  fs.mkdirSync(path.join(root, 'outside'));
  fs.writeFileSync(path.join(cwd, 'README.md'), '# Hello');
  fs.writeFileSync(path.join(cwd, 'docs', 'spec.md'), '# Spec');
  fs.writeFileSync(path.join(cwd, 'shot.png'), fakePng(2, 2));
  fs.writeFileSync(path.join(cwd, 'fake.png'), 'not an image');
  fs.writeFileSync(path.join(cwd, '.env'), 'SECRET=1');
  fs.writeFileSync(path.join(cwd, 'notes.txt'), 'text');
  fs.writeFileSync(path.join(att, '0123456789abcdef-pic.png'), fakePng(1, 1));
  fs.writeFileSync(path.join(root, 'outside', 'secret.md'), '# Secret');
  fs.symlinkSync(path.join(root, 'outside', 'secret.md'), path.join(cwd, 'link-out.md'));
  fs.symlinkSync(path.join(root, 'outside'), path.join(cwd, 'dir-out'));
  fs.symlinkSync(path.join(cwd, 'docs', 'spec.md'), path.join(cwd, 'link-in.md'));
  fs.symlinkSync(path.join(cwd, '.env'), path.join(cwd, 'env-as.md'));
  fs.mkdirSync(path.join(cwd, 'folder.md'));
  const roots: FileRoots = { base: cwd, roots: [cwd, att, path.join(root, 'no-such-dir')] };
  return { root, cwd, att, roots };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    expect(e).toBeInstanceOf(SessionFileError);
    expect((e as Error).message).not.toMatch(/\//);
    return (e as SessionFileError).code;
  }
};

describe('readSessionFile', () => {
  it('reads Markdown inside the session folder, by absolute or relative path', async () => {
    const { cwd, roots } = tree();
    const a = await readSessionFile(path.join(cwd, 'README.md'), roots);
    expect(a.data.toString()).toBe('# Hello');
    expect(a.type).toBe('text/markdown; charset=utf-8');
    expect(a.kind).toBe('markdown');
    expect((await readSessionFile('docs/spec.md', roots)).data.toString()).toBe('# Spec');
    expect((await readSessionFile('./docs/spec.md', roots)).data.toString()).toBe('# Spec');
  });

  it('reads an image with a fixed type, and an attachment of the session', async () => {
    const { att, roots } = tree();
    const img = await readSessionFile('shot.png', roots);
    expect(img.type).toBe('image/png');
    expect(img.kind).toBe('image');
    const a = await readSessionFile(path.join(att, '0123456789abcdef-pic.png'), roots);
    expect(a.type).toBe('image/png');
  });

  it('refuses an image whose bytes are not that image', async () => {
    const { roots } = tree();
    expect(await code(readSessionFile('fake.png', roots))).toBe('type');
  });

  it('refuses other file types, even through a link with an allowed name', async () => {
    const { roots } = tree();
    expect(await code(readSessionFile('.env', roots))).toBe('type');
    expect(await code(readSessionFile('notes.txt', roots))).toBe('type');
    expect(await code(readSessionFile('env-as.md', roots))).toBe('type');
  });

  it('refuses paths outside the allowed folders, and links that lead out', async () => {
    const { root, roots } = tree();
    expect(await code(readSessionFile(path.join(root, 'outside', 'secret.md'), roots))).toBe('outside');
    expect(await code(readSessionFile('../outside/secret.md', roots))).toBe('outside');
    expect(await code(readSessionFile('link-out.md', roots))).toBe('outside');
    expect(await code(readSessionFile('dir-out/secret.md', roots))).toBe('outside');
    // A missing file behind a link that leaves the folder must not be told apart from an outside one.
    expect(await code(readSessionFile('dir-out/missing.md', roots))).toBe('outside');
  });

  it('follows a link that stays inside', async () => {
    const { roots } = tree();
    expect((await readSessionFile('link-in.md', roots)).data.toString()).toBe('# Spec');
  });

  it('answers not-found for a missing file or a folder', async () => {
    const { roots } = tree();
    expect(await code(readSessionFile('nope.md', roots))).toBe('not-found');
    expect(await code(readSessionFile('folder.md', roots))).toBe('not-found');
  });

  it('refuses invalid paths', async () => {
    const { roots } = tree();
    for (const p of ['', 'a\0b.md', 'x'.repeat(5000) + '.md', 42, null]) expect(await code(readSessionFile(p, roots))).toBe('invalid');
  });

  it('refuses files over the size limit of their type', async () => {
    const { cwd, roots } = tree();
    fs.writeFileSync(path.join(cwd, 'big.md'), Buffer.alloc(2 * 1024 * 1024 + 1, 0x61));
    expect(await code(readSessionFile('big.md', roots))).toBe('too-large');
    fs.writeFileSync(path.join(cwd, 'ok.md'), Buffer.alloc(2 * 1024 * 1024, 0x61));
    expect((await readSessionFile('ok.md', roots)).data.length).toBe(2 * 1024 * 1024);
  });
});

describe('existingSessionFiles', () => {
  it('returns the given paths that resolve to readable files of a known type inside the folders', async () => {
    const { root, cwd, roots } = tree();
    const asked = ['README.md', 'docs/spec.md', 'nope.md', 'link-out.md', '.env', path.join(cwd, 'shot.png'), path.join(root, 'outside', 'secret.md'), 'README.md'];
    expect(await existingSessionFiles(asked, roots)).toEqual(['README.md', 'docs/spec.md', path.join(cwd, 'shot.png')]);
  });

  it('ignores non-strings and caps the number of paths', async () => {
    const { roots } = tree();
    expect(await existingSessionFiles([1, null, 'README.md'], roots)).toEqual(['README.md']);
    expect(await existingSessionFiles('README.md', roots)).toEqual([]);
    const many = Array.from({ length: 300 }, () => 'README.md');
    many.push('docs/spec.md');
    expect(await existingSessionFiles(many, roots)).toEqual(['README.md']);
  });
});
