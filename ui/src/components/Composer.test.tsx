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
      <Composer name="x" disabled={false} onSend={async () => {}} />
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
