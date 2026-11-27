import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionView } from '@shared/types';
import { LangProvider } from '../i18n';
import { saveGroupByProject } from '../prefs';
import { SessionList } from './SessionList';

const s = (id: string, name: string, cwd: string, extra: Partial<SessionView> = {}): SessionView =>
  ({ sessionId: id, name, cwd, state: 'idle', pendingAppMessageIds: [], pendingAppMessages: [], ...extra }) as SessionView;

// Hub order: most recent first.
const sessions = [
  s('a1', 'Alpha one', '/home/me/alpha'),
  s('b1', 'Beta one', '/home/me/beta', { state: 'busy', agentsWorking: 2 }),
  s('p', 'Pinned', '/home/me/beta', { pinned: true }),
  s('a2', 'Alpha two', '/home/me/alpha'),
  s('b2', 'Beta two', '/home/me/beta'),
];

function setup(props: { collapsed?: boolean; unread?: Record<string, number> } = {}) {
  return render(
    <LangProvider lang="en">
      <SessionList
        connected={sessions}
        others={[]}
        unread={props.unread ?? {}}
        selectedId={null}
        onSelect={() => {}}
        onLanguage={() => {}}
        collapsed={props.collapsed}
      />
    </LangProvider>,
  );
}

const order = () => [...document.querySelectorAll('[data-session]')].map((e) => e.getAttribute('data-session'));

afterEach(() => saveGroupByProject(false));

describe('group by project', () => {
  it('is off by default: the flat list as before', () => {
    setup();
    expect(screen.queryByRole('button', { name: /^alpha/ })).toBeNull();
    expect(order()).toEqual(['p', 'a1', 'b1', 'a2', 'b2']);
  });

  it('groups by folder, pinned on top outside the groups, groups and members most recent first', () => {
    saveGroupByProject(true);
    setup();
    expect(order()).toEqual(['p', 'a1', 'a2', 'b1', 'b2']);
    const alpha = screen.getByRole('button', { name: /^alpha \(2\)/ });
    expect(alpha).toHaveAttribute('aria-expanded', 'true');
    expect(alpha).toHaveAttribute('title', '/home/me/alpha');
    expect(screen.getByRole('button', { name: /^beta \(2\)/ })).toBeInTheDocument();
  });

  it('closes and opens a group and remembers it', async () => {
    saveGroupByProject(true);
    const user = userEvent.setup();
    const { unmount } = setup();
    await user.click(screen.getByRole('button', { name: /^alpha/ }));
    expect(screen.getByRole('button', { name: /^alpha/ })).toHaveAttribute('aria-expanded', 'false');
    expect(order()).toEqual(['p', 'b1', 'b2']);
    expect(JSON.parse(localStorage.getItem('acc.closedGroups')!)).toEqual(['/home/me/alpha']);
    unmount();
    setup();
    expect(order()).toEqual(['p', 'b1', 'b2']);
    await user.click(screen.getByRole('button', { name: /^alpha/ }));
    expect(order()).toEqual(['p', 'a1', 'a2', 'b1', 'b2']);
    expect(JSON.parse(localStorage.getItem('acc.closedGroups')!)).toEqual([]);
  });

  it('a closed group shows working, subagents working and new messages', () => {
    saveGroupByProject(true);
    localStorage.setItem('acc.closedGroups', JSON.stringify(['/home/me/beta', '/home/me/alpha']));
    setup({ unread: { b2: 2, b1: 1, p: 5 } });
    const beta = screen.getByRole('button', { name: /^beta/ });
    expect(beta).toHaveAccessibleName(/a conversation is working/);
    expect(beta).toHaveAccessibleName(/2 subagents working/);
    expect(beta).toHaveAccessibleName(/3 unread/);
    expect(within(beta).getByText('3')).toBeInTheDocument();
    const alpha = screen.getByRole('button', { name: /^alpha/ });
    expect(alpha).not.toHaveAccessibleName(/working|unread/);
  });

  it('an open group does not repeat the activity in its header', () => {
    saveGroupByProject(true);
    setup({ unread: { b2: 2 } });
    expect(screen.getByRole('button', { name: /^beta/ })).not.toHaveAccessibleName(/unread|working/);
  });

  it('the search ignores the groups', async () => {
    saveGroupByProject(true);
    localStorage.setItem('acc.closedGroups', JSON.stringify(['/home/me/alpha']));
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByRole('searchbox'), 'one');
    expect(screen.queryByRole('button', { name: /^alpha/ })).toBeNull();
    expect(order()).toEqual(['a1', 'b1']);
  });

  it('the collapsed list ignores the groups', () => {
    saveGroupByProject(true);
    localStorage.setItem('acc.closedGroups', JSON.stringify(['/home/me/alpha']));
    setup({ collapsed: true });
    expect(screen.queryByRole('button', { name: /^alpha/ })).toBeNull();
    expect(order()).toEqual(['p', 'a1', 'b1', 'a2', 'b2']);
  });

  it('survives a corrupt closed groups entry', () => {
    saveGroupByProject(true);
    localStorage.setItem('acc.closedGroups', '{bad');
    setup();
    expect(order()).toEqual(['p', 'a1', 'a2', 'b1', 'b2']);
  });
});
