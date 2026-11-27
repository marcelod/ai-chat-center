import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SessionView, StoppedBackground } from '@shared/types';
import { LangProvider } from '../i18n';
import { ChatView } from './ChatView';
import { StoppedSessionsDialog } from './StoppedSessionsDialog';
import { SettingsMenu } from './SettingsMenu';

// Stop, restart and remove a background session (spec 2026-11-26-stop-respawn-rm).

const bgSession = (over: Partial<SessionView> = {}): SessionView => ({
  sessionId: 's1',
  name: 'billing-api',
  cwd: '/home/me/billing-api',
  state: 'idle',
  pendingAppMessageIds: [],
  bgId: '5e1b5e9b',
  ...over,
});

function setup(p: { session?: SessionView; onStop?: () => Promise<void>; onRespawn?: () => Promise<void>; onRmBackground?: () => Promise<void> } = {}) {
  const onStop = p.onStop ?? vi.fn(async () => {});
  const onRespawn = p.onRespawn ?? vi.fn(async () => {});
  const onRmBackground = p.onRmBackground ?? vi.fn(async () => {});
  render(
    <LangProvider lang="en">
      <ChatView
        session={p.session ?? bgSession()}
        events={[]}
        pending={[]}
        loading={false}
        onSend={async () => {}}
        onStop={onStop}
        onRespawn={onRespawn}
        onRmBackground={onRmBackground}
        onBack={() => {}}
      />
    </LangProvider>,
  );
  return { onStop, onRespawn, onRmBackground };
}
const menuButton = () => screen.getByRole('button', { name: 'Conversation actions' });

describe('⋮ menu: stop, restart and remove a background session', () => {
  it('a running background session offers all three', async () => {
    setup();
    await userEvent.click(menuButton());
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent);
    expect(items).toEqual(expect.arrayContaining(['Stop session', 'Restart session', 'Remove from Claude Code']));
  });

  it('none for an interactive session or an ended one', () => {
    const { unmount } = render(
      <LangProvider lang="en">
        <ChatView session={bgSession({ bgId: undefined })} events={[]} pending={[]} loading={false} onSend={async () => {}} onStop={vi.fn()} onRespawn={vi.fn()} onRmBackground={vi.fn()} onBack={() => {}} />
      </LangProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Conversation actions' })).not.toBeInTheDocument();
    unmount();
    setup({ session: bgSession({ state: 'disconnected' }) });
    expect(screen.queryByRole('button', { name: 'Conversation actions' })).not.toBeInTheDocument();
  });

  it('Stop asks to confirm in the menu (never window.confirm), then calls onStop', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const { onStop } = setup();
    await userEvent.click(menuButton());
    await userEvent.click(screen.getByRole('menuitem', { name: 'Stop session' }));
    expect(onStop).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Stop? Confirm' }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('Restart runs at once and says the conversation reconnects by itself', async () => {
    const { onRespawn } = setup();
    await userEvent.click(menuButton());
    await userEvent.click(screen.getByRole('menuitem', { name: 'Restart session' }));
    expect(onRespawn).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(await screen.findByTestId('respawn-notice')).toHaveTextContent('reconnects by itself');
    expect(screen.getByTestId('respawn-notice')).toHaveTextContent('/cc');
  });

  it('Remove from Claude Code asks to confirm; a refusal of claude rm is said', async () => {
    const onRmBackground = vi.fn(async () => {
      throw Object.assign(new Error('502'), { status: 502, code: 'claude-failed', detail: 'claude rm failed' });
    });
    setup({ onRmBackground });
    await userEvent.click(menuButton());
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove from Claude Code' }));
    expect(onRmBackground).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove from Claude Code? Confirm' }));
    expect(onRmBackground).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't remove from Claude Code");
    expect(screen.getByRole('alert')).not.toHaveTextContent('claude rm failed');
  });

  it('a failed restart is said in the menu, without the hub text for other errors', async () => {
    setup({ onRespawn: vi.fn(async () => { throw Object.assign(new Error('409'), { status: 409, code: 'busy', detail: 'another action is under way' }); }) });
    await userEvent.click(menuButton());
    await userEvent.click(screen.getByRole('menuitem', { name: 'Restart session' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't restart");
    expect(alert).not.toHaveTextContent('another action');
  });
});

const stopped: StoppedBackground[] = [
  { bgId: 'abcdef01', sessionId: 's1', cwd: '/home/me/a', name: 'old work', state: 'done' },
  { bgId: 'abcdef02', sessionId: 's2', cwd: '/home/me/b', name: '' },
];

function dialog(p: { load?: () => Promise<StoppedBackground[]>; remove?: (id: string) => Promise<void> } = {}) {
  const load = p.load ?? vi.fn(async () => stopped);
  const remove = p.remove ?? vi.fn(async () => {});
  const onClose = vi.fn();
  render(
    <LangProvider lang="en">
      <StoppedSessionsDialog load={load} remove={remove} onClose={onClose} />
    </LangProvider>,
  );
  return { load, remove, onClose };
}

describe('StoppedSessionsDialog', () => {
  it('lists the stopped sessions; removing the chosen ones asks to confirm in the dialog first', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const { remove } = dialog();
    const d = screen.getByRole('dialog', { name: 'Stopped background sessions' });
    expect(await within(d).findByText('old work')).toBeInTheDocument();
    expect(within(d).getByText('Unnamed')).toBeInTheDocument();
    expect(within(d).getByRole('button', { name: 'Remove (0)' })).toBeDisabled();
    await userEvent.click(within(d).getByRole('checkbox', { name: /old work/ }));
    await userEvent.click(within(d).getByRole('button', { name: 'Remove (1)' }));
    expect(remove).not.toHaveBeenCalled();
    expect(within(d).getByText('Remove this background session? This cannot be undone.')).toBeInTheDocument();
    await userEvent.click(within(d).getByRole('button', { name: 'Remove' }));
    expect(remove).toHaveBeenCalledWith('abcdef01');
    expect(remove).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(within(d).queryByText('old work')).not.toBeInTheDocument());
    expect(within(d).getByText('Unnamed')).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('Back leaves the confirmation without removing; Select all picks every one', async () => {
    const { remove } = dialog();
    const d = screen.getByRole('dialog');
    await within(d).findByText('old work');
    await userEvent.click(within(d).getByRole('checkbox', { name: 'Select all' }));
    await userEvent.click(within(d).getByRole('button', { name: 'Remove (2)' }));
    await userEvent.click(within(d).getByRole('button', { name: 'Back' }));
    expect(remove).not.toHaveBeenCalled();
    expect(within(d).getByRole('button', { name: 'Remove (2)' })).toBeEnabled();
  });

  it('a failure keeps that session listed and says why', async () => {
    const remove = vi.fn(async (id: string) => {
      if (id === 'abcdef02') throw Object.assign(new Error('502'), { status: 502, code: 'claude-failed', detail: 'claude rm failed' });
    });
    dialog({ remove });
    const d = screen.getByRole('dialog');
    await within(d).findByText('old work');
    await userEvent.click(within(d).getByRole('checkbox', { name: 'Select all' }));
    await userEvent.click(within(d).getByRole('button', { name: 'Remove (2)' }));
    await userEvent.click(within(d).getByRole('button', { name: 'Remove' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent("Couldn't remove abcdef02");
    expect(within(d).queryByText('old work')).not.toBeInTheDocument();
    expect(within(d).getByText('Unnamed')).toBeInTheDocument();
  });

  it('after removing, focus goes back to Close and Escape still closes the dialog', async () => {
    const { onClose } = dialog();
    const d = screen.getByRole('dialog');
    await within(d).findByText('old work');
    await userEvent.click(within(d).getByRole('checkbox', { name: 'Select all' }));
    await userEvent.click(within(d).getByRole('button', { name: 'Remove (2)' }));
    await userEvent.click(within(d).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(within(d).getByRole('button', { name: 'Close' })).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('empty list, load failure, Escape closes', async () => {
    const { onClose } = dialog({ load: async () => [] });
    expect(await screen.findByText('No stopped background sessions.')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('says so when the list cannot be read', async () => {
    dialog({ load: async () => { throw new Error('503'); } });
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't list the background sessions.");
  });
});

describe('Settings: clean up stopped sessions', () => {
  it('offers the cleanup when the app can do it, and opens it', async () => {
    const onCleanup = vi.fn();
    render(
      <LangProvider lang="en">
        <SettingsMenu onLanguage={() => {}} onCleanup={onCleanup} />
      </LangProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clean up stopped sessions' }));
    expect(onCleanup).toHaveBeenCalledTimes(1);
  });
});
