import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Audit S2-N5: after a hub restart the token rotates. EventSource only reports a bare error on the
// 401 from /api/stream, so the tab used to keep a stale list and retry forever. On a stream error the
// UI now asks GET /api/sessions once; its 401 drops the token. Since spec 2026-11-27-old-window-after-update
// a page that had a token shows "the app was updated; this window can be closed" (not the /cc link screen).

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  addEventListener() {}
  close() {}
}

let rotated = false;
const hmac = async (token: string, msg: string) => {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg))), (x) => x.toString(16).padStart(2, '0')).join('');
};
const calls: string[] = [];

beforeEach(() => {
  FakeEventSource.last = null;
  rotated = false;
  calls.length = 0;
  sessionStorage.clear();
  window.history.replaceState(null, '', '/?token=old');
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      calls.push(path);
      const challenge = /^\/api\/health\?challenge=([0-9a-f]{32})$/.exec(path)?.[1];
      if (challenge) {
        // The hub's proof for the token it holds: 'old' before the rotation, a new one after.
        const port = Number(window.location.port || 80);
        const proof = await hmac(rotated ? 'new' : 'old', `${challenge}|${port}|7|0.2.3`);
        return new Response(JSON.stringify({ ok: true, version: '0.2.3', pid: 7, proof }), { status: 200 });
      }
      if (rotated) return new Response('{"error":"unauthorized"}', { status: 401 });
      if (path === '/api/sessions') return new Response(JSON.stringify({ connected: [], others: [] }), { status: 200 });
      if (path === '/api/config') return new Response(JSON.stringify({ language: 'en' }), { status: 200 });
      return new Response('[]', { status: 200 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('a stream error after a token rotation shows the "app was updated" screen', async () => {
  vi.resetModules();
  const { App } = await import('./App');
  render(<App />);
  await waitFor(() => expect(calls).toContain('/api/sessions'));
  await waitFor(() => expect(FakeEventSource.last).not.toBeNull()); // opened once the hub proved itself
  expect(screen.queryByText('Open the link shown by /cc')).toBeNull();

  rotated = true; // the hub restarted with a new token
  calls.length = 0;
  await act(async () => FakeEventSource.last!.onerror?.());
  await waitFor(() => expect(screen.getByText('The app was updated; this window can be closed')).toBeInTheDocument(), { timeout: 5000 });
  expect(screen.queryByText('Open the link shown by /cc')).toBeNull();
  // Audit S4-S3: the reconnect asks for the proof first; the new hub's proof does not match the old token,
  // so the token is dropped without being sent anywhere again.
  expect(calls.some((c) => c.startsWith('/api/health?challenge='))).toBe(true);
  expect(calls.filter((c) => c === '/api/sessions')).toHaveLength(0);
  expect(sessionStorage.getItem('acc.token')).toBeNull();
});
