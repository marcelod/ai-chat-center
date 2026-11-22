import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

type Hook = { type: string; command: string; args?: string[]; shell?: string; asyncRewake?: boolean; async?: boolean; timeout?: number };
type Group = { matcher?: string; hooks: Hook[] };
const cfg = JSON.parse(fs.readFileSync('plugin/hooks/hooks.json', 'utf8')) as { hooks: Record<string, Group[]> };
const all = Object.values(cfg.hooks).flat().flatMap((g) => g.hooks);
const SCRIPT = /^\$\{CLAUDE_PLUGIN_ROOT\}\/dist\/(hook|waiter)\.mjs$/;
const event = (h: Hook) => h.args?.[1];

/** What Claude Code does with an exec-form hook: substitute the placeholder, spawn `command` with `args`, no shell. */
const runExec = (h: Hook, root: string, env: NodeJS.ProcessEnv) =>
  spawnSync(h.command, (h.args ?? []).map((a) => a.split('${CLAUDE_PLUGIN_ROOT}').join(root)), { env, encoding: 'utf8', shell: false });

describe('hooks.json', () => {
  // Audit S2 (Windows without Git Bash), S2-N2, R2-N6, RT2, AI-F12: exec form needs no shell on any
  // platform, passes the plugin path as one argument (no quoting), and makes node the direct child.
  it('every hook is exec form: command "node", args [<plugin .mjs bundle>, <event>], no shell', () => {
    expect(all.length).toBeGreaterThan(0);
    for (const h of all) {
      expect(h.type).toBe('command');
      expect(h.command).toBe('node');
      expect(h.args).toHaveLength(2);
      expect(h.args![0]).toMatch(SCRIPT);
      expect(h.args![1]).toMatch(/^[a-z-]+$/);
      expect(h.shell).toBeUndefined();
    }
  });

  it('no POSIX shell syntax is left in any hook', () => {
    for (const h of all) expect(JSON.stringify(h)).not.toMatch(/command -v|exec node|\|\||>\/dev\/null|"\$\{CLAUDE_PLUGIN_ROOT\}[^"]*\s/);
  });

  // Audit RT1 / AI-F5: Claude Code enforces `timeout` on asyncRewake hooks (default 600 s).
  it('waiters carry an explicit 24 h timeout', () => {
    const waiters = all.filter((h) => h.asyncRewake);
    expect(waiters).toHaveLength(3);
    for (const h of waiters) expect(h.timeout).toBe(86400);
  });

  // Audit RT6 / AI-F4: never start a rewake waiter on compact (mid-turn) or clear.
  it('Stop runs `waiter stop`; SessionStart runs a rewake `waiter start` only on startup|resume', () => {
    const stop = cfg.hooks.Stop.flatMap((g) => g.hooks);
    expect(stop.map((h) => [h.args?.[0], event(h)])).toEqual([['${CLAUDE_PLUGIN_ROOT}/dist/waiter.mjs', 'stop']]);
    const rewake = cfg.hooks.SessionStart.filter((g) => g.hooks.some((h) => h.asyncRewake));
    expect(rewake).toHaveLength(1);
    expect(rewake[0].matcher).toBe('startup|resume');
    expect(rewake[0].hooks[0].args).toEqual(['${CLAUDE_PLUGIN_ROOT}/dist/waiter.mjs', 'start']);
  });

  it('clear and fork only run the session-switch cleanup, in the background and without rewake', () => {
    const other = cfg.hooks.SessionStart.filter((g) => !g.hooks.some((h) => h.asyncRewake));
    expect(other).toHaveLength(1);
    expect(other[0].matcher).toBe('clear|fork');
    expect(other[0].hooks).toEqual([
      expect.objectContaining({ async: true, command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/dist/waiter.mjs', 'start'] }),
    ]);
    expect(other[0].hooks[0].asyncRewake).toBeUndefined();
  });

  // Audit R3-F1: an interrupted turn fires no Stop. A rewake waiter armed by UserPromptSubmit exists during
  // every turn (also the turns a delivery wakes), so delivery resumes after Esc. The synchronous prompt
  // hook stays first and separate: /cc needs its context in the same turn.
  it('UserPromptSubmit runs the prompt hook, then a rewake `waiter prompt`', () => {
    const ups = cfg.hooks.UserPromptSubmit.flatMap((g) => g.hooks);
    expect(ups.map((h) => h.args)).toEqual([
      ['${CLAUDE_PLUGIN_ROOT}/dist/hook.mjs', 'prompt-submit'],
      ['${CLAUDE_PLUGIN_ROOT}/dist/waiter.mjs', 'prompt'],
    ]);
    expect(ups[0].async ?? ups[0].asyncRewake).toBeUndefined();
    expect(ups[1]).toMatchObject({ asyncRewake: true, timeout: 86400 });
  });

  it('Notification runs the hook bundle', () => {
    expect(cfg.hooks.Notification.flatMap((g) => g.hooks).map((h) => h.args)).toEqual([['${CLAUDE_PLUGIN_ROOT}/dist/hook.mjs', 'notification']]);
  });

  it('there is no synchronous session-start hook any more', () => {
    expect(all.some((h) => (h.args ?? []).includes('session-start'))).toBe(false);
  });

  it('spawned without a shell: node is the direct child and gets the plugin path as one argument (spaces, quotes)', () => {
    // Quotes are not valid in Windows file names; spaces are.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), process.platform === 'win32' ? 'acc root $x-' : `acc root "q" 'a' $x-`));
    fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'dist', 'hook.mjs'), 'process.stdout.write(JSON.stringify({ pid: process.pid, argv: process.argv.slice(1) }));');
    const h = cfg.hooks.UserPromptSubmit[0].hooks[0];
    const r = runExec(h, root, process.env); // npm puts node on PATH, as it is for Claude Code

    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as { pid: number; argv: string[] };
    expect(out.argv).toEqual([path.join(root, 'dist', 'hook.mjs'), 'prompt-submit']);
    expect(out.pid).toBe(r.pid); // no shell between Claude Code and node
  });

  // Accepted trade-off (round-2 ruling): without node the spawn fails, which Claude Code reports as a
  // visible, non-blocking hook error. It is documented in both READMEs under Requirements.
  it('without node on PATH the spawn fails (a non-blocking hook error), it does not hang', () => {
    const h = cfg.hooks.UserPromptSubmit[0].hooks[0];
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-nopath-'));
    const r = runExec(h, '/nonexistent', { PATH: empty });
    expect((r.error as NodeJS.ErrnoException | undefined)?.code).toBe('ENOENT');
  });
});
