import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { EFFORTS, MODELS } from './NewSessionDialog';

// Switching the model and the effort of a background session from the app (spec 2026-11-25-app-batch).
// One chip under the message field shows the model and effort in use; it opens the list of models, whose last
// item ("Effort") opens the levels beside it. Each choice types `/model <alias>` or `/effort <level>`.

const statusOf = (e: unknown) => (e as { status?: unknown } | null)?.status;

/** The alias the session's model belongs to ("Opus 5.5", "claude-opus-5-5" → "opus"), if any. */
export function modelAlias(model: string | undefined): string | undefined {
  const m = model?.toLowerCase() ?? '';
  return MODELS.filter(Boolean).find((a) => m.includes(a));
}

type Props = {
  onCommand: (line: string) => Promise<void>;
  /** The session is not idle: the hub types commands only into an idle session, so a choice is kept until then. */
  working: boolean;
  /** Not a background session: the chip only shows the model, nothing can be sent. */
  unavailable?: boolean;
  model?: string;
  effort?: string;
};

export function SessionControls({ onCommand, working, unavailable = false, model, effort }: Props) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ model?: string; effort?: string }>({});
  const [open, setOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const sending = useRef(false);
  const box = useRef<HTMLSpanElement>(null);
  const chip = useRef<HTMLButtonElement>(null);

  const close = (refocus = false) => {
    setOpen(false);
    setEffortOpen(false);
    if (refocus) chip.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const send = async (lines: string[]) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      for (const line of lines) await onCommand(line);
    } catch (e) {
      const s = statusOf(e);
      setError(t(s === 409 ? 'ui.composer.commandBusy' : s === 501 ? 'ui.composer.commandWindows' : 'ui.composer.commandFailed'));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const choose = (kind: 'model' | 'effort', value: string) => {
    close(true);
    if (working) setPending((p) => ({ ...p, [kind]: value }));
    else void send([`/${kind} ${value}`]);
  };
  // The session became idle: apply what was chosen while it worked.
  useEffect(() => {
    if (working || unavailable || (!pending.model && !pending.effort)) return;
    const lines = [...(pending.model ? [`/model ${pending.model}`] : []), ...(pending.effort ? [`/effort ${pending.effort}`] : [])];
    setPending({});
    void send(lines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [working, pending]);

  const currentModel = pending.model ?? modelAlias(model);
  const currentEffort = pending.effort ?? effort;
  const label = [pending.model ?? model ?? t('ui.chat.model'), currentEffort].filter(Boolean).join(' · ');
  const waiting = working && (pending.model || pending.effort);
  const chipCls = 'inline-flex h-7 min-w-0 max-w-[14rem] items-center gap-1 rounded-full border px-2.5 text-xs';
  const item = 'flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-field aria-checked:bg-field';

  return (
    <span ref={box} data-testid="session-controls" className="relative flex min-w-0 items-center gap-1.5">
      {error && (
        <span role="alert" className="truncate text-xs text-danger">
          {error}
        </span>
      )}
      {waiting && <span className="truncate text-[11px] text-muted">{t('ui.chat.switchWhenIdle')}</span>}
      {unavailable ? (
        <span
          title={t('ui.chat.controlsTerminal')}
          aria-label={`${label}. ${t('ui.chat.controlsTerminal')}`}
          className={`${chipCls} border-line bg-field text-muted`}
        >
          <span className="truncate">{label}</span>
        </span>
      ) : (
        <button
          ref={chip}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${t('ui.chat.switchModel')}: ${label}`}
          title={t('ui.chat.switchSavesDefault')}
          disabled={busy}
          onClick={() => (open ? close() : setOpen(true))}
          className={`${chipCls} bg-field text-ink disabled:opacity-50 ${open ? 'border-accent' : 'border-line'}`}
        >
          <span className="truncate">{label}</span>
          <span aria-hidden="true" className="text-[10px] text-muted">
            ▾
          </span>
        </button>
      )}
      {open && (
        <div
          // On a phone the effort list stacks above the model list: side by side they are wider than the screen.
          className="absolute bottom-full right-0 z-30 mb-1.5 flex max-w-[calc(100vw-1rem)] flex-col items-end gap-1 md:flex-row"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              if (effortOpen) setEffortOpen(false);
              else close(true);
            }
          }}
        >
          {effortOpen && (
            <div role="menu" aria-label={t('ui.chat.switchEffort')} className="w-36 rounded-xl border border-line bg-surface p-1.5 shadow-lg">
              {EFFORTS.filter(Boolean).map((e) => (
                <button key={e} type="button" role="menuitemradio" aria-checked={currentEffort === e} onClick={() => choose('effort', e)} className={item}>
                  {e}
                  {currentEffort === e && <span aria-hidden="true" className="text-accent">✓</span>}
                </button>
              ))}
            </div>
          )}
          <div role="menu" aria-label={t('ui.chat.switchModel')} className="w-52 rounded-xl border border-line bg-surface p-1.5 shadow-lg">
            {MODELS.filter(Boolean).map((m) => (
              <button
                key={m}
                type="button"
                role="menuitemradio"
                aria-checked={currentModel === m}
                autoFocus={currentModel === m || (!currentModel && m === MODELS[1])}
                onClick={() => choose('model', m)}
                className={item}
              >
                {m}
                {currentModel === m && <span aria-hidden="true" className="text-accent">✓</span>}
              </button>
            ))}
            <div className="mx-0.5 my-1 border-t border-line" />
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={effortOpen}
              onClick={() => setEffortOpen((o) => !o)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') setEffortOpen(true);
              }}
              className={`${item} ${effortOpen ? 'bg-field' : ''}`}
            >
              <span>
                🧠 {t('ui.chat.switchEffort')}
                {currentEffort ? `: ${currentEffort}` : ''}
              </span>
              <span aria-hidden="true">›</span>
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
