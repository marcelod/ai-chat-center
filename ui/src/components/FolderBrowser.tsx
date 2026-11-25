import { useEffect, useId, useRef, useState } from 'react';
import type { FolderListing } from '../api';
import { useT } from '../i18n';
import { BackIcon, ChevronIcon } from './icons';

// The folder browser of the "+" dialog (spec 2026-11-25-any-folder): the hub lists the subfolders of a folder
// inside the home folder; up, enter, a path typed or pasted, and "Use this folder".

export type Browse = (path?: string, hidden?: boolean) => Promise<FolderListing>;

type Props = {
  browse: Browse;
  disabled?: boolean;
  onUse: (path: string) => void;
};

const FOLDER_ERRORS: Record<string, string> = {
  'folder-invalid': 'ui.newSession.folderInvalid',
  'folder-outside': 'ui.newSession.folderOutside',
  'folder-not-found': 'ui.newSession.folderNotFound',
  'folder-denied': 'ui.newSession.folderDenied',
};
/** The message key for an error of the hub's folder checks. */
export const folderErrorKey = (e: unknown) => FOLDER_ERRORS[(e as { code?: unknown } | null)?.code as string] ?? 'ui.newSession.browseFailed';

const small = 'min-h-11 rounded-lg px-3 text-sm hover:bg-field disabled:opacity-40';

export function FolderBrowser({ browse, disabled, onUse }: Props) {
  const t = useT();
  const pathId = useId();
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  /** Only the answer to the latest request counts (a slow one never overwrites a newer folder). */
  const seq = useRef(0);

  const go = async (path: string | undefined, showHidden: boolean) => {
    const n = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const l = await browse(path, showHidden);
      if (n !== seq.current) return;
      setListing(l);
      setTyped(l.path);
    } catch (e) {
      if (n === seq.current) setError(t(folderErrorKey(e)));
    } finally {
      if (n === seq.current) setLoading(false);
    }
  };
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    void goRef.current(undefined, false); // opens at the home folder
  }, []);

  const off = disabled || loading;
  const submitPath = () => {
    const p = typed.trim();
    if (p && !off) void go(p, hidden);
  };

  return (
    <div role="group" aria-label={t('ui.newSession.browser')} className="mb-3 rounded-lg border border-line p-2">
      <label htmlFor={pathId} className="block text-xs font-semibold text-muted">
        {t('ui.newSession.pathField')}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id={pathId}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            // Enter goes to the folder typed; it never submits the dialog (starting the session).
            if (e.key === 'Enter') {
              e.preventDefault();
              submitPath();
            }
          }}
          disabled={disabled}
          placeholder={t('ui.newSession.pathPlaceholder')}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="min-h-11 w-full min-w-0 rounded-lg border border-field-border bg-surface px-3 font-mono text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
        <button type="button" onClick={submitPath} disabled={off || !typed.trim()} className={`${small} border border-line`}>
          {t('ui.newSession.go')}
        </button>
      </div>
      <div className="mt-2 flex items-center gap-1">
        <button
          type="button"
          onClick={() => listing?.parent && void go(listing.parent, hidden)}
          disabled={off || !listing?.parent}
          aria-label={t('ui.newSession.up')}
          title={t('ui.newSession.up')}
          className={small}
        >
          <BackIcon className="h-4 w-4 rotate-90" />
        </button>
        <p className="min-w-0 flex-1 truncate font-mono text-xs" title={listing?.path}>
          <span className="sr-only">{t('ui.newSession.current')}: </span>
          {listing?.path ?? ''}
        </p>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
      <ul aria-busy={loading || undefined} className="mt-1 max-h-48 overflow-y-auto">
        {loading && !listing && <li className="px-2 py-2 text-sm text-muted">{t('ui.newSession.loading')}</li>}
        {listing?.entries.map((e) => (
          <li key={e.path}>
            <button
              type="button"
              onClick={() => void go(e.path, hidden)}
              disabled={off}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-field disabled:opacity-60"
            >
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              <ChevronIcon className="h-4 w-4 shrink-0 text-muted" />
            </button>
          </li>
        ))}
        {listing && listing.entries.length === 0 && <li className="px-2 py-2 text-sm text-muted">{t('ui.newSession.empty')}</li>}
      </ul>
      {listing?.truncated && <p className="mt-1 text-xs text-muted">{t('ui.newSession.truncated', { count: listing.entries.length })}</p>}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={hidden}
            disabled={off}
            onChange={(e) => {
              setHidden(e.target.checked);
              void go(listing?.path, e.target.checked);
            }}
          />
          {t('ui.newSession.showHidden')}
        </label>
        <button
          type="button"
          onClick={() => listing && onUse(listing.path)}
          disabled={off || !listing}
          className="min-h-11 rounded-lg border border-accent px-3 text-sm font-semibold text-accent disabled:opacity-40"
        >
          {t('ui.newSession.use')}
        </button>
      </div>
    </div>
  );
}
