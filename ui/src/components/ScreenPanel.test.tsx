import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SessionView } from '@shared/types';
import { LangProvider } from '../i18n';
import { ChatView } from './ChatView';
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

function setup(screenFn: PanelApi['screen'], s = session()) {
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
        panel={{ file: async () => new Blob(['']), screen: screenFn }}
      />
    </LangProvider>,
  );
}

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
});
