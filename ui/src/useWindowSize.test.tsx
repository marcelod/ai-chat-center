import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

vi.mock('./api', () => ({ getConfig: vi.fn(), saveWindowSize: vi.fn(), openedByPair: vi.fn() }));

import * as api from './api';
import { useWindowSize, WINDOW_SIZE_SAVE_MS } from './useWindowSize';

function Probe() {
  useWindowSize();
  return null;
}

const flush = () => act(async () => {});

let standalone = true;
let outer = { width: 945, height: 1060 };
let avail = { width: 1920, height: 1040 };
const resizeTo = vi.fn((w: number, h: number) => {
  outer = { width: w, height: h };
});

function define(obj: object, key: string, get: () => unknown) {
  Object.defineProperty(obj, key, { configurable: true, get });
}

function userResize(width: number, height: number) {
  outer = { width, height };
  window.dispatchEvent(new Event('resize'));
}

describe('useWindowSize', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    standalone = true;
    outer = { width: 945, height: 1060 };
    avail = { width: 1920, height: 1040 };
    resizeTo.mockClear();
    window.matchMedia = ((q: string) => ({ matches: q === '(display-mode: standalone)' && standalone, media: q })) as never;
    window.resizeTo = resizeTo as never;
    define(window, 'outerWidth', () => outer.width);
    define(window, 'outerHeight', () => outer.height);
    define(window.screen, 'availWidth', () => avail.width);
    define(window.screen, 'availHeight', () => avail.height);
    vi.mocked(api.openedByPair).mockReturnValue(true);
    vi.mocked(api.getConfig).mockResolvedValue({ language: 'en', answersFromApp: false });
    vi.mocked(api.saveWindowSize).mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(api.getConfig).mockReset();
    vi.mocked(api.saveWindowSize).mockReset();
    vi.mocked(api.openedByPair).mockReset();
  });

  it('a window opened by /cc takes the default size when none was saved, and that resize is not saved back', async () => {
    render(<Probe />);
    await flush();
    expect(resizeTo).toHaveBeenCalledExactlyOnceWith(1280, 860);
    window.dispatchEvent(new Event('resize'));
    await act(async () => vi.advanceTimersByTime(WINDOW_SIZE_SAVE_MS));
    expect(api.saveWindowSize).not.toHaveBeenCalled();
  });

  it('takes the saved size, shrunk to the free area of the screen', async () => {
    vi.mocked(api.getConfig).mockResolvedValue({ language: 'en', answersFromApp: false, windowSize: { width: 1600, height: 1000 } });
    avail = { width: 1440, height: 875 };
    render(<Probe />);
    await flush();
    expect(resizeTo).toHaveBeenCalledExactlyOnceWith(1440, 875);
  });

  it('does not resize a window that is already the right size, or one not opened with a pairing code (a reload)', async () => {
    outer = { width: 1280, height: 860 };
    const r = render(<Probe />);
    await flush();
    expect(resizeTo).not.toHaveBeenCalled();
    r.unmount();
    outer = { width: 945, height: 1060 };
    vi.mocked(api.openedByPair).mockReturnValue(false);
    render(<Probe />);
    await flush();
    expect(resizeTo).not.toHaveBeenCalled();
  });

  it('after a reload, a resize event that leaves the saved size is not sent', async () => {
    vi.mocked(api.openedByPair).mockReturnValue(false);
    vi.mocked(api.getConfig).mockResolvedValue({ language: 'en', answersFromApp: false, windowSize: { width: 1300, height: 800 } });
    outer = { width: 1300, height: 800 };
    render(<Probe />);
    await flush();
    window.dispatchEvent(new Event('resize'));
    await act(async () => vi.advanceTimersByTime(WINDOW_SIZE_SAVE_MS));
    expect(api.saveWindowSize).not.toHaveBeenCalled();
    expect(resizeTo).not.toHaveBeenCalled();
    userResize(1310, 800);
    await act(async () => vi.advanceTimersByTime(WINDOW_SIZE_SAVE_MS));
    expect(api.saveWindowSize).toHaveBeenCalledExactlyOnceWith({ width: 1310, height: 800 });
  });

  it('saves the size the person leaves, once, after the resizing stops', async () => {
    vi.mocked(api.openedByPair).mockReturnValue(false);
    render(<Probe />);
    await flush();
    userResize(1300, 800);
    await act(async () => vi.advanceTimersByTime(WINDOW_SIZE_SAVE_MS / 2));
    userResize(1350, 820);
    await act(async () => vi.advanceTimersByTime(WINDOW_SIZE_SAVE_MS));
    expect(api.saveWindowSize).toHaveBeenCalledExactlyOnceWith({ width: 1350, height: 820 });
    // the same size again is not sent again
    window.dispatchEvent(new Event('resize'));
    await act(async () => vi.advanceTimersByTime(WINDOW_SIZE_SAVE_MS));
    expect(api.saveWindowSize).toHaveBeenCalledTimes(1);
  });

  it('a maximized window is not saved (the size left before stays)', async () => {
    vi.mocked(api.openedByPair).mockReturnValue(false);
    render(<Probe />);
    await flush();
    userResize(1920, 1040);
    await act(async () => vi.advanceTimersByTime(WINDOW_SIZE_SAVE_MS));
    expect(api.saveWindowSize).not.toHaveBeenCalled();
  });

  it('does nothing in an ordinary browser tab', async () => {
    standalone = false;
    render(<Probe />);
    await flush();
    userResize(1300, 800);
    await act(async () => vi.advanceTimersByTime(WINDOW_SIZE_SAVE_MS));
    expect(resizeTo).not.toHaveBeenCalled();
    expect(api.getConfig).not.toHaveBeenCalled();
    expect(api.saveWindowSize).not.toHaveBeenCalled();
  });

  it('stops listening on unmount', async () => {
    vi.mocked(api.openedByPair).mockReturnValue(false);
    const r = render(<Probe />);
    await flush();
    userResize(1300, 800);
    r.unmount();
    await act(async () => vi.advanceTimersByTime(WINDOW_SIZE_SAVE_MS));
    expect(api.saveWindowSize).not.toHaveBeenCalled();
  });
});
