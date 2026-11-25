import { useCallback, useEffect, useState } from 'react';
import type { ChatEvent, SessionView } from '@shared/types';

// Says when a command typed from the app has finished (spec 2026-11-25-app-batch). `claude attach` gives
// no answer, so the end is read from what the app already sees:
// - /compact: the compact summary lands in the transcript (a `compacted` notice newer than the command);
// - any command that made the session busy: the session is idle again;
// - otherwise (/rename, /model, /effort run at once): QUICK_MS after the hub typed it.

/** A command that never made the session busy counts as done this long after it was typed. */
export const QUICK_MS = 4000;
/** A /compact with no summary after this long is not followed anymore (nothing is claimed). */
export const GIVE_UP_MS = 10 * 60_000;

export type CommandRun = { cmd: string; at: number; sawBusy: boolean; doneAt?: number };

export function useCommandProgress(session: Pick<SessionView, 'state'>, events: ChatEvent[], now: () => number = Date.now) {
  const [run, setRun] = useState<CommandRun | null>(null);
  const started = useCallback((line: string) => setRun({ cmd: line.split(' ')[0], at: now(), sawBusy: false }), [now]);

  const { state } = session;
  useEffect(() => {
    setRun((r) => {
      if (!r || r.doneAt) return r;
      if (r.cmd === '/compact') {
        const summary = events.some((e) => e.kind === 'notice' && e.code === 'compacted' && Date.parse(e.ts) >= r.at - 2000);
        return summary ? { ...r, doneAt: now() } : r;
      }
      if (state === 'busy' || state === 'waiting') return r.sawBusy ? r : { ...r, sawBusy: true };
      if (r.sawBusy && state === 'idle') return { ...r, doneAt: now() };
      return r;
    });
  }, [events, state, now]);

  // The time-based ends: a quick command, or a /compact given up on.
  useEffect(() => {
    if (!run || run.doneAt) return;
    const compact = run.cmd === '/compact';
    if (!compact && run.sawBusy) return;
    const wait = Math.max(0, run.at + (compact ? GIVE_UP_MS : QUICK_MS) - now());
    const timer = setTimeout(() => setRun((r) => (r !== run ? r : compact ? null : { ...r, doneAt: now() })), wait);
    return () => clearTimeout(timer);
  }, [run, now]);

  const clear = useCallback(() => setRun(null), []);
  return { run, started, clear };
}
