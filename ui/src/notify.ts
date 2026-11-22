const KEY = 'acc.notify';

/** Browser notifications, all behind feature detection. */
export const notificationsSupported = (): boolean => typeof Notification !== 'undefined';

export function notificationsEnabled(): boolean {
  if (!notificationsSupported()) return false;
  try {
    return localStorage.getItem(KEY) === '1' && Notification.permission === 'granted';
  } catch {
    return false;
  }
}

function store(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

/** Must be called from a click handler: it may prompt for permission. Returns the resulting preference. */
export async function setNotificationsEnabled(on: boolean): Promise<boolean> {
  if (!on || !notificationsSupported()) {
    store(false);
    return false;
  }
  let permission = Notification.permission;
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = 'denied';
    }
  }
  const ok = permission === 'granted';
  store(ok);
  return ok;
}

export function showNotification(title: string, text: string): void {
  if (!notificationsEnabled()) return;
  try {
    new Notification(title, { body: text.slice(0, 120) });
  } catch {
    /* some platforms only allow notifications through a service worker */
  }
}
