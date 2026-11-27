// The side panel (spec 2026-11-26-side-panel): right of the conversation on a wide screen, the whole screen
// on a narrow one. Shows a cited file (image or Markdown), the session's subagents and the session screen.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ChatEvent, SubagentInfo } from '@shared/types';
import { useT } from '../i18n';
import { fileKind } from '../filePaths';
import { FileLinksProvider, useFileLinksContext } from '../fileLinks';
import { BackIcon, CloseIcon } from './icons';
import { MarkdownText } from './Markdown';

export type PanelItem = { kind: 'file'; path: string } | { kind: 'subagents' } | { kind: 'subagent'; id: string; title: string } | { kind: 'screen'; cmd?: string; at?: number };

/** What the panel loads, bound to the open session. */
export type PanelApi = {
  file: (path: string) => Promise<Blob>;
  filesExist?: (paths: string[]) => Promise<string[]>;
  subagents?: () => Promise<SubagentInfo[]>;
  subagentEvents?: (id: string) => Promise<ChatEvent[]>;
  screen?: () => Promise<string>;
};

const statusOf = (e: unknown): number | undefined => {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : undefined;
};

/** The reason a load failed, as a message key. */
export function loadErrorKey(e: unknown): string {
  const s = statusOf(e);
  if (s === 404) return 'ui.panel.notFound';
  if (s === 413) return 'ui.panel.tooLarge';
  if (s === 403 || s === 415) return 'ui.panel.notAllowed';
  return 'ui.panel.loadFailed';
}

const baseName = (p: string) => p.split('/').filter(Boolean).pop() ?? p;

export function PanelMessage({ children, alert }: { children: ReactNode; alert?: boolean }) {
  return (
    <p role={alert ? 'alert' : 'status'} className={`p-4 text-sm ${alert ? 'text-danger' : 'text-muted'}`}>
      {children}
    </p>
  );
}

function FileView({ path, load }: { path: string; load: (path: string) => Promise<Blob> }) {
  const t = useT();
  const kind = fileKind(path);
  const links = useFileLinksContext();
  // The loader changes identity on every render of the app: only a new path loads again.
  const loadRef = useRef(load);
  loadRef.current = load;
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; key: string } | { status: 'image'; url: string } | { status: 'markdown'; text: string }>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    setState({ status: 'loading' });
    loadRef.current(path).then(
      async (blob) => {
        if (!alive) return;
        if (kind === 'image') {
          if (typeof URL.createObjectURL !== 'function') return setState({ status: 'error', key: 'ui.panel.loadFailed' });
          made = URL.createObjectURL(blob);
          setState({ status: 'image', url: made });
        } else {
          const text = await blob.text();
          if (alive) setState({ status: 'markdown', text });
        }
      },
      (e: unknown) => alive && setState({ status: 'error', key: loadErrorKey(e) }),
    );
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [path, kind]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="truncate border-b border-line px-4 py-1.5 font-mono text-xs text-muted" title={path}>
        {path}
      </p>
      <div className="min-h-0 flex-1 overflow-auto">
        {state.status === 'loading' && <PanelMessage>{t('ui.panel.loading')}</PanelMessage>}
        {state.status === 'error' && <PanelMessage alert>{t(state.key)}</PanelMessage>}
        {state.status === 'image' && (
          <div className="flex min-h-full items-center justify-center p-4">
            <img src={state.url} alt={baseName(path)} className="max-h-full max-w-full rounded-lg object-contain" />
          </div>
        )}
        {state.status === 'markdown' && (
          // Inside a Markdown file every local link opens in the panel; a missing one says so there.
          <FileLinksProvider value={{ isLinkable: () => true, open: (p) => links?.open(p) }}>
            <div data-testid="panel-markdown" className="md break-words px-5 py-4 text-[15px] leading-relaxed">
              <MarkdownText text={state.text} linkBase={path} />
            </div>
          </FileLinksProvider>
        )}
      </div>
    </div>
  );
}

export type SidePanelProps = {
  stack: PanelItem[];
  api: PanelApi;
  onBack: () => void;
  onClose: () => void;
  /** Renders the items other than files (subagents, screen); null when the panel has nothing for it. */
  renderOther?: (item: Exclude<PanelItem, { kind: 'file' }>) => ReactNode;
};

export function panelTitle(item: PanelItem, t: ReturnType<typeof useT>): string {
  switch (item.kind) {
    case 'file':
      return baseName(item.path);
    case 'subagents':
      return t('ui.panel.subagents');
    case 'subagent':
      return item.title;
    case 'screen':
      return t('ui.panel.screen');
  }
}

export function SidePanel({ stack, api, onBack, onClose, renderOther }: SidePanelProps) {
  const t = useT();
  const item = stack[stack.length - 1];
  const close = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    close.current?.focus();
  }, [stack.length]);
  if (!item) return null;
  return (
    <aside
      data-testid="side-panel"
      aria-label={t('ui.panel.label')}
      className="fixed inset-0 z-40 flex min-h-0 flex-col bg-surface md:static md:z-auto md:w-[min(48%,640px)] md:shrink-0 md:border-l md:border-line"
    >
      <header className="flex items-center gap-2 border-b border-line px-2 py-2 md:px-3">
        <button
          type="button"
          aria-label={t('ui.back')}
          onClick={onBack}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-field ${stack.length > 1 ? '' : 'md:hidden'}`}
        >
          <BackIcon />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{panelTitle(item, t)}</h2>
        <button
          ref={close}
          type="button"
          aria-label={t('ui.panel.close')}
          title={t('ui.panel.close')}
          onClick={onClose}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-field"
        >
          <CloseIcon width={18} height={18} />
        </button>
      </header>
      {item.kind === 'file' ? <FileView key={item.path} path={item.path} load={api.file} /> : renderOther?.(item)}
    </aside>
  );
}
