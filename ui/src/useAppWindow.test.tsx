import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

vi.mock('./api', () => ({ pingWindow: vi.fn(), WINDOW_FOCUS_EVENT: 'acc:window-focus' }));

import * as api from './api';
import { useAppWindow, WINDOW_PING_MS } from './useAppWindow';

function Probe({ select }: { select: (sid: string) => void }) {
  useAppWindow(select);
  return null;
}

const flush = () => act(async () => {});

describe('useAppWindow', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(api.pingWindow).mockReset();
  });

  it('pings with one id, shows a session asked for after the page opened, and says goodbye on unmount', async () => {
    const answers = [{ seq: 3, sessionId: 'old' }, { seq: 3, sessionId: 'old' }, { seq: 4, sessionId: 's9' }];
    vi.mocked(api.pingWindow).mockImplementation(async () => answers.shift() ?? null);
    const select = vi.fn();
    const r = render(<Probe select={select} />);
    await flush();
    // the request already there when the page opened is not for this page
    expect(select).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(WINDOW_PING_MS));
    expect(select).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(WINDOW_PING_MS));
    expect(select).toHaveBeenCalledExactlyOnceWith('s9');
    const ids = new Set(vi.mocked(api.pingWindow).mock.calls.map((c) => c[0]));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toMatch(/^[0-9a-f]{32}$/);
    r.unmount();
    expect(vi.mocked(api.pingWindow).mock.calls.at(-1)).toEqual([[...ids][0], true]);
  });

  it('a failed ping is retried on the next tick', async () => {
    vi.mocked(api.pingWindow).mockRejectedValueOnce(new Error('down')).mockResolvedValue(null);
    render(<Probe select={() => {}} />);
    await flush();
    await act(async () => vi.advanceTimersByTime(WINDOW_PING_MS));
    expect(vi.mocked(api.pingWindow).mock.calls.length).toBe(2);
  });

  it('a focus request from the stream pings at once instead of at the next tick', async () => {
    const answers = [{ seq: 1, sessionId: 'a' }, { seq: 2, sessionId: 's2' }];
    vi.mocked(api.pingWindow).mockImplementation(async () => answers.shift() ?? null);
    const select = vi.fn();
    render(<Probe select={select} />);
    await flush();
    await act(async () => {
      window.dispatchEvent(new Event('acc:window-focus'));
    });
    await flush();
    expect(select).toHaveBeenCalledExactlyOnceWith('s2');
  });

  it('a focus request during the first ping waits for it, so that /cc is not lost', async () => {
    let release!: (v: { seq: number; sessionId: string }) => void;
    vi.mocked(api.pingWindow)
      .mockImplementationOnce(() => new Promise((r) => (release = r)))
      .mockResolvedValue({ seq: 2, sessionId: 's2' });
    const select = vi.fn();
    render(<Probe select={select} />);
    await act(async () => {
      window.dispatchEvent(new Event('acc:window-focus'));
    });
    await act(async () => release({ seq: 1, sessionId: 'old' }));
    await flush();
    expect(select).toHaveBeenCalledExactlyOnceWith('s2');
  });
});
