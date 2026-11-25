import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { SessionView } from '@shared/types';
import { LangProvider } from '../i18n';
import { ChatView } from './ChatView';
import { SettingsMenu } from './SettingsMenu';
import { SessionList } from './SessionList';

// Versions in use: the hub's in the settings menu, the session's plugin and Claude Code in the conversation header.

const session = (over: Partial<SessionView> = {}): SessionView => ({ sessionId: 'v1', name: 'n', cwd: '/p', state: 'idle', pendingAppMessageIds: [], ...over });
const chat = (s: SessionView, hubVersion?: string, lang: 'en' | 'pt-BR' = 'en') =>
  render(
    <LangProvider lang={lang}>
      <ChatView session={s} events={[]} pending={[]} loading={false} onSend={async () => {}} onBack={() => {}} hubVersion={hubVersion} />
    </LangProvider>,
  );

describe('versions in the bar under the message field', () => {
  it('shows only the plugin version; Claude Code is in its title', () => {
    chat(session({ pluginVersion: '0.6.1', claudeVersion: '2.1.332' }), '0.6.1');
    const box = screen.getByTestId('version-info');
    expect(box.closest('[data-testid="session-bar"]')).not.toBeNull();
    expect(box.getAttribute('title')).toContain('Claude Code 2.1.332');
    expect(box).not.toHaveAttribute('data-stale');
    expect(box.textContent).toContain('plugin 0.6.1');
  });

  it('flags a plugin different from the hub with the fix', () => {
    chat(session({ pluginVersion: '0.5.0' }), '0.6.1', 'pt-BR');
    const stale = screen.getByTestId('version-info');
    expect(stale).toHaveAttribute('data-stale', 'true');
    expect(stale.textContent).toContain('↻');
    expect(stale.getAttribute('title')).toContain('versão antiga: rode /reload-plugins e /ai-chat-center:cc');
  });

  it('nothing when the session has no version', () => {
    chat(session(), '0.6.1');
    expect(screen.queryByTestId('version-info')).toBeNull();
  });
});

describe('hub version in the list', () => {
  it('the settings menu shows it', async () => {
    render(
      <LangProvider lang="en">
        <SettingsMenu onLanguage={() => {}} version="0.6.1" />
      </LangProvider>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByTestId('app-version').textContent).toBe('AI Chat Center 0.6.1');
  });
});

describe('list title stays on one line', () => {
  it('has whitespace-nowrap, truncate and min-w-0', () => {
    render(
      <LangProvider lang="en">
        <SessionList connected={[]} others={[]} unread={{}} selectedId={null} onSelect={() => {}} onLanguage={() => {}} />
      </LangProvider>,
    );
    const h1 = screen.getByRole('heading', { level: 1 });
    for (const c of ['whitespace-nowrap', 'truncate', 'min-w-0']) expect(h1.className).toContain(c);
  });
});
