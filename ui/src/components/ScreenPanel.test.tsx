import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SessionView } from '@shared/types';
import { LangProvider } from '../i18n';
import { ChatView } from './ChatView';
import { ScreenView } from './ScreenPanel';
import type { PanelApi } from './SidePanel';

// Spec 2026-11-26-side-panel: the screen of a background session in the side panel.

const session = (over: Partial<SessionView> = {}): SessionView => ({
  sessionId: 's1',
  name: 'proj',
  cwd: '/home/me/proj',
  state: 'idle',
  bgId: '5e1b5e9b',
  pendingAppMessageIds: [],
  ...over,
});

function setup(screenFn: PanelApi['screen'], s = session(), onCommand?: (text: string) => Promise<void>) {
  render(
    <LangProvider lang="en">
      <ChatView
        session={s}
        events={[]}
        pending={[]}
        loading={false}
        onSend={async () => {}}
        onBack={() => {}}
        onRemove={async () => {}}
        onCommand={onCommand}
        panel={{ file: async () => new Blob(['']), screen: screenFn }}
      />
    </LangProvider>,
  );
}

describe('ScreenView', () => {
  it('an answer that comes back after a newer one is dropped (the newest screen stays)', async () => {
    const resolvers: ((text: string) => void)[] = [];
    const load = vi.fn(() => new Promise<string>((r) => resolvers.push(r)));
    render(
      <LangProvider lang="en">
        <ScreenView load={load} after="/status" refreshInMs={[5]} />
      </LangProvider>,
    );
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await act(async () => resolvers[1]('new screen'));
    await act(async () => resolvers[0]('old screen'));
    expect(screen.getByTestId('session-screen')).toHaveTextContent('new screen');
  });
});

describe('session screen', () => {
  it('the ⋮ menu opens the screen as monospaced text, with a refresh button', async () => {
    const fn = vi.fn().mockResolvedValueOnce('Model: Opus 5.5\n  Context 42%').mockResolvedValueOnce('second look');
    setup(fn);
    await userEvent.click(screen.getByRole('button', { name: 'Conversation actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Session screen' }));
    const panel = await screen.findByTestId('side-panel');
    const pre = await within(panel).findByTestId('session-screen');
    expect(pre.tagName).toBe('PRE');
    expect(pre.textContent).toBe('Model: Opus 5.5\n  Context 42%');
    await userEvent.click(within(panel).getByRole('button', { name: 'Refresh' }));
    expect(await within(panel).findByText('second look')).toBeTruthy();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('a failure says so', async () => {
    setup(vi.fn().mockRejectedValue(Object.assign(new Error('409'), { status: 409 })));
    await userEvent.click(screen.getByRole('button', { name: 'Conversation actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Session screen' }));
    expect(await screen.findByText("Only a background session's screen can be shown.")).toBeTruthy();
  });

  it('no menu item for a session not in the background or disconnected', async () => {
    setup(vi.fn(), session({ bgId: undefined }));
    await userEvent.click(screen.getByRole('button', { name: 'Conversation actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Session screen' })).toBeNull();
  });

  it('after /context from the app, the screen opens by itself and refreshes for the result (spec 2026-11-27-session-screen-terminal)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const fn = vi.fn().mockResolvedValueOnce('typing…').mockResolvedValue('Context 42%');
      const onCommand = vi.fn(async () => {});
      setup(fn, session(), onCommand);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.type(screen.getByRole('textbox'), '/context{Enter}');
      expect(onCommand).toHaveBeenCalledWith('/context');
      const panel = await screen.findByTestId('side-panel');
      expect(await within(panel).findByText('typing…')).toBeTruthy();
      expect(within(panel).getByText('Result of /context: the screen refreshes in a moment.')).toBeTruthy();
      await vi.advanceTimersByTimeAsync(2000);
      expect(await within(panel).findByText('Context 42%')).toBeTruthy();
      await vi.advanceTimersByTimeAsync(4000);
      expect(fn).toHaveBeenCalledTimes(3);
      expect(within(panel).queryByText(/refreshes in a moment/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a terminal session still does not run /status from the app', async () => {
    const onCommand = vi.fn(async () => {});
    setup(vi.fn(), session({ bgId: undefined }), onCommand);
    await userEvent.type(screen.getByRole('textbox'), '/status{Enter}');
    expect(onCommand).not.toHaveBeenCalled();
    expect(screen.queryByTestId('side-panel')).toBeNull();
  });
});
