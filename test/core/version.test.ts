import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { VERSION } from '../../src/core/version.js';

const git = (...args: string[]) => spawnSync('git', args, { encoding: 'utf8' });
/** The latest release tag reachable from HEAD (v*), or null (no git, shallow clone, no tags yet). */
const lastTag = (() => {
  const r = git('describe', '--tags', '--abbrev=0', '--match', 'v*');
  return r.status === 0 ? r.stdout.trim() : null;
})();

describe('version', () => {
  it('matches plugin.json and package.json', () => {
    const plugin = JSON.parse(fs.readFileSync('plugin/.claude-plugin/plugin.json', 'utf8'));
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    expect(VERSION).toBe(plugin.version);
    expect(VERSION).toBe(pkg.version);
  });

  // Installed copies update only when plugin.json's version changes: a dist change without a bump
  // would never reach users (and the hub replacement logic keys on VERSION too).
  it.skipIf(!lastTag)('plugin/dist changed since the last release tag only together with a version bump', () => {
    const diff = git('diff', '--quiet', lastTag!, '--', 'plugin/dist');
    expect([0, 1]).toContain(diff.status);
    if (diff.status === 0) return;
    const tagged = JSON.parse(git('show', `${lastTag}:plugin/.claude-plugin/plugin.json`).stdout).version;
    expect(VERSION, `plugin/dist differs from ${lastTag}: bump the version (see README, Releasing)`).not.toBe(tagged);
  });
});
