import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent, ProviderChange, SessionsResponse } from '@shared/types';

vi.mock('./api', () => ({
  getSessions: vi.fn(),
  getEvents: vi.fn(),
  sendMessage: vi.fn(),
  openStream: vi.fn(),
}));

import * as api from './api';
import { mergeEvents, nextDelay, useLiveSessions } from './useLiveSessions';

const sessions: SessionsResponse = {
  connected: [
    { sessionId: 's1', name: 'one', cwd: '/a', state: 'idle', pendingAppMessageIds: [] },
    { sessionId: 's2', name: 'two', cwd: '/b', state: 'idle', pendingAppMessageIds: [] },
  ],
  others: [],
};
const a = (id: string, ts: string, text = id): ChatEvent => ({ kind: 'assistant', id, ts, text });

let push: (c: ProviderChange) => void;
let handlers: { onOpen?: () => void; onError?: () => void };

beforeEach(() => {
  vi.mocked(api.getSessions).mockResolvedValue(sessions);
  vi.mocked(api.getEvents).mockResolvedValue([a('e1', '2026-01-01T10:00:00Z')]);
  vi.mocked(api.openStream).mockImplementation((cb, h) => {
    push = cb;
    handlers = h ?? {};
    return () => {};
  });
});
afterEach(() => vi.useRealTimers());

describe('mergeEvents', () => {
  it('replaces by id, appends new and keeps ts order stably', () => {
    const base = [a('1', '2026-01-01T10:00:00Z', 'old'), a('2', '2026-01-01T10:05:00Z')];
    const out = mergeEvents(base, [a('1', '2026-01-01T10:00:00Z', 'new'), a('3', '2026-01-01T10:02:00Z'), a('4', '2026-01-01T10:02:00Z')]);
    expect(out.map((e) => e.id)).toEqual(['1', '3', '4', '2']);
    expect((out[0] as { text: string }).text).toBe('new');
  });
});

describe('mergeEvents ordering', () => {
  it('treats an unparseable ts as 0', () => {
    const out = mergeEvents([a('1', '2026-01-01T10:00:00Z')], [a('2', 'garbage')]);
    expect(out.map((e) => e.id)).toEqual(['2', '1']);
  });
});

describe('nextDelay', () => {
  it('doubles and caps at 10s', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(nextDelay)).toEqual([1000, 2000, 4000, 8000, 10000, 10000, 10000]);
  });
});

describe('useLiveSessions', () => {
  it('fetches events only on first open, then SSE keeps them current', async () => {
    const { result } = renderHook(() => useLiveSessions());
    await waitFor(() => expect(result.current.data.connected).toHaveLength(2));
    expect(api.getEvents).not.toHaveBeenCalled();
    act(() => result.current.select('s1'));
    await waitFor(() => expect(result.current.eventsById.s1).toHaveLength(1));
    act(() => push({ type: 'events', sessionId: 's1', events: [a('e2', '2026-01-01T10:01:00Z')] }));
    expect(result.current.eventsById.s1.map((e) => e.id)).toEqual(['e1', 'e2']);
    act(() => result.current.select(null));
    act(() => result.current.select('s1'));
    expect(api.getEvents).toHaveBeenCalledTimes(1);
  });

  it('reconnects with backoff and resyncs after reconnect', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useLiveSessions());
    await act(async () => {});
    act(() => result.current.select('s1'));
    await act(async () => {});
    expect(api.openStream).toHaveBeenCalledTimes(1);
    vi.mocked(api.getSessions).mockClear();
    vi.mocked(api.getEvents).mockClear();
    act(() => handlers.onError?.());
    await act(async () => void vi.advanceTimersByTime(999));
    expect(api.openStream).toHaveBeenCalledTimes(1);
    await act(async () => void vi.advanceTimersByTime(1));
    expect(api.openStream).toHaveBeenCalledTimes(2);
    act(() => handlers.onError?.());
    await act(async () => void vi.advanceTimersByTime(1999));
    expect(api.openStream).toHaveBeenCalledTimes(2);
    await act(async () => void vi.advanceTimersByTime(1));
    expect(api.openStream).toHaveBeenCalledTimes(3);
    await act(async () => void handlers.onOpen?.());
    expect(api.getSessions).toHaveBeenCalled();
    expect(api.getEvents).toHaveBeenCalledWith('s1');
  });

  it('send adds a pending item that is dropped when the matching user event arrives', async () => {
    vi.mocked(api.sendMessage).mockResolvedValue({ id: 'm1' });
    const { result } = renderHook(() => useLiveSessions());
    await waitFor(() => expect(result.current.data.connected).toHaveLength(2));
    await act(async () => result.current.send('s1', 'hi'));
    expect(result.current.pending.s1).toEqual([expect.objectContaining({ id: 'm1', text: 'hi' })]);
    act(() =>
      push({
        type: 'events',
        sessionId: 's1',
        events: [{ kind: 'user', id: 'u', ts: '2026-01-01T10:03:00Z', text: 'hi', origin: 'app', appMessageId: 'm1' }],
      }),
    );
    expect(result.current.pending.s1 ?? []).toEqual([]);
  });

  const withPending = (ids: string[], state: 'idle' | 'busy' | 'waiting' | 'disconnected' = 'busy'): SessionsResponse => ({
    ...sessions,
    connected: [{ ...sessions.connected[0], state, pendingAppMessageIds: ids }, sessions.connected[1]],
  });
  const userEv = (appMessageId: string): ChatEvent => ({
    kind: 'user',
    id: 'u-' + appMessageId,
    ts: '2026-01-01T10:03:00Z',
    text: 'hi',
    origin: 'app',
    appMessageId,
  });

  it('pending clears when user event arrives', async () => {
    vi.mocked(api.sendMessage).mockResolvedValue({ id: 'm1' });
    vi.mocked(api.getSessions).mockResolvedValue(withPending(['m1']));
    const { result } = renderHook(() => useLiveSessions());
    await waitFor(() => expect(result.current.data.connected).toHaveLength(2));
    await act(async () => result.current.send('s1', 'hi'));
    expect(result.current.pending.s1).toHaveLength(1);
    act(() => push({ type: 'events', sessionId: 's1', events: [userEv('m1')] }));
    expect(result.current.pending.s1).toEqual([]);
  });

  it('pending becomes not-delivered when it leaves pendingAppMessageIds without an event', async () => {
    vi.useFakeTimers();
    vi.mocked(api.sendMessage).mockResolvedValue({ id: 'm1' });
    vi.mocked(api.getSessions).mockResolvedValue(withPending(['m1']));
    const { result } = renderHook(() => useLiveSessions());
    await act(async () => {});
    await act(async () => result.current.send('s1', 'hi'));
    await act(async () => void vi.advanceTimersByTime(10));
    vi.mocked(api.getSessions).mockResolvedValue(withPending([], 'idle'));
    await act(async () => push({ type: 'sessions' }));
    await act(async () => void vi.advanceTimersByTime(4900));
    expect(result.current.pending.s1[0].failed).toBeUndefined();
    await act(async () => void vi.advanceTimersByTime(200));
    expect(result.current.pending.s1[0].failed).toBe(true);
    // retry re-sends the text
    vi.mocked(api.sendMessage).mockResolvedValue({ id: 'm2' });
    await act(async () => result.current.retry('s1', 'm1'));
    expect(api.sendMessage).toHaveBeenLastCalledWith('s1', 'hi');
    expect(result.current.pending.s1.map((m) => m.id)).toEqual(['m2']);
  });

  it.each(['busy', 'waiting'] as const)('never marks a message failed while the session is %s', async (state) => {
    vi.useFakeTimers();
    vi.mocked(api.sendMessage).mockResolvedValue({ id: 'm1' });
    vi.mocked(api.getSessions).mockResolvedValue(withPending(['m1'], 'idle'));
    const { result } = renderHook(() => useLiveSessions());
    await act(async () => {});
    await act(async () => result.current.send('s1', 'hi'));
    await act(async () => void vi.advanceTimersByTime(10));
    // drained (left the queue) and the session is working on it
    vi.mocked(api.getSessions).mockResolvedValue(withPending([], state));
    await act(async () => push({ type: 'sessions' }));
    await act(async () => void vi.advanceTimersByTime(30_000));
    expect(result.current.pending.s1[0].failed).toBeUndefined();
    // still queued while busy: no failure either
    vi.mocked(api.getSessions).mockResolvedValue(withPending(['m1'], state));
    await act(async () => push({ type: 'sessions' }));
    await act(async () => void vi.advanceTimersByTime(30_000));
    expect(result.current.pending.s1[0].failed).toBeUndefined();
  });

  it('a grace window started while idle is cancelled when the session turns busy', async () => {
    vi.useFakeTimers();
    vi.mocked(api.sendMessage).mockResolvedValue({ id: 'm1' });
    vi.mocked(api.getSessions).mockResolvedValue(withPending(['m1'], 'idle'));
    const { result } = renderHook(() => useLiveSessions());
    await act(async () => {});
    await act(async () => result.current.send('s1', 'hi'));
    await act(async () => void vi.advanceTimersByTime(10));
    vi.mocked(api.getSessions).mockResolvedValue(withPending([], 'idle'));
    await act(async () => push({ type: 'sessions' }));
    await act(async () => void vi.advanceTimersByTime(1000));
    vi.mocked(api.getSessions).mockResolvedValue(withPending([], 'busy'));
    await act(async () => push({ type: 'sessions' }));
    await act(async () => void vi.advanceTimersByTime(30_000));
    expect(result.current.pending.s1[0].failed).toBeUndefined();
    // back to idle without the event: a fresh grace window, then not delivered
    vi.mocked(api.getSessions).mockResolvedValue(withPending([], 'idle'));
    await act(async () => push({ type: 'sessions' }));
    await act(async () => void vi.advanceTimersByTime(4900));
    expect(result.current.pending.s1[0].failed).toBeUndefined();
    await act(async () => void vi.advanceTimersByTime(200));
    expect(result.current.pending.s1[0].failed).toBe(true);
  });

  it('pending becomes not-delivered on disconnect', async () => {
    vi.mocked(api.sendMessage).mockResolvedValue({ id: 'm1' });
    vi.mocked(api.getSessions).mockResolvedValue(withPending(['m1']));
    const { result } = renderHook(() => useLiveSessions());
    await waitFor(() => expect(result.current.data.connected).toHaveLength(2));
    await act(async () => result.current.send('s1', 'hi'));
    vi.mocked(api.getSessions).mockResolvedValue(withPending([], 'disconnected'));
    await act(async () => push({ type: 'sessions' }));
    expect(result.current.pending.s1[0].failed).toBe(true);
  });

  it('reconnect invalidates non-selected conversations', async () => {
    const { result } = renderHook(() => useLiveSessions());
    await waitFor(() => expect(result.current.data.connected).toHaveLength(2));
    act(() => result.current.select('s1'));
    await waitFor(() => expect(result.current.eventsById.s1).toBeDefined());
    act(() => result.current.select('s2'));
    await waitFor(() => expect(result.current.eventsById.s2).toBeDefined());
    act(() => result.current.select('s1'));
    expect(api.getEvents).toHaveBeenCalledTimes(2);
    act(() => handlers.onError?.());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1050));
    });
    await act(async () => void handlers.onOpen?.());
    expect(api.getEvents).toHaveBeenCalledTimes(3); // s1 (selected) refetched
    act(() => result.current.select('s2'));
    expect(api.getEvents).toHaveBeenCalledTimes(4); // s2 invalidated
  });
});

// Audit RT5: opening the UI (or a hub restart, or /cc again) replays history over SSE; that
// history must not fire one browser notification per old assistant message.
describe('notifications', () => {
  let shown: string[];
  beforeEach(() => {
    shown = [];
    class N {
      static permission = 'granted';
      constructor(_t: string, o: { body: string }) {
        shown.push(o.body);
      }
    }
    vi.stubGlobal('Notification', N);
    localStorage.setItem('acc.notify', '1');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem('acc.notify');
  });

  const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

  it('history replayed after the UI connected fires no notification; a new reply fires one', async () => {
    const old = Array.from({ length: 25 }, (_, i) => a(`h${i}`, `2025-12-01T10:00:${String(i).padStart(2, '0')}Z`, `old ${i}`));
    vi.mocked(api.getSessions).mockResolvedValue({ connected: [{ ...sessions.connected[0], lastEvent: old.at(-1) }], others: [] });
    const { result } = renderHook(() => useLiveSessions());
    await waitFor(() => expect(result.current.data.connected).toHaveLength(1));
    act(() => push({ type: 'events', sessionId: 's1', events: old }));
    expect(shown).toEqual([]);
    act(() => push({ type: 'events', sessionId: 's1', events: [a('n1', iso(1000), 'fresh reply')] }));
    expect(shown).toEqual(['fresh reply']);
  });

  it('a session first seen later does not notify its own backlog', async () => {
    vi.mocked(api.getSessions).mockResolvedValue({ connected: [], others: [] });
    const { result } = renderHook(() => useLiveSessions());
    await waitFor(() => expect(api.getSessions).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    const backlog = a('b1', iso(5), 'written just after the UI opened, before the session was seen');
    vi.mocked(api.getSessions).mockResolvedValue(sessions);
    await new Promise((r) => setTimeout(r, 20));
    act(() => push({ type: 'sessions' }));
    await waitFor(() => expect(result.current.data.connected).toHaveLength(2));
    act(() => push({ type: 'events', sessionId: 's2', events: [backlog] }));
    expect(shown).toEqual([]);
    act(() => push({ type: 'events', sessionId: 's2', events: [a('b2', iso(2000), 'new')] }));
    expect(shown).toEqual(['new']);
  });
});

// Audit R3-F5: queued bubbles lived only in React state: a reload, or a second tab, did not show a
// message that was still queued. The hub now returns the queued messages with their text.
describe('queued messages from the hub', () => {
  it('a message still queued in the hub shows as a queued bubble after a reload', async () => {
    vi.mocked(api.getSessions).mockResolvedValue({
      connected: [
        {
          sessionId: 's1', name: 'one', cwd: '/a', state: 'idle',
          pendingAppMessageIds: ['p1'],
          pendingAppMessages: [{ id: 'p1', text: 'sent before the reload', createdAt: '2026-01-01T10:00:00Z' }],
        },
      ],
      others: [],
    });
    const { result } = renderHook(() => useLiveSessions());
    await waitFor(() => expect(result.current.pending.s1?.map((m) => [m.id, m.text, m.failed ?? false])).toEqual([['p1', 'sent before the reload', false]]));
  });
  it('is not added twice, and not at all once its event arrived', async () => {
    const view = {
      sessionId: 's1', name: 'one', cwd: '/a', state: 'idle' as const,
      pendingAppMessageIds: ['p1'],
      pendingAppMessages: [{ id: 'p1', text: 'x', createdAt: '2026-01-01T10:00:00Z' }],
    };
    vi.mocked(api.getSessions).mockResolvedValue({ connected: [view], others: [] });
    vi.mocked(api.getEvents).mockResolvedValue([
      { kind: 'user', id: 'u1', ts: '2026-01-01T10:00:01Z', text: 'x', origin: 'app', appMessageId: 'p1' },
    ]);
    const { result } = renderHook(() => useLiveSessions());
    await waitFor(() => expect(result.current.pending.s1).toHaveLength(1));
    act(() => push({ type: 'sessions' }));
    await act(async () => {});
    expect(result.current.pending.s1).toHaveLength(1);
    act(() => result.current.select('s1'));
    await waitFor(() => expect(result.current.pending.s1 ?? []).toHaveLength(0));
    act(() => push({ type: 'sessions' }));
    await act(async () => {});
    expect(result.current.pending.s1 ?? []).toHaveLength(0);
  });
});

// Audit S3-L3 / R3-F8: browsers keep EventSource open in background tabs, so the hub ran `claude agents`
// every 5 s as long as any tab existed. The stream now closes while the page is hidden (unless browser
// notifications are on: they are what a hidden tab is for) and reopens, resynced, when it is visible.
describe('page visibility', () => {
  const setHidden = (hidden: boolean) => {
    Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  afterEach(() => setHidden(false));
  it('closes the stream while hidden and reopens it, with a resync, when visible', async () => {
    const closes: number[] = [];
    vi.mocked(api.openStream).mockImplementation((cb, h) => {
      push = cb;
      handlers = h ?? {};
      const n = vi.mocked(api.openStream).mock.calls.length;
      return () => void closes.push(n);
    });
    vi.mocked(api.openStream).mockClear();
    const { result } = renderHook(() => useLiveSessions());
    await waitFor(() => expect(result.current.data.connected).toHaveLength(2));
    expect(api.openStream).toHaveBeenCalledTimes(1);
    const fetches = vi.mocked(api.getSessions).mock.calls.length;
    act(() => setHidden(true));
    expect(closes).toEqual([1]);
    act(() => setHidden(false));
    expect(api.openStream).toHaveBeenCalledTimes(2);
    act(() => handlers.onOpen?.());
    await waitFor(() => expect(vi.mocked(api.getSessions).mock.calls.length).toBeGreaterThan(fetches));
  });
  it('keeps the stream open while hidden when browser notifications are on', async () => {
    const notify = await import('./notify');
    const spy = vi.spyOn(notify, 'notificationsEnabled').mockReturnValue(true);
    let closed = 0;
    vi.mocked(api.openStream).mockImplementation((cb, h) => {
      push = cb;
      handlers = h ?? {};
      return () => void closed++;
    });
    const { result } = renderHook(() => useLiveSessions());
    await waitFor(() => expect(result.current.data.connected).toHaveLength(2));
    act(() => setHidden(true));
    expect(closed).toBe(0);
    spy.mockRestore();
  });
});
