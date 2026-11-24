import { useEffect, useRef } from 'react';
import * as api from './api';

/** Below the hub's WINDOW_FRESH_MS, even with a hidden page's timers throttled to about once a minute. */
export const WINDOW_PING_MS = 20_000;

const newId = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Keeps this page counted as an open app window, so /cc reuses it instead of opening another one, and
 * shows the session a later /cc asked for. A request that was already there when the page opened is
 * ignored: it was meant for an earlier page.
 */
export function useAppWindow(select: (sessionId: string) => void): void {
  const selectRef = useRef(select);
  selectRef.current = select;
  useEffect(() => {
    const id = newId();
    let lastSeq: number | null = null;
    let stopped = false;
    // One ping at a time: a focus request during the first ping must not be taken as the page's baseline.
    let inFlight = false;
    let again = false;
    const ping = async (): Promise<void> => {
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      try {
        await pingOnce();
      } finally {
        inFlight = false;
      }
      if (again && !stopped) {
        again = false;
        await ping();
      }
    };
    const pingOnce = async () => {
      try {
        const f = await api.pingWindow(id);
        if (stopped) return;
        const seq = f?.seq ?? 0;
        if (lastSeq !== null && f && seq > lastSeq) {
          selectRef.current(f.sessionId);
          try {
            window.focus();
          } catch {
            /* the browser may refuse to raise the window */
          }
        }
        if (lastSeq === null || seq > lastSeq) lastSeq = seq;
      } catch {
        /* hub away or restarting: the next ping tries again */
      }
    };
    void ping();
    const timer = setInterval(() => void ping(), WINDOW_PING_MS);
    // Back to visible: ping now, so a request made while hidden shows up at once.
    const onVisible = () => {
      if (!document.hidden) void ping();
    };
    const onHide = () => void api.pingWindow(id, true);
    const onFocusRequest = () => void ping();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', onHide);
    window.addEventListener(api.WINDOW_FOCUS_EVENT, onFocusRequest);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener(api.WINDOW_FOCUS_EVENT, onFocusRequest);
      void api.pingWindow(id, true);
    };
  }, []);
}
