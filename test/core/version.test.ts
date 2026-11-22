import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { VERSION } from '../../src/core/version.js';

describe('version', () => {
  it('matches plugin.json and package.json', () => {
    const plugin = JSON.parse(fs.readFileSync('plugin/.claude-plugin/plugin.json', 'utf8'));
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    expect(VERSION).toBe(plugin.version);
    expect(VERSION).toBe(pkg.version);
  });
});
