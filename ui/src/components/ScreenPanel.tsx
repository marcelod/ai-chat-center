// The screen of a background session in the side panel (spec 2026-11-26-side-panel): what `claude logs`
// shows (after /status, /cost or /context, say), cleaned by the hub, as monospaced text. Refreshed on demand.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLang, useT } from '../i18n';
import { formatTime } from '../format';
import { loadErrorKey, PanelMessage } from './SidePanel';

const statusOf = (e: unknown): number | undefined => {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : undefined;
};

function screenErrorKey(e: unknown): string {
  const s = statusOf(e);
  if (s === 409) return 'ui.panel.screenNotBackground';
  if (s === 501) return 'ui.panel.screenWindows';
  return s === 502 ? 'ui.panel.screenFailed' : loadErrorKey(e);
}

export function ScreenView({ load }: { load: () => Promise<string> }) {
  const t = useT();
  const lang = useLang();
  const [state, setState] = useState<{ text?: string; at?: string; error?: string; loading: boolean }>({ loading: true });
  const loadRef = useRef(load);
  loadRef.current = load;
  const box = useRef<HTMLDivElement>(null);
  const refresh = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    loadRef.current().then(
      (text) => setState({ text, at: new Date().toISOString(), loading: false }),
      (e: unknown) => setState((s) => ({ ...s, error: screenErrorKey(e), loading: false })),
    );
  }, []);
  useEffect(refresh, [refresh]);
  useLayoutEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.text]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-1.5 text-xs text-muted">
        <span role="status" className="min-w-0 flex-1 truncate">
          {state.loading ? t('ui.panel.loading') : state.at ? t('ui.panel.updatedAt', { time: formatTime(state.at, lang, t) }) : ''}
        </span>
        <button type="button" onClick={refresh} disabled={state.loading} className="min-h-9 rounded-lg px-3 font-semibold text-accent hover:bg-field disabled:opacity-50">
          {t('ui.panel.refresh')}
        </button>
      </div>
      {state.error && <PanelMessage alert>{t(state.error)}</PanelMessage>}
      <div ref={box} className="min-h-0 flex-1 overflow-auto bg-page">
        {state.text !== undefined && (
          <pre data-testid="session-screen" className="whitespace-pre p-4 font-mono text-[12.5px] leading-snug text-ink">
            {state.text}
          </pre>
        )}
      </div>
    </div>
  );
}
