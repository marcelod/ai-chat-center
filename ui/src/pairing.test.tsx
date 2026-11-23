import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// The window opened by /cc arrives at #pair=<code>. The App waits for the trade before its first
// authenticated call, then runs as if it had come from #token=; a failed trade shows the "open the /cc
// link" screen without retrying.

const CODE = 'c'.repeat(64);
const TOKEN = 't'.repeat(64);
const calls: { url: string; auth?: string }[] = [];
let pairOk = true;
const hmac = async (token: string, msg: string) => {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg))), (x) => x.toString(16).padStart(2, '0')).join('');
};

class FakeEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {}
  addEventListener() {}
  close() {}
}

beforeEach(() => {
  calls.length = 0;
  sessionStorage.clear();
  window.history.replaceState(null, '', `/#pair=${CODE}`);
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, auth: ((init?.headers ?? {}) as Record<string, string>).Authorization });
      if (url === '/api/pair') {
        return pairOk ? new Response(JSON.stringify({ token: TOKEN }), { status: 200 }) : new Response('{"error":"invalid code"}', { status: 400 });
      }
      const challenge = /^\/api\/health\?challenge=([0-9a-f]{32})$/.exec(url)?.[1];
      if (challenge) {
        const proof = await hmac(TOKEN, `${challenge}|${Number(window.location.port || 80)}|7|0.4.0`);
        return new Response(JSON.stringify({ ok: true, version: '0.4.0', pid: 7, proof }), { status: 200 });
      }
      if (url === '/api/sessions') return new Response(JSON.stringify({ connected: [], others: [] }), { status: 200 });
      if (url === '/api/config') return new Response(JSON.stringify({ language: 'en', answersFromApp: false }), { status: 200 });
      return new Response('[]', { status: 200 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  pairOk = true;
});

it('trades the code before any authenticated call and opens the app', async () => {
  vi.resetModules();
  const { App } = await import('./App');
  render(<App />);
  expect(window.location.hash).toBe('');
  await waitFor(() => expect(calls.some((c) => c.url === '/api/sessions')).toBe(true));
  await waitFor(() => expect(calls.some((c) => c.url === '/api/config')).toBe(true));
  expect(calls[0].url).toBe('/api/pair');
  for (const c of calls.slice(1).filter((c) => c.auth !== undefined)) expect(c.auth).toBe(`Bearer ${TOKEN}`);
  expect(screen.queryByText('Open the link shown by /cc')).toBeNull();
  expect(sessionStorage.getItem('acc.token')).toBe(TOKEN);
});

it('a code the hub refuses shows the "open the /cc link" screen, without retrying', async () => {
  pairOk = false;
  vi.resetModules();
  const { App } = await import('./App');
  render(<App />);
  await waitFor(() => expect(screen.getByText('Open the link shown by /cc')).toBeInTheDocument());
  await new Promise((r) => setTimeout(r, 50));
  expect(calls.map((c) => c.url)).toEqual(['/api/pair']);
  expect(window.location.hash).toBe('');
});
