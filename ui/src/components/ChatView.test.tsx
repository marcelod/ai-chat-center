import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ChatEvent, SessionView } from '@shared/types';
import { LangProvider } from '../i18n';
import { ChatView } from './ChatView';
import type { PendingMessage } from '../useLiveSessions';

const session = (over: Partial<SessionView> = {}): SessionView => ({
  sessionId: 's1',
  name: 'billing-api',
  cwd: '/home/me/billing-api',
  state: 'idle',
  pendingAppMessageIds: [],
  ...over,
});

const ts = (n: number) => new Date(2026, 0, 5, 10, n).toISOString();

const events: ChatEvent[] = [
  { kind: 'notice', id: 'n1', ts: ts(0), code: 'connected' },
  { kind: 'user', id: 'u1', ts: ts(1), text: 'from the keyboard', origin: 'terminal' },
  { kind: 'user', id: 'u2', ts: ts(2), text: 'from the phone', origin: 'app', appMessageId: 'a2' },
  { kind: 'assistant', id: 'c1', ts: ts(3), text: 'Here is **bold** and `inline` text' },
  {
    kind: 'actions',
    id: 'x1',
    ts: ts(4),
    items: [
      { toolUseId: 't1', name: 'Read', summary: 'src/a.ts', result: 'ok' },
      { toolUseId: 't2', name: 'Bash', summary: 'npm test', result: 'boom', isError: true },
      { toolUseId: 't3', name: 'Read', summary: 'src/b.ts' },
    ],
  },
];

function setup(
  props: Partial<{
    session: SessionView;
    events: ChatEvent[];
    pending: PendingMessage[];
    onSend: (text: string) => Promise<void>;
    onRename: (name: string) => Promise<{ name: string } | void>;
    onRemove: () => Promise<void>;
    onPin: (pinned: boolean) => Promise<void>;
    onDisconnect: () => Promise<void>;
  }> = {},
) {
  const onSend = props.onSend ?? vi.fn(async () => {});
  const ui = (p: typeof props) => (
    <LangProvider lang="en">
      <ChatView
        session={p.session ?? session()}
        events={p.events ?? events}
        pending={p.pending ?? []}
        loading={false}
        onSend={onSend}
        onRename={p.onRename}
        onRemove={p.onRemove}
        onPin={p.onPin}
        onDisconnect={p.onDisconnect}
        onBack={() => {}}
      />
    </LangProvider>
  );
  const r = render(ui(props));
  return { ...r, onSend, rerenderWith: (p: typeof props) => r.rerender(ui(p)) };
}

describe('ChatView', () => {
  it("an agent's message is on Claude's side, labelled with the agent, collapsed to its first line until expanded", async () => {
    const text = '## Os **dois** ajustes\n\nDetalhe que só aparece aberto';
    const { container } = setup({ events: [{ kind: 'agent', id: 'g1', ts: ts(1), from: 'dev-c2-frontend', text }] });
    const b = container.querySelector('[data-bubble="agent"]') as HTMLElement;
    expect(b).not.toBeNull();
    expect(within(b).getByText('Agent dev-c2-frontend')).toBeTruthy();
    expect(container.querySelector('[data-bubble="user"]')).toBeNull();
    expect(within(b).getByText('DC', { selector: '[data-avatar]' })).toBeTruthy();
    expect(within(b).getByTestId('agent-preview')).toHaveTextContent('Os dois ajustes');
    expect(b.textContent).not.toContain('Detalhe que só aparece aberto');
    await userEvent.click(within(b).getByRole('button', { name: 'Show all' }));
    expect(within(b).getByText('dois').tagName).toBe('STRONG');
    expect(b.textContent).toContain('Detalhe que só aparece aberto');
    expect(within(b).getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe('true');
  });
  it("Claude's message to an agent shows who it is for, collapsed to its first line with a toggle", async () => {
    const long = 'Fix the casing.\n' + 'More detail. '.repeat(40);
    const { container } = setup({ events: [{ kind: 'toAgent', id: 'm1', ts: ts(1), to: 'dev-c2-frontend', text: long }] });
    const b = container.querySelector('[data-bubble="toAgent"]') as HTMLElement;
    expect(within(b).getByText('dev-c2-frontend')).toBeTruthy();
    expect(b.className).toMatch(/\bbg-surface\b/); // a filled bubble, readable over a conversation background
    expect(within(b).getByTestId('agent-preview')).toHaveTextContent('Fix the casing.');
    expect(b.textContent).not.toContain('More detail.');
    await userEvent.click(within(b).getByRole('button', { name: 'Show all' }));
    expect(b.textContent).toContain('More detail. More detail.');
    expect(within(b).getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe('true');
  });
  it('a blocked call to an agent stays, dimmed, marked "not run" with its reason', () => {
    const { container } = setup({
      events: [
        { kind: 'toAgent', id: 'm1', ts: ts(1), to: 'Teste B', text: 'Do B', blocked: true, blockedReason: 'Permission for this tool use was denied.' },
        { kind: 'toAgent', id: 'm2', ts: ts(2), to: 'Teste C', text: 'Do C' },
      ],
    });
    const [b, ok] = [...container.querySelectorAll('[data-bubble="toAgent"]')] as HTMLElement[];
    expect(within(b).getByText('Teste B')).toBeTruthy();
    expect(b.getAttribute('data-blocked')).toBe('true');
    expect(b.querySelector('.opacity-60')).toBeTruthy();
    expect(within(b).getByText('Not run')).toBeTruthy();
    expect(b.textContent).toContain('Permission for this tool use was denied.');
    expect(ok.hasAttribute('data-blocked')).toBe(false);
    expect(ok.textContent).not.toContain('Not run');
  });
  it('a one-line agent message has nothing to expand', () => {
    const { container } = setup({ events: [{ kind: 'agent', id: 'g2', ts: ts(1), from: 'x', text: 'Feito.' }] });
    const b = container.querySelector('[data-bubble="agent"]') as HTMLElement;
    expect(b.textContent).toContain('Feito.');
    expect(within(b).queryByRole('button')).toBeNull();
  });

  it('header shows cwd and branch; model, effort and mode go to the bar under the message field', () => {
    setup({ session: session({ branch: 'feat/x', model: 'Opus 5.5', effort: 'high', mode: 'auto' }) });
    const header = screen.getByTestId('session-info');
    expect(header).toHaveTextContent('/home/me/billing-api');
    expect(screen.getByTitle('Branch')).toHaveTextContent('⎇ feat/x');
    expect(header).not.toHaveTextContent('Opus 5.5');
    expect(header).not.toHaveTextContent('auto mode');
    const bar = screen.getByTestId('session-bar');
    expect(bar).toHaveTextContent('Opus 5.5 · high');
    expect(bar).toHaveTextContent('auto mode');
  });
  it('header info parts have aria-labels, are truncatable and wrap under the cwd on narrow screens', () => {
    setup({ session: session({ branch: 'feat/x' }) });
    expect(screen.getByLabelText('Branch: feat/x')).toHaveClass('truncate', 'min-w-0');
    const box = screen.getByTestId('session-info');
    expect(box).toHaveClass('flex-col', 'md:flex-row', 'overflow-hidden');
  });
  it('header with only the cwd shows no extra parts', () => {
    setup();
    expect(screen.getByText('/home/me/billing-api')).toBeInTheDocument();
    expect(screen.queryByTitle('Branch')).toBeNull();
    expect(screen.queryByTitle('Model')).toBeNull();
    expect(screen.queryByTitle('Reasoning level')).toBeNull();
  });
  it('header shows the permission mode with the glyph Claude Code uses', () => {
    setup({ session: session({ mode: 'auto' }) });
    expect(screen.getByTitle('Permission mode')).toHaveTextContent('⏵⏵ auto mode');
  });
  it('header shows plan mode and the default mode by name, and an unknown mode as it came', () => {
    const { unmount } = setup({ session: session({ mode: 'plan' }) });
    expect(screen.getByLabelText('Permission mode: plan mode')).toHaveTextContent('⏸ plan mode');
    unmount();
    const r = setup({ session: session({ mode: 'default' }) });
    expect(screen.getByTitle('Permission mode')).toHaveTextContent('default');
    r.unmount();
    setup({ session: session({ mode: 'newMode' }) });
    expect(screen.getByTitle('Permission mode')).toHaveTextContent('newMode');
  });
  it('header without a mode shows no mode part', () => {
    setup({ session: session({ model: 'Opus 5.5' }) });
    expect(screen.queryByTitle('Permission mode')).toBeNull();
  });
  it('header without a branch has no branch part; the bar still shows the model', () => {
    setup({ session: session({ model: 'Opus 5.5', effort: 'low' }) });
    expect(screen.queryByTitle('Branch')).toBeNull();
    expect(screen.getByTestId('session-bar')).toHaveTextContent('Opus 5.5 · low');
  });

  it('renders bubbles with origin icons', () => {
    setup();
    const term = screen.getByText('from the keyboard').closest('[data-bubble]') as HTMLElement;
    expect(term).toHaveAttribute('data-bubble', 'user');
    expect(within(term).getByLabelText('Sent from the terminal')).toBeInTheDocument();
    const app = screen.getByText('from the phone').closest('[data-bubble]') as HTMLElement;
    expect(within(app).getByLabelText('Sent from the app')).toBeInTheDocument();
    const claude = screen.getByText('bold').closest('[data-bubble]') as HTMLElement;
    expect(claude).toHaveAttribute('data-bubble', 'assistant');
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByText('inline').tagName).toBe('CODE');
    expect(screen.getByText(/Connected to AI Chat Center · /)).toBeInTheDocument();
  });

  it('markdown links open in a new tab and raw html is not rendered', () => {
    setup({
      events: [{ kind: 'assistant', id: 'c', ts: ts(1), text: '[x](https://example.com) <b>raw</b>' }],
    });
    const a = screen.getByRole('link', { name: 'x' });
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    expect(document.querySelector('b')).toBeNull();
  });

  it('actions group collapsed then expands', async () => {
    const user = userEvent.setup();
    setup();
    const toggle = screen.getByRole('button', { name: /3 actions/ });
    expect(toggle).toHaveTextContent('Read · Bash');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('npm test')).not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('npm test')).toBeInTheDocument();
    expect(screen.getByText('src/a.ts')).toBeInTheDocument();
    expect(screen.getByText('error')).toBeInTheDocument();
    expect(screen.getByText('running…')).toBeInTheDocument();
    expect(screen.getByLabelText('done')).toBeInTheDocument();
    await user.click(toggle);
    expect(screen.queryByText('npm test')).not.toBeInTheDocument();
  });

  it('optimistic message shows queued then reconciles by appMessageId', () => {
    const pending: PendingMessage[] = [{ id: 'a9', text: 'please continue', ts: ts(5) }];
    const { rerenderWith } = setup({ events: [], pending, session: session({ state: 'busy', pendingAppMessageIds: ['a9'] }) });
    expect(screen.getByText('please continue')).toBeInTheDocument();
    expect(screen.getByText('queued — delivered when Claude finishes')).toBeInTheDocument();
    rerenderWith({
      events: [{ kind: 'user', id: 'u9', ts: ts(6), text: 'please continue', origin: 'app', appMessageId: 'a9' }],
      pending,
      session: session({ state: 'busy' }),
    });
    expect(screen.getAllByText('please continue')).toHaveLength(1);
    expect(screen.queryByText(/^queued/)).not.toBeInTheDocument();
  });

  it('composer disabled when disconnected', () => {
    setup({ session: session({ state: 'disconnected' }) });
    const box = screen.getByPlaceholderText('Session disconnected');
    expect(box).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getAllByText(/type \/cc/).length).toBeGreaterThan(0);
  });

  it('enter sends, shift+enter newline', async () => {
    const user = userEvent.setup();
    const { onSend } = setup();
    const box = screen.getByPlaceholderText('Message billing-api…');
    await user.type(box, 'line1{Shift>}{Enter}{/Shift}line2');
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue('line1\nline2');
    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledWith('line1\nline2');
    expect(box).toHaveValue('');
  });

  it('409 shows inline error and restores the text; other errors offer retry', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockRejectedValueOnce(Object.assign(new Error('409'), { status: 409 }));
    setup({ onSend });
    const box = screen.getByPlaceholderText('Message billing-api…');
    await user.type(box, 'hello{Enter}');
    expect(await screen.findByText('This session is disconnected')).toBeInTheDocument();
    expect(box).toHaveValue('hello');

    onSend.mockRejectedValueOnce(new Error('500')).mockResolvedValueOnce(undefined);
    await user.keyboard('{Enter}');
    const retry = await screen.findByRole('button', { name: 'Retry' });
    await user.click(retry);
    expect(onSend).toHaveBeenLastCalledWith('hello');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('waiting state label', () => {
    setup({ session: session({ state: 'waiting', waitingKind: 'permission' }) });
    expect(screen.getAllByText('waiting for you in the terminal').length).toBeGreaterThan(0);
    expect(screen.getByText('Claude is waiting for you to approve an action in the terminal')).toBeInTheDocument();
    expect(screen.getByText('Approving from the app comes in a later version.')).toBeInTheDocument();
  });

  it('waiting for input shows the answer banner without the approval hint', () => {
    setup({ session: session({ state: 'waiting', waitingKind: 'input' }) });
    expect(screen.getByText('Claude is waiting for your answer in the terminal')).toBeInTheDocument();
    expect(screen.queryByText('Claude is waiting for you to approve an action in the terminal')).not.toBeInTheDocument();
    expect(screen.queryByText('Approving from the app comes in a later version.')).not.toBeInTheDocument();
  });

  it('transcript missing says why the app shows nothing and how to fix it', () => {
    setup({ session: session({ state: 'idle', transcriptMissing: true }) });
    expect(screen.getByTestId('transcript-missing').textContent).toContain('Open a new terminal, start claude there');
  });

  // Audit R3-F1 (b): queued messages with no waiter to deliver them: say what resumes delivery.
  it('delivery stalled shows how to resume it, in the user language', () => {
    setup({ session: session({ state: 'idle', deliveryStalled: true, pendingAppMessageIds: ['p1'] }) });
    expect(screen.getByTestId('delivery-stalled').textContent).toContain('send any prompt in the terminal to resume delivery');
  });
  // Audit R4-M2: a message sent through an older version's hub fails the signature check: kept aside, and
  // the app says it was not delivered.
  it('a message kept aside as unsigned is reported as not delivered', () => {
    setup({ session: session({ state: 'idle', undeliveredUnsigned: 1 }) });
    expect(screen.getByTestId('undelivered-unsigned').textContent).toContain('older version of AI Chat Center was not delivered');
  });
  it('no unsigned notice by default', () => {
    setup({ session: session({ state: 'idle' }) });
    expect(screen.queryByTestId('undelivered-unsigned')).not.toBeInTheDocument();
  });
  it('no stall hint by default', () => {
    setup({ session: session({ state: 'idle' }) });
    expect(screen.queryByText(/resume delivery/)).not.toBeInTheDocument();
  });

  it('busy shows working pill and typing indicator', () => {
    setup({ session: session({ state: 'busy' }) });
    expect(screen.getByText('working…')).toBeInTheDocument();
    expect(screen.getByTestId('typing')).toBeInTheDocument();
  });

  // Audit R5-M1: a session still running another version of the plugin: the hub refuses; say how to fix it.
  it('409 for a session of an older or newer version says to restart it, and restores the text', async () => {
    const user = userEvent.setup();
    const onSend = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('409'), { status: 409, code: 'session-older-version' }))
      .mockRejectedValueOnce(Object.assign(new Error('409'), { status: 409, code: 'session-newer-version' }));
    setup({ onSend });
    const box = screen.getByPlaceholderText('Message billing-api…');
    await user.type(box, 'hello{Enter}');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'This session runs an older version of AI Chat Center. Restart it (exit and `claude --resume`) to send messages from the app.',
    );
    expect(screen.queryByText('This session is disconnected')).not.toBeInTheDocument();
    expect(box).toHaveValue('hello');
    await user.keyboard('{Enter}');
    expect((await screen.findByRole('alert')).textContent).toBe('This session runs a newer version of AI Chat Center than this app. Type /cc in that session to update the app, then send again.');
    expect(box).toHaveValue('hello');
  });

  it('409 does not overwrite text typed since', async () => {
    const user = userEvent.setup();
    let reject: (e: unknown) => void = () => {};
    const onSend = vi.fn(() => new Promise<void>((_, rej) => (reject = rej)));
    setup({ onSend });
    const box = screen.getByPlaceholderText('Message billing-api…');
    await user.type(box, 'first{Enter}');
    await user.type(box, 'second');
    reject(Object.assign(new Error('409'), { status: 409 }));
    expect(await screen.findByText('This session is disconnected')).toBeInTheDocument();
    expect(box).toHaveValue('second');
  });

  it('a user message with attachments shows its file chips; one made only of files has no empty text', () => {
    const { container } = setup({
      events: [
        { kind: 'user', id: 'f1', ts: ts(1), text: 'see these', origin: 'app', appMessageId: 'x1', attachments: ['shot.png', 'notes.txt'] },
        { kind: 'user', id: 'f2', ts: ts(2), text: '', origin: 'app', appMessageId: 'x2', attachments: ['only.pdf'] },
      ],
    });
    const [b1, b2] = Array.from(container.querySelectorAll('[data-bubble="user"]')) as HTMLElement[];
    const list1 = within(b1).getByRole('list', { name: 'Attached files' });
    expect(within(list1).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['shot.png', 'notes.txt']);
    expect(within(b1).getByText('see these')).toBeInTheDocument();
    expect(within(b2).getByRole('list', { name: 'Attached files' })).toHaveTextContent('only.pdf');
    expect(b2.querySelector('p.whitespace-pre-wrap')).toBeNull();
  });
  it('queued and not-delivered messages show attachment lines as chips, not as text', () => {
    const line = '[Attachment: /h/a/s1/0123456789abcdef-shot.png]';
    const { container } = setup({
      events: [],
      pending: [
        { id: 'q1', text: `queued one\n${line}`, ts: ts(1) },
        { id: 'q2', text: `failed one\n${line}`, ts: ts(2), failed: true },
      ],
    });
    for (const kind of ['queued', 'failed']) {
      const b = container.querySelector(`[data-bubble="${kind}"]`) as HTMLElement;
      expect(b.textContent).not.toContain('[Attachment:');
      expect(within(b).getByRole('list', { name: 'Attached files' })).toHaveTextContent('shot.png');
    }
  });

  it('not-delivered item shows retry', async () => {
    const { container } = setup({ events: [], pending: [{ id: 'a1', text: 'lost', ts: ts(1), failed: true }] });
    expect(screen.getByText('not delivered')).toBeInTheDocument();
    expect(container.querySelector('[data-bubble="queued"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  // Audit RT4: new transcript shapes.
  it('an image prompt shows its text and an image chip; the compaction notice is not a bubble', () => {
    setup({
      events: [
        { kind: 'user', id: 'i1', ts: ts(1), text: 'look at this', origin: 'terminal', images: 1 },
        { kind: 'user', id: 'i2', ts: ts(2), text: 'and these', origin: 'terminal', images: 2 },
        { kind: 'notice', id: 'k1', ts: ts(3), code: 'compacted' },
      ],
    });
    expect(screen.getByText('look at this')).toBeInTheDocument();
    expect(screen.getByText('[image]')).toBeInTheDocument();
    expect(screen.getByText('[2 images]')).toBeInTheDocument();
    expect(screen.getByText(/^Conversation compacted · /)).toBeInTheDocument();
    expect(document.querySelectorAll('[data-bubble="user"]')).toHaveLength(2);
  });

  it('a ! shell command is a terminal message and its output sits in a collapsible actions item', async () => {
    setup({
      events: [
        { kind: 'user', id: 'b1', ts: ts(1), text: 'ls -a', origin: 'terminal', shell: true },
        { kind: 'actions', id: 'b2', ts: ts(2), items: [{ toolUseId: 'b2', name: 'Shell', summary: 'ls -a', result: 'a.txt\nb.txt' }] },
      ],
    });
    expect(screen.getByText('! ls -a')).toBeInTheDocument();
    expect(screen.queryByText(/a\.txt/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /1 action/ }));
    expect(screen.getByText(/a\.txt/)).toBeInTheDocument();
  });

  it('disables the composer while a question is pending', () => {
    setup({
      session: session({
        state: 'waiting',
        waitingKind: 'question',
        pendingQuestion: { toolUseId: 'tu1', createdAt: ts(5), questions: [{ question: 'Q?', options: [{ label: 'A' }] }] },
      }),
      events: [{ kind: 'question', id: 'q1', ts: ts(5), toolUseId: 'tu1', questions: [{ question: 'Q?', options: [{ label: 'A' }] }] }],
    });
    expect(screen.getByRole('textbox', { name: /Message billing-api/ })).toBeDisabled();
    expect(screen.getByPlaceholderText('Answer the question above')).toBeInTheDocument();
  });

  it('says to answer below (banner and header status) when the question is routed to the app', () => {
    setup({
      session: session({
        state: 'waiting',
        waitingKind: 'question',
        pendingQuestion: { toolUseId: 'tu1', createdAt: ts(5), questions: [{ question: 'Q?', options: [{ label: 'A' }] }] },
      }),
      events: [],
    });
    expect(screen.getByText('Claude is asking you a question — answer below')).toBeInTheDocument();
    expect(screen.getByText('waiting for your answer', { selector: '[data-state="waiting"]' })).toBeInTheDocument();
    // The card's own "Answer in the terminal" button is expected; no banner or status may send the user there.
    expect(screen.queryByText(/waiting .*in the terminal/i)).toBeNull();
  });

  // Claude Code writes the AskUserQuestion entry to the transcript only after the tool returns, so while the
  // hook waits the card must come from the hub's pendingQuestion.
  it('shows the pending question card before the question reaches the transcript', () => {
    setup({
      session: session({
        state: 'waiting',
        waitingKind: 'question',
        pendingQuestion: { toolUseId: 'tu1', createdAt: ts(5), questions: [{ question: 'Pick one?', options: [{ label: 'Alpha' }, { label: 'Beta' }] }] },
      }),
      events: [],
    });
    expect(screen.getByText('Pick one?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Alpha/ })).toBeInTheDocument();
  });

  it('shows the pending question once when the transcript already has it', () => {
    const questions = [{ question: 'Pick one?', options: [{ label: 'Alpha' }, { label: 'Beta' }] }];
    setup({
      session: session({ state: 'waiting', waitingKind: 'question', pendingQuestion: { toolUseId: 'tu1', createdAt: ts(5), questions } }),
      events: [{ kind: 'question', id: 'q1', ts: ts(5), toolUseId: 'tu1', questions }],
    });
    expect(screen.getAllByText('Pick one?')).toHaveLength(1);
  });

  describe('rename', () => {
    const openRename = async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Conversation actions' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    };
    it('opens an input from the pencil and saves on Enter', async () => {
      const onRename = vi.fn(async () => {});
      setup({ onRename });
      await openRename();
      const input = screen.getByRole('textbox', { name: 'Rename session' });
      expect(input).toHaveValue('billing-api');
      expect(input).toHaveFocus();
      await userEvent.clear(input);
      await userEvent.type(input, 'Novo{Enter}');
      expect(onRename).toHaveBeenCalledWith('Novo');
    });

    it('Escape cancels without saving', async () => {
      const onRename = vi.fn(async () => {});
      setup({ onRename });
      await openRename();
      await userEvent.type(screen.getByRole('textbox', { name: 'Rename session' }), 'x{Escape}');
      expect(onRename).not.toHaveBeenCalled();
      expect(screen.queryByRole('textbox', { name: 'Rename session' })).not.toBeInTheDocument();
    });

    it('saves an empty name as "" to restore the original', async () => {
      const onRename = vi.fn(async () => {});
      setup({ onRename });
      await openRename();
      await userEvent.clear(screen.getByRole('textbox', { name: 'Rename session' }));
      await userEvent.keyboard('{Enter}');
      expect(onRename).toHaveBeenCalledWith('');
    });

    it('shows an error and keeps the input when saving fails', async () => {
      const onRename = vi.fn(async () => {
        throw new Error('boom');
      });
      setup({ onRename });
      await openRename();
      await userEvent.type(screen.getByRole('textbox', { name: 'Rename session' }), 'x{Enter}');
      expect(await screen.findByText("Couldn't rename")).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Rename session' })).toBeInTheDocument();
    });

    it('shows the original name as the title of a custom name', () => {
      setup({ session: session({ name: 'Custom', originalName: 'billing-api' }) });
      expect(screen.getByRole('heading', { name: 'Custom' })).toHaveAttribute('title', 'billing-api');
    });

    it('shows the new name right after saving, before the session updates', async () => {
      const onRename = vi.fn(async (n: string) => ({ name: n }));
      setup({ onRename });
      await openRename();
      const input = screen.getByRole('textbox', { name: 'Rename session' });
      await userEvent.clear(input);
      await userEvent.type(input, 'Novo{Enter}');
      expect(await screen.findByRole('heading', { name: 'Novo' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Conversation actions' })).toHaveFocus();
    });

    it('drops the override once the session moved on, so a rename back to the base shows', async () => {
      const onRename = vi.fn(async (n: string) => ({ name: n }));
      const { rerenderWith } = setup({ session: session({ name: 'A' }), onRename });
      await openRename();
      const input = screen.getByRole('textbox', { name: 'Rename session' });
      await userEvent.clear(input);
      await userEvent.type(input, 'B{Enter}');
      expect(await screen.findByRole('heading', { name: 'B' })).toBeInTheDocument();
      rerenderWith({ session: session({ name: 'B' }), onRename });
      expect(screen.getByRole('heading', { name: 'B' })).toBeInTheDocument();
      rerenderWith({ session: session({ name: 'A' }), onRename });
      expect(screen.getByRole('heading', { name: 'A' })).toBeInTheDocument();
    });

    it('labels the section with the displayed name', async () => {
      const onRename = vi.fn(async (n: string) => ({ name: n }));
      setup({ session: session({ name: 'A' }), onRename });
      await openRename();
      const input = screen.getByRole('textbox', { name: 'Rename session' });
      await userEvent.clear(input);
      await userEvent.type(input, 'B{Enter}');
      expect(await screen.findByRole('region', { name: 'B' })).toBeInTheDocument();
    });

    it('saves on blur', async () => {
      const onRename = vi.fn(async () => {});
      setup({ onRename });
      await openRename();
      await userEvent.type(screen.getByRole('textbox', { name: 'Rename session' }), 'x');
      await userEvent.tab();
      expect(onRename).toHaveBeenCalledWith('billing-apix');
    });

    it('does not save when the name is unchanged', async () => {
      const onRename = vi.fn(async () => {});
      setup({ onRename });
      await openRename();
      await userEvent.keyboard('{Enter}');
      expect(onRename).not.toHaveBeenCalled();
      expect(screen.queryByRole('textbox', { name: 'Rename session' })).not.toBeInTheDocument();
    });

    it('opens by clicking the name', async () => {
      setup({ onRename: vi.fn(async () => {}) });
      await userEvent.click(screen.getByRole('heading', { name: 'billing-api' }));
      const input = screen.getByRole('textbox', { name: 'Rename session' });
      expect(input).toHaveAttribute('maxlength', '80');
    });
  });

  describe('conversation menu', () => {
    const menuButton = () => screen.getByRole('button', { name: 'Conversation actions' });

    it('replaces the pencil with a ⋮ button that opens a menu with Rename and Remove from app', async () => {
      setup({ onRename: vi.fn(async () => {}), onRemove: vi.fn(async () => {}) });
      expect(screen.queryByRole('button', { name: 'Rename session' })).not.toBeInTheDocument();
      expect(menuButton()).toHaveAttribute('aria-haspopup', 'menu');
      expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
      await userEvent.click(menuButton());
      expect(menuButton()).toHaveAttribute('aria-expanded', 'true');
      const menu = screen.getByRole('menu', { name: 'Conversation actions' });
      expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Rename', 'Remove from app']);
      expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toHaveFocus();
    });

    it('Escape closes the menu and returns focus to the ⋮ button', async () => {
      setup({ onRename: vi.fn(async () => {}), onRemove: vi.fn(async () => {}) });
      await userEvent.click(menuButton());
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(menuButton()).toHaveFocus();
    });

    it('a click outside closes the menu', async () => {
      setup({ onRename: vi.fn(async () => {}), onRemove: vi.fn(async () => {}) });
      await userEvent.click(menuButton());
      await userEvent.click(screen.getByRole('log'));
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('arrow keys move between the items', async () => {
      setup({ onRename: vi.fn(async () => {}), onRemove: vi.fn(async () => {}) });
      await userEvent.click(menuButton());
      await userEvent.keyboard('{ArrowDown}');
      expect(screen.getByRole('menuitem', { name: 'Remove from app' })).toHaveFocus();
      await userEvent.keyboard('{ArrowDown}');
      expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus();
      await userEvent.keyboard('{ArrowUp}');
      expect(screen.getByRole('menuitem', { name: 'Remove from app' })).toHaveFocus();
    });

    it('Rename from the keyboard opens the same input as before', async () => {
      const onRename = vi.fn(async () => {});
      setup({ onRename, onRemove: vi.fn(async () => {}) });
      menuButton().focus();
      await userEvent.keyboard('{Enter}');
      await userEvent.keyboard('{Enter}');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      const input = screen.getByRole('textbox', { name: 'Rename session' });
      expect(input).toHaveFocus();
      await userEvent.type(input, 'x{Escape}');
      expect(onRename).not.toHaveBeenCalled();
      expect(menuButton()).toHaveFocus();
    });

    it('Remove from app asks to confirm in the menu, then calls onRemove', async () => {
      const onRemove = vi.fn(async () => {});
      const confirm = vi.spyOn(window, 'confirm');
      setup({ onRename: vi.fn(async () => {}), onRemove });
      await userEvent.click(menuButton());
      await userEvent.click(screen.getByRole('menuitem', { name: 'Remove from app' }));
      expect(onRemove).not.toHaveBeenCalled();
      const sure = screen.getByRole('menuitem', { name: 'Remove? Confirm' });
      expect(sure).toHaveFocus();
      await userEvent.click(sure);
      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(confirm).not.toHaveBeenCalled();
      confirm.mockRestore();
    });

    it('closing the menu forgets a pending confirmation', async () => {
      const onRemove = vi.fn(async () => {});
      setup({ onRename: vi.fn(async () => {}), onRemove });
      await userEvent.click(menuButton());
      await userEvent.click(screen.getByRole('menuitem', { name: 'Remove from app' }));
      await userEvent.keyboard('{Escape}');
      await userEvent.click(menuButton());
      expect(screen.getByRole('menuitem', { name: 'Remove from app' })).toBeInTheDocument();
      expect(onRemove).not.toHaveBeenCalled();
    });

    it('says so when removing fails and keeps the menu open', async () => {
      const onRemove = vi.fn(async () => {
        throw new Error('boom');
      });
      setup({ onRename: vi.fn(async () => {}), onRemove });
      await userEvent.click(menuButton());
      await userEvent.click(screen.getByRole('menuitem', { name: 'Remove from app' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Remove? Confirm' }));
      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't remove");
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('Pin to top calls onPin(true) and closes; a pinned session offers Unpin', async () => {
      const onPin = vi.fn(async () => {});
      const r = setup({ onPin });
      await userEvent.click(menuButton());
      await userEvent.click(screen.getByRole('menuitem', { name: 'Pin to top' }));
      expect(onPin).toHaveBeenCalledWith(true);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      r.unmount();
      const onPin2 = vi.fn(async () => {});
      setup({ onPin: onPin2, session: { ...session(), pinned: true } });
      await userEvent.click(menuButton());
      await userEvent.click(screen.getByRole('menuitem', { name: 'Unpin' }));
      expect(onPin2).toHaveBeenCalledWith(false);
    });

    it('says so when pinning fails', async () => {
      setup({ onPin: vi.fn(async () => { throw new Error('x'); }) });
      await userEvent.click(menuButton());
      await userEvent.click(screen.getByRole('menuitem', { name: 'Pin to top' }));
      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't change the pin");
    });

    it('Disconnect asks to confirm in the menu, then calls onDisconnect; never window.confirm', async () => {
      const onDisconnect = vi.fn(async () => {});
      const confirm = vi.spyOn(window, 'confirm');
      setup({ onDisconnect, onRemove: vi.fn(async () => {}) });
      await userEvent.click(menuButton());
      await userEvent.click(screen.getByRole('menuitem', { name: 'Disconnect' }));
      expect(onDisconnect).not.toHaveBeenCalled();
      // Only one confirmation at a time: Remove is still asking nothing.
      expect(screen.getByRole('menuitem', { name: 'Remove from app' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('menuitem', { name: 'Disconnect? Confirm' }));
      expect(onDisconnect).toHaveBeenCalledTimes(1);
      expect(confirm).not.toHaveBeenCalled();
      confirm.mockRestore();
    });

    it('Disconnect is not offered for a disconnected session; failure is said', async () => {
      const r = setup({ onDisconnect: vi.fn(async () => {}), session: { ...session(), state: 'disconnected' } });
      expect(screen.queryByRole('button', { name: 'Conversation actions' })).not.toBeInTheDocument();
      r.unmount();
      setup({ onDisconnect: vi.fn(async () => { throw new Error('x'); }) });
      await userEvent.click(menuButton());
      await userEvent.click(screen.getByRole('menuitem', { name: 'Disconnect' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Disconnect? Confirm' }));
      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't disconnect");
    });

    it('no ⋮ button without any action', () => {
      setup();
      expect(screen.queryByRole('button', { name: 'Conversation actions' })).not.toBeInTheDocument();
    });

    describe('export', () => {
      const renderExport = (onExport: (format: 'md' | 'pdf', name: string) => Promise<void>) =>
        render(
          <LangProvider lang="en">
            <ChatView session={session()} events={events} pending={[]} loading={false} onSend={vi.fn(async () => {})} onExport={onExport} onBack={() => {}} />
          </LangProvider>,
        );

      it('Export conversation opens Markdown and PDF in place; each exports with the shown name and closes the menu', async () => {
        const onExport = vi.fn(async () => {});
        renderExport(onExport);
        await userEvent.click(menuButton());
        const item = screen.getByRole('menuitem', { name: 'Export conversation' });
        expect(item).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('menuitem', { name: 'Markdown (.md)' })).not.toBeInTheDocument();
        await userEvent.click(item);
        expect(item).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('menuitem', { name: 'Markdown (.md)' })).toHaveFocus();
        await userEvent.click(screen.getByRole('menuitem', { name: 'Markdown (.md)' }));
        expect(onExport).toHaveBeenCalledWith('md', 'billing-api');
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        await userEvent.click(menuButton());
        await userEvent.click(screen.getByRole('menuitem', { name: 'Export conversation' }));
        await userEvent.click(screen.getByRole('menuitem', { name: 'PDF' }));
        expect(onExport).toHaveBeenLastCalledWith('pdf', 'billing-api');
      });

      it('a failed export is said in the menu, without a dialog', async () => {
        const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
        renderExport(vi.fn(async () => { throw new Error('x'); }));
        await userEvent.click(menuButton());
        await userEvent.click(screen.getByRole('menuitem', { name: 'Export conversation' }));
        await userEvent.click(screen.getByRole('menuitem', { name: 'PDF' }));
        expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't export");
        expect(alert).not.toHaveBeenCalled();
        alert.mockRestore();
      });
    });
  });
});
