import { useEffect, useRef, useState } from 'react';
import type { Usage, UsageWindow } from '@shared/types';
import { useLang, useT, type T } from '../i18n';

/** "2h38" or "45 min" until `iso`; null once it has passed. */
export function timeLeft(iso: string, t: T, now = Date.now()): string | null {
  const mins = Math.ceil((Date.parse(iso) - now) / 60_000);
  if (!(mins > 0)) return null;
  if (mins < 60) return t('ui.usage.minutes', { m: mins });
  return t('ui.usage.hours', { h: Math.floor(mins / 60), m: String(mins % 60).padStart(2, '0') });
}

/** A window whose reset time has passed restarted at 0%: the recorded value is from before it. */
const current = (w: UsageWindow, now: number) => (Date.parse(w.resetsAt) <= now ? null : w);

function Bar({ pct }: { pct: number }) {
  return (
    <span aria-hidden="true" className="block h-1.5 w-full overflow-hidden rounded-full bg-field">
      <span className={`block h-full rounded-full ${pct >= 80 ? 'bg-waiting' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
    </span>
  );
}

/** The account's 5-hour usage at the bottom of the conversation list; a click opens the details. */
export function UsageMeter({ usage, collapsed = false }: { usage?: Usage; collapsed?: boolean }) {
  const t = useT();
  const lang = useLang();
  const [now, setNow] = useState(Date.now);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  if (!usage?.fiveHour) return null;
  const five = current(usage.fiveHour, now);
  const pct = five ? Math.round(five.usedPercentage) : 0;
  const left = five ? timeLeft(five.resetsAt, t, now) : null;
  const summary = five && left ? t('ui.usage.summary', { pct, left }) : t('ui.usage.restarted');
  const clock = (iso: string) => new Date(iso).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  const day = (iso: string) => new Date(iso).toLocaleString(lang, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const seven = usage.sevenDay && current(usage.sevenDay, now);

  return (
    <div ref={root} className="relative border-t border-line">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${t('ui.usage.label')}: ${summary}`}
        title={collapsed ? `${t('ui.usage.label')}: ${summary}` : undefined}
        onClick={() => setOpen((o) => !o)}
        className={`flex min-h-11 w-full flex-col justify-center gap-1 py-2 text-left hover:bg-field ${collapsed ? 'items-center px-2' : 'px-4'}`}
      >
        {collapsed ? (
          <span aria-hidden="true" className="text-xs font-semibold text-muted">{pct}%</span>
        ) : (
          <>
            <span aria-hidden="true" className="flex w-full items-baseline justify-between gap-2 text-xs">
              <span className="font-semibold text-muted">{t('ui.usage.label')}</span>
              <span className="text-muted">{summary}</span>
            </span>
            <Bar pct={pct} />
          </>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t('ui.usage.label')}
          className={`absolute bottom-full z-10 mb-2 w-64 rounded-xl border border-line bg-surface p-3 text-sm shadow-lg ${collapsed ? 'left-2' : 'left-4'}`}
        >
          <p className="text-xs font-semibold text-muted">{t('ui.usage.fiveHour')}</p>
          <p className="mt-1 font-semibold">{t('ui.usage.used', { pct })}</p>
          <div className="mt-1"><Bar pct={pct} /></div>
          <p className="mt-1 text-xs text-muted">
            {five && left ? t('ui.usage.resetsAt', { time: clock(five.resetsAt), left }) : t('ui.usage.restarted')}
          </p>
          {seven && (
            <>
              <p className="mt-3 text-xs font-semibold text-muted">{t('ui.usage.sevenDay')}</p>
              <p className="mt-1 font-semibold">{t('ui.usage.used', { pct: Math.round(seven.usedPercentage) })}</p>
              <div className="mt-1"><Bar pct={Math.round(seven.usedPercentage)} /></div>
              <p className="mt-1 text-xs text-muted">{t('ui.usage.resetsOn', { time: day(seven.resetsAt) })}</p>
            </>
          )}
          <p className="mt-3 text-xs text-muted">{t('ui.usage.updated', { time: clock(usage.updatedAt) })}</p>
        </div>
      )}
    </div>
  );
}
