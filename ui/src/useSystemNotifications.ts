import { useEffect, useRef } from 'react';
import type { SessionView } from '@shared/types';
import { useT } from './i18n';
import { notificationsEnabled, pageAttentive, sessionAlert, showSessionNotification } from './notify';

const MAX_TITLE = 60;

type StateOf = Pick<SessionView, 'state' | 'waitingKind'>;

/**
 * System notifications (spec 2026-11-26-system-notifications): while the user is away from the app, says
 * when a session finished its turn, asks for a permission or asks a question. The body is a fixed, translated
 * phrase: never conversation text, folders, the token or the app link. A click opens that conversation.
 */
export function useSystemNotifications(connected: SessionView[], select: (id: string) => void): void {
  const t = useT();
  const prev = useRef<Map<string, StateOf> | null>(null);
  const tRef = useRef(t);
  const selectRef = useRef(select);
  useEffect(() => {
    tRef.current = t;
    selectRef.current = select;
  });

  useEffect(() => {
    const before = prev.current;
    prev.current = new Map(connected.map((s) => [s.sessionId, { state: s.state, waitingKind: s.waitingKind }]));
    // The first list after load is the baseline. States are tracked even while notifications are off or the
    // user is looking, so a change seen then never fires later.
    if (!before || !notificationsEnabled() || pageAttentive()) return;
    for (const s of connected) {
      const was = before.get(s.sessionId);
      const alert = was && sessionAlert(was, s);
      if (!alert) continue;
      const title = s.name.length > MAX_TITLE ? `${s.name.slice(0, MAX_TITLE - 1)}…` : s.name;
      showSessionNotification(s.sessionId, title, tRef.current(`ui.notifications.${alert}`), () => selectRef.current(s.sessionId));
    }
  }, [connected]);
}
