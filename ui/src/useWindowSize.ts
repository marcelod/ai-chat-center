import { useEffect } from 'react';
import { DEFAULT_WINDOW_SIZE, fitWindowSize, normalizeWindowSize, type WindowSize } from '@shared/windowSize';
import * as api from './api';

/** How long the size must stay the same before it is sent to the hub. */
export const WINDOW_SIZE_SAVE_MS = 1000;

/** A Chrome/Edge `--app` window (as /cc and the launcher open it); an ordinary tab reports `browser`. */
function isAppWindow(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

const sameSize = (a: WindowSize | null, b: WindowSize) => !!a && a.width === b.width && a.height === b.height;

/**
 * Sizes the app window (spec 2026-11-26-window-size). Chrome ignores `--window-size` when it is already
 * running, so the page sizes itself: a window just opened by /cc or the launcher (it loaded with `#pair=`)
 * takes the last saved size, or the default, shrunk to the free area of the screen (`window.resizeTo`
 * works in `--app` windows). Later resizes by the person are sent to the hub once they stop, except a
 * maximized window. Ordinary tabs are left alone.
 */
export function useWindowSize(): void {
  useEffect(() => {
    if (!isAppWindow()) return;
    let stopped = false;
    /** The size the hub already has (or the one this page set itself): not sent again. */
    let known: WindowSize | null = null;
    if (api.openedByPair()) {
      void api
        .getConfig()
        .then((c) => {
          if (stopped) return;
          const saved = normalizeWindowSize(c?.windowSize);
          const target = fitWindowSize(saved ?? DEFAULT_WINDOW_SIZE, { width: window.screen.availWidth, height: window.screen.availHeight });
          known = target;
          if (window.outerWidth === target.width && window.outerHeight === target.height) return;
          try {
            window.resizeTo(target.width, target.height);
          } catch {
            /* the browser may refuse */
          }
        })
        .catch(() => {
          /* no config: the window keeps the browser's size */
        });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      const { availWidth, availHeight } = window.screen;
      // Maximized (or larger): keep the size left before, so the next window does not open screen-sized.
      if (window.outerWidth >= availWidth && window.outerHeight >= availHeight) return;
      const size = normalizeWindowSize({ width: window.outerWidth, height: window.outerHeight });
      if (!size || sameSize(known, size)) return;
      known = size;
      void api.saveWindowSize(size).catch(() => {
        known = null; // try again at the next resize
      });
    };
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(save, WINDOW_SIZE_SAVE_MS);
    };
    window.addEventListener('resize', onResize);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, []);
}
