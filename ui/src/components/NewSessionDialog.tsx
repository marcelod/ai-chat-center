import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Folder, NewSessionInput } from '../api';
import { useT } from '../i18n';
import { FolderBrowser, folderErrorKey, type Browse } from './FolderBrowser';

// A new background session from the app (spec 2026-11-25-app-batch): a recent folder or any folder inside the
// home folder picked in the browser (spec 2026-11-25-any-folder), an optional name, model and effort. The hub
// runs `claude --bg … "/ai-chat-center:cc"`.

/** Model aliases offered; '' keeps the default of Claude Code. */
export const MODELS = ['', 'opus', 'sonnet', 'haiku', 'fable'] as const;
export const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
/** The hub's rule (bgSessions.isSessionName). */
export const validName = (v: string) => v === '' || (v.length <= 60 && /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(v) && v.trim() === v);

type Props = {
  loadFolders: () => Promise<Folder[]>;
  browse: Browse;
  onStart: (input: NewSessionInput) => Promise<void>;
  onClose: () => void;
};

const field = 'min-h-11 w-full rounded-lg border border-field-border bg-surface px-3 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';

export function NewSessionDialog({ loadFolders, browse, onStart, onClose }: Props) {
  const t = useT();
  const titleId = useId();
  const [browsing, setBrowsing] = useState(false);
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [cwd, setCwd] = useState('');
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    let live = true;
    loadFolders()
      .then((f) => {
        if (!live) return;
        setFolders(f);
        setCwd((c) => c || (f[0]?.cwd ?? ''));
        if (f.length === 0) setBrowsing(true);
      })
      .catch(() => live && setLoadError(true));
    return () => {
      live = false;
    };
  }, [loadFolders]);
  useEffect(() => {
    if (folders) first.current?.focus();
  }, [folders]);

  /** A folder picked in the browser that is not a recent one: shown first in the list. */
  const picked = cwd && !(folders ?? []).some((f) => f.cwd === cwd) ? cwd : null;
  const options = [...(picked ? [picked] : []), ...(folders ?? []).map((f) => f.cwd)];
  const nameOk = validName(name.trim());
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!cwd || busy || !validName(n)) return;
    setBusy(true);
    setError(null);
    try {
      await onStart({ cwd, ...(n ? { name: n } : {}), ...(model ? { model } : {}), ...(effort ? { effort } : {}) });
      onClose();
    } catch (err) {
      const { detail, code } = (err ?? {}) as { detail?: unknown; code?: unknown };
      if (code === 'untrusted') setError(t('ui.newSession.untrusted', { folder: cwd }));
      else if (typeof code === 'string' && code.startsWith('folder-')) setError(t(folderErrorKey(err)));
      else setError(typeof detail === 'string' && detail ? t('ui.newSession.failedWith', { error: detail }) : t('ui.newSession.failed'));
      setBusy(false);
    }
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
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        onKeyDown={onKeyDown}
        onSubmit={(e) => void submit(e)}
        className="max-h-full w-full max-w-md overflow-y-auto rounded-xl border border-line bg-surface p-4 text-ink shadow-lg"
      >
        <h3 id={titleId} className="mb-1 text-base font-semibold">
          {t('ui.newSession.title')}
        </h3>
        <p className="mb-3 text-sm text-muted">{t('ui.newSession.body')}</p>
        {loadError && (
          <p role="alert" className="mb-2 text-sm text-danger">
            {t('ui.newSession.foldersFailed')}
          </p>
        )}
        {folders && folders.length === 0 && <p className="mb-2 text-sm text-muted">{t('ui.newSession.noFolders')}</p>}
        <label className="mb-3 block text-xs font-semibold text-muted">
          {t('ui.newSession.folder')}
          <select ref={first} value={cwd} onChange={(e) => setCwd(e.target.value)} disabled={!options.length || busy} className={`${field} mt-1 font-mono`}>
            {picked && <option value={picked}>{picked}</option>}
            {(folders ?? []).length > 0 && (
              <optgroup label={t('ui.newSession.recent')}>
                {(folders ?? []).map((f) => (
                  <option key={f.cwd} value={f.cwd}>
                    {f.cwd}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setBrowsing((b) => !b)}
          disabled={busy}
          aria-expanded={browsing}
          className="mb-2 min-h-11 rounded-lg px-3 text-sm text-accent hover:bg-field disabled:opacity-40"
        >
          {browsing ? t('ui.newSession.browseHide') : t('ui.newSession.browse')}
        </button>
        {browsing && (
          <FolderBrowser
            browse={browse}
            disabled={busy}
            onUse={(p) => {
              setCwd(p);
              setBrowsing(false);
              first.current?.focus();
            }}
          />
        )}
        <label className="mb-3 block text-xs font-semibold text-muted">
          {t('ui.newSession.name')}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            disabled={busy}
            placeholder={t('ui.newSession.namePlaceholder')}
            aria-invalid={!nameOk || undefined}
            className={`${field} mt-1`}
          />
          {!nameOk && <span className="mt-1 block font-normal text-danger">{t('ui.newSession.nameInvalid')}</span>}
        </label>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="block text-xs font-semibold text-muted">
            {t('ui.newSession.model')}
            <select value={model} onChange={(e) => setModel(e.target.value)} disabled={busy} className={`${field} mt-1`}>
              {MODELS.map((m) => (
                <option key={m} value={m}>
                  {m || t('ui.newSession.default')}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold text-muted">
            {t('ui.newSession.effort')}
            <select value={effort} onChange={(e) => setEffort(e.target.value)} disabled={busy} className={`${field} mt-1`}>
              {EFFORTS.map((m) => (
                <option key={m} value={m}>
                  {m || t('ui.newSession.default')}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && (
          <p role="alert" className="mb-2 break-words text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="min-h-11 rounded-lg px-4 text-sm hover:bg-field">
            {t('ui.newSession.cancel')}
          </button>
          <button type="submit" disabled={!cwd || busy || !nameOk} className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-contrast disabled:opacity-40">
            {busy ? t('ui.newSession.starting') : t('ui.newSession.start')}
          </button>
        </div>
      </form>
    </div>
  );
}
