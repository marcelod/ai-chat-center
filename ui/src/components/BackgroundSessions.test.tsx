import { render, screen, within } from '@testing-library/react';
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

describe('open in a terminal (backlog 2026-11-25)', () => {
  const errCode = (status: number, code: string) => Object.assign(new Error(String(status)), { status, code });
  function chatT(s: SessionView, onOpenTerminal: () => Promise<void>, answersFromApp = false) {
    render(
      <LangProvider lang="en">
        <ChatView session={s} events={[]} pending={[]} loading={false} onSend={async () => {}} onBack={() => {}} onOpenTerminal={onOpenTerminal} answersFromApp={answersFromApp} />
      </LangProvider>,
    );
  }
  const openMenu = () => userEvent.setup().click(screen.getByRole('button', { name: 'Conversation actions' }));

  it('the ⋮ menu offers it for a connected background session, and says when it opened', async () => {
    const onOpenTerminal = vi.fn(async () => {});
    chatT(session({ bgId: '5e1b5e9b' }), onOpenTerminal);
    await openMenu();
    await userEvent.setup().click(screen.getByRole('menuitem', { name: 'Open in a terminal' }));
    expect(onOpenTerminal).toHaveBeenCalledTimes(1);
    expect((await screen.findByTestId('terminal-outcome')).textContent).toContain('Terminal opened');
  });

  it('not for an interactive session nor a disconnected one', async () => {
    const { unmount } = render(
      <LangProvider lang="en">
        <ChatView session={session()} events={[]} pending={[]} loading={false} onSend={async () => {}} onBack={() => {}} onOpenTerminal={async () => {}} onRename={async () => {}} />
      </LangProvider>,
    );
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Open in a terminal' })).toBeNull();
    unmount();
    render(
      <LangProvider lang="en">
        <ChatView session={session({ bgId: '5e1b5e9b', state: 'disconnected' })} events={[]} pending={[]} loading={false} onSend={async () => {}} onBack={() => {}} onOpenTerminal={async () => {}} onRename={async () => {}} />
      </LangProvider>,
    );
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Open in a terminal' })).toBeNull();
  });

  it('shows the hub refusal: no terminal (with the command to run), not background, other failure', async () => {
    const cases: [Error, RegExp][] = [
      [errCode(502, 'no-terminal'), /No terminal program found\. Run in a terminal: claude attach 5e1b5e9b/],
      [errCode(409, 'not-background'), /no longer runs in the background/],
      [errCode(502, 'spawn-failed'), /Could not open a terminal\. Run in a terminal: claude attach 5e1b5e9b/],
    ];
    for (const [e, text] of cases) {
      const { unmount } = render(
        <LangProvider lang="en">
          <ChatView session={session({ bgId: '5e1b5e9b' })} events={[]} pending={[]} loading={false} onSend={async () => {}} onBack={() => {}} onOpenTerminal={() => Promise.reject(e)} />
        </LangProvider>,
      );
      await openMenu();
      await userEvent.setup().click(screen.getByRole('menuitem', { name: 'Open in a terminal' }));
      expect((await screen.findByRole('alert')).textContent).toMatch(text);
      unmount();
    }
  });

  it('a question waiting in the terminal dialog, answers off: says so, with the button and claude attach', async () => {
    const onOpenTerminal = vi.fn(async () => {});
    chatT(session({ bgId: '5e1b5e9b', state: 'waiting', waitingKind: 'question' }), onOpenTerminal);
    const banner = screen.getByTestId('waiting-banner');
    expect(banner.textContent).toContain('Question waiting for an answer');
    expect(banner.textContent).toContain('/ai-chat-center:cc answers on');
    expect(within(banner).getByTestId('attach-command').textContent).toContain('claude attach 5e1b5e9b');
    await userEvent.setup().click(within(banner).getByRole('button', { name: 'Open in a terminal' }));
    expect(onOpenTerminal).toHaveBeenCalledTimes(1);
  });

  it('answers on but the question went to the terminal: no hint to turn them on', () => {
    chatT(session({ bgId: '5e1b5e9b', state: 'waiting', waitingKind: 'question' }), async () => {}, true);
    const banner = screen.getByTestId('waiting-banner');
    expect(banner.textContent).toContain('Question waiting for an answer');
    expect(banner.textContent).not.toContain('answers on');
  });

  it('a question routed to the app keeps its own banner, without the terminal button', () => {
    chatT(
      session({ bgId: '5e1b5e9b', state: 'waiting', waitingKind: 'question', pendingQuestion: { toolUseId: 'tu1', createdAt: '2026-11-25T00:00:00.000Z', questions: [{ question: 'Q?', options: [{ label: 'A' }] }] } }),
      async () => {},
      true,
    );
    const banner = screen.getByTestId('waiting-banner');
    expect(banner.textContent).toContain('answer below');
    expect(within(banner).queryByRole('button', { name: 'Open in a terminal' })).toBeNull();
  });

  it('an interactive session with a terminal question: answer in the terminal, no button', () => {
    chatT(session({ state: 'waiting', waitingKind: 'question' }), async () => {});
    const banner = screen.getByTestId('waiting-banner');
    expect(banner.textContent).toContain("Answer it in the session's terminal.");
    expect(within(banner).queryByRole('button', { name: 'Open in a terminal' })).toBeNull();
  });

  it('a permission wait of a background session also offers the button', () => {
    chatT(session({ bgId: '5e1b5e9b', state: 'waiting', waitingKind: 'permission' }), async () => {});
    expect(within(screen.getByTestId('waiting-banner')).getByRole('button', { name: 'Open in a terminal' })).toBeTruthy();
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
