import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { SessionView } from '@shared/types';
import { LangProvider } from './i18n';
import { saveSystemNotifications } from './prefs';
import { useSystemNotifications } from './useSystemNotifications';

type Shown = { title: string; options: NotificationOptions; onclick: (() => void) | null; close: ReturnType<typeof vi.fn> };
let shown: Shown[];

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(title: string, options: NotificationOptions) {
    shown.push(Object.assign(this, { title, options }) as unknown as Shown);
  }
}

const view = (state: SessionView['state'], waitingKind?: SessionView['waitingKind'], over: Partial<SessionView> = {}): SessionView => ({
  sessionId: 's1',
  name: 'api server',
  cwd: '/home/someone/secret-project',
  state,
  pendingAppMessageIds: [],
  ...(waitingKind ? { waitingKind } : {}),
  ...over,
});

let visible: DocumentVisibilityState;
let focused: boolean;

beforeEach(() => {
  shown = [];
  FakeNotification.permission = 'granted';
  vi.stubGlobal('Notification', FakeNotification);
  saveSystemNotifications(true);
  visible = 'hidden';
  focused = false;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible);
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  saveSystemNotifications(false);
});

function setup(lang: 'en' | 'pt-BR' = 'en') {
  const select = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => <LangProvider lang={lang}>{children}</LangProvider>;
  const hook = renderHook(({ list }: { list: SessionView[] }) => useSystemNotifications(list, select), {
    wrapper,
    initialProps: { list: [view('busy')] },
  });
  return { select, show: (...list: SessionView[]) => hook.rerender({ list }) };
}

describe('useSystemNotifications', () => {
  it('notifies once when a session finishes its turn while the page is hidden', () => {
    const { show } = setup();
    expect(shown).toHaveLength(0);
    show(view('idle'));
    show(view('idle', undefined, { lastEvent: { kind: 'assistant', id: 'x', ts: '2026-01-01T00:00:00Z', text: 'secret reply' } }));
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe('api server');
    expect(shown[0].options.body).toBe('Finished its turn');
    expect(shown[0].options.tag).toBe('acc-session-s1');
    expect(JSON.stringify(shown[0].options)).not.toMatch(/secret|home/);
  });

  it('notifies a permission request and a question, in Portuguese', () => {
    const { show } = setup('pt-BR');
    show(view('waiting', 'permission'));
    show(view('waiting', 'question'));
    expect(shown.map((n) => n.options.body)).toEqual(['Pede permissão', 'Fez uma pergunta']);
  });

  it('stays quiet while the page is visible and focused, and notifies when it is only unfocused', () => {
    visible = 'visible';
    focused = true;
    const { show } = setup();
    show(view('idle'));
    expect(shown).toHaveLength(0);
    focused = false;
    show(view('busy'));
    show(view('idle'));
    expect(shown).toHaveLength(1);
  });

  it('never notifies a session on its first appearance, nor while turned off', () => {
    const { show } = setup();
    show(view('busy'), view('waiting', 'question', { sessionId: 's2' }));
    expect(shown).toHaveLength(0);
    saveSystemNotifications(false);
    show(view('idle'), view('idle', undefined, { sessionId: 's2' }));
    expect(shown).toHaveLength(0);
    // Turned on again: the transitions seen while off do not fire late.
    saveSystemNotifications(true);
    show(view('idle'), view('idle', undefined, { sessionId: 's2' }));
    expect(shown).toHaveLength(0);
  });

  it('a click focuses the window and opens the conversation', () => {
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {});
    const { show, select } = setup();
    show(view('idle'));
    shown[0].onclick?.();
    expect(focus).toHaveBeenCalled();
    expect(select).toHaveBeenCalledWith('s1');
    expect(shown[0].close).toHaveBeenCalled();
  });

  it('does nothing, without errors, when the browser has no Notification API', () => {
    vi.stubGlobal('Notification', undefined);
    const { show } = setup();
    expect(() => show(view('idle'))).not.toThrow();
  });

  it('ignores a notification constructor that throws', () => {
    vi.stubGlobal(
      'Notification',
      class {
        static permission = 'granted';
        constructor() {
          throw new TypeError('Illegal constructor');
        }
      },
    );
    const { show } = setup();
    expect(() => show(view('idle'))).not.toThrow();
  });
});
