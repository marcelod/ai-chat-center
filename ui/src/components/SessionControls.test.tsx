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

describe('model and effort controls', () => {
  it('a background session: choosing types /model and /effort', async () => {
    const onCommand = vi.fn(async () => {});
    chat(session({ bgId: '5e1b5e9b' }), onCommand);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Switch model' }), 'sonnet');
    expect(onCommand).toHaveBeenCalledWith('/model sonnet');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Switch effort' }), 'high');
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
    expect(screen.getByRole('combobox', { name: 'Switch model' })).not.toBeDisabled();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Switch model' }), 'opus');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Switch effort' }), 'high');
    expect(onCommand).not.toHaveBeenCalled();
    expect(screen.getByText('will be applied when the session finishes')).toBeTruthy();
    rerender(view(session({ bgId: '5e1b5e9b', state: 'idle' })));
    await vi.waitFor(() => expect(onCommand).toHaveBeenCalledTimes(2));
    expect(onCommand.mock.calls.map((c) => c[0])).toEqual(['/model opus', '/effort high']);
    expect(screen.queryByText('will be applied when the session finishes')).toBeNull();
  });

  it('a busy answer is shown', async () => {
    chat(session({ bgId: '5e1b5e9b' }), async () => Promise.reject(Object.assign(new Error('409'), { status: 409 })));
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Switch model' }), 'opus');
    expect((await screen.findByRole('alert')).textContent).toContain('busy');
  });

  it('a terminal session: shown disabled with the hint, nothing is sent', () => {
    const onCommand = vi.fn(async () => {});
    chat(session(), onCommand);
    const model = screen.getByRole('combobox', { name: /Switch model/ });
    expect(model).toBeDisabled();
    expect(screen.getByRole('combobox', { name: /Switch effort/ })).toBeDisabled();
    expect(model.getAttribute('aria-label')).toContain('Available in background sessions: resume the session from the app');
    expect(screen.getByTestId('session-controls').getAttribute('title')).toContain('Available in background sessions');
    expect(screen.getByText('background sessions only')).toBeTruthy();
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
