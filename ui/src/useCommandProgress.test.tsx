import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent, SessionView } from '@shared/types';
import { QUICK_MS, useCommandProgress } from './useCommandProgress';

// Spec 2026-11-25-app-batch: saying when a command typed from the app has finished.

beforeEach(() => vi.useFakeTimers({ now: Date.parse('2026-11-25T10:00:00.000Z') }));
afterEach(() => vi.useRealTimers());

type P = { state: SessionView['state']; events: ChatEvent[] };
const hook = (initial: P) => renderHook(({ state, events }: P) => useCommandProgress({ state }, events), { initialProps: initial });

describe('useCommandProgress', () => {
  it('/compact ends with the compact summary, not before', () => {
    const h = hook({ state: 'idle', events: [] });
    act(() => h.result.current.started('/compact keep the tests'));
    expect(h.result.current.run).toMatchObject({ cmd: '/compact' });
    act(() => vi.advanceTimersByTime(60_000));
    expect(h.result.current.run?.doneAt).toBeUndefined();
    h.rerender({ state: 'idle', events: [{ kind: 'notice', id: 'n', ts: new Date().toISOString(), code: 'compacted' }] });
    expect(h.result.current.run?.doneAt).toBeDefined();
  });

  it('an older compact summary does not count', () => {
    const old: ChatEvent = { kind: 'notice', id: 'o', ts: '2026-11-25T09:00:00.000Z', code: 'compacted' };
    const h = hook({ state: 'idle', events: [old] });
    act(() => h.result.current.started('/compact'));
    h.rerender({ state: 'idle', events: [old] });
    expect(h.result.current.run?.doneAt).toBeUndefined();
  });

  it('a command that makes the session busy ends when it is idle again', () => {
    const h = hook({ state: 'idle', events: [] });
    act(() => h.result.current.started('/my-skill'));
    h.rerender({ state: 'busy', events: [] });
    act(() => vi.advanceTimersByTime(QUICK_MS * 3));
    expect(h.result.current.run?.doneAt).toBeUndefined();
    h.rerender({ state: 'idle', events: [] });
    expect(h.result.current.run?.doneAt).toBeDefined();
  });

  it('a quick command (/rename) counts as done shortly after', () => {
    const h = hook({ state: 'idle', events: [] });
    act(() => h.result.current.started('/rename x'));
    expect(h.result.current.run?.doneAt).toBeUndefined();
    act(() => vi.advanceTimersByTime(QUICK_MS));
    expect(h.result.current.run).toMatchObject({ cmd: '/rename' });
    expect(h.result.current.run?.doneAt).toBeDefined();
  });
});
