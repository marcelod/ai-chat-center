import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LangProvider } from '../i18n';
import { Composer } from './Composer';
import { dismissSuggestion, loadDismissed, loadQuickReplies, resetQuickRepliesMemory, saveQuickReplies } from '../quickReplies';

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

/** The hub's suggestions (spec 2026-11-27-suggested-quick-replies); none unless a test says otherwise. */
const hub = (suggestions: { text: string; count: number }[] | 'fail' = []) => {
  const f = vi.fn(async (url: string) =>
    suggestions === 'fail' || url !== '/api/quick-replies/suggestions'
      ? new Response('{}', { status: 500 })
      : new Response(JSON.stringify({ suggestions }), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', f);
  return f;
};

beforeEach(() => {
  hub();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

describe('suggested quick replies', () => {
  const section = async () => {
    const list = await openList();
    return within(list).findByRole('region', { name: 'Suggestions' });
  };

  it('shows what the hub suggests below the list; a pick fills the field', async () => {
    const f = hub([{ text: 'run the tests', count: 4 }]);
    setup();
    const s = await section();
    expect(f).toHaveBeenCalledWith('/api/quick-replies/suggestions', expect.anything());
    await userEvent.click(within(s).getByRole('button', { name: 'Use suggestion: run the tests' }));
    expect(box().value).toBe('run the tests');
  });

  it('+ adds it to the list (after the defaults) and it leaves the suggestions', async () => {
    hub([{ text: 'run the tests', count: 4 }, { text: 'and push', count: 3 }]);
    setup();
    const s = await section();
    await userEvent.click(within(s).getByRole('button', { name: 'Add to quick replies: run the tests' }));
    expect(loadQuickReplies()).toEqual(['Go ahead', 'Commit it', "Summarize what's left", 'run the tests']);
    expect(within(s).queryByRole('button', { name: /run the tests/ })).toBeNull();
    expect(within(s).getByRole('button', { name: 'Use suggestion: and push' })).toBeInTheDocument();
  });

  it('x dismisses it for good', async () => {
    hub([{ text: 'Run the tests!', count: 4 }]);
    const { unmount } = setup();
    const s = await section();
    await userEvent.click(within(s).getByRole('button', { name: 'Dismiss: Run the tests!' }));
    expect(screen.queryByRole('region', { name: 'Suggestions' })).toBeNull();
    expect(loadDismissed()).toContain('run the tests');
    unmount();
    setup();
    const list = await openList();
    await new Promise((r) => setTimeout(r, 20));
    expect(within(list).queryByRole('region', { name: 'Suggestions' })).toBeNull();
  });

  it('hides what is already in the list (defaults included, compared normalized) or was dismissed', async () => {
    dismissSuggestion('ship IT');
    hub([{ text: 'go ahead!', count: 9 }, { text: 'Ship it', count: 5 }, { text: 'keep going', count: 3 }]);
    setup();
    const s = await section();
    expect(within(s).getAllByRole('button', { name: /^Use suggestion: / }).map((b) => b.textContent)).toEqual(['keep going']);
  });

  it('+ is disabled when the list is full', async () => {
    saveQuickReplies(Array.from({ length: 12 }, (_, i) => `r${i}`));
    hub([{ text: 'keep going', count: 3 }]);
    setup();
    const s = await section();
    expect(within(s).getByRole('button', { name: 'Add to quick replies: keep going' })).toBeDisabled();
  });

  it('a failure shows no section', async () => {
    hub('fail');
    setup();
    const list = await openList();
    await new Promise((r) => setTimeout(r, 20));
    expect(within(list).queryByRole('region', { name: 'Suggestions' })).toBeNull();
    expect(within(list).getByRole('button', { name: 'Use: Go ahead' })).toBeInTheDocument();
  });

  it('Portuguese', async () => {
    hub([{ text: 'roda os testes', count: 3 }]);
    setup({ lang: 'pt-BR' });
    await userEvent.click(screen.getByRole('button', { name: 'Respostas rápidas' }));
    const s = await screen.findByRole('region', { name: 'Sugestões' });
    expect(within(s).getByRole('button', { name: 'Adicionar às respostas rápidas: roda os testes' })).toBeInTheDocument();
    expect(within(s).getByRole('button', { name: 'Dispensar: roda os testes' })).toBeInTheDocument();
  });
});

describe('dismissed suggestions storage', () => {
  it('keeps them normalized, without repeats, capped, and survives storage errors', () => {
    dismissSuggestion('Pode seguir!');
    dismissSuggestion('pode   SEGUIR');
    expect(loadDismissed()).toEqual(['pode seguir']);
    for (let i = 0; i < 250; i++) dismissSuggestion(`t${i}`);
    expect(loadDismissed()).toHaveLength(200);
    expect(loadDismissed()).toContain('t249');
    localStorage.setItem('acc.quickReplies.dismissed', '{"x":1}');
    expect(loadDismissed()).toEqual([]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => dismissSuggestion('a')).not.toThrow();
    expect(loadDismissed()).toContain('a');
  });
});
