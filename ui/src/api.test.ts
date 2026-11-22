import { beforeEach, describe, expect, it, vi } from 'vitest';

async function load() {
  vi.resetModules();
  return import('./api');
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

describe('token', () => {
  it('is stripped from the URL and stored', async () => {
    window.history.replaceState(null, '', '/?token=abc&x=1');
    const api = await load();
    expect(api.hasToken()).toBe(true);
    expect(window.location.search).toBe('?x=1');
    expect(localStorage.getItem('acc.token')).toBe('abc');
  });

  it('a 401 clears it and notifies', async () => {
    localStorage.setItem('acc.token', 'abc');
    const api = await load();
    const lost = vi.fn();
    api.onAuthLost(lost);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    await expect(api.getSessions()).rejects.toThrow();
    expect(lost).toHaveBeenCalled();
    expect(api.hasToken()).toBe(false);
    expect(localStorage.getItem('acc.token')).toBeNull();
  });
});
