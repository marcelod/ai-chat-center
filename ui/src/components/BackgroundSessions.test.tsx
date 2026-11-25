import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SessionView } from '@shared/types';
import { LangProvider } from '../i18n';
import { ChatView } from './ChatView';
import { Composer, isSlashCommand } from './Composer';

// Spec 2026-11-24-background-sessions: resume from the app, slash commands in background sessions.

const session = (over: Partial<SessionView> = {}): SessionView => ({
  sessionId: 's1',
  name: 'billing-api',
  cwd: '/home/me/billing-api',
  state: 'idle',
  pendingAppMessageIds: [],
  ...over,
});
const err = (status: number) => Object.assign(new Error(String(status)), { status });

function chat(s: SessionView, props: { onResume?: () => Promise<void>; onCommand?: (t: string) => Promise<void>; onSend?: (t: string) => Promise<void> } = {}) {
  const onSend = props.onSend ?? vi.fn(async () => {});
  render(
    <LangProvider lang="en">
      <ChatView session={s} events={[]} pending={[]} loading={false} onSend={onSend} onBack={() => {}} onResume={props.onResume} onCommand={props.onCommand} />
    </LangProvider>,
  );
  return { onSend };
}

describe('isSlashCommand', () => {
  it('matches the hub rule: a command name, one line; a path is text', () => {
    for (const ok of ['/compact', '/rename new name', '/ai-chat-center:cc off']) expect(isSlashCommand(ok)).toBe(true);
    for (const no of ['/home/me/file.ts', 'compact', '/', '/compact\nmore', `/${'a'.repeat(200)}`]) expect(isSlashCommand(no)).toBe(false);
  });
});

describe('resume panel', () => {
  it('only for an ended session, and calls onResume', async () => {
    const onResume = vi.fn(async () => {});
    chat(session({ state: 'disconnected' }), { onResume });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Resume in the background' }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('not for a connected session', () => {
    chat(session(), { onResume: vi.fn(async () => {}) });
    expect(screen.queryByTestId('resume-panel')).toBeNull();
  });

  it('shows Resuming… while the hub resumes, and the hub error after', () => {
    const { unmount } = render(
      <LangProvider lang="en">
        <ChatView session={session({ state: 'disconnected', resuming: true })} events={[]} pending={[]} loading={false} onSend={async () => {}} onBack={() => {}} onResume={async () => {}} />
      </LangProvider>,
    );
    expect(screen.getByRole('button', { name: 'Resuming…' })).toBeDisabled();
    unmount();
    chat(session({ state: 'disconnected', resumeError: 'Workspace not trusted.' }), { onResume: async () => {} });
    expect(screen.getByRole('alert').textContent).toContain('Workspace not trusted.');
  });

  it('a 409 says the session still runs in a terminal', async () => {
    chat(session({ state: 'disconnected' }), { onResume: async () => Promise.reject(err(409)) });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Resume in the background' }));
    expect((await screen.findByRole('alert')).textContent).toContain('still open in a terminal');
  });
});

describe('background session header', () => {
  it('shows claude attach <id> and the background permission hint', () => {
    chat(session({ bgId: '5e1b5e9b', state: 'waiting', waitingKind: 'permission' }));
    expect(screen.getByTestId('attach-command').textContent).toContain('claude attach 5e1b5e9b');
    expect(screen.getByText(/answer in a terminal with claude attach 5e1b5e9b/)).toBeTruthy();
  });

  it('nothing of it for an interactive session', () => {
    chat(session());
    expect(screen.queryByTestId('attach-command')).toBeNull();
  });
});

describe('slash commands in the composer', () => {
  it('background session: /compact goes to onCommand, not onSend, and says it was sent', async () => {
    const onCommand = vi.fn(async () => {});
    const { onSend } = chat(session({ bgId: '5e1b5e9b' }), { onCommand });
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), '/compact{Enter}');
    expect(onCommand).toHaveBeenCalledWith('/compact');
    expect(onSend).not.toHaveBeenCalled();
    expect((await screen.findByText(/Command \/compact sent/)).textContent).toContain('/compact');
    // ...and the conversation follows it until it ends (useCommandProgress).
    expect(screen.getByTestId('command-progress').textContent).toContain('/compact is running');
  });

  it('background session: plain text and paths still go to onSend', async () => {
    const onCommand = vi.fn(async () => {});
    const { onSend } = chat(session({ bgId: '5e1b5e9b' }), { onCommand });
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), '/home/me/a.ts{Enter}');
    expect(onSend).toHaveBeenCalledWith('/home/me/a.ts');
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('busy (409) and Windows (501): the text comes back with the reason', async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn(async () => Promise.reject(err(409)));
    render(
      <LangProvider lang="en">
        <Composer sessionId="b1" name="x" disabled={false} onSend={async () => {}} onCommand={onCommand} />
      </LangProvider>,
    );
    await user.type(screen.getByRole('textbox'), '/compact{Enter}');
    expect((await screen.findByRole('alert')).textContent).toContain('busy');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('/compact');
    onCommand.mockImplementation(async () => Promise.reject(err(501)));
    await user.type(screen.getByRole('textbox'), '{Enter}');
    expect((await screen.findByRole('alert')).textContent).toContain('Windows');
  });

  it('interactive session: asks before sending a command as text', async () => {
    const { onSend } = chat(session());
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), '/compact{Enter}');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('would arrive as text');
    await user.click(screen.getByRole('button', { name: 'Send as text' }));
    expect(onSend).toHaveBeenCalledWith('/compact');
  });

  it('interactive session: Cancel keeps the text and sends nothing', async () => {
    const { onSend } = chat(session());
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), '/compact{Enter}');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('/compact');
  });
});
