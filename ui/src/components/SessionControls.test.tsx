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

  it('disabled while the session works; a busy answer is shown', async () => {
    const { unmount } = chat(session({ bgId: '5e1b5e9b', state: 'busy' }), vi.fn(async () => {}));
    expect(screen.getByRole('combobox', { name: 'Switch model' })).toBeDisabled();
    unmount();
    chat(session({ bgId: '5e1b5e9b' }), async () => Promise.reject(Object.assign(new Error('409'), { status: 409 })));
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Switch model' }), 'opus');
    expect((await screen.findByRole('alert')).textContent).toContain('busy');
  });

  it('not for an interactive session', () => {
    chat(session(), vi.fn(async () => {}));
    expect(screen.queryByTestId('session-controls')).toBeNull();
  });
});
