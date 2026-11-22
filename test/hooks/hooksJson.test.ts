import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

type Hook = { type: string; command: string; asyncRewake?: boolean; async?: boolean; timeout?: number };
type Group = { matcher?: string; hooks: Hook[] };
const cfg = JSON.parse(fs.readFileSync('plugin/hooks/hooks.json', 'utf8')) as { hooks: Record<string, Group[]> };
const all = Object.values(cfg.hooks).flat().flatMap((g) => g.hooks);
const LINE = /^command -v node >\/dev\/null 2>&1 \|\| exit 0; exec node "\$\{CLAUDE_PLUGIN_ROOT\}\/dist\/(hook|waiter)\.mjs"(?: [a-z-]+)?$/;

describe('hooks.json', () => {
  // Audit AI-F1/F2, RT2: missing node is silent, exec ties the hook's lifetime to node, .mjs bundles.
  it('every command is the guarded POSIX exec line for an .mjs bundle', () => {
    expect(all.length).toBeGreaterThan(0);
    for (const h of all) expect(h.command).toMatch(LINE);
  });

  // Audit RT1 / AI-F5: Claude Code enforces `timeout` on asyncRewake hooks (default 600 s).
  it('waiters carry an explicit 24 h timeout', () => {
    const waiters = all.filter((h) => h.asyncRewake);
    expect(waiters).toHaveLength(2);
    for (const h of waiters) expect(h.timeout).toBe(86400);
  });

  // Audit RT6 / AI-F4: never start a rewake waiter on compact (mid-turn) or clear.
  it('Stop runs `waiter stop`; SessionStart runs a rewake `waiter start` only on startup|resume', () => {
    const stop = cfg.hooks.Stop.flatMap((g) => g.hooks);
    expect(stop.map((h) => h.command.split('.mjs"')[1])).toEqual([' stop']);
    const rewake = cfg.hooks.SessionStart.filter((g) => g.hooks.some((h) => h.asyncRewake));
    expect(rewake).toHaveLength(1);
    expect(rewake[0].matcher).toBe('startup|resume');
    expect(rewake[0].hooks[0].command).toMatch(/waiter\.mjs" start$/);
  });

  it('clear and fork only run the session-switch cleanup, in the background and without rewake', () => {
    const other = cfg.hooks.SessionStart.filter((g) => !g.hooks.some((h) => h.asyncRewake));
    expect(other).toHaveLength(1);
    expect(other[0].matcher).toBe('clear|fork');
    expect(other[0].hooks).toEqual([expect.objectContaining({ async: true, command: expect.stringMatching(/waiter\.mjs" start$/) })]);
  });

  it('there is no synchronous session-start hook any more', () => {
    expect(all.some((h) => h.command.includes('session-start'))).toBe(false);
  });

  const sh = process.platform === 'win32' ? null : '/bin/sh';
  it.skipIf(!sh)('runs under sh: exits 0 silently without node; with node, node replaces the shell (exec)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-root-'));
    fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'dist', 'hook.mjs'), 'process.stdout.write(JSON.stringify({ pid: process.pid, argv: process.argv.slice(2) }));');
    const cmd = cfg.hooks.UserPromptSubmit[0].hooks[0].command;
    const noNode = spawnSync(sh!, ['-c', cmd], { env: { CLAUDE_PLUGIN_ROOT: root, PATH: '/nonexistent' }, encoding: 'utf8' });
    expect(noNode.status).toBe(0);
    expect(noNode.stdout).toBe('');
    expect(noNode.stderr).toBe('');
    const binDir = path.dirname(process.execPath);
    const withNode = spawnSync(sh!, ['-c', cmd], { env: { CLAUDE_PLUGIN_ROOT: root, PATH: `${binDir}:/usr/bin:/bin` }, encoding: 'utf8' });
    expect(withNode.status).toBe(0);
    const out = JSON.parse(withNode.stdout) as { pid: number; argv: string[] };
    expect(out.argv).toEqual(['prompt-submit']);
    expect(out.pid).toBe(withNode.pid); // exec: no shell left between Claude Code and node
  });
});
