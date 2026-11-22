import { useEffect, useRef, useState } from 'react';
import type { Language } from '../api';
import { useLang, useT } from '../i18n';
import { GearIcon } from './icons';

export type NotificationsControl = { supported: boolean; enabled: boolean; onToggle: (on: boolean) => void };

export function SettingsMenu({
  onLanguage,
  notifications,
}: {
  onLanguage: (l: Language) => void;
  notifications?: NotificationsControl;
}) {
  const t = useT();
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

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

  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        aria-label={t('ui.settings')}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-field"
      >
        <GearIcon />
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-10 w-60 rounded-xl border border-line bg-surface p-3 shadow-lg">
          <label className="block text-xs font-semibold text-muted" htmlFor="acc-lang">
            {t('ui.language')}
          </label>
          <select
            id="acc-lang"
            value={lang}
            onChange={(e) => onLanguage(e.target.value as Language)}
            className="mt-1 h-11 w-full rounded-[10px] bg-field px-2 text-sm text-ink"
          >
            <option value="en">English</option>
            <option value="pt-BR">Português (Brasil)</option>
          </select>
          {notifications?.supported && (
            <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={notifications.enabled}
                onChange={(e) => notifications.onToggle(e.target.checked)}
                className="h-4 w-4 accent-accent"
              />
              {t('ui.notifications.enable')}
            </label>
          )}
        </div>
      )}
    </div>
  );
}
