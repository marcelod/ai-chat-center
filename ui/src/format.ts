import type { ChatEvent, SessionView } from '@shared/types';
import type { Language } from './api';
import type { T } from './i18n';

export function initials(name: string): string {
  const parts = name.split(/[\s\-_./]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function formatTime(iso: string, lang: Language, t: T, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  if (days === 1) return t('ui.yesterday');
  if (days <= 6) return d.toLocaleDateString(lang, { weekday: 'short' });
  return d.toLocaleDateString(lang, { day: 'numeric', month: 'short' });
}

function eventPreview(e: ChatEvent | undefined, t: T): string {
  if (!e) return t('ui.noMessages');
  switch (e.kind) {
    case 'user':
      return `${t('ui.you')}: ${e.text}`;
    case 'assistant':
      return e.text;
    case 'actions':
      return e.items[e.items.length - 1]?.summary ?? '';
    case 'notice':
      return t(`ui.notice.${e.code}`);
  }
}

export function previewText(s: SessionView, t: T): string {
  if (s.state === 'waiting') return t('ui.waiting');
  if (s.state === 'disconnected') return t('ui.disconnected');
  return eventPreview(s.lastEvent, t).replace(/\s+/g, ' ').trim();
}
