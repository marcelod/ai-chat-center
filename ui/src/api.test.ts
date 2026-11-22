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

// Audit S4-S3: a tab left open must not send its messages to whatever listens on the port after the hub
// is gone. It asks for the port-bound HMAC proof before connecting and before every message.
describe('hub verification', () => {
  const TOKEN = 'a'.repeat(64);
  /** The hub's proof, computed independently with WebCrypto (synchronous answers are precomputed per call). */
  const hmac = async (token: string, msg: string) => {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg))), (x) => x.toString(16).padStart(2, '0')).join('');
  };
  const proof = (token: string, challenge: string, port: number, pid: number, version: string) =>
    hmac(token, `${challenge}|${port}|${pid}|${version}`);
  const port = () => Number(window.location.port || 80);
  /** Answers may hold a pending proof: wait for it. */
  const resolveProof = async (a: unknown) => {
    const o = a as Record<string, unknown>;
    return o && o.proof instanceof Promise ? { ...o, proof: await o.proof } : o;
  };
  /** fetch stub: /api/health answers with `prove(challenge)`; records every request. */
  const stub = (prove: (c: string) => unknown, status = 200) => {
    const seen: { url: string; method: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        seen.push({ url, method: init?.method ?? 'GET' });
        const c = /challenge=([0-9a-f]+)/.exec(url)?.[1];
        if (url.startsWith('/api/health')) return new Response(JSON.stringify(await resolveProof(prove(c ?? ''))), { status });
        return new Response(JSON.stringify({ id: 'm1' }), { status: 202 });
      }),
    );
    return seen;
  };
  beforeEach(() => window.history.replaceState(null, '', `/#token=${TOKEN}`));

  it('ok for the proof of a hub holding this token on this port', async () => {
    stub((c) => ({ ok: true, pid: 7, version: '0.2.3', proof: proof(TOKEN, c, port(), 7, '0.2.3') }));
    const api = await load();
    expect(await api.verifyHub()).toBe('ok');
  });
  it('mismatch for another token, another port, no proof, or an error status', async () => {
    for (const answer of [
      (c: string) => ({ ok: true, pid: 7, version: 'v', proof: proof('b'.repeat(64), c, port(), 7, 'v') }),
      (c: string) => ({ ok: true, pid: 7, version: 'v', proof: proof(TOKEN, c, port() + 1, 7, 'v') }),
      () => ({ ok: true, version: 'v' }),
    ]) {
      stub(answer);
      const api = await load();
      expect(await api.verifyHub()).toBe('mismatch');
    }
    stub(() => ({ error: 'not found' }), 404);
    expect(await (await load()).verifyHub()).toBe('mismatch');
  });
  it('unreachable when nothing answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    expect(await (await load()).verifyHub()).toBe('unreachable');
  });
  it('sendMessage never POSTs to a server that cannot prove itself, and drops the token', async () => {
    const seen = stub(() => ({ ok: true, pid: 7, version: 'v', proof: 'f'.repeat(64) }));
    const api = await load();
    let lost = 0;
    api.onAuthLost(() => void lost++);
    await expect(api.sendMessage('s1', 'secret text')).rejects.toMatchObject({ status: 401 });
    expect(seen.some((r) => r.method === 'POST')).toBe(false);
    expect(lost).toBe(1);
    expect(api.hasToken()).toBe(false);
  });
  it('sendMessage POSTs once the hub proved itself', async () => {
    const seen = stub((c) => ({ ok: true, pid: 7, version: 'v', proof: proof(TOKEN, c, port(), 7, 'v') }));
    const api = await load();
    expect(await api.sendMessage('s1', 'hi')).toEqual({ id: 'm1' });
    expect(seen.map((r) => r.method)).toEqual(['GET', 'POST']);
  });
});
