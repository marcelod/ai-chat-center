import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent, SessionView } from '@shared/types';
import { LangProvider } from '../i18n';
import { ChatView } from './ChatView';
import type { PanelApi } from './SidePanel';

// Spec 2026-11-26-side-panel.

const session = (over: Partial<SessionView> = {}): SessionView => ({
  sessionId: 's1',
  name: 'proj',
  cwd: '/home/me/proj',
  state: 'idle',
  pendingAppMessageIds: [],
  ...over,
});
const ts = new Date(2026, 0, 5, 10, 0).toISOString();

const files: Record<string, string> = {
  'docs/spec.md': '# The spec\n\n<b>raw html</b>\n\n![remote](https://e.com/x.png) see [other](other.md) and `docs/spec.md`',
  'docs/other.md': '# Other file',
};

function api(over: Partial<PanelApi> = {}): PanelApi & { file: ReturnType<typeof vi.fn>; filesExist: ReturnType<typeof vi.fn> } {
  return {
    file: vi.fn(async (p: string) => {
      if (p in files) return new Blob([files[p]], { type: 'text/markdown' });
      if (p.endsWith('.png')) return new Blob(['png'], { type: 'image/png' });
      throw Object.assign(new Error('404'), { status: 404 });
    }),
    filesExist: vi.fn(async (paths: string[]) => paths.filter((p) => p in files || p.endsWith('shot.png') || p === 'gone.md')),
    ...over,
  } as never;
}

function setup(events: ChatEvent[], panel = api(), s = session()) {
  const r = render(
    <LangProvider lang="en">
      <ChatView session={s} events={events} pending={[]} loading={false} onSend={async () => {}} onBack={() => {}} panel={panel} />
    </LangProvider>,
  );
  return { ...r, panel };
}

const say = (text: string): ChatEvent => ({ kind: 'assistant', id: 'a1', ts, text });

beforeEach(() => {
  let n = 0;
  Object.assign(URL, { createObjectURL: vi.fn(() => `blob:x/${++n}`), revokeObjectURL: vi.fn() });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('side panel: files cited in the conversation', () => {
  it('only paths the hub says exist become links, asked once', async () => {
    const { panel } = setup([say('Read docs/spec.md and missing.md')]);
    const link = await screen.findByRole('button', { name: 'docs/spec.md' });
    expect(link).toHaveAttribute('title', 'docs/spec.md');
    expect(screen.queryByRole('button', { name: 'missing.md' })).toBeNull();
    expect(panel.filesExist).toHaveBeenCalledTimes(1);
    expect(panel.filesExist).toHaveBeenCalledWith(['docs/spec.md', 'missing.md']);
  });

  it('opens a Markdown file formatted, without raw HTML or remote images, and closes with X', async () => {
    setup([say('See `docs/spec.md`')]);
    await userEvent.click(await screen.findByRole('button', { name: 'docs/spec.md' }));
    const panel = await screen.findByTestId('side-panel');
    const md = await within(panel).findByTestId('panel-markdown');
    expect(within(md).getByRole('heading', { name: 'The spec' })).toBeTruthy();
    expect(md.querySelector('b')).toBeNull();
    expect(md.querySelector('img')).toBeNull();
    expect(md.textContent).toContain('🖼 remote');
    expect(within(panel).getByRole('heading', { level: 2 })).toHaveTextContent('spec.md');
    await userEvent.click(within(panel).getByRole('button', { name: 'Close panel' }));
    expect(screen.queryByTestId('side-panel')).toBeNull();
  });

  it('a relative link inside the file opens that file in the panel; back returns', async () => {
    setup([say('docs/spec.md')]);
    await userEvent.click(await screen.findByRole('button', { name: 'docs/spec.md' }));
    const panel = await screen.findByTestId('side-panel');
    await userEvent.click(await within(panel).findByRole('button', { name: 'other' }));
    expect(await within(panel).findByRole('heading', { name: 'Other file' })).toBeTruthy();
    await userEvent.click(within(panel).getByRole('button', { name: 'Back' }));
    expect(await within(panel).findByRole('heading', { name: 'The spec' })).toBeTruthy();
  });

  it('Esc closes the panel', async () => {
    setup([say('docs/spec.md')]);
    await userEvent.click(await screen.findByRole('button', { name: 'docs/spec.md' }));
    await screen.findByTestId('side-panel');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('side-panel')).toBeNull();
  });

  it('a file gone since says so in the panel', async () => {
    setup([say('gone.md')]);
    await userEvent.click(await screen.findByRole('button', { name: 'gone.md' }));
    expect(await screen.findByText('File not found.')).toBeTruthy();
  });

  it('an image attachment opens large in the panel from a blob URL', async () => {
    const att = '/home/me/.ai-chat-center/attachments/s1/0123456789abcdef-shot.png';
    setup([{ kind: 'user', id: 'u1', ts, text: 'look', origin: 'app', attachments: ['shot.png'], attachmentPaths: [att] }]);
    await userEvent.click(await screen.findByRole('button', { name: 'Open shot.png' }));
    const img = await within(screen.getByTestId('side-panel')).findByRole('img', { name: '0123456789abcdef-shot.png' });
    expect(img.getAttribute('src')).toMatch(/^blob:/);
  });

  it('without a panel API nothing becomes a link', () => {
    render(
      <LangProvider lang="en">
        <ChatView session={session()} events={[say('docs/spec.md')]} pending={[]} loading={false} onSend={async () => {}} onBack={() => {}} />
      </LangProvider>,
    );
    expect(screen.queryByRole('button', { name: 'docs/spec.md' })).toBeNull();
  });

  it('a new session closes the panel', async () => {
    const { rerender, panel } = setup([say('docs/spec.md')]);
    await userEvent.click(await screen.findByRole('button', { name: 'docs/spec.md' }));
    await screen.findByTestId('side-panel');
    rerender(
      <LangProvider lang="en">
        <ChatView session={session({ sessionId: 's2' })} events={[]} pending={[]} loading={false} onSend={async () => {}} onBack={() => {}} panel={panel} />
      </LangProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId('side-panel')).toBeNull());
  });
});
