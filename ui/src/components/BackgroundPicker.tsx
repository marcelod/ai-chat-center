import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import {
  BACKGROUND_COLORS,
  BACKGROUND_GRADIENTS,
  BACKGROUND_IMAGE_MAX,
  type BackgroundPreset,
  type ChatBackground,
} from '@shared/background';
import { useT } from '../i18n';
import { ApiError } from '../api';
import { COLOR_CSS, GRADIENT_CSS, IMAGE_TYPES } from './backgrounds';

type Props = {
  current?: ChatBackground;
  onSelect: (bg: BackgroundPreset | null) => Promise<void>;
  onUpload: (file: File) => Promise<void>;
  /** Closes the dialog; the caller puts the focus back on the ⋮ button. */
  onClose: () => void;
};

type ErrorKey = 'failed' | 'tooBig' | 'badType';

const errorOf = (e: unknown): ErrorKey =>
  e instanceof ApiError && e.status === 413 ? 'tooBig' : e instanceof ApiError && e.status === 415 ? 'badType' : 'failed';

/**
 * The background picker of a conversation (⋮ menu → Background): preset colours and gradients, an image of
 * up to 5 MB, or none. A modal dialog: Escape or the close button closes it, Tab stays inside.
 */
export function BackgroundPicker({ current, onSelect, onUpload, onClose }: Props) {
  const t = useT();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [busy, setBusy] = useState(false);

  const focusables = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('button') ?? []);

  useLayoutEffect(() => {
    const pressed = panel.current?.querySelector<HTMLElement>('button[aria-pressed="true"]');
    (pressed ?? focusables()[0])?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const list = focusables();
    if (list.length === 0) return;
    const at = list.indexOf(document.activeElement as HTMLElement);
    list[(at + (e.shiftKey ? -1 : 1) + list.length) % list.length].focus();
  };

  const run = async (op: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await op();
      onClose();
    } catch (e) {
      setError(errorOf(e));
    } finally {
      setBusy(false);
    }
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // the same file can be picked again after an error
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) return setError('badType');
    if (file.size > BACKGROUND_IMAGE_MAX) return setError('tooBig');
    void run(() => onUpload(file));
  };

  const isCurrent = (kind: 'color' | 'gradient', value: string) => current?.kind === kind && current.value === value;
  const swatch =
    'h-11 w-full rounded-lg border border-line aria-pressed:ring-2 aria-pressed:ring-accent aria-pressed:ring-offset-2 aria-pressed:ring-offset-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
  const action = 'flex min-h-11 flex-1 items-center justify-center rounded-lg border border-line px-3 text-sm hover:bg-field';

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        onKeyDown={onKeyDown}
        className="w-full max-w-sm rounded-xl border border-line bg-surface p-4 text-ink shadow-lg"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 id={titleId} className="text-base font-semibold">
            {t('ui.background.title')}
          </h3>
          <button
            type="button"
            aria-label={t('ui.background.close')}
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-field"
          >
            <span aria-hidden="true" className="text-xl leading-none">
              ×
            </span>
          </button>
        </div>
        <p id={`${titleId}-c`} className="mb-1.5 text-xs font-semibold text-muted">
          {t('ui.background.colors')}
        </p>
        <div role="group" aria-labelledby={`${titleId}-c`} className="mb-3 grid grid-cols-4 gap-2">
          {BACKGROUND_COLORS.map((id) => (
            <button
              key={id}
              type="button"
              aria-label={t(`ui.background.color.${id}`)}
              title={t(`ui.background.color.${id}`)}
              aria-pressed={isCurrent('color', id)}
              onClick={() => void run(() => onSelect({ kind: 'color', value: id }))}
              className={swatch}
              style={{ backgroundColor: COLOR_CSS[id] }}
            />
          ))}
        </div>
        <p id={`${titleId}-g`} className="mb-1.5 text-xs font-semibold text-muted">
          {t('ui.background.gradients')}
        </p>
        <div role="group" aria-labelledby={`${titleId}-g`} className="mb-4 grid grid-cols-3 gap-2">
          {BACKGROUND_GRADIENTS.map((id) => (
            <button
              key={id}
              type="button"
              aria-label={t(`ui.background.gradient.${id}`)}
              title={t(`ui.background.gradient.${id}`)}
              aria-pressed={isCurrent('gradient', id)}
              onClick={() => void run(() => onSelect({ kind: 'gradient', value: id }))}
              className={swatch}
              style={{ backgroundImage: GRADIENT_CSS[id] }}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" aria-pressed={current?.kind === 'image'} onClick={() => fileInput.current?.click()} className={action}>
            {t('ui.background.image')}
          </button>
          <button type="button" aria-pressed={!current} onClick={() => void run(() => onSelect(null))} className={action}>
            {t('ui.background.none')}
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_TYPES.join(',')}
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          onChange={onFile}
        />
        {error && (
          <p role="alert" className="mt-3 text-sm text-waiting-text">
            {t(`ui.background.${error}`)}
          </p>
        )}
      </div>
    </div>
  );
}
