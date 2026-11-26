import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionView } from '@shared/types';
import { notificationStatus, notificationsEnabled, sessionAlert, setNotificationsEnabled } from './notify';
import { readSystemNotifications } from './prefs';

function stubNotification(permission: NotificationPermission, ask: NotificationPermission = permission) {
  const requestPermission = vi.fn(async () => {
    N.permission = ask;
    return ask;
  });
  class N {
    static permission = permission;
    static requestPermission = requestPermission;
  }
  vi.stubGlobal('Notification', N);
  return requestPermission;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('notificationStatus', () => {
  it('is unsupported without the API, or outside a secure context', () => {
    vi.stubGlobal('Notification', undefined);
    expect(notificationStatus()).toBe('unsupported');
    stubNotification('granted');
    vi.stubGlobal('isSecureContext', false);
    expect(notificationStatus()).toBe('unsupported');
  });
  it('reports the browser permission otherwise', () => {
    stubNotification('denied');
    expect(notificationStatus()).toBe('denied');
  });
});

describe('setNotificationsEnabled', () => {
  it('asks for permission when on, and stores the choice when granted', async () => {
    const ask = stubNotification('default', 'granted');
    expect(await setNotificationsEnabled(true)).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(readSystemNotifications()).toBe(true);
    expect(notificationsEnabled()).toBe(true);
    expect(await setNotificationsEnabled(false)).toBe(false);
    expect(notificationsEnabled()).toBe(false);
  });
  it('stays off when the browser blocks it, and without support', async () => {
    stubNotification('default', 'denied');
    expect(await setNotificationsEnabled(true)).toBe(false);
    expect(readSystemNotifications()).toBe(false);
    vi.stubGlobal('Notification', undefined);
    expect(await setNotificationsEnabled(true)).toBe(false);
  });
  it('is off when the permission was revoked after it was turned on', async () => {
    stubNotification('granted');
    await setNotificationsEnabled(true);
    stubNotification('denied');
    expect(notificationsEnabled()).toBe(false);
  });
});

describe('sessionAlert', () => {
  const s = (state: SessionView['state'], waitingKind?: SessionView['waitingKind']) => ({ state, waitingKind });
  it.each([
    [s('busy'), s('idle'), 'turnEnded'],
    [s('busy'), s('waiting', 'permission'), 'permission'],
    [s('busy'), s('waiting'), 'permission'],
    [s('idle'), s('waiting', 'question'), 'question'],
    [s('waiting', 'permission'), s('waiting', 'question'), 'question'],
    [s('waiting', 'question'), s('waiting', 'permission'), 'permission'],
  ] as const)('%o -> %o is %s', (prev, next, kind) => {
    expect(sessionAlert(prev, next)).toBe(kind);
  });
  it.each([
    [s('idle'), s('idle')],
    [s('busy'), s('busy')],
    [s('waiting', 'permission'), s('waiting', 'permission')],
    [s('waiting', 'question'), s('waiting', 'question')],
    [s('busy'), s('waiting', 'input')],
    [s('waiting', 'permission'), s('idle')],
    [s('idle'), s('busy')],
    [s('busy'), s('disconnected')],
  ] as const)('%o -> %o is nothing', (prev, next) => {
    expect(sessionAlert(prev, next)).toBeNull();
  });
});
