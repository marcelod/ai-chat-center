// The subagents of a session in the side panel (spec 2026-11-26-side-panel): a live list (refreshed while
// open) and, for one subagent, its transcript in short form.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ChatEvent, SubagentInfo } from '@shared/types';
import { useT, type T } from '../i18n';
import { ActionsGroup } from './ActionsGroup';
import { AgentBubble, AssistantBubble, ToAgentBubble } from './MessageBubble';
import { loadErrorKey, PanelMessage } from './SidePanel';

export const SUBAGENTS_POLL_MS = 3000;

/** "less than a minute", "25 min", "2 h 5 min". */
export function formatDuration(ms: number, t: T): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return t('ui.panel.duration.lessThanMinute');
  if (min < 60) return t('ui.panel.duration.minutes', { n: min });
  return t('ui.panel.duration.hours', { h: Math.floor(min / 60), m: min % 60 });
}

/** Loads with `load` now and every `ms` while mounted; keeps the last good answer on a failed refresh. */
function usePolled<V>(load: () => Promise<V>, ms: number): { value?: V; error?: string } {
  const [state, setState] = useState<{ value?: V; error?: string }>({});
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      loadRef.current().then(
        (value) => alive && setState({ value }),
        (e: unknown) => alive && setState((s) => (s.value === undefined ? { error: loadErrorKey(e) } : s)),
      ).finally(() => {
        if (alive) timer = setTimeout(tick, ms);
      });
    };
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [ms]);
  return state;
}

const STATUS_STYLE: Record<SubagentInfo['status'], string> = {
  running: 'bg-busy-bg text-busy-text',
  finished: 'bg-field text-muted',
  stale: 'bg-warn-bg text-waiting-text',
};

function timeLine(a: SubagentInfo, now: number, t: T): string | null {
  const start = a.startedAt ? Date.parse(a.startedAt) : NaN;
  const last = a.lastActivityAt ? Date.parse(a.lastActivityAt) : NaN;
  if (a.status === 'running' && Number.isFinite(start)) return t('ui.panel.workingFor', { d: formatDuration(now - start, t) });
  if (a.status === 'finished' && Number.isFinite(start) && Number.isFinite(last)) return t('ui.panel.ran', { d: formatDuration(last - start, t) });
  if (a.status === 'stale' && Number.isFinite(last)) return t('ui.panel.noNewsFor', { d: formatDuration(now - last, t) });
  return null;
}

export function SubagentList({ load, onOpen, now }: { load: () => Promise<SubagentInfo[]>; onOpen: (a: SubagentInfo) => void; now: () => number }) {
  const t = useT();
  const { value, error } = usePolled(load, SUBAGENTS_POLL_MS);
  if (error) return <PanelMessage alert>{t(error)}</PanelMessage>;
  if (!value) return <PanelMessage>{t('ui.panel.loading')}</PanelMessage>;
  if (value.length === 0) return <PanelMessage>{t('ui.panel.noSubagents')}</PanelMessage>;
  const at = now();
  return (
    <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
      {value.map((a) => {
        const when = timeLine(a, at, t);
        const kind = [a.agentType, a.model, a.background ? t('ui.panel.background') : null].filter(Boolean).join(' · ');
        return (
          <li key={a.id}>
            <button type="button" data-testid="subagent" onClick={() => onOpen(a)} className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-field">
              <span className="flex w-full items-start gap-2">
                <span className="min-w-0 flex-1 text-sm font-semibold text-ink">{a.description || a.agentType || a.id}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[a.status]}`}>
                  {a.status === 'running' && <span aria-hidden="true">● </span>}
                  {t(`ui.panel.status.${a.status}`)}
                </span>
              </span>
              {kind && <span className="text-xs text-muted">{kind}</span>}
              <span className="flex flex-wrap gap-x-3 text-xs text-muted">
                {when && <span>{when}</span>}
                {a.lastTool && <span className="font-mono">{t('ui.panel.lastTool', { tool: a.lastTool })}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** One subagent's transcript, short: its prompt (folded), tools and answers. */
export function SubagentTranscript({ load, title }: { load: () => Promise<ChatEvent[]>; title: string }) {
  const t = useT();
  const { value, error } = usePolled(load, SUBAGENTS_POLL_MS);
  const end = useRef<HTMLDivElement>(null);
  const count = value?.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [count]);
  if (error) return <PanelMessage alert>{t(error)}</PanelMessage>;
  if (!value) return <PanelMessage>{t('ui.panel.loading')}</PanelMessage>;
  const render = (e: ChatEvent): ReactNode => {
    switch (e.kind) {
      case 'user':
        return <ToAgentBubble key={e.id} event={{ kind: 'toAgent', id: e.id, ts: e.ts, to: title, text: e.text }} />;
      case 'assistant':
        return <AssistantBubble key={e.id} text={e.text} />;
      case 'actions':
        return <ActionsGroup key={e.id} items={e.items} />;
      case 'agent':
        return <AgentBubble key={e.id} event={e} />;
      case 'toAgent':
        return <ToAgentBubble key={e.id} event={e} />;
      default:
        return null;
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-page px-3 py-4">
      {value.length === 0 ? <PanelMessage>{t('ui.panel.noMessages')}</PanelMessage> : value.map(render)}
      <div ref={end} />
    </div>
  );
}
