// The side panel (spec 2026-11-26-side-panel): right of the conversation on a wide screen, the whole screen
// on a narrow one. Shows a cited file (image, Markdown, code or text, PDF: spec 2026-11-27-side-panel-file-types),
// an edit's diff, the session's subagents and the session screen.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ChatEvent, SubagentInfo, ToolDiff } from '@shared/types';
import { useT } from '../i18n';
import { fileKind } from '../filePaths';
import { FileLinksProvider, useFileLinksContext } from '../fileLinks';
import { BackIcon, CloseIcon } from './icons';
import { MarkdownText } from './Markdown';
import { CodeView } from './CodeView';
import { DiffLines } from './ActionsGroup';
import { saveCodeWrap, useCodeWrap } from '../prefs';

export type PanelItem =
  | { kind: 'file'; path: string; line?: number }
  | { kind: 'diff'; title: string; diff: ToolDiff }
  | { kind: 'subagents' } | { kind: 'subagent'; id: string; title: string } | { kind: 'screen'; cmd?: string; at?: number };

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

/** What a loaded file shows; a Markdown file cited with a line shows its source at that line. */
type FileState =
  | { status: 'loading' }
  | { status: 'error'; key: string }
  | { status: 'image'; url: string }
  | { status: 'markdown'; text: string }
  | { status: 'text'; text: string }
  | { status: 'pdf'; url: string };

/** Whether the bytes start like a PDF (the hub checks too; the blob URL must never hold anything else). */
async function isPdf(blob: Blob): Promise<boolean> {
  return (await blob.slice(0, 5).text()) === '%PDF-';
}

/** A touch screen (a phone, a tablet): their browsers often leave a PDF frame empty. */
function coarsePointer(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

function PdfView({ url, name }: { url: string; name: string }) {
  const t = useT();
  // On a touch screen the links come first, with a hint saying the frame is often empty there.
  const [touch] = useState(coarsePointer);
  const links = (
    <p className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-line px-4 py-2 text-xs text-muted ${touch ? 'border-b' : 'border-t'}`}>
      <span className="min-w-0 flex-1">{t(touch ? 'ui.panel.pdfHintTouch' : 'ui.panel.pdfHint')}</span>
      <a href={url} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline">
        {t('ui.panel.pdfOpenTab')}
      </a>
      <a href={url} download={name} className="font-semibold text-accent underline">
        {t('ui.panel.pdfDownload')}
      </a>
    </p>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {touch && links}
      <iframe title={name} src={url} className="min-h-0 w-full flex-1 border-0 bg-white" />
      {!touch && links}
    </div>
  );
}

function FileView({ path, line, load }: { path: string; line?: number; load: (path: string) => Promise<Blob> }) {
  const t = useT();
  const kind = fileKind(path);
  const links = useFileLinksContext();
  // The loader changes identity on every render of the app: only a new path loads again.
  const loadRef = useRef(load);
  loadRef.current = load;
  const [state, setState] = useState<FileState>({ status: 'loading' });
  const wrap = useCodeWrap();
  const asSource = kind === 'text' || (kind === 'markdown' && line !== undefined);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    setState({ status: 'loading' });
    loadRef.current(path).then(
      async (blob) => {
        if (!alive) return;
        if (kind === 'image' || kind === 'pdf') {
          if (typeof URL.createObjectURL !== 'function') return setState({ status: 'error', key: 'ui.panel.loadFailed' });
          if (kind === 'pdf') {
            if (!(await isPdf(blob))) return alive && setState({ status: 'error', key: 'ui.panel.notAllowed' });
            if (!alive) return;
            // A fixed type: whatever the response said, this URL is only ever shown as a PDF.
            made = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
            return setState({ status: 'pdf', url: made });
          }
          made = URL.createObjectURL(blob);
          setState({ status: 'image', url: made });
        } else {
          const text = await blob.text();
          if (alive) setState({ status: asSource ? 'text' : 'markdown', text });
        }
      },
      (e: unknown) => alive && setState({ status: 'error', key: loadErrorKey(e) }),
    );
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [path, kind, asSource]);

  if (state.status === 'pdf') {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <p className="truncate border-b border-line px-4 py-1.5 font-mono text-xs text-muted" title={path}>
          {path}
        </p>
        <PdfView url={state.url} name={baseName(path)} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-1.5">
        <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted" title={path}>
          {line ? `${path}:${line}` : path}
        </p>
        {state.status === 'text' && (
          <button
            type="button"
            aria-pressed={wrap}
            onClick={() => saveCodeWrap(!wrap)}
            className="shrink-0 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] font-medium text-muted hover:text-ink"
          >
            {wrap ? t('ui.chat.code.noWrap') : t('ui.chat.code.wrap')}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {state.status === 'loading' && <PanelMessage>{t('ui.panel.loading')}</PanelMessage>}
        {state.status === 'error' && <PanelMessage alert>{t(state.key)}</PanelMessage>}
        {state.status === 'image' && (
          <div className="flex min-h-full items-center justify-center p-4">
            <img src={state.url} alt={baseName(path)} className="max-h-full max-w-full rounded-lg object-contain" />
          </div>
        )}
        {state.status === 'text' && (
          <CodeView text={state.text} path={path} line={line} wrap={wrap} label={t('ui.panel.codeOf', { name: baseName(path) })} />
        )}
        {state.status === 'markdown' && (
          // Inside a Markdown file every local link opens in the panel; a missing one says so there.
          <FileLinksProvider value={{ isLinkable: () => true, open: (p, line) => links?.open(p, line) }}>
            <div data-testid="panel-markdown" className="md break-words px-5 py-4 text-[15px] leading-relaxed">
              <MarkdownText text={state.text} linkBase={path} />
            </div>
          </FileLinksProvider>
        )}
      </div>
    </div>
  );
}

/** An edit's diff, whole, in the panel's width. */
function DiffPanel({ title, diff }: { title: string; diff: ToolDiff }) {
  const t = useT();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {title && (
        <p className="truncate border-b border-line px-4 py-1.5 font-mono text-xs text-muted" title={title}>
          {title}
        </p>
      )}
      <div data-testid="panel-diff" className="min-h-0 flex-1 overflow-auto py-2 font-mono text-xs leading-5">
        <div className="min-w-max">
          <DiffLines diff={diff} />
        </div>
        {diff.truncated && <p className="px-2 py-1 text-muted">{t('ui.chat.diffCut')}</p>}
      </div>
    </div>
  );
}

export type SidePanelProps = {
  stack: PanelItem[];
  api: PanelApi;
  onBack: () => void;
  onClose: () => void;
  /** Renders the items other than files and diffs (subagents, screen); null when the panel has nothing for it. */
  renderOther?: (item: Exclude<PanelItem, { kind: 'file' } | { kind: 'diff' }>) => ReactNode;
};

export function panelTitle(item: PanelItem, t: ReturnType<typeof useT>): string {
  switch (item.kind) {
    case 'file':
      return baseName(item.path);
    case 'diff':
      return t('ui.panel.diffTitle', { name: baseName(item.title) });
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
      {item.kind === 'file' ? (
        <FileView key={`${item.path}:${item.line ?? ''}`} path={item.path} line={item.line} load={api.file} />
      ) : item.kind === 'diff' ? (
        <DiffPanel title={item.title} diff={item.diff} />
      ) : (
        renderOther?.(item)
      )}
    </aside>
  );
}
