import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ChatEvent, SessionView } from '@shared/types';
import { formatTime, initials } from '../format';
import { avatarStyle } from './backgrounds';
import { useLang, useT } from '../i18n';
import type { PendingMessage } from '../useLiveSessions';
import { ActionsGroup } from './ActionsGroup';
import { QuestionCard } from './QuestionCard';
import { Composer } from './Composer';
import { BackIcon, ChevronIcon, SearchIcon, WarningIcon } from './icons';
import { useFindInChat } from '../useFindInChat';
import { MIN_QUERY } from '@shared/search';
import { ChatMenu } from './ChatMenu';
import type { BackgroundPreset } from '@shared/background';
import { BackgroundPicker } from './BackgroundPicker';
import { ChatBackground } from './ChatBackground';
import { useCommandProgress } from '../useCommandProgress';
import { SessionControls } from './SessionControls';
import { AgentBubble, RecapCard, AssistantBubble, ToAgentBubble, FailedBubble, QueuedBubble, UserBubble } from './MessageBubble';

type Props = {
  /** Version of the hub (the app); a session whose plugin differs is flagged in the header. */
  hubVersion?: string;
  /** Opens the conversation search with this text (a hit picked in the list search). */
  initialSearch?: string;
  session: SessionView;
  events: ChatEvent[];
  pending: PendingMessage[];
  loading: boolean;
  onSend: (text: string) => Promise<void>;
  /** Uploads a file attached in the composer (see Composer). */
  onUpload?: (file: File) => Promise<string>;
  onRetry?: (id: string) => void;
  answersFromApp?: boolean;
  onAnswer?: (toolUseId: string, answers: Record<string, string>) => Promise<void>;
  onRelease?: (toolUseId: string) => Promise<void>;
  onRename?: (name: string) => Promise<{ name: string } | void>;
  /** Removes the session from the app (⋮ menu); rejects when the hub refused. */
  onRemove?: () => Promise<void>;
  /** Pins/unpins the conversation (⋮ menu). */
  onPin?: (pinned: boolean) => Promise<void>;
  /** Disconnects the session from the app, keeping it listed (⋮ menu; only for an active session). */
  onDisconnect?: () => Promise<void>;
  /** Background of the conversation (⋮ menu → Background); absent: no Background item. */
  onSetBackground?: (bg: BackgroundPreset | null) => Promise<void>;
  onUploadBackground?: (file: File) => Promise<void>;
  /** Fetches the background image (with the token) when the background is an image. */
  onLoadBackgroundImage?: () => Promise<Blob>;
  /** Resumes an ended session in the background (spec 2026-11-24-background-sessions); rejects with ApiError. */
  onResume?: () => Promise<void>;
  /** Types a slash command into a background session; rejects with ApiError (409 busy, 501 Windows). */
  onCommand?: (text: string) => Promise<void>;
  /** Opens the system terminal on a background session (`claude attach`); rejects with ApiError. */
  onOpenTerminal?: () => Promise<void>;
  onBack: () => void;
};

const NEAR_BOTTOM = 80;

const NOTICE_KEY = {
  connected: 'ui.chat.connectedAt',
  disconnected: 'ui.chat.disconnectedAt',
  compacted: 'ui.chat.compacted',
} as const;

const KNOWN_MODES = new Set(['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions', 'dontAsk']);
/** The glyphs Claude Code shows in its own footer for these modes. */
const MODE_GLYPH: Record<string, string> = { auto: '⏵⏵ ', acceptEdits: '⏵⏵ ', bypassPermissions: '⏵⏵ ', plan: '⏸ ' };
/** A mode Claude Code adds later is shown as it came. */
function modeLabel(mode: string, t: ReturnType<typeof useT>): string {
  return KNOWN_MODES.has(mode) ? t(`ui.chat.modes.${mode}`) : mode;
}

function InfoPart({ label, value, glyph, cls }: { label: string; value: string; glyph?: string; cls: string }) {
  return (
    <span title={label} aria-label={`${label}: ${value}`} className={`min-w-0 truncate ${cls}`}>
      <span aria-hidden="true" className="hidden md:inline">
        {'· '}
      </span>
      {glyph && <span aria-hidden="true">{glyph}</span>}
      {value}
    </span>
  );
}

/** The session's plugin version, discreet (Claude Code's is in its title); flagged when it differs from the hub's. */
function VersionInfo({ session, hubVersion }: { session: SessionView; hubVersion?: string }) {
  const t = useT();
  const { pluginVersion, claudeVersion } = session;
  if (!pluginVersion) return null;
  const stale = Boolean(hubVersion && pluginVersion !== hubVersion);
  const claude = claudeVersion ? ` · ${t('ui.chat.claudeVersionValue', { v: claudeVersion })}` : '';
  return (
    <span
      data-testid="version-info"
      data-stale={stale ? 'true' : undefined}
      title={(stale ? t('ui.chat.versionOld') : t('ui.chat.pluginVersion')) + claude}
      className={`shrink-0 whitespace-nowrap text-[11px] ${stale ? 'font-semibold text-waiting-text' : 'text-muted'}`}
    >
      {t('ui.chat.pluginVersionValue', { v: pluginVersion })}
      {stale && <span aria-hidden="true"> ↻</span>}
      <span className="sr-only">{stale ? ` · ${t('ui.chat.versionOld')}` : ''}{claude}</span>
    </span>
  );
}

/** Under the message field, right of the keyboard hint: model and effort chip, permission mode, plugin version. */
function SessionBar({ session, hubVersion, runCommand }: { session: SessionView; hubVersion?: string; runCommand?: (line: string) => Promise<void> }) {
  const t = useT();
  const live = session.state !== 'disconnected';
  return (
    <div data-testid="session-bar" className="flex min-w-0 items-center justify-end gap-1.5">
      {live && session.bgId && runCommand && (
        <SessionControls key={session.sessionId} onCommand={runCommand} working={session.state !== 'idle'} model={session.model} effort={session.effort} />
      )}
      {live && !session.bgId && <SessionControls onCommand={async () => {}} working={false} unavailable model={session.model} effort={session.effort} />}
      {session.mode && (
        <span
          title={t('ui.chat.mode')}
          aria-label={`${t('ui.chat.mode')}: ${modeLabel(session.mode, t)}`}
          className="inline-flex h-7 min-w-0 max-w-[10rem] items-center rounded-full border border-line px-2.5 text-xs text-muted"
        >
          <span className="truncate">
            {MODE_GLYPH[session.mode] && <span aria-hidden="true">{MODE_GLYPH[session.mode]}</span>}
            {modeLabel(session.mode, t)}
          </span>
        </span>
      )}
      <VersionInfo session={session} hubVersion={hubVersion} />
    </div>
  );
}

function StatusPill({ state, asking }: { state: SessionView['state']; asking: boolean }) {
  const t = useT();
  const label = asking ? t('ui.question.waiting') : t(`ui.status.${state}`);
  const style: Record<SessionView['state'], string> = {
    busy: 'bg-busy-bg text-busy-text',
    waiting: 'bg-warn-bg text-waiting-text',
    idle: 'bg-field text-muted',
    disconnected: 'bg-field text-muted',
  };
  return (
    <span
      data-state={state}
      className={`ml-auto flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${style[state]}`}
    >
      {state === 'busy' && <span className="h-2 w-2 rounded-full bg-busy" />}
      {state === 'waiting' && <WarningIcon width={14} height={14} />}
      {label}
    </span>
  );
}

const statusOf = (e: unknown): number | undefined => {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : undefined;
};

/** `claude attach <id>` for a background session, with a copy button (spec 2026-11-24-background-sessions). */
function AttachCommand({ id, bullet = true }: { id: string; bullet?: boolean }) {
  const t = useT();
  const cmd = `claude attach ${id}`;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* no clipboard: the command is on screen */
    }
  };
  return (
    <span className="flex min-w-0 items-baseline gap-1 font-mono" data-testid="attach-command">
      {bullet && (
        <span aria-hidden="true" className="hidden md:inline">
          {'· '}
        </span>
      )}
      <span title={t('ui.chat.attach')} className="truncate">
        {cmd}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={t('ui.chat.attachCopy', { cmd })}
        className="rounded px-1 text-accent underline hover:bg-field"
      >
        {copied ? t('ui.chat.attachCopied') : '⧉'}
      </button>
    </span>
  );
}

type TerminalOutcome = 'opened' | 'noTerminal' | 'failed' | 'notBackground' | 'folderMissing';

/** What the hub's refusal of "Open in a terminal" means for the user. */
function terminalOutcome(e: unknown): TerminalOutcome {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === 'folder-missing') return 'folderMissing';
  if (statusOf(e) === 409) return 'notBackground';
  return code === 'no-terminal' ? 'noTerminal' : 'failed';
}

function OpenTerminalButton({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="min-h-11 shrink-0 rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-field"
    >
      {t('ui.chatMenu.openTerminal')}
    </button>
  );
}

/** Offers to resume an ended session in the background; shows the hub's progress and failures. */
function ResumePanel({ session, onResume }: { session: SessionView; onResume: () => Promise<void> }) {
  const t = useT();
  const [sending, setSending] = useState(false);
  const [refused, setRefused] = useState<'running' | 'error' | null>(null);
  const resuming = sending || !!session.resuming;
  const click = async () => {
    if (resuming) return;
    setSending(true);
    setRefused(null);
    try {
      await onResume();
    } catch (e) {
      setRefused(statusOf(e) === 409 ? 'running' : 'error');
    } finally {
      setSending(false);
    }
  };
  return (
    <div data-testid="resume-panel" className="flex flex-wrap items-center gap-3 self-stretch rounded-xl border border-line bg-surface p-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{t('ui.chat.resume.title')}</p>
        <p className="mt-0.5 text-[13px] text-muted">{t('ui.chat.resume.body')}</p>
        {session.resumeError && !resuming && (
          <p role="alert" className="mt-1 text-[13px] text-danger">
            {t('ui.chat.resume.failed', { error: session.resumeError })}
          </p>
        )}
        {refused && (
          <p role="alert" className="mt-1 text-[13px] text-danger">
            {t(refused === 'running' ? 'ui.chat.resume.running' : 'ui.chat.resume.error')}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => void click()}
        disabled={resuming}
        className="min-h-11 shrink-0 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-contrast disabled:opacity-60"
      >
        {resuming ? t('ui.chat.resume.resuming') : t('ui.chat.resume.button')}
      </button>
    </div>
  );
}

function Typing() {
  const t = useT();
  return (
    <div
      data-testid="typing"
      role="status"
      aria-label={t('ui.chat.typing')}
      className="flex items-center gap-1.5 self-start rounded-[14px_14px_14px_4px] border border-line bg-surface px-4 py-3.5"
    >
      {[0, 0.2, 0.4].map((d) => (
        <span key={d} className="typing-dot h-2 w-2 rounded-full bg-idle" style={{ animationDelay: `${d}s` }} />
      ))}
    </div>
  );
}

function SessionTitle({
  session,
  name,
  onRename,
  onRenamed,
  onRemove,
  onPin,
  onDisconnect,
  onSetBackground,
  onUploadBackground,
  onResume,
  onOpenTerminal,
}: {
  session: SessionView;
  name: string;
  onRename?: (name: string) => Promise<{ name: string } | void>;
  onRenamed: (name: string) => void;
  onRemove?: () => Promise<void>;
  onPin?: (pinned: boolean) => Promise<void>;
  onDisconnect?: () => Promise<void>;
  onSetBackground?: (bg: BackgroundPreset | null) => Promise<void>;
  onUploadBackground?: (file: File) => Promise<void>;
  onResume?: () => Promise<void>;
  onOpenTerminal?: () => void;
}) {
  const t = useT();
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);

  const open = () => {
    if (!onRename) return;
    done.current = false;
    setValue(name);
    setFailed(false);
    setEditing(true);
  };
  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
    if (!editing && refocus.current) {
      refocus.current = false;
      menuButton.current?.focus();
    }
  }, [editing]);

  const save = async () => {
    if (done.current) return;
    done.current = true;
    const next = value.trim();
    if (next === name) {
      setEditing(false);
      return;
    }
    try {
      const res = await onRename?.(next);
      if (res && typeof res.name === 'string') onRenamed(res.name);
      refocus.current = true;
      setEditing(false);
    } catch {
      done.current = false;
      setFailed(true);
    }
  };
  const cancel = () => {
    done.current = true;
    refocus.current = true;
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="min-w-0">
        <input
          ref={input}
          value={value}
          maxLength={80}
          aria-label={t('ui.rename.label')}
          aria-invalid={failed || undefined}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
          className="h-11 w-full min-w-0 rounded-lg border border-line bg-field px-2 text-base font-semibold text-text"
        />
        {failed && (
          <p role="alert" className="text-xs text-waiting-text">
            {t('ui.rename.failed')}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-1">
      <h2
        title={session.originalName}
        onClick={open}
        className={`truncate text-base font-semibold ${onRename ? 'cursor-text' : ''}`}
      >
        {name}
      </h2>
      <ChatMenu
        ref={menuButton}
        onRename={onRename ? open : undefined}
        onRemove={onRemove}
        onPin={onPin}
        pinned={!!session.pinned}
        onDisconnect={session.state === 'disconnected' ? undefined : onDisconnect}
        onBackground={onSetBackground && onUploadBackground ? () => setPicking(true) : undefined}
        onResume={session.state === 'disconnected' && !session.resuming ? onResume : undefined}
        onOpenTerminal={onOpenTerminal}
      />
      {picking && onSetBackground && onUploadBackground && (
        <BackgroundPicker
          current={session.background}
          onSelect={onSetBackground}
          onUpload={onUploadBackground}
          onClose={() => {
            setPicking(false);
            menuButton.current?.focus();
          }}
        />
      )}
    </div>
  );
}

export function ChatView({ hubVersion, initialSearch, session, events, pending, loading, onSend, onUpload, onRetry, onBack, answersFromApp = false, onAnswer, onRelease, onRename, onRemove, onPin, onDisconnect, onResume, onCommand, onOpenTerminal, ...bg }: Props) {
  const t = useT();
  const lang = useLang();
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const { state } = session;
  const [override, setOverride] = useState<{ base: string; name: string } | null>(null);
  const shownName = override && override.base === session.name ? override.name : session.name;
  // Once the session moved off the name the override was made on, the override is stale.
  useEffect(() => {
    setOverride((o) => (o && o.base !== session.name ? null : o));
  }, [session.name]);

  const progress = useCommandProgress(session, events);
  // Search in this conversation (spec 2026-11-25-app-batch): null while the search bar is closed.
  const [search, setSearch] = useState<string | null>(initialSearch ?? null);
  const sq = (search ?? '').trim();
  const searching = sq.length >= MIN_QUERY;
  const find = useFindInChat(scroller, search !== null && searching ? sq : null, events);
  const runCommand = onCommand
    ? async (text: string) => {
        await onCommand(text);
        progress.started(text);
      }
    : undefined;

  // "Open in a terminal": only for a background session that is still connected.
  const [terminal, setTerminal] = useState<TerminalOutcome | null>(null);
  useEffect(() => {
    if (terminal !== 'opened') return;
    const timer = setTimeout(() => setTerminal((o) => (o === 'opened' ? null : o)), 6000);
    return () => clearTimeout(timer);
  }, [terminal]);
  const openTerminal =
    onOpenTerminal && session.bgId && state !== 'disconnected'
      ? () => {
          setTerminal(null);
          onOpenTerminal().then(
            () => setTerminal('opened'),
            (e: unknown) => setTerminal(terminalOutcome(e)),
          );
        }
      : undefined;
  // A question Claude Code shows in its own dialog (answers from the app off, or a turn from the terminal).
  const terminalQuestion = state === 'waiting' && session.waitingKind === 'question' && !session.pendingQuestion;

  const reconciled = new Set(events.flatMap((e) => (e.kind === 'user' && e.appMessageId ? [e.appMessageId] : [])));
  const queued = pending.filter((m) => !reconciled.has(m.id));

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [events, queued.length, state, loading, progress.run, terminal]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM;
  };

  const render = (e: ChatEvent): ReactNode => {
    switch (e.kind) {
      case 'user':
        return <UserBubble key={e.id} event={e} />;
      case 'assistant':
        return <AssistantBubble key={e.id} text={e.text} />;
      case 'agent':
        return <AgentBubble key={e.id} event={e} />;
      case 'recap':
        return <RecapCard key={e.id} text={e.text} />;
      case 'toAgent':
        return <ToAgentBubble key={e.id} event={e} />;
      case 'actions':
        return <ActionsGroup key={e.id} items={e.items} />;
      case 'question':
        return (
          <QuestionCard
            key={e.id}
            event={e}
            pending={session.pendingQuestion?.toolUseId === e.toolUseId}
            answersFromApp={answersFromApp}
            onAnswer={(answers) => onAnswer?.(e.toolUseId, answers) ?? Promise.resolve()}
            onRelease={() => onRelease?.(e.toolUseId) ?? Promise.resolve()}
          />
        );
      case 'notice':
        return (
          <p key={e.id} className="self-center rounded-full bg-field px-3 py-1 text-xs text-muted">
            {t(NOTICE_KEY[e.code], {
              time: formatTime(e.ts, lang, t),
            })}
          </p>
        );
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={shownName}>
      <header className="flex items-center gap-3 border-b border-line bg-surface px-3 py-3 md:px-5">
        <button
          type="button"
          aria-label={t('ui.back')}
          onClick={onBack}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-field md:hidden"
        >
          <BackIcon />
        </button>
        <div
          data-avatar
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-avatar text-sm font-semibold text-avatar-text"
          style={avatarStyle(session.background)}
        >
          {initials(shownName)}
        </div>
        <div className="min-w-0">
          <SessionTitle
            session={session}
            name={shownName}
            onRename={onRename}
            onRenamed={(n) => setOverride({ base: session.name, name: n })}
            onRemove={onRemove}
            onPin={onPin}
            onDisconnect={onDisconnect}
            onSetBackground={bg.onSetBackground}
            onUploadBackground={bg.onUploadBackground}
            onResume={onResume}
            onOpenTerminal={openTerminal}
          />
          <div data-testid="session-info" className="flex min-w-0 flex-col overflow-hidden font-mono text-xs text-muted md:flex-row md:items-baseline md:gap-1.5">
            <span className="min-w-0 truncate md:min-w-[6ch]">{session.cwd}</span>
            {session.bgId && state !== 'disconnected' && <AttachCommand id={session.bgId} />}
            {session.branch && (
              <span className="flex min-w-0 md:shrink-0">
                <InfoPart label={t('ui.chat.branch')} value={session.branch} glyph="⎇ " cls="max-w-[14rem]" />
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          aria-label={t('ui.chat.search')}
          title={t('ui.chat.search')}
          aria-pressed={search !== null}
          onClick={() => setSearch((s) => (s === null ? '' : null))}
          className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-field aria-pressed:bg-field"
        >
          <SearchIcon width={18} height={18} />
        </button>
        <StatusPill state={state} asking={session.waitingKind === 'question'} />
      </header>
      {search !== null && (
        <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2 md:px-5">
          <input
            type="search"
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSearch(null);
              else if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) find.previous();
                else find.next();
              }
            }}
            placeholder={t('ui.chat.searchPlaceholder')}
            aria-label={t('ui.chat.search')}
            className="h-10 min-w-0 flex-1 rounded-[10px] bg-field px-3 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
          />
          {searching && (
            <>
              <span role="status" className="shrink-0 text-xs text-muted tabular-nums">
                {find.total > 0 ? t('ui.chat.searchPosition', { i: find.current + 1, n: find.total }) : t('ui.chat.searchNone')}
              </span>
              <button
                type="button"
                aria-label={t('ui.chat.searchPrevious')}
                title={t('ui.chat.searchPrevious')}
                disabled={find.total === 0}
                onClick={find.previous}
                className="flex h-10 w-9 shrink-0 items-center justify-center rounded-[10px] text-muted hover:bg-field disabled:opacity-40"
              >
                <ChevronIcon width={18} height={18} className="-rotate-90" />
              </button>
              <button
                type="button"
                aria-label={t('ui.chat.searchNext')}
                title={t('ui.chat.searchNext')}
                disabled={find.total === 0}
                onClick={find.next}
                className="flex h-10 w-9 shrink-0 items-center justify-center rounded-[10px] text-muted hover:bg-field disabled:opacity-40"
              >
                <ChevronIcon width={18} height={18} className="rotate-90" />
              </button>
            </>
          )}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col bg-page">
      {session.background && <ChatBackground background={session.background} loadImage={bg.onLoadBackgroundImage} />}
      <div
        ref={scroller}
        onScroll={onScroll}
        role="log"
        aria-label={t('ui.chat.messages')}
        className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-5 md:px-12"
      >
        {loading && events.length === 0 && <p className="self-center text-sm text-muted">{t('ui.chat.loading')}</p>}
        {events.map(render)}
        {/* Claude Code writes the AskUserQuestion entry to the transcript only after the tool returns: while the
            hook waits for the app, the card comes from the hub's pending question. */}
        {session.pendingQuestion &&
          !events.some((e) => e.kind === 'question' && e.toolUseId === session.pendingQuestion!.toolUseId) &&
          render({
            kind: 'question',
            id: `pending-${session.pendingQuestion.toolUseId}`,
            ts: session.pendingQuestion.createdAt,
            toolUseId: session.pendingQuestion.toolUseId,
            questions: session.pendingQuestion.questions,
          })}
        {queued.map((m) =>
          m.failed ? (
            <FailedBubble key={m.id} text={m.text} onRetry={() => onRetry?.(m.id)} />
          ) : (
            <QueuedBubble key={m.id} text={m.text} />
          ),
        )}
        {progress.run && (
          <p data-testid="command-progress" role="status" className="self-center rounded-full bg-field px-3 py-1 text-xs text-muted">
            {progress.run.doneAt
              ? `✓ ${t('ui.chat.commandDone', { cmd: progress.run.cmd, time: formatTime(new Date(progress.run.doneAt).toISOString(), lang, t) })}`
              : `⏳ ${t('ui.chat.commandRunning', { cmd: progress.run.cmd })}`}
          </p>
        )}
        {state === 'busy' && <Typing />}
        {session.deliveryStalled && state === 'idle' && (
          <div
            data-testid="delivery-stalled"
            role="status"
            className="flex items-start gap-3 self-stretch rounded-xl border border-banner-border bg-banner-bg p-3.5 text-waiting-text"
          >
            <WarningIcon className="mt-0.5 shrink-0" />
            <p className="text-sm">{t('ui.chat.deliveryStalled')}</p>
          </div>
        )}
        {session.transcriptMissing && state !== 'disconnected' && (
          <div
            data-testid="transcript-missing"
            role="status"
            className="flex items-start gap-3 self-stretch rounded-xl border border-banner-border bg-banner-bg p-3.5 text-waiting-text"
          >
            <WarningIcon className="mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold">{t('ui.chat.transcriptMissing.title')}</p>
              <p className="mt-1 text-sm">{t('ui.chat.transcriptMissing.body')}</p>
            </div>
          </div>
        )}
        {(session.undeliveredUnsigned ?? 0) > 0 && state !== 'disconnected' && (
          <div
            data-testid="undelivered-unsigned"
            role="status"
            className="flex items-start gap-3 self-stretch rounded-xl border border-banner-border bg-banner-bg p-3.5 text-waiting-text"
          >
            <WarningIcon className="mt-0.5 shrink-0" />
            <p className="text-sm">{t('ui.chat.undeliveredUnsigned')}</p>
          </div>
        )}
        {state === 'disconnected' && onResume && <ResumePanel session={session} onResume={onResume} />}
        {state === 'waiting' && (
          <div
            data-testid="waiting-banner"
            className="flex items-start gap-3 self-stretch rounded-xl border border-banner-border bg-banner-bg p-3.5 text-waiting-text"
          >
            <WarningIcon className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {t(
                  terminalQuestion
                    ? 'ui.question.terminalTitle'
                    : session.waitingKind === 'question'
                      ? 'ui.question.banner'
                      : session.waitingKind === 'input'
                        ? 'ui.chat.waitingInputBanner'
                        : 'ui.chat.waitingBanner',
                )}
              </p>
              {session.waitingKind !== 'input' && session.waitingKind !== 'question' && <p className="mt-0.5 text-[13px]">{t('ui.chat.waitingBannerHint')}</p>}
              {terminalQuestion && session.bgId && (
                <p className="mt-0.5 text-[13px]">{t(answersFromApp ? 'ui.question.bgBodyOn' : 'ui.question.bgBody')}</p>
              )}
              {terminalQuestion && !session.bgId && (
                <>
                  <p className="mt-0.5 text-[13px]">{t('ui.question.terminalBody')}</p>
                  {!answersFromApp && <p className="mt-0.5 text-[13px]">{t('ui.question.enableHint')}</p>}
                </>
              )}
              {session.bgId && session.waitingKind !== 'question' && (
                <p className="mt-0.5 text-[13px]">{t('ui.chat.waitingBgHint', { cmd: `claude attach ${session.bgId}` })}</p>
              )}
              {session.bgId && (terminalQuestion || session.waitingKind !== 'question') && (
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px]">
                  {openTerminal && <OpenTerminalButton onOpen={openTerminal} />}
                  {terminalQuestion && <AttachCommand id={session.bgId} bullet={false} />}
                </div>
              )}
            </div>
          </div>
        )}
        {terminal && session.bgId && (
          <p
            data-testid="terminal-outcome"
            role={terminal === 'opened' ? 'status' : 'alert'}
            className={`self-center rounded-full bg-field px-3 py-1 text-xs ${terminal === 'opened' ? 'text-muted' : 'text-danger'}`}
          >
            {t(`ui.chat.terminal.${terminal}`, { cmd: `claude attach ${session.bgId}` })}
          </p>
        )}
      </div>
      </div>

      <Composer key={session.sessionId} sessionId={session.sessionId} name={session.name} disabled={state === 'disconnected'}
        blockedByQuestion={Boolean(session.pendingQuestion)} onSend={onSend} onUpload={onUpload}
        onCommand={session.bgId && state !== 'disconnected' ? runCommand : undefined} attachId={session.bgId} terminalHint={!session.bgId && state !== 'disconnected'}
        controls={<SessionBar session={session} hubVersion={hubVersion} runCommand={runCommand} />} />
    </section>
  );
}
