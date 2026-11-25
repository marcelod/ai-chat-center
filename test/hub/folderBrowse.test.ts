import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from '../helpers/tmp.js';
import { browseFolder, FolderError, isInside, resolveHomeFolder } from '../../src/hub/folderBrowse.js';

// Spec 2026-11-25-any-folder: the folder browser of the "+" dialog. Only folders inside the home folder.

function tree() {
  const root = fs.realpathSync(tmpDir('acc-browse-'));
  const home = path.join(root, 'ana');
  const mk = (...p: string[]) => fs.mkdirSync(path.join(home, ...p), { recursive: true });
  mk('b-proj', 'src');
  mk('A-proj');
  mk('.hidden');
  fs.writeFileSync(path.join(home, 'file.txt'), 'x');
  fs.mkdirSync(path.join(root, 'ana2', 'secret'), { recursive: true });
  fs.mkdirSync(path.join(root, 'outside'));
  fs.symlinkSync(path.join(root, 'outside'), path.join(home, 'link-out'));
  fs.symlinkSync(path.join(root, 'ana2'), path.join(home, 'link-ana2'));
  fs.symlinkSync(path.join(home, 'b-proj', 'src'), path.join(home, 'link-in'));
  fs.symlinkSync(path.join(home, 'file.txt'), path.join(home, 'link-file'));
  fs.symlinkSync(path.join(root, 'missing'), path.join(home, 'link-broken'));
  return { root, home };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    expect(e).toBeInstanceOf(FolderError);
    return (e as FolderError).code;
  }
};

describe('isInside', () => {
  it('compares by path segments, not by string prefix', () => {
    expect(isInside('/home/ana', '/home/ana')).toBe(true);
    expect(isInside('/home/ana', '/home/ana/x/y')).toBe(true);
    expect(isInside('/home/ana', '/home/ana2')).toBe(false);
    expect(isInside('/home/ana', '/home')).toBe(false);
    expect(isInside('/home/ana', '/etc')).toBe(false);
  });
});

describe('browseFolder', () => {
  it('lists only the subfolders of the home folder by default, sorted, hidden ones left out', async () => {
    const { home } = tree();
    const r = await browseFolder(undefined, { home });
    expect(r.path).toBe(home);
    expect(r.parent).toBeNull();
    expect(r.truncated).toBe(false);
    expect(r.entries.map((e) => e.name)).toEqual(['A-proj', 'b-proj', 'link-in']);
    expect(r.entries[0].path).toBe(path.join(home, 'A-proj'));
  });

  it('hidden=true shows the hidden folders too', async () => {
    const { home } = tree();
    const r = await browseFolder(home, { home, hidden: true });
    expect(r.entries.map((e) => e.name)).toContain('.hidden');
  });

  it('a subfolder has its parent; the path is normalized', async () => {
    const { home } = tree();
    const r = await browseFolder(path.join(home, 'b-proj', 'src', '..') + '/', { home });
    expect(r.path).toBe(path.join(home, 'b-proj'));
    expect(r.parent).toBe(home);
    expect(r.entries.map((e) => e.name)).toEqual(['src']);
  });

  it('refuses a path outside the home folder, a look-alike prefix and a link that leads out', async () => {
    const { root, home } = tree();
    expect(await code(browseFolder(root, { home }))).toBe('outside');
    expect(await code(browseFolder(path.join(root, 'ana2'), { home }))).toBe('outside');
    expect(await code(browseFolder(path.join(home, '..', 'outside'), { home }))).toBe('outside');
    expect(await code(browseFolder(path.join(home, 'link-out'), { home }))).toBe('outside');
    expect(await code(browseFolder(path.join(home, 'link-ana2'), { home }))).toBe('outside');
  });

  it('a missing path outside the home folder is "outside" too: nothing tells whether it exists', async () => {
    const { root, home } = tree();
    expect(await code(browseFolder(path.join(root, 'no-such'), { home }))).toBe('outside');
    expect(await code(resolveHomeFolder('/no/such/place', home))).toBe('outside');
  });

  it('refuses a relative path, a missing folder and a file', async () => {
    const { home } = tree();
    expect(await code(browseFolder('ana/b-proj', { home }))).toBe('invalid');
    expect(await code(browseFolder('', { home }))).toBe('invalid');
    expect(await code(browseFolder('/a\0b', { home }))).toBe('invalid');
    expect(await code(browseFolder(path.join(home, 'nope'), { home }))).toBe('not-found');
    expect(await code(browseFolder(path.join(home, 'file.txt'), { home }))).toBe('not-found');
  });

  it('error messages never carry the path', async () => {
    const { root, home } = tree();
    try {
      await browseFolder(path.join(root, 'outside'), { home });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain(root);
    }
  });

  it('caps the entries and says so', async () => {
    const { home } = tree();
    for (let i = 0; i < 12; i++) fs.mkdirSync(path.join(home, 'A-proj', `d${String(i).padStart(2, '0')}`));
    const r = await browseFolder(path.join(home, 'A-proj'), { home, limit: 5 });
    expect(r.entries.map((e) => e.name)).toEqual(['d00', 'd01', 'd02', 'd03', 'd04']);
    expect(r.truncated).toBe(true);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('a folder it cannot read is "denied"', async () => {
    const { home } = tree();
    const locked = path.join(home, 'A-proj');
    fs.chmodSync(locked, 0o000);
    try {
      expect(await code(browseFolder(locked, { home }))).toBe('denied');
    } finally {
      fs.chmodSync(locked, 0o755);
    }
  });
});

describe('resolveHomeFolder', () => {
  it('gives the real path of a folder inside the home folder', async () => {
    const { home } = tree();
    expect(await resolveHomeFolder(path.join(home, 'link-in'), home)).toBe(path.join(home, 'b-proj', 'src'));
    expect(await resolveHomeFolder(home, home)).toBe(home);
  });

  it('refuses what browseFolder refuses', async () => {
    const { root, home } = tree();
    expect(await code(resolveHomeFolder(path.join(root, 'outside'), home))).toBe('outside');
    expect(await code(resolveHomeFolder(path.join(home, 'link-out'), home))).toBe('outside');
    expect(await code(resolveHomeFolder(path.join(home, 'file.txt'), home))).toBe('not-found');
    expect(await code(resolveHomeFolder('rel', home))).toBe('invalid');
  });

  it('works when the home folder itself is a link', async () => {
    const { root, home } = tree();
    const alias = path.join(root, 'home-alias');
    fs.symlinkSync(home, alias);
    expect(await resolveHomeFolder(path.join(alias, 'A-proj'), alias)).toBe(path.join(home, 'A-proj'));
    expect((await browseFolder(undefined, { home: alias })).path).toBe(home);
  });

  it('does not tell whether a path beyond a link out of home exists', async () => {
    const { root, home } = tree();
    fs.mkdirSync(path.join(root, 'outside', 'real'));
    // link-out -> root/outside: one path exists out there, the other does not; both answer "outside"
    expect(await code(resolveHomeFolder(path.join(home, 'link-out', 'real'), home))).toBe('outside');
    expect(await code(resolveHomeFolder(path.join(home, 'link-out', 'nope'), home))).toBe('outside');
    expect(await code(resolveHomeFolder(path.join(home, 'link-out', 'nope', 'deeper'), home))).toBe('outside');
    expect(await code(browseFolder(path.join(home, 'link-out', 'nope'), { home }))).toBe('outside');
    // a missing path really inside home stays not-found
    expect(await code(resolveHomeFolder(path.join(home, 'b-proj', 'nope', 'deeper'), home))).toBe('not-found');
  });
});
