import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Spec 2026-11-27-old-window-after-update: a hub that stops (replaced by a newer version) says `bye` on the
// stream. The window /cc opened (#pair=) closes itself; any page shows "the app was updated; this window
// can be closed" instead of staying empty. A page that loses its token later shows the same screen.

const CODE = 'c'.repeat(64);
const TOKEN = 't'.repeat(64);

class FakeEventSource {
  static last: FakeEventSource | null = null;
  listeners = new Map<string, () => void>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, cb: () => void) {
    this.listeners.set(type, cb);
  }
  close() {
    this.closed = true;
  }
}

const hmac = async (token: string, msg: string) => {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg))), (x) => x.toString(16).padStart(2, '0')).join('');
};
let closeSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  FakeEventSource.last = null;
  sessionStorage.clear();
  closeSpy = vi.fn();
  vi.stubGlobal('close', closeSpy);
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/pair') return new Response(JSON.stringify({ token: TOKEN }), { status: 200 });
      const challenge = /^\/api\/health\?challenge=([0-9a-f]{32})$/.exec(url)?.[1];
      if (challenge) {
        const proof = await hmac(TOKEN, `${challenge}|${Number(window.location.port || 80)}|7|0.6.9`);
        return new Response(JSON.stringify({ ok: true, version: '0.6.9', pid: 7, proof }), { status: 200 });
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
});

async function openApp(hash: string) {
  window.history.replaceState(null, '', `/${hash}`);
  vi.resetModules();
  const { App } = await import('./App');
  render(<App />);
  await waitFor(() => expect(FakeEventSource.last?.listeners.has('bye')).toBe(true));
}

it('the window /cc opened closes itself when the hub says bye, and shows the updated screen', async () => {
  await openApp(`#pair=${CODE}`);
  await act(async () => FakeEventSource.last!.listeners.get('bye')!());
  expect(closeSpy).toHaveBeenCalled();
  expect(screen.getByText('The app was updated; this window can be closed')).toBeInTheDocument();
  expect(FakeEventSource.last!.closed).toBe(true);
  expect(sessionStorage.getItem('acc.token')).toBeNull();
});

it('a tab opened from the link does not try to close itself, it only shows the updated screen', async () => {
  await openApp(`#token=${TOKEN}`);
  await act(async () => FakeEventSource.last!.listeners.get('bye')!());
  expect(closeSpy).not.toHaveBeenCalled();
  expect(screen.getByText('The app was updated; this window can be closed')).toBeInTheDocument();
});
