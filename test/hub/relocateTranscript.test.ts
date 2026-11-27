import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { findMovedTranscript, transcriptCwd } from '../../src/hub/relocateTranscript.js';
import { tmpDir } from '../helpers/tmp.js';

let projects: string;
const put = (dirName: string, sid = 's1', body = '{}\n') => {
  const d = path.join(projects, dirName);
  fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, `${sid}.jsonl`);
  fs.writeFileSync(f, body);
  return f;
};
beforeEach(() => {
  projects = path.join(tmpDir('acc-reloc-'), 'projects');
  fs.mkdirSync(projects, { recursive: true });
});

describe('findMovedTranscript', () => {
  const old = () => path.join(projects, '-home-u-proj', 's1.jsonl');

  it('looks first in the worktree folders of the same project', async () => {
    const other = put('-home-u-other');
    const wt = put('-home-u-proj--claude-worktrees-site');
    fs.utimesSync(other, new Date(), new Date(Date.now() + 60_000)); // newer, but not the same project
    expect(await findMovedTranscript(old(), 's1', projects)).toBe(wt);
  });

  it('falls back to any other project folder', async () => {
    const other = put('-home-u-other');
    expect(await findMovedTranscript(old(), 's1', projects)).toBe(other);
  });

  it('picks the most recent copy among several worktree folders', async () => {
    const a = put('-home-u-proj--claude-worktrees-a');
    const b = put('-home-u-proj--claude-worktrees-b');
    fs.utimesSync(a, new Date(), new Date(Date.now() - 60_000));
    expect(await findMovedTranscript(old(), 's1', projects)).toBe(b);
  });

  it('returns null when the file is nowhere, or the projects folder does not exist', async () => {
    put('-home-u-other', 's2');
    expect(await findMovedTranscript(old(), 's1', projects)).toBeNull();
    expect(await findMovedTranscript(old(), 's1', path.join(projects, 'nope'))).toBeNull();
  });

  it('ignores symbolic links and rejects a bad session id', async () => {
    const real = put('-home-u-x', 's9');
    fs.mkdirSync(path.join(projects, '-home-u-proj--claude-worktrees-l'), { recursive: true });
    fs.symlinkSync(real, path.join(projects, '-home-u-proj--claude-worktrees-l', 's1.jsonl'));
    expect(await findMovedTranscript(old(), 's1', projects)).toBeNull();
    await expect(findMovedTranscript(old(), '../x', projects)).rejects.toThrow();
  });
});

describe('transcriptCwd', () => {
  it('returns the cwd of the last line that has one', async () => {
    const f = put('-p', 's1', [JSON.stringify({ cwd: '/a' }), JSON.stringify({ cwd: '/b' }), JSON.stringify({ type: 'x' }), 'not json', ''].join('\n'));
    expect(await transcriptCwd(f)).toBe('/b');
  });
  it('returns undefined without one', async () => {
    expect(await transcriptCwd(put('-p', 's1', '{}\n'))).toBeUndefined();
    expect(await transcriptCwd(path.join(projects, 'none.jsonl'))).toBeUndefined();
  });
});
