import { act, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ChatEvent, SessionView, SubagentInfo } from '@shared/types';
import { LangProvider } from '../i18n';
import { ChatView } from './ChatView';
import { formatDuration, groupSubagents, lastUserMessageAt, SUBAGENTS_POLL_MS, usePolled } from './SubagentsPanel';
import type { PanelApi } from './SidePanel';

// Spec 2026-11-26-side-panel: the subagents of the session in the side panel.

const NOW = Date.parse('2026-11-26T10:30:00.000Z');
const session = (over: Partial<SessionView> = {}): SessionView => ({
  sessionId: 's1',
  name: 'proj',
  cwd: '/home/me/proj',
  state: 'busy',
  pendingAppMessageIds: [],
  ...over,
});
const agents: SubagentInfo[] = [
  {
    id: 'a1',
    description: 'Front D: side panel',
    agentType: 'general-purpose',
    model: 'Opus 5.5',
    background: true,
    status: 'running',
    startedAt: '2026-11-26T10:05:00.000Z',
    lastActivityAt: '2026-11-26T10:29:30.000Z',
    lastTool: 'Bash',
  },
  { id: 'a2', description: 'Find the parser', agentType: 'Explore', background: false, status: 'finished', startedAt: '2026-11-26T09:00:00.000Z', lastActivityAt: '2026-11-26T09:02:00.000Z', lastTool: 'Grep' },
];
const subEvents: ChatEvent[] = [
  { kind: 'user', id: 'u', ts: '2026-11-26T10:05:00.000Z', text: 'Implement the panel', origin: 'terminal' },
  { kind: 'actions', id: 'x', ts: '2026-11-26T10:06:00.000Z', items: [{ toolUseId: 't', name: 'Read', summary: 'src/a.ts' }] },
  { kind: 'assistant', id: 'c', ts: '2026-11-26T10:07:00.000Z', text: 'Done with **step 1**' },
];

function setup(over: Partial<PanelApi> = {}, s = session(), events: ChatEvent[] = []) {
  const panel: PanelApi = {
    file: vi.fn(async () => new Blob([''])),
    filesExist: vi.fn(async () => []),
    subagents: vi.fn(async () => agents),
    subagentEvents: vi.fn(async () => subEvents),
    ...over,
  };
  render(
    <LangProvider lang="en">
      <ChatView session={s} events={events} pending={[]} loading={false} onSend={async () => {}} onBack={() => {}} panel={panel} now={() => NOW} />
    </LangProvider>,
  );
  return panel;
}

describe('usePolled', () => {
  const setHidden = (hidden: boolean) => Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
  it('does not poll while the page is hidden, and loads again when it is shown', async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const load = vi.fn(async () => ({ n: ++n }));
      const { result } = renderHook(() => usePolled(load, SUBAGENTS_POLL_MS));
      await act(async () => {});
      expect(load).toHaveBeenCalledTimes(1);
      setHidden(true);
      await act(async () => vi.advanceTimersByTime(SUBAGENTS_POLL_MS)); // the one already scheduled
      await act(async () => vi.advanceTimersByTime(SUBAGENTS_POLL_MS * 5));
      expect(load).toHaveBeenCalledTimes(2);
      setHidden(false);
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
      expect(load).toHaveBeenCalledTimes(3);
      expect(result.current.value).toEqual({ n: 3 });
    } finally {
      setHidden(false);
      vi.useRealTimers();
    }
  });
  it('keeps the same value when an answer did not change', async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn(async () => ({ same: true }));
      const { result } = renderHook(() => usePolled(load, SUBAGENTS_POLL_MS));
      await act(async () => {});
      const first = result.current.value;
      await act(async () => vi.advanceTimersByTime(SUBAGENTS_POLL_MS));
      expect(load).toHaveBeenCalledTimes(2);
      expect(result.current.value).toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('formatDuration', () => {
  it('says minutes and hours', () => {
    const t = (k: string, v?: Record<string, unknown>) => `${k}:${JSON.stringify(v ?? {})}`;
    expect(formatDuration(20_000, t)).toBe('ui.panel.duration.lessThanMinute:{}');
    expect(formatDuration(25 * 60_000, t)).toBe('ui.panel.duration.minutes:{"n":25}');
    expect(formatDuration(125 * 60_000, t)).toBe('ui.panel.duration.hours:{"h":2,"m":5}');
  });
});

describe('subagents in the side panel', () => {
  it('clicking the status opens the list: description, type, model, time, state and last tool', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: /Show subagents/ }));
    const panel = await screen.findByTestId('side-panel');
    const items = await within(panel).findAllByTestId('subagent');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('Front D: side panel');
    expect(items[0]).toHaveTextContent('general-purpose · Opus 5.5 · background');
    expect(items[0]).toHaveTextContent('Working for 25 min');
    expect(items[0]).toHaveTextContent('Last: Bash');
    const history = within(panel).getByRole('button', { name: 'History (1)' });
    expect(history).toHaveAttribute('aria-expanded', 'false');
    expect(items).toHaveLength(1);
    await userEvent.click(history);
    expect(history).toHaveAttribute('aria-expanded', 'true');
    const all = within(panel).getAllByTestId('subagent');
    expect(all).toHaveLength(2);
    expect(all[1]).toHaveTextContent('Finished');
    expect(all[1]).toHaveTextContent('Ran 2 min');
  });

  it('clicking a subagent shows its transcript; Back returns to the list', async () => {
    const panel = setup();
    await userEvent.click(screen.getByRole('button', { name: /Show subagents/ }));
    const side = await screen.findByTestId('side-panel');
    await userEvent.click((await within(side).findAllByTestId('subagent'))[0]);
    expect(await within(side).findByText('step 1')).toBeTruthy();
    expect(within(side).getByText('Implement the panel')).toBeTruthy();
    expect(within(side).getByRole('heading', { level: 2 })).toHaveTextContent('Front D: side panel');
    expect(panel.subagentEvents).toHaveBeenCalledWith('a1');
    await userEvent.click(within(side).getByRole('button', { name: 'Back' }));
    expect(await within(side).findAllByTestId('subagent')).toHaveLength(1);
  });

  it('an empty list says so', async () => {
    setup({ subagents: vi.fn(async () => []) });
    await userEvent.click(screen.getByRole('button', { name: /Show subagents/ }));
    expect(await screen.findByText('No subagents in this conversation.')).toBeTruthy();
  });

  it('without the subagents loader the status is not a button', () => {
    setup({ subagents: undefined });
    expect(screen.queryByRole('button', { name: /Show subagents/ })).toBeNull();
  });
});

// Spec 2026-11-27-subagents-history: working ones on top, this round's finished ones below them, the rest in
// a History closed by default.
const fin = (id: string, last: string, over: Partial<SubagentInfo> = {}): SubagentInfo => ({
  id,
  description: `Agent ${id}`,
  agentType: 'general-purpose',
  background: true,
  status: 'finished',
  startedAt: '2026-11-26T08:00:00.000Z',
  lastActivityAt: last,
  ...over,
});
const userAt = (ts: string): ChatEvent => ({ kind: 'user', id: `u${ts}`, ts, text: 'go', origin: 'app' });

describe('groupSubagents', () => {
  const list = [
    fin('old1', '2026-11-26T07:00:00.000Z'),
    agents[0],
    fin('new1', '2026-11-26T10:10:00.000Z'),
    fin('old2', '2026-11-26T09:00:00.000Z'),
    fin('st', '2026-11-26T10:12:00.000Z', { status: 'stale' }),
  ];
  it('splits working, finished since the last message, and the rest (newest first)', () => {
    const g = groupSubagents(list, '2026-11-26T10:00:00.000Z');
    expect(g.running.map((a) => a.id)).toEqual(['a1']);
    expect(g.recent.map((a) => a.id)).toEqual(['st', 'new1']);
    expect(g.history.map((a) => a.id)).toEqual(['old2', 'old1']);
  });
  it('without a last message every ended one is history', () => {
    const g = groupSubagents(list, undefined);
    expect(g.recent).toEqual([]);
    expect(g.history.map((a) => a.id)).toEqual(['st', 'new1', 'old2', 'old1']);
  });
  it('an ended one with no time goes to history', () => {
    const g = groupSubagents([fin('x', '', { lastActivityAt: undefined })], '2026-11-26T10:00:00.000Z');
    expect(g.history.map((a) => a.id)).toEqual(['x']);
  });
});

describe('lastUserMessageAt', () => {
  it('is the time of the last user message', () => {
    const ev: ChatEvent[] = [userAt('2026-11-26T09:00:00.000Z'), { kind: 'assistant', id: 'a', ts: '2026-11-26T09:30:00.000Z', text: 'ok' }, userAt('2026-11-26T10:00:00.000Z'), { kind: 'assistant', id: 'b', ts: '2026-11-26T10:20:00.000Z', text: 'ok' }];
    expect(lastUserMessageAt(ev)).toBe('2026-11-26T10:00:00.000Z');
    expect(lastUserMessageAt([])).toBeUndefined();
  });
});

describe('subagents History', () => {
  const open = async () => {
    await userEvent.click(screen.getByRole('button', { name: /Show subagents/ }));
    return screen.findByTestId('side-panel');
  };

  it('none working: says so, and the old ones wait in the closed History', async () => {
    setup({ subagents: vi.fn(async () => [fin('o1', '2026-11-26T09:00:00.000Z'), fin('o2', '2026-11-26T08:00:00.000Z')]) });
    const side = await open();
    expect(await within(side).findByText('No subagents running now.')).toBeTruthy();
    expect(within(side).queryAllByTestId('subagent')).toHaveLength(0);
    const history = within(side).getByRole('button', { name: 'History (2)' });
    await userEvent.click(history);
    const items = within(side).getAllByTestId('subagent');
    expect(items.map((i) => i.textContent)).toEqual([expect.stringContaining('Agent o1'), expect.stringContaining('Agent o2')]);
    await userEvent.click(history);
    expect(history).toHaveAttribute('aria-expanded', 'false');
    expect(within(side).queryAllByTestId('subagent')).toHaveLength(0);
  });

  it("this round's finished ones stay visible below the working ones", async () => {
    setup(
      { subagents: vi.fn(async () => [agents[0], fin('n1', '2026-11-26T10:20:00.000Z'), fin('o1', '2026-11-26T09:00:00.000Z')]) },
      session(),
      [userAt('2026-11-26T10:00:00.000Z')],
    );
    const side = await open();
    const items = await within(side).findAllByTestId('subagent');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Front D: side panel');
    expect(items[1]).toHaveTextContent('Agent n1');
    expect(within(side).getByRole('button', { name: 'History (1)' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('one waiting on its own background task stays with the working ones, labelled "Waiting for task" (spec 2026-11-27-subagent-background-task)', async () => {
    const waiting = fin('w1', '2026-11-26T09:50:00.000Z', { status: 'waiting', description: 'Sleeper', startedAt: '2026-11-26T09:40:00.000Z' });
    expect(groupSubagents([waiting], '2026-11-26T10:00:00.000Z').running.map((a) => a.id)).toEqual(['w1']);
    setup({ subagents: vi.fn(async () => [waiting]) }, session(), [userAt('2026-11-26T10:00:00.000Z')]);
    const side = await open();
    const items = await within(side).findAllByTestId('subagent');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('Waiting for task');
    expect(items[0]).toHaveTextContent('Working for 50 min');
    expect(within(side).queryByText('No subagents running now.')).toBeNull();
  });

  it('no History when every subagent is in view', async () => {
    setup({ subagents: vi.fn(async () => [agents[0]]) });
    const side = await open();
    await within(side).findAllByTestId('subagent');
    expect(within(side).queryByRole('button', { name: /History/ })).toBeNull();
  });

  it('an opened History stays open after viewing a subagent and going back', async () => {
    setup();
    const side = await open();
    await userEvent.click(await within(side).findByRole('button', { name: 'History (1)' }));
    await userEvent.click(within(side).getAllByTestId('subagent')[1]);
    await userEvent.click(within(side).getByRole('button', { name: 'Back' }));
    expect(await within(side).findByRole('button', { name: 'History (1)' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(side).getAllByTestId('subagent')).toHaveLength(2);
  });
});
