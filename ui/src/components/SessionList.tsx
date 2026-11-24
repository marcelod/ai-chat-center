import { useState } from 'react';
import type { LiveSession, SessionView, Usage } from '@shared/types';
import { formatTime, initials, previewText } from '../format';
import { useLang, useT } from '../i18n';
import { Logo } from './Logo';
import { ChevronIcon, PanelIcon, PinIcon, SearchIcon } from './icons';
import { SettingsMenu, type NotificationsControl } from './SettingsMenu';
import { UsageMeter } from './UsageMeter';
import type { Language } from '../api';

type Props = {
  connected: SessionView[];
  others: LiveSession[];
  /** The account's rate-limit usage, when `/cc usage on` records it. */
  usage?: Usage;
  unread: Record<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onLanguage: (l: Language) => void;
  error?: boolean;
  notifications?: NotificationsControl;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
};

const dotColor: Record<SessionView['state'], string> = {
  busy: 'bg-busy',
  idle: 'bg-idle',
  waiting: 'bg-waiting',
  disconnected: 'bg-disconnected',
};

export function SessionList({ connected, others, usage, unread, selectedId, onSelect, onLanguage, error, notifications, collapsed = false, onToggleCollapsed }: Props) {
  const t = useT();
  const lang = useLang();
  const [query, setQuery] = useState('');
  const [showOthers, setShowOthers] = useState(false);
  const q = query.trim().toLowerCase();
  const found = q && !collapsed
    ? connected.filter((s) => s.name.toLowerCase().includes(q) || s.cwd.toLowerCase().includes(q))
    : connected;
  // Pinned first; the hub's order holds inside each group.
  const rows = [...found.filter((s) => s.pinned), ...found.filter((s) => !s.pinned)];

  return (
    <div className="flex h-full flex-col bg-surface">
      <header className={`flex items-center gap-3 pb-2 pt-4 ${collapsed ? 'justify-center px-2' : 'px-4'}`}>
        {!collapsed && (
          <>
            <Logo size={34} />
            <h1 className="flex-1 font-display text-xl font-semibold">{t('ui.title')}</h1>
            <SettingsMenu onLanguage={onLanguage} notifications={notifications} usageHint={!usage?.fiveHour} />
          </>
        )}
        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? t('ui.expandList') : t('ui.collapseList')}
            title={collapsed ? t('ui.expandList') : t('ui.collapseList')}
            className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-muted hover:bg-field md:flex"
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
        {rows.map((s) => {
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
                <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-avatar text-sm font-semibold text-avatar-text">
                  <span aria-hidden="true">{initials(s.name)}</span>
                  <span
                    aria-hidden="true"
                    className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface ${dotColor[s.state]}`}
                  />
                  {collapsed && <span className="sr-only">{s.name}. </span>}
                  {collapsed && n > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-contrast">
                      <span aria-hidden="true">{n > 99 ? '99+' : n}</span>
                      <span className="sr-only">{t('ui.unread', { n })}. </span>
                    </span>
                  )}
                  <span className="sr-only">{s.waitingKind === 'question' ? t('ui.question.statusAria') : t(`ui.state.${s.state}`)}</span>
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
        {rows.length === 0 && !collapsed && (
          <li className="px-4 py-6 text-sm text-muted">{q ? t('ui.noResults') : t('ui.empty')}</li>
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
