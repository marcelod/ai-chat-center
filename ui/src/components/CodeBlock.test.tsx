import { describe, expect, it, vi } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssistantBubble } from './MessageBubble';
import { LangProvider } from '../i18n';

function show(text: string) {
  return render(
    <LangProvider lang="en">
      <AssistantBubble text={text} />
    </LangProvider>,
  );
}

const fence = (lang: string, body: string) => '```' + lang + '\n' + body + '\n```';

describe('code blocks', () => {
  it('a block without a language (a prompt to paste) wraps; real code scrolls', () => {
    const { container } = show(fence('', 'a long prompt') + '\n\n' + fence('ts', 'const x = 1;'));
    const pres = container.querySelectorAll('pre');
    expect(pres[0].getAttribute('data-wrap')).toBe('on');
    expect(pres[1].getAttribute('data-wrap')).toBe('off');
  });
  it('the toggle switches between wrapped and scrolled lines', async () => {
    const { container } = show(fence('ts', 'const x = 1;'));
    const block = container.querySelector('[data-code-block]') as HTMLElement;
    await userEvent.click(within(block).getByRole('button', { name: 'Wrap lines' }));
    expect(block.querySelector('pre')!.getAttribute('data-wrap')).toBe('on');
    expect(within(block).getByRole('button', { name: "Don't wrap lines" }).getAttribute('aria-pressed')).toBe('true');
  });
  it('Copy puts the plain text of the block on the clipboard and says so', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    show(fence('text', 'line one\nline two'));
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('line one\nline two');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });
  it('a refused clipboard says it could not copy', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } }, configurable: true });
    show(fence('', 'x'));
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Copy' }));
    });
    expect(screen.getByRole('button', { name: 'Could not copy' })).toBeTruthy();
  });
  it('inline code is left as it was', () => {
    const { container } = show('use `npm test` here');
    expect(container.querySelector('[data-code-block]')).toBeNull();
    expect(container.querySelector('code')!.textContent).toBe('npm test');
  });
});
