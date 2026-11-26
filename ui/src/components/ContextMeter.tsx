import { useEffect, useId, useRef, useState } from 'react';
import type { ContextUsage } from '@shared/types';
import { useLang, useT } from '../i18n';

// How full the session's context is (spec 2026-11-26-context-quick-replies): a small pie with the percentage in
// the bar under the message field; hover, focus or a tap shows the details.

/** 950 → "950", 124400 → "124k", 1000000 → "1M", 1250000 → "1.3M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  const m = Math.round(n / 100_000) / 10;
  return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
}

type Level = 'normal' | 'warn' | 'danger';
const levelOf = (pct: number): Level => (pct >= 90 ? 'danger' : pct >= 80 ? 'warn' : 'normal');
const LEVEL_CLS: Record<Level, string> = { normal: 'text-muted', warn: 'font-semibold text-waiting-text', danger: 'font-semibold text-danger' };

/** A circle that fills clockwise from the top. */
function Pie({ pct }: { pct: number }) {
  const r = 3.5;
  const c = 2 * Math.PI * r;
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
      <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle
        cx="7"
        cy="7"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={2 * r}
        strokeDasharray={`${(pct / 100) * c} ${c}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}

export function ContextMeter({ context, model }: { context: ContextUsage; model?: string }) {
  const t = useT();
  const lang = useLang();
  const id = useId();
  const [hover, setHover] = useState(false);
  // Opened by a tap or the keyboard: stays until a tap elsewhere, the focus leaves or Escape.
  const [pinned, setPinned] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const open = hover || pinned;

  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setPinned(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pinned]);

  const pct = Math.min(100, Math.max(0, Math.round((context.used / context.size) * 100)));
  const level = levelOf(pct);
  const leftTokens = Math.max(0, context.size - context.used);
  const summary = t('ui.context.summary', { pct }) + (level === 'warn' ? `, ${t('ui.context.warn')}` : level === 'danger' ? `, ${t('ui.context.danger')}` : '');
  const when = (iso: string) => {
    const d = new Date(iso);
    const today = d.toDateString() === new Date().toDateString();
    const time = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const;
    return today ? d.toLocaleTimeString(lang, time) : d.toLocaleString(lang, { day: 'numeric', month: 'short', ...time });
  };

  return (
    <span
      ref={box}
      data-testid="context-meter"
      className="relative inline-flex shrink-0"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        data-level={level}
        aria-label={`${t('ui.context.label')}: ${summary}`}
        aria-describedby={open ? id : undefined}
        onClick={() => setPinned(true)}
        onFocus={() => setPinned(true)}
        onBlur={() => setPinned(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setPinned(false);
            setHover(false);
          }
        }}
        className={`inline-flex h-7 items-center gap-1 rounded-full px-1.5 text-xs tabular-nums hover:bg-field ${LEVEL_CLS[level]}`}
      >
        <Pie pct={pct} />
        <span aria-hidden="true">{pct}%</span>
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute bottom-full right-0 z-30 mb-1.5 flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-xl border border-line bg-surface p-3 text-left text-xs text-muted shadow-lg"
        >
          <span className="text-[13px] font-semibold text-ink">
            {t('ui.context.label')} · {t('ui.context.summary', { pct })}
          </span>
          <span className="text-ink">{t('ui.context.tokens', { used: formatTokens(context.used), size: formatTokens(context.size) })}</span>
          {model && <span>{t('ui.context.model', { model })}</span>}
          <span>{t('ui.context.left', { pct: 100 - pct, tokens: formatTokens(leftTokens) })}</span>
          <span>{t('ui.context.autoCompact')}</span>
          <span>{context.lastCompactAt ? t('ui.context.lastCompact', { time: when(context.lastCompactAt) }) : t('ui.context.noCompact')}</span>
          {!context.exact && <span className="italic">{t('ui.context.estimated')}</span>}
        </span>
      )}
    </span>
  );
}
