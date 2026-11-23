import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readGitBranch } from '../../src/core/gitBranch.js';
import { tmpDir } from '../helpers/tmp.js';

const HASH = 'abcdef0123456789abcdef0123456789abcdef01';

describe('readGitBranch', () => {
  it('reads the branch of the repo root', async () => {
    const d = tmpDir('acc-');
    fs.mkdirSync(path.join(d, '.git'));
    fs.writeFileSync(path.join(d, '.git', 'HEAD'), 'ref: refs/heads/feat/x\n');
    expect(await readGitBranch(d)).toBe('feat/x');
  });
  it('walks up from a subdirectory', async () => {
    const d = tmpDir('acc-');
    fs.mkdirSync(path.join(d, '.git'));
    fs.writeFileSync(path.join(d, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    fs.mkdirSync(path.join(d, 'a', 'b'), { recursive: true });
    expect(await readGitBranch(path.join(d, 'a', 'b'))).toBe('main');
  });
  it('follows gitdir: of a worktree (relative and absolute)', async () => {
    const d = tmpDir('acc-');
    const real = path.join(d, 'main', '.git', 'worktrees', 'w');
    fs.mkdirSync(real, { recursive: true });
    fs.writeFileSync(path.join(real, 'HEAD'), 'ref: refs/heads/wt\n');
    fs.mkdirSync(path.join(d, 'w1'));
    fs.writeFileSync(path.join(d, 'w1', '.git'), `gitdir: ${real}\n`);
    expect(await readGitBranch(path.join(d, 'w1'))).toBe('wt');
    fs.mkdirSync(path.join(d, 'w2'));
    fs.writeFileSync(path.join(d, 'w2', '.git'), 'gitdir: ../main/.git/worktrees/w\n');
    expect(await readGitBranch(path.join(d, 'w2'))).toBe('wt');
  });
  it('detached HEAD gives the first 7 chars', async () => {
    const d = tmpDir('acc-');
    fs.mkdirSync(path.join(d, '.git'));
    fs.writeFileSync(path.join(d, '.git', 'HEAD'), HASH + '\n');
    expect(await readGitBranch(d)).toBe('abcdef0');
  });
  it('no git, unreadable or garbage .git: null, no throw', async () => {
    const d = tmpDir('acc-');
    expect(await readGitBranch(d)).toBeNull();
    fs.mkdirSync(path.join(d, 'r', '.git'), { recursive: true }); // dir without HEAD
    expect(await readGitBranch(path.join(d, 'r'))).toBeNull();
    fs.mkdirSync(path.join(d, 'g'));
    fs.writeFileSync(path.join(d, 'g', '.git'), 'nonsense');
    expect(await readGitBranch(path.join(d, 'g'))).toBeNull();
    fs.mkdirSync(path.join(d, 'h', '.git'), { recursive: true });
    fs.writeFileSync(path.join(d, 'h', '.git', 'HEAD'), 'garbage');
    expect(await readGitBranch(path.join(d, 'h'))).toBeNull();
    expect(await readGitBranch('')).toBeNull();
    expect(await readGitBranch('/does/not/exist')).toBeNull();
  });
});
