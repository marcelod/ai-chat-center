import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SessionView } from '@shared/types';
import { LangProvider } from '../i18n';
import { ChatView } from './ChatView';
import { SessionList } from './SessionList';

// Spec 2026-11-26-side-panel: "agents working (N)", apart from "working" (Claude's turn) and "idle".

const session = (over: Partial<SessionView> = {}): SessionView => ({
  sessionId: 's1',
  name: 'proj',
  cwd: '/home/me/proj',
  state: 'idle',
  pendingAppMessageIds: [],
  ...over,
});

function chat(s: SessionView, subagents = vi.fn(async () => [])) {
  render(
    <LangProvider lang="en">
      <ChatView session={s} events={[]} pending={[]} loading={false} onSend={async () => {}} onBack={() => {}} panel={{ file: async () => new Blob(['']), subagents }} />
    </LangProvider>,
  );
  return subagents;
}

describe('agents working', () => {
  it('an idle session with subagents working says so in the header; clicking opens the subagents', async () => {
    const subagents = chat(session({ agentsWorking: 5 }));
    const pill = screen.getByRole('button', { name: /Show subagents/ });
    expect(pill).toHaveTextContent('agents working (5)');
    // The state is in the accessible name too, first (what a voice user says), then what the button does.
    expect(pill).toHaveAccessibleName('agents working (5). Show subagents');
    expect(pill).toHaveAttribute('data-state', 'agents');
    await userEvent.click(pill);
    expect(await screen.findByTestId('side-panel')).toBeTruthy();
    expect(subagents).toHaveBeenCalled();
  });

  it('a busy session stays "working"; an idle one without agents stays idle', () => {
    chat(session({ state: 'busy', agentsWorking: 2 }));
    expect(screen.getByRole('button', { name: /Show subagents/ })).toHaveTextContent('working…');
  });

  it('idle without agents', () => {
    chat(session());
    expect(screen.getByRole('button', { name: /Show subagents/ })).toHaveTextContent('idle');
  });

  it('the session list shows a discreet sign with the count', () => {
    render(
      <LangProvider lang="en">
        <SessionList
          connected={[session({ agentsWorking: 3 }), session({ sessionId: 's2', name: 'other' })]}
          others={[]}
          unread={{}}
          selectedId={null}
          onSelect={() => {}}
          onLanguage={() => {}}
        />
      </LangProvider>,
    );
    const row = document.querySelector('[data-session="s1"]') as HTMLElement;
    expect(within(row).getByTitle('3 subagents working')).toHaveTextContent('3');
    expect(row).toHaveTextContent('Status: idle, 3 subagents working');
    const other = document.querySelector('[data-session="s2"]') as HTMLElement;
    expect(within(other).queryByTitle(/subagents working/)).toBeNull();
  });
});
