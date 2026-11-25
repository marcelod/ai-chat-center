import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { installStatusline, isOurs, refreshWrapper, removeStatusline } from '../../src/hooks/statusline.js';
import { readStatuslineState } from '../../src/core/statuslineState.js';
import { paths } from '../../src/core/paths.js';
import { tmpDir } from '../helpers/tmp.js';

let dir: string;
let settingsFile: string;
let source: string;
const opts = () => ({ source, settingsFile, nodePath: '/usr/bin/node' });
const settings = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'));

beforeEach(() => {
  process.env.AI_CHAT_CENTER_HOME = tmpDir('acc-');
  dir = tmpDir('acc-claude-');
  settingsFile = path.join(dir, 'settings.json');
  source = path.join(dir, 'statusline.mjs');
  fs.writeFileSync(source, '// v1');
});

describe('status line wrapper', () => {
  it('on: wraps the existing status line, keeps the other settings, its padding and file mode; off: restores it', async () => {
    const original = { type: 'command', command: '~/.claude/statusline.sh', padding: 0 };
    fs.writeFileSync(settingsFile, JSON.stringify({ model: 'opus', statusLine: original }), { mode: 0o644 });
    expect(await installStatusline(opts())).toBe('installed');
    const s = settings();
    expect(s.model).toBe('opus');
    expect(s.statusLine).toEqual({ type: 'command', command: `"/usr/bin/node" "${paths().statuslineScript.replace(/\\/g, '/')}"`, padding: 0 });
    expect(isOurs(s.statusLine)).toBe(true);
    expect(fs.readFileSync(paths().statuslineScript, 'utf8')).toBe('// v1');
    expect(await readStatuslineState()).toEqual({ original });
    if (process.platform !== 'win32') expect(fs.statSync(settingsFile).mode & 0o777).toBe(0o644);

    expect(await installStatusline(opts())).toBe('refreshed'); // twice: the original is not overwritten by ours
    expect(await readStatuslineState()).toEqual({ original });

    expect(await removeStatusline({ settingsFile })).toBe('restored');
    expect(settings()).toEqual({ model: 'opus', statusLine: original });
    expect(await readStatuslineState()).toBeNull();
  });
  it('without a status line (or settings.json): off removes ours and leaves none', async () => {
    expect(await installStatusline(opts())).toBe('installed');
    expect(isOurs(settings().statusLine)).toBe(true);
    expect(await removeStatusline({ settingsFile })).toBe('restored');
    expect(settings()).toEqual({});
  });
  it('off leaves a status line changed by hand since on', async () => {
    fs.writeFileSync(settingsFile, JSON.stringify({ statusLine: { type: 'command', command: 'a.sh' } }));
    await installStatusline(opts());
    fs.writeFileSync(settingsFile, JSON.stringify({ statusLine: { type: 'command', command: 'b.sh' } }));
    expect(await removeStatusline({ settingsFile })).toBe('changed-since');
    expect(settings().statusLine.command).toBe('b.sh');
    expect(await removeStatusline({ settingsFile })).toBe('not-installed');
  });
  it('never rewrites a settings.json it cannot parse', async () => {
    fs.writeFileSync(settingsFile, '{ "statusLine": ');
    await expect(installStatusline(opts())).rejects.toThrow();
    expect(fs.readFileSync(settingsFile, 'utf8')).toBe('{ "statusLine": ');
  });
  it('refresh copies a new wrapper only when it changed', async () => {
    await refreshWrapper(opts());
    const t1 = fs.statSync(paths().statuslineScript).mtimeMs;
    await refreshWrapper(opts());
    expect(fs.statSync(paths().statuslineScript).mtimeMs).toBe(t1);
    fs.writeFileSync(source, '// v2');
    await refreshWrapper(opts());
    expect(fs.readFileSync(paths().statuslineScript, 'utf8')).toBe('// v2');
  });
});
