import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ChatEvent, SessionView } from '@shared/types';
import { formatTime, initials } from '../format';
import { useLang, useT } from '../i18n';
import type { PendingMessage } from '../useLiveSessions';
import { ActionsGroup } from './ActionsGroup';
import { QuestionCard } from './QuestionCard';
import { Composer } from './Composer';
import { BackIcon, WarningIcon } from './icons';
import { ChatMenu } from './ChatMenu';
import type { BackgroundPreset } from '@shared/background';
import { BackgroundPicker } from './BackgroundPicker';
import { ChatBackground } from './ChatBackground';
import { AgentBubble, AssistantBubble, ToAgentBubble, FailedBubble, QueuedBubble, UserBubble } from './MessageBubble';

type Props = {
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

export function ChatView({ session, events, pending, loading, onSend, onUpload, onRetry, onBack, answersFromApp = false, onAnswer, onRelease, onRename, onRemove, onPin, onDisconnect, ...bg }: Props) {
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

  const reconciled = new Set(events.flatMap((e) => (e.kind === 'user' && e.appMessageId ? [e.appMessageId] : [])));
  const queued = pending.filter((m) => !reconciled.has(m.id));

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [events, queued.length, state, loading]);

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
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-avatar text-sm font-semibold text-avatar-text">
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
          />
          <div data-testid="session-info" className="flex min-w-0 flex-col overflow-hidden font-mono text-xs text-muted md:flex-row md:items-baseline md:gap-1.5">
            <span className="min-w-0 truncate md:min-w-[6ch]">{session.cwd}</span>
            {(session.branch || session.model || session.effort || session.mode) && (
              <span className="flex min-w-0 gap-x-2 md:shrink-0 md:gap-x-1.5">
                {session.branch && (
                  <InfoPart label={t('ui.chat.branch')} value={session.branch} glyph="⎇ " cls="max-w-[14rem]" />
                )}
                {session.model && <InfoPart label={t('ui.chat.model')} value={session.model} cls="max-w-[9rem]" />}
                {session.effort && <InfoPart label={t('ui.chat.effort')} value={session.effort} glyph="🧠 " cls="max-w-[7rem]" />}
                {session.mode && (
                  <InfoPart label={t('ui.chat.mode')} value={modeLabel(session.mode, t)} glyph={MODE_GLYPH[session.mode] ?? ''} cls="max-w-[10rem]" />
                )}
              </span>
            )}
          </div>
        </div>
        <StatusPill state={state} asking={session.waitingKind === 'question'} />
      </header>

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
        {state === 'waiting' && (
          <div className="flex items-start gap-3 self-stretch rounded-xl border border-banner-border bg-banner-bg p-3.5 text-waiting-text">
            <WarningIcon className="mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold">
                {t(
                  session.waitingKind === 'question'
                    ? 'ui.question.banner'
                    : session.waitingKind === 'input'
                      ? 'ui.chat.waitingInputBanner'
                      : 'ui.chat.waitingBanner',
                )}
              </p>
              {session.waitingKind !== 'input' && session.waitingKind !== 'question' && <p className="mt-0.5 text-[13px]">{t('ui.chat.waitingBannerHint')}</p>}
            </div>
          </div>
        )}
      </div>
      </div>

      <Composer key={session.sessionId} sessionId={session.sessionId} name={session.name} disabled={state === 'disconnected'}
        blockedByQuestion={Boolean(session.pendingQuestion)} onSend={onSend} onUpload={onUpload} />
    </section>
  );
}
