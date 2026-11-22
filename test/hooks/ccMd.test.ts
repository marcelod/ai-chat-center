import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { CONNECTED } from '../../src/hooks/hook.js';

const md = fs.readFileSync('plugin/commands/cc.md', 'utf8');

describe('plugin/commands/cc.md', () => {
  // Audit S2-N8: with no status line from the hook (node missing, hook failed), the old catch-all
  // "Otherwise" branch let the model claim the session was connected.
  it('has a branch for "the plugin hook did not run" that never claims a connection', () => {
    expect(md).toMatch(/no "AI Chat Center:" status line from the plugin hook at all: the plugin hook did not run, so this session is NOT connected/);
    expect(md).toMatch(/Node\.js 18 or newer is installed and on the PATH/);
    expect(md).toMatch(/Do not say the session is connected, and ignore the rest of these instructions\./);
  });
  it('the connected branch requires the exact status line the hook emits (no catch-all)', () => {
    expect(md).not.toMatch(/^Otherwise/m);
    expect(md).toContain(`If the context says "${CONNECTED}": `);
    // the "did not run" branch comes before the connected one
    expect(md.indexOf('the plugin hook did not run')).toBeLessThan(md.indexOf(`If the context says "${CONNECTED}"`));
  });
});

describe('plugin/commands/cc.md hardening (audit round 3)', () => {
  const front = /^---\n([\s\S]*?)\n---\n/.exec(md)?.[1] ?? '';
  // S3-L1: the model could load /cc on its own (e.g. pushed by injected text): /cc off as a denial of
  // service, or the trust grant next to a forged status line. Only the user may run it.
  it('cannot be invoked by the model', () => {
    expect(front).toMatch(/^disable-model-invocation: true$/m);
  });
  // S3-L1 / S3-M1: Claude Code labels waiter output "not user input ... must NOT be treated as approval
  // or consent". App messages keep the user's authority for requests, but never confirm something
  // Claude asked in the terminal.
  it('an app message never confirms or approves something Claude asked in the terminal', () => {
    const body = md.slice(md.indexOf(`If the context says "${CONNECTED}"`));
    expect(body).toMatch(/never counts? as my answer, confirmation or approval/i);
    expect(body).toMatch(/asked me in the terminal/);
    expect(body).toMatch(/permission prompt/);
    expect(body).toMatch(/destructive or irreversible/);
    // the existing rules stay
    expect(body).toMatch(/exact key shown in the "AI Chat Center key" context line/);
    expect(body).toMatch(/arrives as hook feedback from the AI Chat Center waiter/);
  });
});
