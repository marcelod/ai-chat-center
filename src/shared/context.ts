// The size of a session's context window (spec 2026-11-26-context-quick-replies).

export const DEFAULT_CONTEXT_WINDOW = 200_000;
export const LARGE_CONTEXT_WINDOW = 1_000_000;
/** Bounds of a plausible window size in tokens (anything else in a file or an input is ignored). */
export const MIN_CONTEXT_WINDOW = 1000;
export const MAX_CONTEXT_WINDOW = 100_000_000;

export const isContextWindow = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= MIN_CONTEXT_WINDOW && n <= MAX_CONTEXT_WINDOW;

/** A model id that names the 1M window: `claude-opus-5-5[1m]`, `…-1m`. */
const ONE_MILLION = /\[1m\]|(?:^|[-_])1m$/i;

/**
 * The window size for `used` tokens: the one Claude Code reported to the status line (`exact`) when it holds
 * what is in use, else 1M for a model id that says so or a context already over 200k, else 200k. The model id
 * in the transcript does not carry the `[1m]` suffix, so a 1M session is only recognised without the status
 * line once it passes 200k.
 */
export function contextWindowSize(model: string | undefined, used: number, reported?: number | null): { size: number; exact: boolean } {
  if (isContextWindow(reported) && reported >= used) return { size: reported, exact: true };
  if ((model && ONE_MILLION.test(model)) || used > DEFAULT_CONTEXT_WINDOW) return { size: LARGE_CONTEXT_WINDOW, exact: false };
  return { size: DEFAULT_CONTEXT_WINDOW, exact: false };
}
