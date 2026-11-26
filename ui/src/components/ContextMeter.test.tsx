import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ContextUsage, SessionView } from '@shared/types';
import { LangProvider } from '../i18n';
import { ContextMeter, formatTokens } from './ContextMeter';
import { ChatView } from './ChatView';

const show = (context: ContextUsage, model?: string, lang: 'en' | 'pt-BR' = 'en') =>
  render(<LangProvider lang={lang}><ContextMeter context={context} model={model} /></LangProvider>);

describe('formatTokens', () => {
  it('shortens to k and M', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(124_400)).toBe('124k');
    expect(formatTokens(200_000)).toBe('200k');
    expect(formatTokens(1_000_000)).toBe('1M');
    expect(formatTokens(1_250_000)).toBe('1.3M');
  });
});

describe('ContextMeter', () => {
  it('shows a small pie and the percentage', () => {
    show({ used: 124_000, size: 200_000 });
    const b = screen.getByRole('button', { name: /Context: 62% used/ });
    expect(b).toHaveTextContent('62%');
    expect(b.querySelector('svg')).not.toBeNull();
    expect(b).toHaveAttribute('data-level', 'normal');
  });

  it('turns yellow from 80% and red from 90%, saying so in words too', () => {
    const { unmount } = show({ used: 160_000, size: 200_000 });
    let b = screen.getByRole('button');
    expect(b).toHaveAttribute('data-level', 'warn');
    expect(b.getAttribute('aria-label')).toContain('near the limit');
    unmount();
    show({ used: 185_000, size: 200_000 });
    b = screen.getByRole('button');
    expect(b).toHaveAttribute('data-level', 'danger');
    expect(b).toHaveTextContent('93%');
    expect(b.getAttribute('aria-label')).toContain('almost full');
  });

  it('hovering shows the details: tokens, model, room left and the last compaction', async () => {
    show({ used: 124_000, size: 200_000, exact: true, lastCompactAt: new Date(2026, 10, 26, 14, 5).toISOString() }, 'Opus 5.5');
    await userEvent.hover(screen.getByRole('button'));
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('124k / 200k tokens');
    expect(tip).toHaveTextContent('Opus 5.5');
    expect(tip).toHaveTextContent('38% left until the limit (76k tokens)');
    expect(tip).toHaveTextContent('Claude Code compacts automatically before the limit');
    expect(tip).toHaveTextContent(/Last compaction: .*14:05/);
    expect(tip).not.toHaveTextContent('estimated');
    expect(screen.getByRole('button')).toHaveAttribute('aria-describedby', tip.id);
    await userEvent.unhover(screen.getByRole('button'));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('says when the size is estimated and when there was no compaction', async () => {
    show({ used: 10_000, size: 200_000 });
    await userEvent.hover(screen.getByRole('button'));
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Window size estimated from the model');
    expect(tip).toHaveTextContent('No compaction yet');
  });

  it('opens with a tap or the keyboard, and Escape closes it', async () => {
    show({ used: 10_000, size: 200_000 });
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
    await userEvent.tab();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('caps the pie at 100%', () => {
    show({ used: 210_000, size: 200_000 });
    expect(screen.getByRole('button')).toHaveTextContent('100%');
  });

  it('in Portuguese', async () => {
    show({ used: 124_000, size: 200_000 }, undefined, 'pt-BR');
    await userEvent.hover(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('faltam 38% até o limite');
  });
});

describe('context in the bar under the message field', () => {
  const session = (over: Partial<SessionView> = {}): SessionView => ({ sessionId: 'c1', name: 'n', cwd: '/p', state: 'idle', pendingAppMessageIds: [], ...over });
  const chat = (s: SessionView) =>
    render(
      <LangProvider lang="en">
        <ChatView session={s} events={[]} pending={[]} loading={false} onSend={async () => {}} onBack={() => {}} />
      </LangProvider>,
    );
  it('shows the meter in the bar, without shrinking it', () => {
    chat(session({ context: { used: 50_000, size: 200_000 }, model: 'Opus 5.5' }));
    const meter = screen.getByTestId('context-meter');
    expect(meter.closest('[data-testid="session-bar"]')).not.toBeNull();
    expect(meter.className).toContain('shrink-0');
  });
  it('nothing without context data or for a disconnected session', () => {
    chat(session());
    expect(screen.queryByTestId('context-meter')).toBeNull();
  });
});
