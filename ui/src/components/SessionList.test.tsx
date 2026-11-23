import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SessionView } from '@shared/types';
import { LangProvider } from '../i18n';
import { SessionList } from './SessionList';
import { useCollapsedList } from '../useCollapsedList';

const s = (id: string, name: string, state: SessionView['state'] = 'idle'): SessionView =>
  ({ sessionId: id, name, cwd: '/x/' + name, state, pendingAppMessageIds: [], pendingAppMessages: [] }) as unknown as SessionView;

function Harness({ onSelect = () => {} }: { onSelect?: (id: string) => void }) {
  const [collapsed, toggle] = useCollapsedList();
  return (
    <LangProvider lang="en">
      <div data-testid="wrap" data-collapsed={collapsed}>
        <SessionList
          connected={[s('a', 'Alpha', 'busy'), s('b', 'Beta')]}
          others={[{ sessionId: 'o', name: 'Other', cwd: '/o', status: 'idle' } as never]}
          unread={{ b: 3 }}
          selectedId={null}
          onSelect={onSelect}
          onLanguage={() => {}}
          collapsed={collapsed}
          onToggleCollapsed={toggle}
        />
      </div>
    </LangProvider>
  );
}

describe('collapsible session list', () => {
  it('toggles and persists in localStorage', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Collapse list' }));
    expect(localStorage.getItem('acc.sessionsCollapsed')).toBe('1');
    await user.click(screen.getByRole('button', { name: 'Expand list' }));
    expect(localStorage.getItem('acc.sessionsCollapsed')).toBe('0');
  });

  it('starts collapsed from storage; avatars have accessible name and select on click; hides others/search', async () => {
    localStorage.setItem('acc.sessionsCollapsed', '1');
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSelect={onSelect} />);
    const btn = screen.getByRole('button', { name: 'Beta' });
    expect(btn).toHaveAttribute('title', 'Beta');
    await user.click(btn);
    expect(onSelect).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByText(/Other open sessions/)).toBeNull();
    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
  });

  it('works when localStorage throws', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Collapse list' }));
    expect(screen.getByTestId('wrap')).toHaveAttribute('data-collapsed', 'true');
    spy.mockRestore();
    set.mockRestore();
  });
});
