import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('a send that fails after switching chat keeps the text as that chat\'s draft', async () => {
    sessionStorage.clear();
    const user = userEvent.setup();
    let fail!: (e: Error) => void;
    const onSend = () => new Promise<void>((_, reject) => (fail = reject));
    const { rerender } = render(mount('fa', onSend));
    await user.type(box(), 'lost?{Enter}');
    rerender(mount('fb'));
    await act(async () => fail(new Error('500')));
    rerender(mount('fa'));
    expect(box().value).toBe('lost?');
  });

  it('a failed send keeps the text when the chat is switched while the retry banner shows', async () => {
    sessionStorage.clear();
    const user = userEvent.setup();
    const { rerender } = render(mount('fc', () => Promise.reject(new Error('500'))));
    await user.type(box(), 'retry me{Enter}');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(box().value).toBe('');
    rerender(mount('fd'));
    rerender(mount('fc'));
    expect(box().value).toBe('retry me');
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

describe('Composer attachments', () => {
  const MB = 1024 * 1024;
  const file = (name: string, type = 'text/plain', size?: number) => {
    const f = new File(['data'], name, { type });
    if (size !== undefined) Object.defineProperty(f, 'size', { value: size });
    return f;
  };
  type Upload = (f: File) => Promise<string>;
  function mountA(
    o: { onSend?: (t: string) => Promise<void>; onUpload?: Upload | null; lang?: 'en' | 'pt-BR'; id?: string } = {},
  ) {
    const onSend = vi.fn(o.onSend ?? (async () => {}));
    const onUpload = o.onUpload === null ? undefined : vi.fn(o.onUpload ?? (async (f: File) => `/h/att/s/0123456789abcdef-${f.name}`));
    const r = render(
      <LangProvider lang={o.lang ?? 'en'}>
        <Composer sessionId={o.id ?? 'att'} name="x" disabled={false} onSend={onSend} onUpload={onUpload} />
      </LangProvider>,
    );
    const input = r.container.querySelector('input[type="file"]') as HTMLInputElement | null;
    return { ...r, onSend, onUpload, input };
  }
  const chips = () => screen.queryAllByRole('listitem');
  const created: string[] = [];
  const revoked: string[] = [];
  beforeEach(() => {
    sessionStorage.clear();
    created.length = 0;
    revoked.length = 0;
    let n = 0;
    // jsdom has no object URLs.
    Object.assign(URL, {
      createObjectURL: () => {
        const u = `blob:test/${++n}`;
        created.push(u);
        return u;
      },
      revokeObjectURL: (u: string) => void revoked.push(u),
    });
  });
  afterEach(() => {
    const u = URL as unknown as Record<string, unknown>;
    delete u.createObjectURL;
    delete u.revokeObjectURL;
  });

  it('the attach button picks files: chips with name and size, an image thumbnail, each removable', async () => {
    const user = userEvent.setup();
    const { input } = mountA();
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeInTheDocument();
    await user.upload(input!, [file('shot.png', 'image/png', 2 * MB), file('notes.txt', 'text/plain', 1500)]);
    expect(chips()).toHaveLength(2);
    expect(within(chips()[0]).getByText('shot.png')).toBeInTheDocument();
    expect(within(chips()[0]).getByText('2.0 MB')).toBeInTheDocument();
    expect(chips()[0].querySelector('img')?.getAttribute('src')).toBe('blob:test/1');
    expect(within(chips()[1]).getByText('notes.txt')).toBeInTheDocument();
    expect(within(chips()[1]).getByText('1.5 KB')).toBeInTheDocument();
    expect(chips()[1].querySelector('img')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Remove shot.png' }));
    expect(chips()).toHaveLength(1);
    expect(revoked).toEqual(['blob:test/1']);
  });

  it('sending uploads the files first, then sends the text with one [Attachment: path] line per file', async () => {
    const user = userEvent.setup();
    const { input, onSend, onUpload } = mountA();
    await user.upload(input!, [file('a.png', 'image/png'), file('b.txt')]);
    await user.type(box(), 'look{Enter}');
    expect(onUpload).toHaveBeenCalledTimes(2);
    expect(onSend).toHaveBeenCalledWith('look\n[Attachment: /h/att/s/0123456789abcdef-a.png]\n[Attachment: /h/att/s/0123456789abcdef-b.txt]');
    expect(chips()).toHaveLength(0);
    expect(box().value).toBe('');
    expect(revoked).toEqual(['blob:test/1']);
  });

  it('a message may be only attachments', async () => {
    const user = userEvent.setup();
    const { input, onSend } = mountA();
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await user.upload(input!, [file('only.pdf', 'application/pdf')]);
    expect(send).toBeEnabled();
    await user.click(send);
    expect(onSend).toHaveBeenCalledWith('[Attachment: /h/att/s/0123456789abcdef-only.pdf]');
  });

  it('refuses a file over 20 MB and more than 10 files, with clear errors (en and pt-BR)', async () => {
    const user = userEvent.setup();
    const { input, unmount } = mountA();
    await user.upload(input!, [file('huge.mov', 'video/mp4', 20 * MB + 1), file('ok.txt')]);
    expect(screen.getByRole('alert')).toHaveTextContent('huge.mov is larger than 20 MB');
    expect(chips()).toHaveLength(1);
    await user.upload(input!, Array.from({ length: 10 }, (_, i) => file(`f${i}.txt`)));
    expect(screen.getByRole('alert')).toHaveTextContent('At most 10 files per message');
    expect(chips()).toHaveLength(10);
    unmount();
    const pt = mountA({ lang: 'pt-BR', id: 'att-pt' });
    await user.upload(pt.input!, [file('grande.zip', 'application/zip', 21 * MB)]);
    expect(screen.getByRole('alert')).toHaveTextContent('grande.zip tem mais de 20 MB');
  });

  it('Ctrl+V of files from the clipboard attaches them instead of pasting text', () => {
    mountA();
    const f = file('image.png', 'image/png');
    const ev = fireEvent.paste(box(), { clipboardData: { files: [f], types: ['Files'], getData: () => '' } });
    expect(ev).toBe(false); // default prevented
    expect(chips()).toHaveLength(1);
    expect(within(chips()[0]).getByText('image.png')).toBeInTheDocument();
  });

  it('a paste with text and files pastes the text and attaches nothing', () => {
    mountA();
    const ev = fireEvent.paste(box(), {
      clipboardData: { files: [file('cell.png', 'image/png')], types: ['text/plain', 'Files'], getData: (k: string) => (k === 'text/plain' ? 'cell' : '') },
    });
    expect(ev).toBe(true); // left to the browser
    expect(chips()).toHaveLength(0);
  });

  it('a text-only paste is left to the browser', () => {
    mountA();
    const ev = fireEvent.paste(box(), { clipboardData: { files: [], types: ['text/plain'], getData: () => 'hi' } });
    expect(ev).toBe(true);
    expect(chips()).toHaveLength(0);
  });

  it('dropping files on the message box attaches them', () => {
    const { container } = mountA();
    const footer = container.querySelector('footer')!;
    const dt = { files: [file('dropped.txt')], types: ['Files'] };
    fireEvent.dragOver(footer, { dataTransfer: dt });
    fireEvent.drop(footer, { dataTransfer: dt });
    expect(chips()).toHaveLength(1);
    expect(within(chips()[0]).getByText('dropped.txt')).toBeInTheDocument();
  });

  it('a failed upload keeps the text and the files and says so; nothing is sent', async () => {
    const user = userEvent.setup();
    const { input, onSend } = mountA({ onUpload: async () => Promise.reject(new Error('500')) });
    await user.upload(input!, [file('a.txt')]);
    await user.type(box(), 'hey{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not upload the attachments');
    expect(onSend).not.toHaveBeenCalled();
    expect(box().value).toBe('hey');
    expect(chips()).toHaveLength(1);
  });

  it('retrying after a partial upload failure does not upload again the files already stored', async () => {
    const user = userEvent.setup();
    let failB = true;
    const { input, onSend, onUpload } = mountA({
      id: 'retry',
      onUpload: async (f) => {
        if (f.name === 'b.txt' && failB) {
          failB = false;
          throw new Error('500');
        }
        return `/h/${f.name}`;
      },
    });
    await user.upload(input!, [file('a.txt'), file('b.txt')]);
    await user.type(box(), 'hey{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not upload the attachments');
    expect(onSend).not.toHaveBeenCalled();
    box().focus();
    await user.keyboard('{Enter}');
    expect(onUpload.mock.calls.map(([f]) => f.name)).toEqual(['a.txt', 'b.txt', 'b.txt']);
    expect(onSend).toHaveBeenCalledWith('hey\n[Attachment: /h/a.txt]\n[Attachment: /h/b.txt]');
  });

  it('an upload refused as disconnected (409) shows the disconnected error', async () => {
    const user = userEvent.setup();
    const { input } = mountA({ onUpload: async () => Promise.reject(Object.assign(new Error('409'), { status: 409, code: 'session-disconnected' })) });
    await user.upload(input!, [file('a.txt')]);
    await user.type(box(), '{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('This session is disconnected');
    expect(chips()).toHaveLength(1);
  });

  it('the text draft still works while files are attached', async () => {
    const user = userEvent.setup();
    const { input } = mountA({ id: 'dr' });
    await user.upload(input!, [file('a.txt')]);
    await user.type(box(), 'draft');
    expect(sessionStorage.getItem('acc.draft.dr')).toBe('draft');
  });

  it('without an upload handler there is no attach button and a paste of files is ignored', () => {
    const { input } = mountA({ onUpload: null });
    expect(screen.queryByRole('button', { name: 'Attach files' })).toBeNull();
    expect(input).toBeNull();
    fireEvent.paste(box(), { clipboardData: { files: [file('a.png', 'image/png')], types: ['Files'], getData: () => '' } });
    expect(chips()).toHaveLength(0);
  });
});
