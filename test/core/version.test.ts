import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { PROTOCOL, VERSION } from '../../src/core/version.js';
import { verifyMessage } from '../../src/core/secret.js';

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

  // Audit R5-M1: a hub refuses sends to a session whose registration carries another PROTOCOL. The number
  // must change with every change of the hub <-> waiter message format, or mixed versions lose messages.
  it('PROTOCOL is pinned to the message signature format (change one, bump the other)', () => {
    const secret = 'a'.repeat(64);
    const m = { id: 'i1', createdAt: '2026-01-01T00:00:00.000Z', text: 'hi' };
    const sig = crypto.createHmac('sha256', secret).update(`v2|s1|${m.id}|${m.createdAt}|${m.text}`).digest('hex');
    expect(verifyMessage({ ...m, sig }, 's1', secret), 'the signature format changed: bump PROTOCOL in src/core/version.ts').toBe(true);
    expect(PROTOCOL, 'PROTOCOL changed: update this test with the new signature format').toBe(2);
  });
});
