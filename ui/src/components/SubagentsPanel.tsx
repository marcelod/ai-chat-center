// The subagents of a session in the side panel (spec 2026-11-26-side-panel): a live list (refreshed while
// open) and, for one subagent, its transcript in short form. The list (spec 2026-11-27-subagents-history):
// working ones on top, the ones that ended since the person's last message below them, the rest in a History
// closed by default.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ChatEvent, SubagentInfo } from '@shared/types';
import { useT, type T } from '../i18n';
import { ActionsGroup } from './ActionsGroup';
import { AgentBubble, AssistantBubble, ToAgentBubble } from './MessageBubble';
import { ChevronIcon } from './icons';
import { loadErrorKey, PanelMessage } from './SidePanel';

export const SUBAGENTS_POLL_MS = 3000;

/** "less than a minute", "25 min", "2 h 5 min". */
export function formatDuration(ms: number, t: T): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return t('ui.panel.duration.lessThanMinute');
  if (min < 60) return t('ui.panel.duration.minutes', { n: min });
  return t('ui.panel.duration.hours', { h: Math.floor(min / 60), m: min % 60 });
}

/**
 * Loads with `load` now and every `ms` while mounted and the page is visible (a hidden tab does not poll; it
 * loads again as soon as it is shown). Keeps the last good answer on a failed refresh, and the same object when
 * an answer did not change (nothing is drawn again).
 */
export function usePolled<V>(load: () => Promise<V>, ms: number): { value?: V; error?: string } {
  const [state, setState] = useState<{ value?: V; error?: string }>({});
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let alive = true;
    let loading = false;
    let last: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      timer = undefined;
      if (loading) return;
      loading = true;
      loadRef.current().then(
        (value) => {
          if (!alive) return;
          const json = JSON.stringify(value);
          if (json === last) return;
          last = json;
          setState({ value });
        },
        (e: unknown) => alive && setState((s) => (s.value === undefined ? { error: loadErrorKey(e) } : s)),
      ).finally(() => {
        loading = false;
        if (alive && !document.hidden) timer = setTimeout(tick, ms);
      });
    };
    const onVisible = () => {
      if (!document.hidden && timer === undefined) tick();
    };
    tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      if (timer) clearTimeout(timer);
    };
  }, [ms]);
  return state;
}

const STATUS_STYLE: Record<SubagentInfo['status'], string> = {
  running: 'bg-busy-bg text-busy-text',
  finished: 'bg-field text-muted',
  stale: 'bg-warn-bg text-waiting-text',
  waiting: 'bg-busy-bg text-busy-text',
};

function timeLine(a: SubagentInfo, now: number, t: T): string | null {
  const start = a.startedAt ? Date.parse(a.startedAt) : NaN;
  const last = a.lastActivityAt ? Date.parse(a.lastActivityAt) : NaN;
  if ((a.status === 'running' || a.status === 'waiting') && Number.isFinite(start)) return t('ui.panel.workingFor', { d: formatDuration(now - start, t) });
  if (a.status === 'finished' && Number.isFinite(start) && Number.isFinite(last)) return t('ui.panel.ran', { d: formatDuration(last - start, t) });
  if (a.status === 'stale' && Number.isFinite(last)) return t('ui.panel.noNewsFor', { d: formatDuration(now - last, t) });
  return null;
}

const activityAt = (a: SubagentInfo) => (a.lastActivityAt ? Date.parse(a.lastActivityAt) : NaN);
const newestFirst = (a: SubagentInfo, b: SubagentInfo) => (activityAt(b) || 0) - (activityAt(a) || 0);

/**
 * Splits the list: working ones; ended ones (finished or no news) with activity at or after `since` (the
 * person's last message); and the rest, the History. Each newest first. Without `since`, every ended one is history.
 */
export function groupSubagents(list: SubagentInfo[], since: string | undefined): { running: SubagentInfo[]; recent: SubagentInfo[]; history: SubagentInfo[] } {
  const from = since ? Date.parse(since) : NaN;
  const running: SubagentInfo[] = [];
  const recent: SubagentInfo[] = [];
  const history: SubagentInfo[] = [];
  for (const a of [...list].sort(newestFirst)) {
    // Waiting on a background task of its own: it comes back, so it stays with the working ones.
    if (a.status === 'running' || a.status === 'waiting') running.push(a);
    else if (Number.isFinite(from) && activityAt(a) >= from) recent.push(a);
    else history.push(a);
  }
  return { running, recent, history };
}

/** The time of the last message the person sent (terminal or app) among `events`. */
export function lastUserMessageAt(events: ChatEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === 'user') return e.ts;
  }
  return undefined;
}

function SubagentItem({ a, at, onOpen }: { a: SubagentInfo; at: number; onOpen: (a: SubagentInfo) => void }) {
  const t = useT();
  const when = timeLine(a, at, t);
  const kind = [a.agentType, a.model, a.background ? t('ui.panel.background') : null].filter(Boolean).join(' · ');
  return (
    <li>
      <button type="button" data-testid="subagent" onClick={() => onOpen(a)} className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-field">
        <span className="flex w-full items-start gap-2">
          <span className="min-w-0 flex-1 text-sm font-semibold text-ink">{a.description || a.agentType || a.id}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[a.status]}`}>
            {a.status === 'running' && <span aria-hidden="true">● </span>}
            {a.status === 'waiting' && <span aria-hidden="true">◔ </span>}
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
}

type ListProps = {
  load: () => Promise<SubagentInfo[]>;
  onOpen: (a: SubagentInfo) => void;
  now: () => number;
  /** The person's last message: ended subagents with news since then stay in view. */
  since?: string;
  /** Whether the History is open; kept by the caller so it survives opening a subagent and coming back. */
  historyOpen?: boolean;
  onHistoryOpen?: (open: boolean) => void;
};

export function SubagentList({ load, onOpen, now, since, historyOpen, onHistoryOpen }: ListProps) {
  const t = useT();
  const { value, error } = usePolled(load, SUBAGENTS_POLL_MS);
  const [ownOpen, setOwnOpen] = useState(false);
  const open = historyOpen ?? ownOpen;
  const setOpen = onHistoryOpen ?? setOwnOpen;
  if (error) return <PanelMessage alert>{t(error)}</PanelMessage>;
  if (!value) return <PanelMessage>{t('ui.panel.loading')}</PanelMessage>;
  if (value.length === 0) return <PanelMessage>{t('ui.panel.noSubagents')}</PanelMessage>;
  const at = now();
  const { running, recent, history } = groupSubagents(value, since);
  const current = [...running, ...recent];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {running.length === 0 && <p className="px-4 py-3 text-sm text-muted">{t('ui.panel.noneRunning')}</p>}
      {current.length > 0 && (
        <ul className={`divide-y divide-line ${running.length === 0 ? 'border-t border-line' : ''}`}>
          {current.map((a) => (
            <SubagentItem key={a.id} a={a} at={at} onOpen={onOpen} />
          ))}
        </ul>
      )}
      {history.length > 0 && (
        <section className="border-t border-line">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="flex min-h-11 w-full items-center gap-2 px-4 text-sm font-semibold text-muted"
          >
            <ChevronIcon width={16} height={16} className={open ? 'rotate-90' : ''} />
            {t('ui.panel.history', { n: history.length })}
          </button>
          {open && (
            <ul className="divide-y divide-line border-t border-line">
              {history.map((a) => (
                <SubagentItem key={a.id} a={a} at={at} onOpen={onOpen} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
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
