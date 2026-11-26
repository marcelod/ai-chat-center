// The size of the app window (spec 2026-11-26-window-size): the app resizes a window opened by /cc or the
// launcher to the last size the person left (or the default) and reports later resizes to the hub, which
// keeps them in config. Shared so the hub and the app clamp the same way.

export interface WindowSize {
  width: number;
  height: number;
}

/** Fits a 1440x900 screen (the window is also shrunk to the free area of the screen). */
export const DEFAULT_WINDOW_SIZE: WindowSize = { width: 1280, height: 860 };
export const MIN_WINDOW_SIZE: WindowSize = { width: 480, height: 480 };
export const MAX_WINDOW_SIZE: WindowSize = { width: 8192, height: 8192 };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** `{width, height}` in whole pixels within the limits, or null when the value is not two finite numbers. */
export function normalizeWindowSize(v: unknown): WindowSize | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const { width, height } = v as Record<string, unknown>;
  if (!finite(width) || !finite(height)) return null;
  return {
    width: clamp(width, MIN_WINDOW_SIZE.width, MAX_WINDOW_SIZE.width),
    height: clamp(height, MIN_WINDOW_SIZE.height, MAX_WINDOW_SIZE.height),
  };
}

/** The size shrunk to the free area of the screen (screen.availWidth/availHeight), never below the minimum. */
export function fitWindowSize(size: WindowSize, avail: { width: number; height: number }): WindowSize {
  const fit = (n: number, room: number, min: number) => (finite(room) && room > 0 ? Math.max(min, Math.min(n, Math.floor(room))) : n);
  return { width: fit(size.width, avail.width, MIN_WINDOW_SIZE.width), height: fit(size.height, avail.height, MIN_WINDOW_SIZE.height) };
}
