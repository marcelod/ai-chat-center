// What the app knows about resumes it asked for (spec 2026-11-24-background-sessions): written by the
// server's resume route, read by the provider into SessionView.resuming / resumeError. In memory only:
// a hub restart forgets it, and the session simply shows as ended (or connected, once it is back).

/** A resume that has not reconnected after this long is reported as failed. */
export const RESUME_WAIT_MS = 60_000;
/** A failure stays visible this long (or until the next resume). */
export const RESUME_ERROR_MS = 5 * 60_000;

type State = { at: number; error?: string; errorAt?: number };
const states = new Map<string, State>();

export function startResume(sid: string, now = Date.now()): void {
  states.set(sid, { at: now });
}

export function failResume(sid: string, error: string, now = Date.now()): void {
  const s = states.get(sid);
  if (s) states.set(sid, { ...s, error, errorAt: now });
}

export function isResuming(sid: string): boolean {
  const s = states.get(sid);
  return !!s && s.error === undefined;
}

/**
 * The resume state shown for a session. `connectedAt` (when it is active): a connection newer than the
 * resume request means it came back, and the state is dropped.
 */
export function resumeView(sid: string, connectedAt: string | null, now = Date.now()): { resuming?: true; resumeError?: string } {
  const s = states.get(sid);
  if (!s) return {};
  if (connectedAt !== null && (Date.parse(connectedAt) || 0) >= s.at - 1000) {
    states.delete(sid);
    return {};
  }
  if (s.error === undefined && now - s.at > RESUME_WAIT_MS) {
    s.error = 'the session did not reconnect within 60 s';
    s.errorAt = now;
  }
  if (s.error !== undefined) {
    if (now - (s.errorAt ?? s.at) > RESUME_ERROR_MS) {
      states.delete(sid);
      return {};
    }
    return { resumeError: s.error };
  }
  return { resuming: true };
}

/** For tests. */
export function resetResumeStates(): void {
  states.clear();
}
