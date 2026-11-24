import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionView } from '@shared/types';
import type { BackgroundPreset } from '@shared/background';
import { LangProvider } from '../i18n';
import { ChatView } from './ChatView';
import { ApiError } from '../api';

const session = (over: Partial<SessionView> = {}): SessionView => ({
  sessionId: 's1',
  name: 'billing-api',
  cwd: '/home/me/billing-api',
  state: 'idle',
  pendingAppMessageIds: [],
  ...over,
});

type Opts = {
  session?: SessionView;
  lang?: 'en' | 'pt-BR';
  onSetBackground?: (bg: BackgroundPreset | null) => Promise<void>;
  onUploadBackground?: (file: File) => Promise<void>;
  onLoadBackgroundImage?: () => Promise<Blob>;
};

function setup(o: Opts = {}) {
  const onSetBackground = o.onSetBackground ?? vi.fn(async () => {});
  const onUploadBackground = o.onUploadBackground ?? vi.fn(async () => {});
  const ui = (p: Opts) => (
    <LangProvider lang={p.lang ?? 'en'}>
      <ChatView
        session={p.session ?? session()}
        events={[]}
        pending={[]}
        loading={false}
        onSend={vi.fn(async () => {})}
        onSetBackground={onSetBackground}
        onUploadBackground={onUploadBackground}
        onLoadBackgroundImage={p.onLoadBackgroundImage}
        onBack={() => {}}
      />
    </LangProvider>
  );
  const r = render(ui(o));
  return { ...r, onSetBackground, onUploadBackground, rerender: (p: Opts) => r.rerender(ui({ ...o, ...p })) };
}

const menuButton = () => screen.getByRole('button', { name: 'Conversation actions' });
async function openPicker() {
  await userEvent.click(menuButton());
  await userEvent.click(screen.getByRole('menuitem', { name: 'Background' }));
  return screen.getByRole('dialog', { name: 'Conversation background' });
}

describe('conversation background', () => {
  it('the ⋮ menu has a Background item only when the background can be changed', async () => {
    render(
      <LangProvider lang="en">
        <ChatView session={session()} events={[]} pending={[]} loading={false} onSend={vi.fn(async () => {})} onRename={vi.fn(async () => {})} onBack={() => {}} />
      </LangProvider>,
    );
    await userEvent.click(menuButton());
    expect(screen.queryByRole('menuitem', { name: 'Background' })).not.toBeInTheDocument();
  });

  it('opens a dialog with 8 colours, 6 gradients, Image… and No background; focus goes in', async () => {
    setup();
    const dialog = await openPicker();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(within(dialog).getByRole('group', { name: 'Colors' })).getAllByRole('button')).toHaveLength(8);
    expect(within(within(dialog).getByRole('group', { name: 'Gradients' })).getAllByRole('button')).toHaveLength(6);
    expect(within(dialog).getByRole('button', { name: 'Image…' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'No background' })).toBeInTheDocument();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Escape closes the dialog and returns focus to the ⋮ button', async () => {
    setup();
    await openPicker();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(menuButton()).toHaveFocus();
  });

  it('the close button closes it too, with focus back on the ⋮ button', async () => {
    setup();
    const dialog = await openPicker();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(menuButton()).toHaveFocus();
  });

  it('Tab stays inside the dialog', async () => {
    setup();
    const dialog = await openPicker();
    for (let i = 0; i < 25; i++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await userEvent.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('a colour, a gradient or none sends the preset id and closes', async () => {
    const { onSetBackground } = setup();
    let dialog = await openPicker();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sky' }));
    expect(onSetBackground).toHaveBeenLastCalledWith({ kind: 'color', value: 'sky' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(menuButton()).toHaveFocus();
    dialog = await openPicker();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ocean' }));
    expect(onSetBackground).toHaveBeenLastCalledWith({ kind: 'gradient', value: 'ocean' });
    dialog = await openPicker();
    await userEvent.click(within(dialog).getByRole('button', { name: 'No background' }));
    expect(onSetBackground).toHaveBeenLastCalledWith(null);
  });

  it('marks the current choice as pressed', async () => {
    setup({ session: session({ background: { kind: 'gradient', value: 'dusk' } }) });
    const dialog = await openPicker();
    expect(within(dialog).getByRole('button', { name: 'Dusk' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByRole('button', { name: 'Rose' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('a refused change keeps the dialog open with an error', async () => {
    setup({ onSetBackground: vi.fn(async () => Promise.reject(new ApiError(500))) });
    const dialog = await openPicker();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mint' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("Couldn't change the background");
  });

  describe('image', () => {
    const fileInput = (dialog: HTMLElement) => dialog.querySelector('input[type="file"]') as HTMLInputElement;

    it('the file input takes png, jpeg, webp and gif; Image… opens it', async () => {
      setup();
      const dialog = await openPicker();
      const input = fileInput(dialog);
      expect(input.accept).toBe('image/png,image/jpeg,image/webp,image/gif');
      const click = vi.spyOn(input, 'click');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Image…' }));
      expect(click).toHaveBeenCalled();
    });

    it('uploads a chosen image and closes', async () => {
      const { onUploadBackground } = setup();
      const dialog = await openPicker();
      const file = new File([new Uint8Array([1])], 'cat.png', { type: 'image/png' });
      await userEvent.upload(fileInput(dialog), file);
      expect(onUploadBackground).toHaveBeenCalledWith(file);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('refuses over 5 MB and other types without uploading', async () => {
      const { onUploadBackground } = setup();
      const dialog = await openPicker();
      const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
      fireEvent.change(fileInput(dialog), { target: { files: [big] } });
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('larger than 5 MB');
      const svg = new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' });
      fireEvent.change(fileInput(dialog), { target: { files: [svg] } });
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('PNG, JPEG, WebP or GIF');
      expect(onUploadBackground).not.toHaveBeenCalled();
    });

    it('says why the hub refused the image (413, 415)', async () => {
      const up = vi.fn<(f: File) => Promise<void>>(async () => Promise.reject(new ApiError(413)));
      setup({ onUploadBackground: up });
      const dialog = await openPicker();
      const file = new File([new Uint8Array([1])], 'cat.png', { type: 'image/png' });
      await userEvent.upload(fileInput(dialog), file);
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('larger than 5 MB');
      up.mockImplementation(async () => Promise.reject(new ApiError(415)));
      await userEvent.upload(fileInput(dialog), new File([new Uint8Array([2])], 'b.png', { type: 'image/png' }));
      await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('PNG, JPEG, WebP or GIF'));
    });
  });

  it('pt-BR strings', async () => {
    setup({ lang: 'pt-BR' });
    await userEvent.click(screen.getByRole('button', { name: 'Ações da conversa' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fundo' }));
    const dialog = screen.getByRole('dialog', { name: 'Fundo da conversa' });
    expect(within(dialog).getByRole('button', { name: 'Imagem…' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Sem fundo' })).toBeInTheDocument();
  });

  describe('behind the messages', () => {
    let urls: string[];
    beforeEach(() => {
      urls = [];
      let n = 0;
      vi.stubGlobal('URL', Object.assign(URL, {
        createObjectURL: vi.fn(() => `blob:x/${++n}`),
        revokeObjectURL: vi.fn((u: string) => urls.push(u)),
      }));
    });
    afterEach(() => vi.unstubAllGlobals());

    it('nothing without a background', () => {
      setup();
      expect(screen.queryByTestId('chat-background')).not.toBeInTheDocument();
    });

    it('a colour or a gradient sits behind the log under a veil of the page colour', () => {
      const { rerender } = setup({ session: session({ background: { kind: 'color', value: 'rose' } }) });
      const bg = screen.getByTestId('chat-background');
      expect(bg).toHaveAttribute('aria-hidden', 'true');
      expect(bg).toHaveAttribute('data-background', 'color:rose');
      expect(bg.style.backgroundColor).not.toBe('');
      expect(within(bg).getByTestId('chat-background-veil')).toBeInTheDocument();
      rerender({ session: session({ background: { kind: 'gradient', value: 'ocean' } }) });
      expect(screen.getByTestId('chat-background')).toHaveAttribute('data-background', 'gradient:ocean');
    });

    it('an image is fetched through the callback and shown from a blob: URL; a new file refetches and revokes the old URL', async () => {
      const load = vi.fn(async () => new Blob([new Uint8Array([1])], { type: 'image/png' }));
      const { rerender, unmount } = setup({ session: session({ background: { kind: 'image', file: 's1-a.png' } }), onLoadBackgroundImage: load });
      await waitFor(() => expect(screen.getByTestId('chat-background').style.backgroundImage).toContain('blob:x/1'));
      rerender({ session: session({ background: { kind: 'image', file: 's1-b.png' } }), onLoadBackgroundImage: load });
      await waitFor(() => expect(screen.getByTestId('chat-background').style.backgroundImage).toContain('blob:x/2'));
      expect(load).toHaveBeenCalledTimes(2);
      expect(urls).toContain('blob:x/1');
      act(() => unmount());
      expect(urls).toContain('blob:x/2');
    });
  });
});
