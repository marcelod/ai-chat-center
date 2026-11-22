import { beforeEach, describe, expect, it, vi } from 'vitest';

async function load() {
  vi.resetModules();
  return import('./api');
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

describe('token', () => {
  // Audit SEC-F2: the token lives per tab (sessionStorage), never in localStorage.
  it('is stripped from the URL and kept in sessionStorage only', async () => {
    window.history.replaceState(null, '', '/?token=abc&x=1');
    const api = await load();
    expect(api.hasToken()).toBe(true);
    expect(window.location.search).toBe('?x=1');
    expect(sessionStorage.getItem('acc.token')).toBe('abc');
    expect(localStorage.getItem('acc.token')).toBeNull();
  });

  // Audit S3-L4: a query string is sent to the server and kept in browser history (which may sync); a
  // fragment is never sent. /cc prints #token=; the UI reads it, keeps it for the tab and clears it.
  it('is read from the fragment, kept in sessionStorage and cleared from the URL', async () => {
    window.history.replaceState(null, '', '/#token=frag');
    const api = await load();
    expect(api.hasToken()).toBe(true);
    expect(window.location.hash).toBe('');
    expect(window.location.href.includes('frag')).toBe(false);
    expect(sessionStorage.getItem('acc.token')).toBe('frag');
  });
  it('keeps other fragment parameters', async () => {
    window.history.replaceState(null, '', '/#token=frag&view=s1');
    const api = await load();
    expect(api.hasToken()).toBe(true);
    expect(window.location.hash).toBe('#view=s1');
  });

  it('a token left in localStorage by an older version is removed and not used', async () => {
    localStorage.setItem('acc.token', 'old');
    const api = await load();
    expect(api.hasToken()).toBe(false);
    expect(localStorage.getItem('acc.token')).toBeNull();
  });

  it('survives a storage that throws', async () => {
    window.history.replaceState(null, '', '/?token=abc');
    const boom = () => {
      throw new Error('denied');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom);
    try {
      const api = await load();
      expect(api.hasToken()).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('a 401 clears it and notifies', async () => {
    sessionStorage.setItem('acc.token', 'abc');
    const api = await load();
    const lost = vi.fn();
    api.onAuthLost(lost);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    await expect(api.getSessions()).rejects.toThrow();
    expect(lost).toHaveBeenCalled();
    expect(api.hasToken()).toBe(false);
    expect(sessionStorage.getItem('acc.token')).toBeNull();
  });
});
