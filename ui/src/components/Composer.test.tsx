import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LangProvider } from '../i18n';
import { Composer, LINE_PX, MAX_HEIGHT, MAX_LINES, PAD_PX } from './Composer';

let scroll = 46;
vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => scroll);
// 1px border on each side: offsetHeight - clientHeight = 2
vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => 48);
vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => 46);
afterEach(() => {
  scroll = 46;
});

const box = () => screen.getByRole('textbox') as HTMLTextAreaElement;
function setup() {
  render(
    <LangProvider lang="en">
      <Composer sessionId="s" name="x" disabled={false} onSend={async () => {}} />
    </LangProvider>,
  );
}

describe('Composer growth', () => {
  it('grows with content, caps at 8 lines, and shrinks back after sending', async () => {
    setup();
    const user = userEvent.setup();
    expect(MAX_HEIGHT).toBe(MAX_LINES * LINE_PX + 2 * PAD_PX);
    scroll = 120;
    await user.type(box(), 'a');
    expect(box().style.height).toBe('122px'); // + border
    expect(box().style.overflowY).toBe('hidden');
    scroll = 900;
    await user.type(box(), 'b');
    expect(box().style.height).toBe(`${MAX_HEIGHT + 2}px`);
    expect(box().style.overflowY).toBe('auto');
    scroll = 46;
    await user.type(box(), '{Enter}');
    expect(box().value).toBe('');
    expect(box().style.height).toBe('48px');
    expect(box().style.overflowY).toBe('hidden');
  });

  it('recalculates the height when the textarea width changes', async () => {
    let cb: (() => void) | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(c: () => void) {
          cb = c;
        }
        observe() {}
        disconnect() {}
      },
    );
    try {
      setup();
      await userEvent.setup().type(box(), 'a');
      expect(box().style.height).toBe('48px');
      scroll = 120; // narrower textarea: the same text now wraps
      act(() => cb?.());
      expect(box().style.height).toBe('122px');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the send button as tall as a one-line textarea', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Send' })).toHaveClass('h-12');
  });
});

describe('Composer drafts', () => {
  const mount = (id: string, onSend: (t: string) => Promise<void> = async () => {}) => (
    <LangProvider lang="en">
      <Composer key={id} sessionId={id} name="x" disabled={false} onSend={onSend} />
    </LangProvider>
  );

  it('keeps the draft per session across switching and reload', async () => {
    sessionStorage.clear();
    const user = userEvent.setup();
    const { rerender, unmount } = render(mount('a'));
    await user.type(box(), 'hello a');
    rerender(mount('b'));
    expect(box().value).toBe('');
    await user.type(box(), 'hello b');
    rerender(mount('a'));
    expect(box().value).toBe('hello a');
    expect(sessionStorage.getItem('acc.draft.a')).toBe('hello a');
    unmount();
    render(mount('b'));
    expect(box().value).toBe('hello b');
  });

  it('clears the draft on send and removes the key when emptied', async () => {
    sessionStorage.clear();
    const user = userEvent.setup();
    render(mount('a'));
    await user.type(box(), 'x{Enter}');
    expect(box().value).toBe('');
    expect(sessionStorage.getItem('acc.draft.a')).toBeNull();
  });

  it('keeps the text when the send is rejected as disconnected (409)', async () => {
    sessionStorage.clear();
    const user = userEvent.setup();
    render(mount('a', () => Promise.reject(Object.assign(new Error('409'), { status: 409 }))));
    await user.type(box(), 'keep{Enter}');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(box().value).toBe('keep');
    expect(sessionStorage.getItem('acc.draft.a')).toBe('keep');
  });

  it('works in memory when sessionStorage throws', async () => {
    const spy = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      const user = userEvent.setup();
      const { rerender } = render(mount('m1'));
      await user.type(box(), 'mem');
      rerender(mount('m2'));
      rerender(mount('m1'));
      expect(box().value).toBe('mem');
    } finally {
      spy.mockRestore();
    }
  });
});
