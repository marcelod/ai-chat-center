import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ChatEvent, SessionView, SubagentInfo } from '@shared/types';
import { LangProvider } from '../i18n';
import { ChatView } from './ChatView';
import { formatDuration } from './SubagentsPanel';
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

function setup(over: Partial<PanelApi> = {}, s = session()) {
  const panel: PanelApi = {
    file: vi.fn(async () => new Blob([''])),
    filesExist: vi.fn(async () => []),
    subagents: vi.fn(async () => agents),
    subagentEvents: vi.fn(async () => subEvents),
    ...over,
  };
  render(
    <LangProvider lang="en">
      <ChatView session={s} events={[]} pending={[]} loading={false} onSend={async () => {}} onBack={() => {}} panel={panel} now={() => NOW} />
    </LangProvider>,
  );
  return panel;
}

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
    await userEvent.click(screen.getByRole('button', { name: 'Show subagents' }));
    const panel = await screen.findByTestId('side-panel');
    const items = await within(panel).findAllByTestId('subagent');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Front D: side panel');
    expect(items[0]).toHaveTextContent('general-purpose · Opus 5.5 · background');
    expect(items[0]).toHaveTextContent('Working for 25 min');
    expect(items[0]).toHaveTextContent('Last: Bash');
    expect(items[1]).toHaveTextContent('Finished');
    expect(items[1]).toHaveTextContent('Ran 2 min');
  });

  it('clicking a subagent shows its transcript; Back returns to the list', async () => {
    const panel = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Show subagents' }));
    const side = await screen.findByTestId('side-panel');
    await userEvent.click((await within(side).findAllByTestId('subagent'))[0]);
    expect(await within(side).findByText('step 1')).toBeTruthy();
    expect(within(side).getByText('Implement the panel')).toBeTruthy();
    expect(within(side).getByRole('heading', { level: 2 })).toHaveTextContent('Front D: side panel');
    expect(panel.subagentEvents).toHaveBeenCalledWith('a1');
    await userEvent.click(within(side).getByRole('button', { name: 'Back' }));
    expect(await within(side).findAllByTestId('subagent')).toHaveLength(2);
  });

  it('an empty list says so', async () => {
    setup({ subagents: vi.fn(async () => []) });
    await userEvent.click(screen.getByRole('button', { name: 'Show subagents' }));
    expect(await screen.findByText('No subagents in this conversation.')).toBeTruthy();
  });

  it('without the subagents loader the status is not a button', () => {
    setup({ subagents: undefined });
    expect(screen.queryByRole('button', { name: 'Show subagents' })).toBeNull();
  });
});
