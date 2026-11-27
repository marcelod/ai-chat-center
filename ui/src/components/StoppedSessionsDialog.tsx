import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { StoppedBackground } from '@shared/types';
import { useT } from '../i18n';

// Clean up the background sessions Claude Code still lists but that no longer run (spec
// 2026-11-26-stop-respawn-rm): pick some, confirm in the dialog (never window.confirm), and the hub runs
// `claude rm <id>` for each, one after the other.

type Props = {
  load: () => Promise<StoppedBackground[]>;
  /** Removes one (`claude rm`); rejects with ApiError (code `claude-failed` when claude refused). */
  remove: (bgId: string) => Promise<void>;
  onClose: () => void;
};

type Failure = { bgId: string; text: string };

export function StoppedSessionsDialog({ load, remove, onClose }: Props) {
  const t = useT();
  const titleId = useId();
  const [list, setList] = useState<StoppedBackground[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<Failure[]>([]);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let live = true;
    load()
      .then((l) => live && setList(l))
      .catch(() => live && setLoadError(true));
    return () => {
      live = false;
    };
  }, [load]);
  useEffect(() => closeButton.current?.focus(), []);

  const toggle = (id: string) =>
    setChosen((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const all = list !== null && list.length > 0 && list.every((s) => chosen.has(s.bgId));

  const run = async () => {
    if (busy || !list) return;
    setBusy(true);
    setFailures([]);
    const failed: Failure[] = [];
    const removed = new Set<string>();
    for (const id of [...chosen]) {
      try {
        await remove(id);
        removed.add(id);
      } catch {
        // claude's own words stay in the hub log (they may hold paths).
        failed.push({ bgId: id, text: t('ui.stopped.failed', { name: id }) });
      }
    }
    setList((l) => (l ?? []).filter((s) => !removed.has(s.bgId)));
    setChosen(new Set(failed.map((f) => f.bgId)));
    setFailures(failed);
    setConfirming(false);
    setBusy(false);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !busy) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        onKeyDown={onKeyDown}
        className="flex max-h-full w-full max-w-md flex-col rounded-xl border border-line bg-surface p-4 text-ink shadow-lg"
      >
        <h3 id={titleId} className="mb-1 text-base font-semibold">
          {t('ui.stopped.title')}
        </h3>
        <p className="mb-3 text-sm text-muted">{t('ui.stopped.body')}</p>
        {loadError && (
          <p role="alert" className="mb-2 text-sm text-danger">
            {t('ui.stopped.loadFailed')}
          </p>
        )}
        {!loadError && list === null && <p className="mb-2 text-sm text-muted">{t('ui.stopped.loading')}</p>}
        {list && list.length === 0 && <p className="mb-2 text-sm text-muted">{t('ui.stopped.empty')}</p>}
        {list && list.length > 0 && (
          <>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 border-b border-line text-sm font-semibold">
              <input
                type="checkbox"
                checked={all}
                disabled={busy || confirming}
                onChange={() => setChosen(all ? new Set() : new Set(list.map((s) => s.bgId)))}
                className="h-4 w-4 accent-accent"
              />
              {t('ui.stopped.selectAll')}
            </label>
            <ul className="min-h-0 flex-1 overflow-y-auto py-1">
              {list.map((s) => (
                <li key={s.bgId}>
                  <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg px-1 py-1.5 hover:bg-field">
                    <input
                      type="checkbox"
                      checked={chosen.has(s.bgId)}
                      disabled={busy || confirming}
                      onChange={() => toggle(s.bgId)}
                      className="mt-1 h-4 w-4 shrink-0 accent-accent"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{s.name || t('ui.stopped.unnamed')}</span>
                      <span className="block truncate font-mono text-xs text-muted">
                        {s.bgId}
                        {s.state ? ` · ${s.state}` : ''} · {s.cwd}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        {failures.length > 0 && (
          <div role="alert" className="mt-2 space-y-1 text-sm text-danger">
            {failures.map((f) => (
              <p key={f.bgId} className="break-words">
                {f.text}
              </p>
            ))}
          </div>
        )}
        {confirming ? (
          <div className="mt-3 rounded-lg bg-field p-3">
            <p className="mb-2 text-sm font-semibold text-waiting-text">{chosen.size === 1 ? t('ui.stopped.confirmOne') : t('ui.stopped.confirm', { n: chosen.size })}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="min-h-11 rounded-lg px-4 text-sm hover:bg-surface">
                {t('ui.stopped.confirmBack')}
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => void run()}
                disabled={busy}
                className="min-h-11 rounded-lg border border-danger bg-surface px-4 text-sm font-semibold text-danger disabled:opacity-40"
              >
                {busy ? t('ui.stopped.removing') : t('ui.stopped.confirmYes')}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" ref={closeButton} onClick={onClose} disabled={busy} className="min-h-11 rounded-lg px-4 text-sm hover:bg-field">
              {t('ui.stopped.close')}
            </button>
            {list && list.length > 0 && (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={chosen.size === 0 || busy}
                className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-contrast disabled:opacity-40"
              >
                {t('ui.stopped.remove', { n: chosen.size })}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
