import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const plugin = JSON.parse(fs.readFileSync('plugin/.claude-plugin/plugin.json', 'utf8')) as { description: string };
const market = JSON.parse(fs.readFileSync('.claude-plugin/marketplace.json', 'utf8')) as {
  description: string;
  plugins: { description: string }[];
};
const REQ = 'Requires Node.js 18+ on PATH and Claude Code ≥ 2.1.139';

// Audit S3-M2: without Node on PATH every hook errors in every session; users must see the requirement
// when they install (the native Claude Code installer does not install Node).
describe('install-time descriptions', () => {
  it('state the Node and Claude Code requirements', () => {
    expect(plugin.description).toContain(REQ);
    expect(market.description).toContain(REQ);
    for (const p of market.plugins) expect(p.description).toContain(REQ);
  });
  it('the READMEs say the native installer does not install Node', () => {
    expect(fs.readFileSync('README.md', 'utf8')).toMatch(/native Claude Code installer does not install Node/);
    expect(fs.readFileSync('README.pt-BR.md', 'utf8')).toMatch(/instalador nativo do Claude Code não instala o Node/);
  });
});
