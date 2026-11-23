import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LangProvider } from '../i18n';
import { Composer } from './Composer';

let scroll = 46;
const spy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => scroll);
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
    void spy;
    setup();
    const user = userEvent.setup();
    scroll = 120;
    await user.type(box(), 'a');
    expect(box().style.height).toBe('120px');
    scroll = 900;
    await user.type(box(), 'b');
    expect(box().style.height).toBe('200px'); // 8 x 22px line + 2 x 12px padding
    expect(box().style.overflowY).toBe('auto');
    scroll = 46;
    await user.type(box(), '{Enter}');
    expect(box().value).toBe('');
    expect(box().style.height).toBe('46px');
  });
});
