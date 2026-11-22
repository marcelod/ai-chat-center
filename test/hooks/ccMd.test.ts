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
