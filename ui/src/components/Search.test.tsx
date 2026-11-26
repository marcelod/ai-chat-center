import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ChatEvent, SessionView } from '@shared/types';
import type { SearchHit } from '@shared/search';
import { LangProvider } from '../i18n';
import { ChatView } from './ChatView';
import { SessionList } from './SessionList';
import { findRanges } from '../useFindInChat';

// Spec 2026-11-25-app-batch: search in a conversation and across all of them.

const session = (over: Partial<SessionView> = {}): SessionView => ({ sessionId: 'q1', name: 'billing', cwd: '/b', state: 'idle', pendingAppMessageIds: [], ...over });
const events: ChatEvent[] = [
  { kind: 'user', id: 'u1', ts: '2026-11-25T01:00:00.000Z', text: 'corrige a cobrança', origin: 'app' },
  { kind: 'assistant', id: 'a1', ts: '2026-11-25T01:01:00.000Z', text: 'Pronto, a função de COBRANÇA foi corrigida.' },
  { kind: 'assistant', id: 'a2', ts: '2026-11-25T01:02:00.000Z', text: 'Mais alguma coisa?' },
];

describe('search in a conversation', () => {
  it('the whole conversation stays; the bar counts every occurrence, ignoring case and accents, and ↑/↓ move between them', async () => {
    render(
      <LangProvider lang="en">
        <ChatView session={session()} events={events} pending={[]} loading={false} onSend={async () => {}} onBack={() => {}} />
      </LangProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Search in this conversation' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search in this conversation' }), 'cobranca');
    expect(screen.getByText('2 of 2')).toBeTruthy(); // starts at the newest occurrence
    expect(screen.getByText('Mais alguma coisa?')).toBeTruthy(); // nothing is hidden
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByText('1 of 2')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByText('2 of 2')).toBeTruthy(); // wraps around
    await user.click(screen.getByRole('searchbox'));
    await user.keyboard('{Enter}');
    expect(screen.getByText('1 of 2')).toBeTruthy();
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(screen.getByText('2 of 2')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('says when nothing is found and disables ↑/↓', async () => {
    render(
      <LangProvider lang="en">
        <ChatView initialSearch="xyzzy" session={session()} events={events} pending={[]} loading={false} onSend={async () => {}} onBack={() => {}} />
      </LangProvider>,
    );
    expect(screen.getByText('No message found')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens already searching when a hit was picked in the list', () => {
    render(
      <LangProvider lang="en">
        <ChatView initialSearch="mais alguma" session={session()} events={events} pending={[]} loading={false} onSend={async () => {}} onBack={() => {}} />
      </LangProvider>,
    );
    expect(screen.getByText('1 of 1')).toBeTruthy();
  });
});

describe('findRanges', () => {
  it('finds every occurrence in the text, not in buttons, ignoring accents', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Ação e acao, ACAO.</p><button>acao</button><span aria-hidden="true">acao</span>';
    const found = findRanges(root, 'ação');
    expect(found.map((r) => r.toString())).toEqual(['Ação', 'acao', 'ACAO']);
  });
});

describe('search across conversations', () => {
  it('the list search also finds messages; picking one opens it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const hit: SearchHit = { sessionId: 'q2', name: 'site', eventId: 'e9', ts: '2026-11-25T02:00:00.000Z', kind: 'assistant', snippet: '…a cobrança do site…' };
    const onSearch = vi.fn(async () => [hit]);
    const onOpenHit = vi.fn();
    render(
      <LangProvider lang="en">
        <SessionList connected={[session()]} others={[]} unread={{}} selectedId={null} onSelect={() => {}} onLanguage={() => {}} onSearch={onSearch} onOpenHit={onOpenHit} />
      </LangProvider>,
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByRole('searchbox'), 'cobrança');
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(onSearch).toHaveBeenCalledTimes(1); // debounced: once, with the whole text
    expect(onSearch).toHaveBeenCalledWith('cobrança');
    await user.click(await screen.findByText('…a cobrança do site…'));
    expect(onOpenHit).toHaveBeenCalledWith(hit, 'cobrança');
    vi.useRealTimers();
  });
});
