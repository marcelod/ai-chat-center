import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent, SessionView, ToolDiff } from '@shared/types';
import { LangProvider } from '../i18n';
import { saveShowDiffs } from '../prefs';
import { ChatView } from './ChatView';
import type { PanelApi } from './SidePanel';

// Spec 2026-11-27-side-panel-file-types: code with the cited line, PDFs and diffs in the side panel.

const session = (over: Partial<SessionView> = {}): SessionView => ({
  sessionId: 's1',
  name: 'proj',
  cwd: '/home/me/proj',
  state: 'idle',
  pendingAppMessageIds: [],
  ...over,
});
const ts = new Date(2026, 0, 5, 10, 0).toISOString();

const code = Array.from({ length: 60 }, (_, i) => (i === 41 ? 'const answer = 42; // the line' : `let x${i} = "v";`)).join('\n') + '\n';
const files: Record<string, BlobPart> = {
  'src/hub/server.ts': code,
  'docs/spec.md': '# Spec\nsecond line\n',
  'docs/a.pdf': '%PDF-1.7\n%%EOF\n',
  'docs/fake.pdf': '<html><script>alert(1)</script>',
};

function api(): PanelApi & { file: ReturnType<typeof vi.fn> } {
  return {
    // The type the hub sent is not trusted: a PDF blob is made again with a fixed type.
    file: vi.fn(async (p: string) => {
      if (p in files) return new Blob([files[p]], { type: 'text/html' });
      throw Object.assign(new Error('404'), { status: 404 });
    }),
    filesExist: vi.fn(async (paths: string[]) => paths.filter((p) => p in files)),
  } as never;
}

function setup(events: ChatEvent[]) {
  return render(
    <LangProvider lang="en">
      <ChatView session={session()} events={events} pending={[]} loading={false} onSend={async () => {}} onBack={() => {}} panel={api()} />
    </LangProvider>,
  );
}
const say = (text: string): ChatEvent => ({ kind: 'assistant', id: 'a1', ts, text });

let scrolled: Element[];
let made: Blob[];
beforeEach(() => {
  scrolled = [];
  made = [];
  let n = 0;
  Object.assign(URL, {
    createObjectURL: vi.fn((b: Blob) => {
      made.push(b);
      return `blob:x/${++n}`;
    }),
    revokeObjectURL: vi.fn(),
  });
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  saveShowDiffs(false);
  localStorage.clear();
});

describe('side panel: code files', () => {
  it('a cited path with a line opens the file with line numbers, scrolled to that line and marked', async () => {
    setup([say('The bug is at src/hub/server.ts:42.')]);
    await userEvent.click(await screen.findByRole('button', { name: 'src/hub/server.ts:42' }));
    const panel = await screen.findByTestId('side-panel');
    const view = await within(panel).findByTestId('panel-code');
    expect(view).toHaveAttribute('aria-label', 'Code of server.ts');
    const rows = view.querySelectorAll('[data-line]');
    expect(rows).toHaveLength(60);
    const current = view.querySelector('[aria-current="true"]') as HTMLElement;
    expect(current.getAttribute('data-line')).toBe('42');
    expect(current.textContent).toContain('const answer = 42;');
    expect(scrolled).toContain(current);
    // Highlighted: a keyword, a number and a comment.
    expect(current.querySelector('.tok-k')?.textContent).toBe('const');
    expect(current.querySelector('.tok-n')?.textContent).toBe('42');
    expect(current.querySelector('.tok-c')?.textContent).toBe('// the line');
    expect(within(panel).getByRole('heading', { level: 2 })).toHaveTextContent('server.ts');
  });

  it('without a line it opens at the top, nothing marked', async () => {
    setup([say('see `src/hub/server.ts`')]);
    await userEvent.click(await screen.findByRole('button', { name: 'src/hub/server.ts' }));
    const view = await screen.findByTestId('panel-code');
    expect(view.querySelector('[aria-current]')).toBeNull();
  });

  it('a Markdown file cited with a line opens as its source, at that line', async () => {
    setup([say('docs/spec.md:2')]);
    await userEvent.click(await screen.findByRole('button', { name: 'docs/spec.md:2' }));
    const view = await screen.findByTestId('panel-code');
    expect(view.querySelector('[aria-current="true"]')?.textContent).toContain('second line');
    expect(screen.queryByTestId('panel-markdown')).toBeNull();
  });
});

describe('side panel: PDF', () => {
  it('shows the PDF from a blob URL made with a fixed PDF type, with a download link', async () => {
    setup([say('Report in docs/a.pdf')]);
    await userEvent.click(await screen.findByRole('button', { name: 'docs/a.pdf' }));
    const panel = await screen.findByTestId('side-panel');
    const frame = (await within(panel).findByTitle('a.pdf')) as HTMLIFrameElement;
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('src')).toMatch(/^blob:/);
    expect(made.at(-1)?.type).toBe('application/pdf');
    expect(within(panel).getByRole('link', { name: 'Download' })).toHaveAttribute('download', 'a.pdf');
    expect(within(panel).getByRole('link', { name: 'Open in a new tab' })).toHaveAttribute('href', frame.getAttribute('src'));
  });

  it('refuses bytes that are not a PDF', async () => {
    setup([say('docs/fake.pdf')]);
    await userEvent.click(await screen.findByRole('button', { name: 'docs/fake.pdf' }));
    expect(await screen.findByText("This file can't be shown here.")).toBeTruthy();
    expect(screen.queryByTitle('fake.pdf')).toBeNull();
  });
});

describe('side panel: diffs', () => {
  const diff: ToolDiff = {
    lines: [
      { op: ' ', text: 'a' },
      { op: '-', text: 'b' },
      { op: '+', text: 'B' },
    ],
    added: 1,
    removed: 1,
  };
  const actions: ChatEvent = { kind: 'actions', id: 'x1', ts, items: [{ toolUseId: 't', name: 'Edit', summary: '/home/me/proj/src/f.ts', result: 'ok', diff }] };

  it('an edit diff opens in the panel, whole', async () => {
    saveShowDiffs(true);
    setup([actions]);
    await userEvent.click(screen.getByRole('button', { name: /Edit/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Open in the panel' }));
    const panel = await screen.findByTestId('side-panel');
    expect(within(panel).getByRole('heading', { level: 2 })).toHaveTextContent('Changes · f.ts');
    expect(panel.querySelector('[data-diff-line="-"]')?.textContent).toContain('b');
    expect(panel.querySelector('[data-diff-line="+"]')?.textContent).toContain('B');
  });

  it('no panel button when diffs are off', async () => {
    setup([actions]);
    await userEvent.click(screen.getByRole('button', { name: /Edit/ }));
    expect(screen.queryByRole('button', { name: 'Open in the panel' })).toBeNull();
  });
});
