import { describe, expect, it } from 'vitest';
import { openApp } from '../../src/hooks/open.js';

describe('openApp (the launcher icon)', () => {
  const HUB = 'http://127.0.0.1:7777/#token=secret';
  it('starts the hub, then opens or reuses the window', async () => {
    const seen: string[] = [];
    const log = (m: string) => void seen.push(m);
    expect(await openApp({ ensureHub: async () => HUB, launch: async (u) => (seen.push(u), 'opened'), log })).toBe('opened');
    expect(seen).toEqual([HUB]);
    expect(await openApp({ ensureHub: async () => HUB, launch: async () => 'reused', log })).toBe('reused');
  });
  it('logs a missing browser and failures, never the token', async () => {
    const seen: string[] = [];
    const log = (m: string) => void seen.push(m);
    expect(await openApp({ ensureHub: async () => HUB, launch: async () => false, log })).toBe('no-browser');
    expect(await openApp({ ensureHub: async () => { throw new Error('hub did not start'); }, log })).toBe('failed');
    expect(await openApp({ ensureHub: async () => HUB, launch: async () => { throw new Error('app window: pair-code answered 401'); }, log })).toBe('failed');
    expect(seen.join('\n')).toMatch(/no Chrome[\s\S]*hub did not start[\s\S]*401/);
    expect(seen.join('\n')).not.toContain('secret');
  });
});
