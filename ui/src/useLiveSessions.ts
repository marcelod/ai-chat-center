import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatEvent, ProviderChange, SessionsResponse } from '@shared/types';
import * as api from './api';
import { notificationsEnabled, setNotificationsEnabled, showNotification } from './notify';
import { applyEvents, baseline, loadUnread, markSeen, saveUnread, type UnreadState } from './unread';

export type PendingMessage = {
  id: string;
  text: string;
  ts: string;
  /** Set once the message could not be delivered (left the hub queue without an event, or the session dropped). */
  failed?: boolean;
  /** When a session list fetched while idle after the send first lacked this id (starts the grace window). */
  leftAt?: number;
};

/** After the id leaves pendingAppMessageIds the matching user event normally arrives within this window. */
export const GRACE_MS = 5000;

const tsOf = (iso: string) => {
  const n = Date.parse(iso);
  return Number.isNaN(n) ? 0 : n;
};

const MAX_DELAY = 10_000;

/** Reconnect delay for the nth consecutive failure: 1 s, 2 s, 4 s ... capped at 10 s. */
export const nextDelay = (attempt: number): number => Math.min(1000 * 2 ** attempt, MAX_DELAY);

/** Replaces events with the same id (in place) or appends them, then orders by ts (stable). */
export function mergeEvents(current: ChatEvent[], incoming: ChatEvent[]): ChatEvent[] {
  const out = current.slice();
  const index = new Map(out.map((e, i) => [e.id, i]));
  for (const e of incoming) {
    const at = index.get(e.id);
    if (at === undefined) {
      index.set(e.id, out.length);
      out.push(e);
    } else {
      out[at] = e;
    }
  }
  return out.sort((a, b) => tsOf(a.ts) - tsOf(b.ts));
}

const appIds = (events: ChatEvent[]) =>
  new Set(events.flatMap((e) => (e.kind === 'user' && e.appMessageId ? [e.appMessageId] : [])));

export function useLiveSessions() {
  const [data, setData] = useState<SessionsResponse>({ connected: [], others: [] });
  const [eventsById, setEventsById] = useState<Record<string, ChatEvent[]>>({});
  const [pending, setPendingState] = useState<Record<string, PendingMessage[]>>({});
  const [unread, setUnread] = useState<UnreadState>(loadUnread);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notify, setNotify] = useState(notificationsEnabled);

  const unreadRef = useRef(unread);
  const selectedRef = useRef<string | null>(null);
  const dataRef = useRef(data);
  const eventsRef = useRef(eventsById);
  const pendingRef = useRef(pending);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const fetched = useRef(new Set<string>());
  const notified = useRef(new Set<string>());
  /** Notifications only for replies newer than both the moment this page connected and the moment a session was first seen. */
  const mountedAt = useRef(Date.now());
  const firstSeen = useRef(new Map<string, number>());
  const seq = useRef(0);
  const inFlight = useRef(false);
  const trailing = useRef(false);

  const commit = useCallback((next: UnreadState) => {
    if (next === unreadRef.current) return;
    unreadRef.current = next;
    saveUnread(next);
    setUnread(next);
  }, []);

  const updatePending = useCallback((fn: (p: Record<string, PendingMessage[]>) => Record<string, PendingMessage[]>) => {
    const next = fn(pendingRef.current);
    if (next === pendingRef.current) return;
    pendingRef.current = next;
    setPendingState(next);
  }, []);

  const patchPending = useCallback(
    (sid: string, id: string, patch: Partial<PendingMessage>) =>
      updatePending((p) => {
        if (!p[sid]?.some((m) => m.id === id)) return p;
        return { ...p, [sid]: p[sid].map((m) => (m.id === id ? { ...m, ...patch } : m)) };
      }),
    [updatePending],
  );

  const cancelGrace = useCallback((sid: string, id: string) => {
    const key = `${sid}/${id}`;
    const t = timers.current.get(key);
    if (t !== undefined) clearTimeout(t);
    timers.current.delete(key);
  }, []);

  const markFailed = useCallback(
    (sid: string, id: string) => {
      cancelGrace(sid, id);
      patchPending(sid, id, { failed: true });
    },
    [cancelGrace, patchPending],
  );

  /** Grace expiry: a session that is working (busy or at a prompt) may still be handling the message. */
  const graceExpired = useCallback(
    (sid: string, id: string) => {
      const state = dataRef.current.connected.find((s) => s.sessionId === sid)?.state;
      if (state === 'busy' || state === 'waiting') {
        cancelGrace(sid, id);
        patchPending(sid, id, { leftAt: undefined });
        return;
      }
      markFailed(sid, id);
    },
    [cancelGrace, markFailed, patchPending],
  );

  /** Applies a sessions list fetched at `startedAt` to the local pending items. */
  const reconcilePending = useCallback(
    (res: SessionsResponse, startedAt: number) => {
      for (const s of res.connected) {
        for (const m of pendingRef.current[s.sessionId] ?? []) {
          if (m.failed) continue;
          const key = `${s.sessionId}/${m.id}`;
          if (s.state === 'disconnected') {
            markFailed(s.sessionId, m.id);
          } else if (s.pendingAppMessageIds.includes(m.id) || s.state === 'busy' || s.state === 'waiting') {
            // Still queued, or the session is working (it may be handling this very message):
            // never fail it now; the grace window only runs while the session is idle.
            cancelGrace(s.sessionId, m.id);
            if (m.leftAt !== undefined) patchPending(s.sessionId, m.id, { leftAt: undefined });
          } else if (m.leftAt === undefined && startedAt >= tsOf(m.ts)) {
            patchPending(s.sessionId, m.id, { leftAt: Date.now() });
            timers.current.set(
              key,
              setTimeout(() => graceExpired(s.sessionId, m.id), GRACE_MS),
            );
          }
        }
      }
    },
    [cancelGrace, graceExpired, markFailed, patchPending],
  );

  /** Messages the hub still has queued but this tab does not know (a reload, another tab): show them as queued. */
  const adoptQueued = useCallback(
    (res: SessionsResponse) =>
      updatePending((p) => {
        let next = p;
        for (const s of res.connected) {
          const known = new Set([...(next[s.sessionId] ?? []).map((m) => m.id), ...appIds(eventsRef.current[s.sessionId] ?? [])]);
          const add = (s.pendingAppMessages ?? []).filter((m) => !known.has(m.id));
          if (add.length === 0) continue;
          next = { ...next, [s.sessionId]: [...(next[s.sessionId] ?? []), ...add.map((m) => ({ id: m.id, text: m.text, ts: m.createdAt }))] };
        }
        return next;
      }),
    [updatePending],
  );

  const putEvents = useCallback((sid: string, events: ChatEvent[]) => {
    const merged = mergeEvents(eventsRef.current[sid] ?? [], events);
    eventsRef.current = { ...eventsRef.current, [sid]: merged };
    setEventsById(eventsRef.current);
    const ids = appIds(events);
    if (ids.size > 0) {
      updatePending((p) => {
        const list = p[sid];
        if (!list?.some((m) => ids.has(m.id))) return p;
        return { ...p, [sid]: list.filter((m) => !ids.has(m.id)) };
      });
    }
  }, [updatePending]);

  const refresh = useCallback(async () => {
    if (inFlight.current) {
      trailing.current = true;
      return;
    }
    inFlight.current = true;
    const mine = ++seq.current;
    const startedAt = Date.now();
    try {
      const res = await api.getSessions();
      if (mine === seq.current) {
        dataRef.current = res;
        for (const s of res.connected) if (!firstSeen.current.has(s.sessionId)) firstSeen.current.set(s.sessionId, Date.now());
        setData(res);
        setError(false);
        adoptQueued(res);
        reconcilePending(res, startedAt);
        const now = new Date();
        commit(res.connected.reduce((st, s) => baseline(st, s.sessionId, s.lastEvent?.ts, now), unreadRef.current));
      }
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
      if (trailing.current) {
        trailing.current = false;
        void refresh();
      }
    }
  }, [commit, reconcilePending, adoptQueued]);

  const loadEvents = useCallback(
    async (sid: string) => {
      setLoading(true);
      try {
        putEvents(sid, await api.getEvents(sid));
        fetched.current.add(sid);
      } catch {
        fetched.current.delete(sid);
      } finally {
        if (selectedRef.current === sid || selectedRef.current === null) setLoading(false);
      }
    },
    [putEvents],
  );

  const maybeNotify = useCallback((sid: string, events: ChatEvent[]) => {
    if (typeof document === 'undefined' || !notificationsEnabled()) return;
    if (sid === selectedRef.current && !document.hidden) return;
    const seen = firstSeen.current.get(sid);
    if (seen === undefined) return; // not in a sessions list yet: whatever arrives is its backlog
    const since = Math.max(mountedAt.current, seen);
    const name = dataRef.current.connected.find((s) => s.sessionId === sid)?.name ?? sid;
    for (const e of events) {
      if (e.kind !== 'assistant' || notified.current.has(e.id)) continue;
      // History replayed by the hub (page load, hub restart, /cc again) is older than `since`.
      if (!(Date.parse(e.ts) > since)) continue;
      notified.current.add(e.id);
      showNotification(name, e.text);
    }
  }, []);

  const onChange = useCallback(
    (c: ProviderChange) => {
      if (c.type === 'sessions') {
        void refresh();
        return;
      }
      commit(applyEvents(unreadRef.current, c.sessionId, c.events, selectedRef.current, new Date()));
      putEvents(c.sessionId, c.events);
      maybeNotify(c.sessionId, c.events);
      const last = c.events[c.events.length - 1];
      if (last) {
        setData((d) => {
          const next = {
            ...d,
            connected: d.connected.map((s) => (s.sessionId === c.sessionId ? { ...s, lastEvent: last } : s)),
          };
          dataRef.current = next;
          return next;
        });
      }
    },
    [refresh, commit, putEvents, maybeNotify],
  );

  useEffect(() => {
    void refresh();
    let closed = false;
    let failures = 0;
    let failed = false;
    /** Stream closed on purpose while the page is hidden. */
    let paused = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let close: (() => void) | undefined;

    const connect = () => {
      close = api.openStream(onChange, {
        onOpen: () => {
          failures = 0;
          if (!failed) return;
          failed = false;
          void refresh();
          const sid = selectedRef.current;
          const keep = sid && fetched.current.has(sid);
          // Other conversations may have missed events while disconnected: refetch them on next open.
          fetched.current = new Set(keep ? [sid] : []);
          if (keep) void loadEvents(sid);
        },
        onError: () => {
          if (closed || paused || timer !== undefined) return;
          failed = true;
          close?.();
          // EventSource hides the status: ask once over plain HTTP. A 401 (the hub restarted with a new
          // token) drops the token and shows the "open the /cc link" screen instead of retrying forever.
          void refresh();
          timer = setTimeout(() => {
            timer = undefined;
            if (!closed && !paused) connect();
          }, nextDelay(failures++));
        },
      });
    };
    connect();
    // A hidden tab keeps no stream open (the hub only polls, and runs `claude agents`, while a stream is
    // open), unless browser notifications are on: they are what a hidden tab is for. When the page is
    // visible again the stream reopens and, as after any reconnect, resyncs.
    const onVisibility = () => {
      if (closed) return;
      if (document.hidden && !paused && !notificationsEnabled()) {
        paused = true;
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        close?.();
        close = undefined;
      } else if (!document.hidden && paused) {
        paused = false;
        failed = true; // resync on open
        failures = 0;
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      closed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer !== undefined) clearTimeout(timer);
      close?.();
    };
  }, [refresh, onChange, loadEvents]);

  const select = useCallback(
    (id: string | null) => {
      const prev = selectedRef.current;
      const nowIso = new Date().toISOString();
      let next = unreadRef.current;
      if (prev) next = markSeen(next, prev, nowIso);
      if (id) next = markSeen(next, id, nowIso);
      selectedRef.current = id;
      commit(next);
      setSelectedId(id);
      if (id && !fetched.current.has(id)) {
        fetched.current.add(id);
        void loadEvents(id);
      } else {
        setLoading(false);
      }
    },
    [commit, loadEvents],
  );

  const send = useCallback(
    async (sid: string, text: string) => {
      const { id } = await api.sendMessage(sid, text);
      if (appIds(eventsRef.current[sid] ?? []).has(id)) return;
      const failed = dataRef.current.connected.find((s) => s.sessionId === sid)?.state === 'disconnected';
      updatePending((p) => ({
        ...p,
        [sid]: [...(p[sid] ?? []), { id, text, ts: new Date().toISOString(), ...(failed ? { failed: true } : {}) }],
      }));
    },
    [updatePending],
  );

  /** Re-sends a not-delivered message; the old item is replaced by the new one. */
  const retry = useCallback(
    async (sid: string, id: string) => {
      const m = pendingRef.current[sid]?.find((x) => x.id === id);
      if (!m) return;
      updatePending((p) => ({ ...p, [sid]: p[sid].filter((x) => x.id !== id) }));
      try {
        await send(sid, m.text);
      } catch {
        updatePending((p) => ({ ...p, [sid]: [...(p[sid] ?? []), { ...m, failed: true, leftAt: undefined }] }));
      }
    },
    [send, updatePending],
  );

  useEffect(() => {
    const all = timers.current;
    return () => {
      all.forEach(clearTimeout);
      all.clear();
    };
  }, []);

  const setNotifications = useCallback(async (on: boolean) => {
    setNotify(await setNotificationsEnabled(on));
  }, []);

  return { data, eventsById, pending, unread, selectedId, select, send, retry, error, loading, notify, setNotifications };
}
