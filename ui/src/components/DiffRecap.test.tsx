import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveShowDiffs } from '../prefs';
import type { ToolDiff } from '@shared/types';
import { LangProvider } from '../i18n';
import { ActionsGroup } from './ActionsGroup';
import { RecapCard } from './MessageBubble';

const wrap = (n: React.ReactNode) => <LangProvider lang="en">{n}</LangProvider>;

describe('DiffView', () => {
  beforeEach(() => saveShowDiffs(true));
  afterEach(() => {
    saveShowDiffs(false);
    localStorage.clear();
  });
  const diff: ToolDiff = {
    lines: [
      { op: ' ', text: 'a' },
      { op: '-', text: 'b' },
      { op: '+', text: 'B' },
    ],
    added: 1,
    removed: 1,
  };
  it('is folded until opened, then shows removed and added lines', async () => {
    const { container } = render(wrap(<ActionsGroup items={[{ toolUseId: 't', name: 'Edit', summary: '/f.ts', result: 'ok', diff }]} />));
    await userEvent.click(screen.getByRole('button', { name: /Edit/ }));
    expect(container.querySelector('[data-diff-line]')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show changes (+1 -1)' }));
    expect(container.querySelector('[data-diff-line="-"]')?.textContent).toContain('b');
    expect(container.querySelector('[data-diff-line="+"]')?.textContent).toContain('B');
  });
  it('off by default: no diff button at all', async () => {
    saveShowDiffs(false);
    render(wrap(<ActionsGroup items={[{ toolUseId: 't', name: 'Edit', summary: '/f.ts', result: 'ok', diff }]} />));
    await userEvent.click(screen.getByRole('button', { name: /Edit/ }));
    expect(screen.queryByRole('button', { name: /Show changes/ })).toBeNull();
  });
  it('shows 200 lines, then more on request', async () => {
    const big: ToolDiff = { lines: Array.from({ length: 450 }, (_, i) => ({ op: '+' as const, text: `l${i}` })), added: 450, removed: 0 };
    const { container } = render(wrap(<ActionsGroup items={[{ toolUseId: 't', name: 'Write', summary: '/n', result: 'ok', diff: big }]} />));
    await userEvent.click(screen.getByRole('button', { name: /Write/ }));
    await userEvent.click(screen.getByRole('button', { name: /Show changes/ }));
    expect(container.querySelectorAll('[data-diff-line]').length).toBe(200);
    await userEvent.click(screen.getByRole('button', { name: 'Show more (250 lines)' }));
    expect(container.querySelectorAll('[data-diff-line]').length).toBe(400);
  });
});

describe('RecapCard', () => {
  it('shows a labelled card with markdown', () => {
    const { container } = render(wrap(<RecapCard text="Falta **conferir** o canal." />));
    const c = container.querySelector('[data-bubble="recap"]') as HTMLElement;
    expect(within(c).getByText('Recap')).toBeTruthy();
    expect(within(c).getByText('conferir').tagName).toBe('STRONG');
  });
});
