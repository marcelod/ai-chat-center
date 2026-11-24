import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Usage } from '@shared/types';
import { LangProvider, translate } from '../i18n';
import { UsageMeter, timeLeft } from './UsageMeter';

const NOW = Date.parse('2026-11-24T12:00:00Z');
const at = (mins: number) => new Date(NOW + mins * 60_000).toISOString();
const usage = (o: Partial<Usage> = {}): Usage => ({
  fiveHour: { usedPercentage: 37.4, resetsAt: at(158) },
  updatedAt: at(-1),
  ...o,
});
const show = (u?: Usage, collapsed = false) =>
  render(<LangProvider lang="en"><UsageMeter usage={u} collapsed={collapsed} /></LangProvider>);

afterEach(() => vi.useRealTimers());

describe('timeLeft', () => {
  const t = (k: string, v?: Record<string, string | number>) => translate('en', k, v);
  it('formats hours and minutes, minutes alone, and null once passed', () => {
    expect(timeLeft(at(158), t, NOW)).toBe('2h38');
    expect(timeLeft(at(45), t, NOW)).toBe('45 min');
    expect(timeLeft(at(60), t, NOW)).toBe('1h00');
    expect(timeLeft(at(0), t, NOW)).toBeNull();
    expect(timeLeft(at(-5), t, NOW)).toBeNull();
  });
});

describe('UsageMeter', () => {
  it('shows nothing without usage', () => {
    const { container } = show(undefined);
    expect(container).toBeEmptyDOMElement();
  });
  it('shows the percentage and the time left; a click opens the details with the 7-day window', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    show(usage({ sevenDay: { usedPercentage: 12, resetsAt: at(3 * 1440) } }));
    const button = screen.getByRole('button', { name: '5-hour usage: 37% · resets in 2h38' });
    expect(button).toHaveTextContent('37% · resets in 2h38');
    await userEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: '5-hour usage' });
    expect(dialog).toHaveTextContent('37% used');
    expect(dialog).toHaveTextContent('(in 2h38)');
    expect(dialog).toHaveTextContent('7-day window');
    expect(dialog).toHaveTextContent('12% used');
  });
  it('a window past its reset shows as restarted', () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    show(usage({ fiveHour: { usedPercentage: 90, resetsAt: at(-3) } }));
    expect(screen.getByRole('button', { name: '5-hour usage: Window restarted' })).toBeInTheDocument();
  });
  it('collapsed: only the percentage, the summary in the title', () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    show(usage(), true);
    const b = screen.getByRole('button');
    expect(b).toHaveTextContent(/^37%$/);
    expect(b).toHaveAttribute('title', '5-hour usage: 37% · resets in 2h38');
  });
});
