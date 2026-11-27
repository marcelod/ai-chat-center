import { useEffect, useState } from 'react';
import type { SearchHit } from '@shared/search';
import { MIN_QUERY } from '@shared/search';
import type { LiveSession, SessionView, Usage } from '@shared/types';
import { formatTime, initials, previewText } from '../format';
import { useLang, useT } from '../i18n';
import { Logo } from './Logo';
import { avatarStyle } from './backgrounds';
import { ChevronIcon, PanelIcon, PinIcon, SearchIcon } from './icons';
import { SettingsMenu } from './SettingsMenu';
import { UsageMeter } from './UsageMeter';
import type { Language } from '../api';
import { groupActivity, groupByFolder, type SessionGroup } from '../groups';
import { toggleClosedGroup, useClosedGroups, useGroupByProject } from '../prefs';

type Props = {
  connected: SessionView[];
  others: LiveSession[];
  /** The account's rate-limit usage, when `/cc usage on` records it. */
  usage?: Usage;
  /** Version of the hub, shown in the settings menu. */
  hubVersion?: string;
  unread: Record<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onLanguage: (l: Language) => void;
  error?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Opens the new session dialog (spec 2026-11-25-app-batch). */
  onNewSession?: () => void;
  /** Opens the cleanup of stopped background sessions (spec 2026-11-26-stop-respawn-rm). */
  onCleanup?: () => void;
  /** Searches the messages of every conversation (same spec); without it the box filters names only. */
  onSearch?: (q: string) => Promise<SearchHit[]>;
  onOpenHit?: (hit: SearchHit, q: string) => void;
};

/** Pause after the last key before searching the messages. */
export const SEARCH_DEBOUNCE_MS = 300;

const dotColor: Record<SessionView['state'], string> = {
  busy: 'bg-busy',
  idle: 'bg-idle',
  waiting: 'bg-waiting',
  disconnected: 'bg-disconnected',
};

type GroupItem = { group: SessionGroup; open: boolean };

/** Pinned rows, then each group's header followed by its rows when open. */
function groupedItems(sessions: SessionView[], closed: string[]): (SessionView | GroupItem)[] {
  const { pinned, groups } = groupByFolder(sessions);
  const out: (SessionView | GroupItem)[] = [...pinned];
  for (const group of groups) {
    const open = !closed.includes(group.key);
    out.push({ group, open });
    if (open) out.push(...group.sessions);
  }
  return out;
}

function GroupHeader({ item: { group, open }, unread }: { item: GroupItem; unread: Record<string, number> }) {
  const t = useT();
  const act = groupActivity(group, unread);
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        data-group={group.key}
        title={group.path}
        onClick={() => toggleClosedGroup(group.key)}
        className="flex min-h-11 w-full items-center gap-2 px-4 text-left text-sm font-semibold text-muted hover:bg-field"
      >
        <ChevronIcon width={16} height={16} className={`shrink-0 ${open ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1 truncate">
          {group.name} <span className="font-normal">({group.sessions.length})</span>
        </span>
        {!open && act.busy && (
          <>
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full bg-busy" />
            <span className="sr-only">, {t('ui.group.busy')}</span>
          </>
        )}
        {!open && act.agents > 0 && (
          <>
            <span
              aria-hidden="true"
              title={t('ui.panel.agentsWorking', { n: act.agents })}
              className="flex h-5 shrink-0 items-center gap-1 rounded-full border border-busy px-1.5 text-[11px] font-semibold text-busy-text"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-busy" />
              {act.agents}
            </span>
            <span className="sr-only">, {t('ui.panel.agentsWorking', { n: act.agents })}</span>
          </>
        )}
        {!open && act.unread > 0 && (
          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-contrast">
            <span aria-hidden="true">{act.unread > 99 ? '99+' : act.unread}</span>
            <span className="sr-only">, {t('ui.unread', { n: act.unread })}</span>
          </span>
        )}
      </button>
    </li>
  );
}

export function SessionList({ connected, others, usage, hubVersion, unread, selectedId, onSelect, onLanguage, error, collapsed = false, onToggleCollapsed, onNewSession, onCleanup, onSearch, onOpenHit }: Props) {
  const t = useT();
  const lang = useLang();
  const [query, setQuery] = useState('');
  const [showOthers, setShowOthers] = useState(false);
  const q = query.trim().toLowerCase();
  const found = q && !collapsed
    ? connected.filter((s) => s.name.toLowerCase().includes(q) || s.cwd.toLowerCase().includes(q))
    : connected;
  const [hits, setHits] = useState<{ q: string; list: SearchHit[] } | null>(null);
  const deep = q.length >= MIN_QUERY && !collapsed && onSearch ? query.trim() : '';
  useEffect(() => {
    if (!deep || !onSearch) {
      setHits(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      onSearch(deep)
        .then((list) => live && setHits({ q: deep, list }))
        .catch(() => live && setHits({ q: deep, list: [] }));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [deep, onSearch]);
  const shownHits = hits && hits.q === deep ? hits.list : [];
  // Pinned first; the hub's order holds inside each group.
  const rows = [...found.filter((s) => s.pinned), ...found.filter((s) => !s.pinned)];
  // Group by project (spec 2026-11-27-group-by-project): not while searching nor in the icon-only list.
  const groupOn = useGroupByProject();
  const closedGroups = useClosedGroups();
  const items: (SessionView | GroupItem)[] = groupOn && !q && !collapsed ? groupedItems(found, closedGroups) : rows;

  return (
    <div className="flex h-full flex-col bg-surface">
      <header className={`flex items-center gap-2 pb-2 pt-4 ${collapsed ? 'justify-center px-2' : 'px-4'}`}>
        {!collapsed && (
          <>
            <Logo size={32} />
            <h1 className="min-w-0 flex-1 truncate whitespace-nowrap font-display text-lg font-semibold">{t('ui.title')}</h1>
            {onNewSession && (
              <button
                type="button"
                onClick={onNewSession}
                aria-label={t('ui.newSession.open')}
                title={t('ui.newSession.open')}
                className="flex h-11 w-10 shrink-0 items-center justify-center rounded-[10px] text-2xl leading-none text-muted hover:bg-field"
              >
                <span aria-hidden="true">+</span>
              </button>
            )}
            <SettingsMenu onLanguage={onLanguage} usageHint={!usage?.fiveHour} version={hubVersion} onCleanup={onCleanup} />
          </>
        )}
        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? t('ui.expandList') : t('ui.collapseList')}
            title={collapsed ? t('ui.expandList') : t('ui.collapseList')}
            className="hidden h-11 w-10 shrink-0 items-center justify-center rounded-[10px] text-muted hover:bg-field md:flex"
          >
            <PanelIcon width={20} height={20} className={collapsed ? 'rotate-180' : ''} />
          </button>
        )}
      </header>

      {!collapsed && (
        <div className="px-4 py-2">
          <div className="flex h-11 items-center gap-2 rounded-[10px] bg-field px-3 text-muted focus-within:ring-2 focus-within:ring-accent">
            <SearchIcon width={18} height={18} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('ui.search')}
              aria-label={t('ui.search')}
              className="h-full flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
            />
          </div>
        </div>
      )}

      {error && !collapsed && <p className="px-4 py-1 text-xs text-waiting-text">{t('ui.loadError')}</p>}

      <ul className="flex-1 overflow-y-auto">
        {items.map((item) => {
          if ('group' in item) return <GroupHeader key={`group:${item.group.key}`} item={item} unread={unread} />;
          const s = item;
          const selected = s.sessionId === selectedId;
          const n = unread[s.sessionId] ?? 0;
          return (
            <li key={s.sessionId}>
              <button
                type="button"
                data-session={s.sessionId}
                data-state={s.state}
                aria-current={selected || undefined}
                onClick={() => onSelect(s.sessionId)}
                title={collapsed ? s.name : undefined}
                className={`flex min-h-[64px] w-full items-center py-2 text-left ${
                  collapsed ? 'justify-center px-2' : 'gap-3 px-4'
                } ${
                  selected ? 'bg-selected' : 'hover:bg-field'
                }`}
              >
                <span
                  data-avatar
                  className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-avatar text-sm font-semibold text-avatar-text"
                  style={avatarStyle(s.background)}
                >
                  <span aria-hidden="true">{initials(s.name)}</span>
                  <span
                    aria-hidden="true"
                    className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 ${
                      s.state === 'idle' && (s.agentsWorking ?? 0) > 0 ? 'border-busy bg-surface' : `border-surface ${dotColor[s.state]}`
                    }`}
                  />
                  {collapsed && <span className="sr-only">{s.name}. </span>}
                  {collapsed && n > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-contrast">
                      <span aria-hidden="true">{n > 99 ? '99+' : n}</span>
                      <span className="sr-only">{t('ui.unread', { n })}. </span>
                    </span>
                  )}
                  <span className="sr-only">
                    {s.waitingKind === 'question' ? t('ui.question.statusAria') : t(`ui.state.${s.state}`)}
                    {(s.agentsWorking ?? 0) > 0 && s.state !== 'disconnected' ? `, ${t('ui.panel.agentsWorking', { n: s.agentsWorking! })}` : ''}
                  </span>
                </span>
                {!collapsed && (
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="flex-1 truncate text-[15px] font-bold">{s.name}</span>
                    {s.pinned && (
                      <>
                        <PinIcon width={14} height={14} className="shrink-0 text-muted" />
                        <span className="sr-only">{t('ui.pinned')}</span>
                      </>
                    )}
                    {s.lastEvent && (
                      <time dateTime={s.lastEvent.ts} className="shrink-0 text-xs text-muted">{formatTime(s.lastEvent.ts, lang, t)}</time>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={`flex-1 truncate text-sm ${s.state === 'waiting' ? 'text-waiting-text' : 'text-muted'}`}
                    >
                      {previewText(s, t)}
                    </span>
                    {(s.agentsWorking ?? 0) > 0 && s.state !== 'disconnected' && (
                      <span
                        aria-hidden="true"
                        title={t('ui.panel.agentsWorking', { n: s.agentsWorking! })}
                        className="flex h-5 shrink-0 items-center gap-1 rounded-full border border-busy px-1.5 text-[11px] font-semibold text-busy-text"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-busy" />
                        {s.agentsWorking}
                      </span>
                    )}
                    {n > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-contrast">
                        <span aria-hidden="true">{n}</span>
                        <span className="sr-only">{t('ui.unread', { n })}</span>
                      </span>
                    )}
                  </span>
                </span>
                )}
              </button>
            </li>
          );
        })}
        {rows.length === 0 && shownHits.length === 0 && !collapsed && (
          <li className="px-4 py-6 text-sm text-muted">{q ? t('ui.noResults') : t('ui.empty')}</li>
        )}
        {shownHits.length > 0 && (
          <li>
            <p className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">{t('ui.searchMessages')}</p>
            <ul aria-label={t('ui.searchMessages')}>
              {shownHits.map((h) => (
                <li key={`${h.sessionId}:${h.eventId}`}>
                  <button
                    type="button"
                    data-hit={h.eventId}
                    onClick={() => onOpenHit?.(h, deep)}
                    className="flex w-full flex-col gap-0.5 px-4 py-2 text-left hover:bg-field"
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="flex-1 truncate text-sm font-semibold">{h.name}</span>
                      <time dateTime={h.ts} className="shrink-0 text-xs text-muted">{formatTime(h.ts, lang, t)}</time>
                    </span>
                    <span className="line-clamp-2 text-[13px] text-muted">
                      {h.kind === 'user' ? `${t('ui.searchYou')}: ` : ''}
                      {h.snippet}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        )}
      </ul>

      {others.length > 0 && !collapsed && (
        <section className="border-t border-line">
          <button
            type="button"
            aria-expanded={showOthers}
            onClick={() => setShowOthers((o) => !o)}
            className="flex min-h-11 w-full items-center gap-2 px-4 text-sm font-semibold text-muted"
          >
            <ChevronIcon width={16} height={16} className={showOthers ? 'rotate-90' : ''} />
            {t('ui.others', { n: others.length })}
          </button>
          {showOthers && (
            <div className="max-h-64 overflow-y-auto px-4 pb-3">
              <ul>
                {others.map((o) => (
                  <li key={o.sessionId} className="py-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        data-state={o.status}
                        className={`h-2 w-2 shrink-0 rounded-full ${dotColor[o.status]}`}
                      />
                      <span className="truncate text-sm font-semibold">{o.name}</span>
                      <span className="sr-only">{t(`ui.state.${o.status}`)}</span>
                    </div>
                    <div className="truncate font-mono text-xs text-muted">{o.cwd}</div>
                  </li>
                ))}
              </ul>
              <p className="mt-2 rounded-[10px] bg-field p-3 text-xs text-muted">{t('ui.othersHint')}</p>
            </div>
          )}
        </section>
      )}

      <UsageMeter usage={usage} collapsed={collapsed} />
    </div>
  );
}
