import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LangProvider } from '../i18n';
import { Composer } from './Composer';
import { loadQuickReplies, resetQuickRepliesMemory, saveQuickReplies } from '../quickReplies';

let n = 0;
const setup = (opts: { lang?: 'en' | 'pt-BR'; onSend?: (t: string) => Promise<void>; blocked?: boolean } = {}) =>
  render(
    <LangProvider lang={opts.lang ?? 'en'}>
      <Composer sessionId={`q${++n}`} name="x" disabled={false} blockedByQuestion={opts.blocked} onSend={opts.onSend ?? (async () => {})} />
    </LangProvider>,
  );
const box = () => screen.getByRole('textbox', { name: /Message/ }) as HTMLTextAreaElement;
const openList = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Quick replies' }));
  return screen.getByRole('dialog', { name: 'Quick replies' });
};

afterEach(() => {
  vi.restoreAllMocks();
  resetQuickRepliesMemory();
});

describe('quick replies storage', () => {
  it('null until saved; saves a cleaned list (trimmed, no blanks or repeats, capped)', () => {
    expect(loadQuickReplies()).toBeNull();
    saveQuickReplies([' go ', '', 'go', 'x'.repeat(600), ...Array.from({ length: 20 }, (_, i) => `r${i}`)]);
    const l = loadQuickReplies()!;
    expect(l[0]).toBe('go');
    expect(l[1]).toHaveLength(500);
    expect(l).toHaveLength(12);
  });
  it('ignores a tampered value and survives storage errors', () => {
    localStorage.setItem('acc.quickReplies', '{"a":1}');
    expect(loadQuickReplies()).toBeNull();
    localStorage.setItem('acc.quickReplies', '[1, "ok"]');
    expect(loadQuickReplies()).toEqual(['ok']);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => saveQuickReplies(['a'])).not.toThrow();
    expect(loadQuickReplies()).toEqual(['a']); // kept in memory until reload
  });
});

describe('quick replies in the composer', () => {
  it('lists the defaults of the language; a pick fills the field without sending', async () => {
    const onSend = vi.fn(async () => {});
    setup({ onSend });
    const list = await openList();
    expect(within(list).getAllByRole('button', { name: /^Use: / }).map((b) => b.textContent)).toEqual([
      'Go ahead', 'Commit it', "Summarize what's left",
    ]);
    await userEvent.click(within(list).getByRole('button', { name: 'Use: Commit it' }));
    expect(box().value).toBe('Commit it');
    expect(box()).toHaveFocus();
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('adds to what is already typed', async () => {
    setup();
    await userEvent.type(box(), 'Looks good.');
    const list = await openList();
    await userEvent.click(within(list).getByRole('button', { name: 'Use: Go ahead' }));
    expect(box().value).toBe('Looks good. Go ahead');
  });

  it('Portuguese defaults', async () => {
    setup({ lang: 'pt-BR' });
    await userEvent.click(screen.getByRole('button', { name: 'Respostas rápidas' }));
    const list = screen.getByRole('dialog', { name: 'Respostas rápidas' });
    expect(within(list).getByRole('button', { name: 'Usar: Pode seguir' })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Usar: Faz o commit' })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Usar: Resume o que falta' })).toBeInTheDocument();
  });

  it('edits the list: remove and add, kept for the next time', async () => {
    const { unmount } = setup();
    let list = await openList();
    await userEvent.click(within(list).getByRole('button', { name: 'Edit' }));
    await userEvent.click(within(list).getByRole('button', { name: 'Remove: Commit it' }));
    await userEvent.type(within(list).getByRole('textbox', { name: 'New quick reply' }), 'Run the tests{Enter}');
    expect(loadQuickReplies()).toEqual(['Go ahead', "Summarize what's left", 'Run the tests']);
    await userEvent.click(within(list).getByRole('button', { name: 'Done' }));
    expect(within(list).queryByRole('button', { name: /^Remove/ })).toBeNull();
    unmount();
    setup();
    list = await openList();
    expect(within(list).getAllByRole('button', { name: /^Use: / }).map((b) => b.textContent)).toEqual([
      'Go ahead', "Summarize what's left", 'Run the tests',
    ]);
  });

  it('an emptied list says how to add one', async () => {
    saveQuickReplies([]);
    setup();
    const list = await openList();
    expect(list).toHaveTextContent('No quick replies');
  });

  it('Escape closes the list and returns focus to the button', async () => {
    setup();
    await openList();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Quick replies' })).toHaveFocus();
  });

  it('disabled while a question blocks the field', () => {
    setup({ blocked: true });
    expect(screen.getByRole('button', { name: 'Quick replies' })).toBeDisabled();
  });
});
