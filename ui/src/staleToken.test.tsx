import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Audit S2-N5: after a hub restart the token rotates. EventSource only reports a bare error on the
// 401 from /api/stream, so the tab used to keep a stale list and retry forever. On a stream error the
// UI now asks GET /api/sessions once; its 401 drops the token and shows the "open the /cc link" screen.

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
const calls: string[] = [];

beforeEach(() => {
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

it('a stream error after a token rotation shows the "open the /cc link" screen', async () => {
  vi.resetModules();
  const { App } = await import('./App');
  render(<App />);
  await waitFor(() => expect(calls).toContain('/api/sessions'));
  expect(screen.queryByText('Open the link shown by /cc')).toBeNull();

  rotated = true; // the hub restarted with a new token
  calls.length = 0;
  await act(async () => FakeEventSource.last!.onerror?.());
  await waitFor(() => expect(screen.getByText('Open the link shown by /cc')).toBeInTheDocument());
  expect(calls.filter((c) => c === '/api/sessions')).toHaveLength(1);
  expect(sessionStorage.getItem('acc.token')).toBeNull();
});
