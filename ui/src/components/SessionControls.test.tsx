import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SessionView } from '@shared/types';
import { LangProvider } from '../i18n';
import { ChatView } from './ChatView';

// Spec 2026-11-25-app-batch: switching the model and the effort of a background session from the app.

const session = (over: Partial<SessionView> = {}): SessionView => ({ sessionId: 'sc1', name: 'n', cwd: '/p', state: 'idle', pendingAppMessageIds: [], ...over });
const chat = (s: SessionView, onCommand?: (t: string) => Promise<void>) =>
  render(
    <LangProvider lang="en">
      <ChatView session={s} events={[]} pending={[]} loading={false} onSend={async () => {}} onBack={() => {}} onCommand={onCommand} />
    </LangProvider>,
  );

const pick = async (user: ReturnType<typeof userEvent.setup>, model?: string, effort?: string) => {
  if (model) {
    await user.click(screen.getByRole('button', { name: /^Switch model/ }));
    await user.click(screen.getByRole('menuitemradio', { name: model }));
  }
  if (effort) {
    await user.click(screen.getByRole('button', { name: /^Switch model/ }));
    await user.click(screen.getByRole('menuitem', { name: /Switch effort/ }));
    await user.click(screen.getByRole('menuitemradio', { name: effort }));
  }
};

describe('model and effort controls', () => {
  it('the chip shows the model and effort in use and marks them in the lists', async () => {
    chat(session({ bgId: '5e1b5e9b', model: 'Opus 5.5', effort: 'high' }), vi.fn(async () => {}));
    const user = userEvent.setup();
    const chip = screen.getByRole('button', { name: 'Switch model: Opus 5.5 · high' });
    expect(chip.closest('footer')).not.toBeNull();
    await user.click(chip);
    expect(screen.getByRole('menuitemradio', { name: 'opus' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('menuitem', { name: /Switch effort: high/ }));
    expect(screen.getByRole('menuitemradio', { name: 'high' })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Switch effort' })).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('on a phone the effort list stacks above the model list, so the menu never leaves the screen', async () => {
    chat(session({ bgId: '5e1b5e9b', model: 'Opus 5.5', effort: 'high' }), vi.fn(async () => {}));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Switch model/ }));
    await user.click(screen.getByRole('menuitem', { name: /Switch effort/ }));
    const box = screen.getByRole('menu', { name: 'Switch effort' }).parentElement!;
    expect(box.className).toMatch(/(^|\s)flex-col(\s|$)/);
    expect(box.className).toContain('md:flex-row');
    expect(box.className).toContain('max-w-[calc(100vw-1rem)]');
  });

  it('a background session: choosing types /model and /effort', async () => {
    const onCommand = vi.fn(async () => {});
    chat(session({ bgId: '5e1b5e9b' }), onCommand);
    const user = userEvent.setup();
    await pick(user, 'sonnet');
    expect(onCommand).toHaveBeenCalledWith('/model sonnet');
    expect(screen.queryByRole('menu')).toBeNull();
    await pick(user, undefined, 'high');
    expect(onCommand).toHaveBeenCalledWith('/effort high');
  });

  it('while the session works the choice is kept and sent once it is idle', async () => {
    const onCommand = vi.fn(async (_line: string) => {});
    const view = (s: SessionView) => (
      <LangProvider lang="en">
        <ChatView session={s} events={[]} pending={[]} loading={false} onSend={async () => {}} onBack={() => {}} onCommand={onCommand} />
      </LangProvider>
    );
    const { rerender } = render(view(session({ bgId: '5e1b5e9b', state: 'busy' })));
    const user = userEvent.setup();
    await pick(user, 'opus', 'high');
    expect(onCommand).not.toHaveBeenCalled();
    expect(screen.getByText('will be applied when the session finishes')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Switch model/ })).toHaveTextContent('opus · high');
    rerender(view(session({ bgId: '5e1b5e9b', state: 'idle' })));
    await vi.waitFor(() => expect(onCommand).toHaveBeenCalledTimes(2));
    expect(onCommand.mock.calls.map((c) => c[0])).toEqual(['/model opus', '/effort high']);
    expect(screen.queryByText('will be applied when the session finishes')).toBeNull();
  });

  it('a busy answer is shown', async () => {
    chat(session({ bgId: '5e1b5e9b' }), async () => Promise.reject(Object.assign(new Error('409'), { status: 409 })));
    await pick(userEvent.setup(), 'opus');
    expect((await screen.findByRole('alert')).textContent).toContain('busy');
  });

  it('a terminal session: the chip only shows the model, with the hint; nothing opens', () => {
    const onCommand = vi.fn(async () => {});
    chat(session({ model: 'Opus 5.5' }), onCommand);
    expect(screen.queryByRole('button', { name: /^Switch model/ })).toBeNull();
    const chip = screen.getByTitle('Available in background sessions: resume the session from the app');
    expect(chip).toHaveTextContent('Opus 5.5');
    expect(screen.queryByText('background sessions only')).toBeNull();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('an ended session has no controls', () => {
    chat(session({ state: 'disconnected' }), vi.fn(async () => {}));
    expect(screen.queryByTestId('session-controls')).toBeNull();
  });

  it('typing / in a terminal session shows the line, not the list; Enter still asks before sending as text', async () => {
    const onSend = vi.fn(async () => {});
    render(
      <LangProvider lang="en">
        <ChatView session={session()} events={[]} pending={[]} loading={false} onSend={onSend} onBack={() => {}} onCommand={vi.fn(async () => {})} />
      </LangProvider>,
    );
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), '/');
    expect(screen.getByTestId('terminal-commands-hint').textContent).toContain('Available in background sessions');
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.type(screen.getByRole('textbox'), 'compact{Enter}');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByTestId('terminal-commands-hint')).toBeNull();
  });

  it('no hint for a background session (it gets the list)', async () => {
    chat(session({ bgId: '5e1b5e9b' }), vi.fn(async () => {}));
    await userEvent.setup().type(screen.getByRole('textbox'), '/');
    expect(screen.queryByTestId('terminal-commands-hint')).toBeNull();
  });
});
