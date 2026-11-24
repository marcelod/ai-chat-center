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

// A window opened by /cc gets #pair=<one-time code> instead of #token=, so the token never sits on the
// browser's command line. The UI clears the fragment at once and trades the code for the token before its
// first authenticated call; a failed trade leaves it with no token (the "open the /cc link" screen).
describe('pairing', () => {
  const CODE = 'c'.repeat(64);
  const TOKEN = 't'.repeat(64);
  type Seen = { url: string; method: string; body?: string; auth?: string };
  const stub = (pair: () => Promise<Response> | Response) => {
    const seen: Seen[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const headers = (init?.headers ?? {}) as Record<string, string>;
        seen.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined, auth: headers.Authorization });
        if (url === '/api/pair') return pair();
        return new Response(JSON.stringify({ connected: [], others: [] }), { status: 200 });
      }),
    );
    return seen;
  };

  it('clears #pair= from the URL at once, trades the code for the token and keeps it like #token=', async () => {
    window.history.replaceState(null, '', `/#pair=${CODE}&view=s1`);
    const seen = stub(() => new Response(JSON.stringify({ token: TOKEN }), { status: 200 }));
    const api = await load();
    expect(window.location.hash).toBe('#view=s1');
    expect(window.location.href.includes(CODE)).toBe(false);
    expect(await api.ready()).toBe(true);
    expect(api.hasToken()).toBe(true);
    expect(sessionStorage.getItem('acc.token')).toBe(TOKEN);
    expect(seen).toEqual([
      { url: '/api/pair', method: 'POST', body: JSON.stringify({ code: CODE }), auth: undefined },
    ]);
  });

  it('an authenticated call made during the trade waits for it and carries the new token', async () => {
    window.history.replaceState(null, '', `/#pair=${CODE}`);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const seen = stub(async () => {
      await gate;
      return new Response(JSON.stringify({ token: TOKEN }), { status: 200 });
    });
    const api = await load();
    const sessions = api.getSessions();
    await new Promise((r) => setTimeout(r, 10));
    expect(seen.map((s) => s.url)).toEqual(['/api/pair']);
    release();
    await sessions;
    expect(seen[1]).toMatchObject({ url: '/api/sessions', auth: `Bearer ${TOKEN}` });
  });

  for (const [name, answer] of [
    ['a 400 (unknown or spent code)', () => new Response('{"error":"invalid code"}', { status: 400 })],
    ['a 200 without a token', () => new Response('{}', { status: 200 })],
    ['a network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
  ] as const) {
    it(`${name} leaves no token, once, with the fragment cleared`, async () => {
      window.history.replaceState(null, '', `/#pair=${CODE}`);
      const seen = stub(answer);
      const api = await load();
      expect(window.location.hash).toBe('');
      expect(await api.ready()).toBe(false);
      expect(api.hasToken()).toBe(false);
      expect(sessionStorage.getItem('acc.token')).toBeNull();
      expect(seen).toHaveLength(1);
    });
  }

  it('a malformed code is cleared and never sent', async () => {
    window.history.replaceState(null, '', '/#pair=not-a-code');
    const seen = stub(() => new Response('{}', { status: 200 }));
    const api = await load();
    expect(window.location.hash).toBe('');
    expect(await api.ready()).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it('#token= wins over #pair= (no trade), and both are cleared', async () => {
    window.history.replaceState(null, '', `/#token=abc&pair=${CODE}`);
    const seen = stub(() => new Response(JSON.stringify({ token: TOKEN }), { status: 200 }));
    const api = await load();
    expect(window.location.hash).toBe('');
    expect(await api.ready()).toBe(true);
    expect(sessionStorage.getItem('acc.token')).toBe('abc');
    expect(seen).toHaveLength(0);
  });

  it('without #pair= ready reflects the stored token', async () => {
    stub(() => new Response('{}', { status: 200 }));
    expect(await (await load()).ready()).toBe(false);
    sessionStorage.setItem('acc.token', 'abc');
    expect(await (await load()).ready()).toBe(true);
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
  const stub = (prove: (c: string) => unknown, status = 200, post: { status: number; body: unknown } = { status: 202, body: { id: 'm1' } }) => {
    const seen: { url: string; method: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        seen.push({ url, method: init?.method ?? 'GET' });
        const c = /challenge=([0-9a-f]+)/.exec(url)?.[1];
        if (url.startsWith('/api/health')) return new Response(JSON.stringify(await resolveProof(prove(c ?? ''))), { status });
        return new Response(JSON.stringify(post.body), { status: post.status });
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
  // Audit R5-M1: the app tells "restart this session" apart from "disconnected" by the 409's code.
  it('a refused send carries the status and the code from the hub', async () => {
    stub((c) => ({ ok: true, pid: 7, version: 'v', proof: proof(TOKEN, c, port(), 7, 'v') }), 200, {
      status: 409,
      body: { error: 'session runs an older version', code: 'session-older-version' },
    });
    const api = await load();
    await expect(api.sendMessage('s1', 'hi')).rejects.toMatchObject({ status: 409, code: 'session-older-version' });
  });
  it('sendMessage POSTs once the hub proved itself', async () => {
    const seen = stub((c) => ({ ok: true, pid: 7, version: 'v', proof: proof(TOKEN, c, port(), 7, 'v') }));
    const api = await load();
    expect(await api.sendMessage('s1', 'hi')).toEqual({ id: 'm1' });
    expect(seen.map((r) => r.method)).toEqual(['GET', 'POST']);
  });
  it('uploadAttachment POSTs the raw file with its type and URI-encoded name once the hub proved itself', async () => {
    stub((c) => ({ ok: true, pid: 7, version: 'v', proof: proof(TOKEN, c, port(), 7, 'v') }), 200, { status: 200, body: { path: '/h/a/s1/x-shot é.png' } });
    const api = await load();
    const file = new File(['abc'], 'shot é.png', { type: 'image/png' });
    expect(await api.uploadAttachment('s 1', file)).toBe('/h/a/s1/x-shot é.png');
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls;
    const [url, init] = calls[calls.length - 1];
    expect(url).toBe('/api/sessions/s%201/attachments');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(file);
    const h = init?.headers as Record<string, string>;
    expect(h['Content-Type']).toBe('image/png');
    expect(h['X-File-Name']).toBe(encodeURIComponent('shot é.png'));
    expect(h.Authorization).toBe(`Bearer ${TOKEN}`);
  });
  it('uploadAttachment never POSTs to a server that cannot prove itself; a refusal carries status and code', async () => {
    const seen = stub(() => ({ ok: true, pid: 7, version: 'v', proof: 'f'.repeat(64) }));
    let api = await load();
    await expect(api.uploadAttachment('s1', new File(['x'], 'a.txt'))).rejects.toMatchObject({ status: 401 });
    expect(seen.some((r) => r.method === 'POST')).toBe(false);
    window.history.replaceState(null, '', `/#token=${TOKEN}`);
    stub((c) => ({ ok: true, pid: 7, version: 'v', proof: proof(TOKEN, c, port(), 7, 'v') }), 200, { status: 409, body: { code: 'session-disconnected' } });
    api = await load();
    await expect(api.uploadAttachment('s1', new File(['x'], 'a.txt'))).rejects.toMatchObject({ status: 409, code: 'session-disconnected' });
  });
});

describe('background', () => {
  const withToken = async () => {
    window.history.replaceState(null, '', '/#token=tok');
    return load();
  };
  it('setBackground PUTs the preset (or null) as JSON with the bearer token', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ background: null }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const api = await withToken();
    await api.setBackground('s 1', { kind: 'color', value: 'rose' });
    await api.setBackground('s1', null);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/sessions/s%201/background');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ kind: 'color', value: 'rose' }));
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', 'Content-Type': 'application/json' });
    expect((f.mock.calls[1] as unknown as [string, RequestInit])[1].body).toBe('null');
  });
  it('uploadBackgroundImage POSTs the raw file with its type; errors carry the status', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ background: { kind: 'image', file: 'x' } }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const api = await withToken();
    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });
    await api.uploadBackgroundImage('s1', file);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/sessions/s1/background-image');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(file);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', 'Content-Type': 'image/png' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 413 })));
    await expect(api.uploadBackgroundImage('s1', file)).rejects.toMatchObject({ status: 413 });
  });
  it('getBackgroundImage fetches the image with the bearer token as a Blob', async () => {
    const f = vi.fn(async () => new Response(new Uint8Array([9]), { status: 200, headers: { 'Content-Type': 'image/png' } }));
    vi.stubGlobal('fetch', f);
    const api = await withToken();
    const b = await api.getBackgroundImage('s1');
    expect(b.size).toBe(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/sessions/s1/background-image');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' });
  });
});
