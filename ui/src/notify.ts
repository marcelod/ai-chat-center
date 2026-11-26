import type { SessionView } from '@shared/types';
import { readSystemNotifications, saveSystemNotifications } from './prefs';

export type NotificationStatus = NotificationPermission | 'unsupported';

/**
 * The browser's notification permission, or 'unsupported' when the API is missing or the page is not a secure
 * context (http://127.0.0.1, where the app runs, counts as secure in Chrome, Edge, Firefox and Safari).
 */
export function notificationStatus(): NotificationStatus {
  if (typeof Notification !== 'function') return 'unsupported';
  if (typeof window !== 'undefined' && window.isSecureContext === false) return 'unsupported';
  try {
    return Notification.permission;
  } catch {
    return 'unsupported';
  }
}

/** Turned on in the settings menu and allowed by the browser. */
export const notificationsEnabled = (): boolean => readSystemNotifications() && notificationStatus() === 'granted';

/** Must be called from a click handler: it may prompt for permission. Returns the resulting preference. */
export async function setNotificationsEnabled(on: boolean): Promise<boolean> {
  let status = notificationStatus();
  if (!on || status === 'unsupported') {
    saveSystemNotifications(false);
    return false;
  }
  if (status === 'default') {
    try {
      status = await Notification.requestPermission();
    } catch {
      status = 'denied';
    }
  }
  const ok = status === 'granted';
  saveSystemNotifications(ok);
  return ok;
}

/** The user is looking at the app: the page is visible and its window has the focus. */
export const pageAttentive = (): boolean => document.visibilityState === 'visible' && document.hasFocus();

export type SessionAlert = 'turnEnded' | 'permission' | 'question';
type StateOf = Pick<SessionView, 'state' | 'waitingKind'>;

const waitingFor = (s: StateOf): 'permission' | 'question' | 'input' | null =>
  s.state !== 'waiting' ? null : s.waitingKind === 'question' ? 'question' : s.waitingKind === 'input' ? 'input' : 'permission';

/**
 * What a change of state between two session lists calls the user for: the turn ended (busy -> idle), or a
 * permission or a question started waiting. Claude Code's "waiting for your input" reminder calls for nothing:
 * the turn end already did.
 */
export function sessionAlert(prev: StateOf, next: StateOf): SessionAlert | null {
  const was = waitingFor(prev);
  const now = waitingFor(next);
  if ((now === 'permission' || now === 'question') && now !== was) return now;
  if (prev.state === 'busy' && next.state === 'idle') return 'turnEnded';
  return null;
}

/**
 * Shows one notification for a session; its tag makes a newer one replace the older instead of piling up.
 * Never throws: some platforms (Chrome on Android) only allow notifications through a service worker.
 */
export function showSessionNotification(sessionId: string, title: string, body: string, onOpen: () => void): void {
  if (!notificationsEnabled()) return;
  try {
    const n = new Notification(title, { body, tag: `acc-session-${sessionId}` });
    n.onclick = () => {
      try {
        window.focus();
      } catch {
        /* some browsers refuse */
      }
      onOpen();
      n.close();
    };
  } catch {
    /* not allowed here */
  }
}
