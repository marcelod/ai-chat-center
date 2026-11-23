import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { ChatEvent, SessionView } from '@shared/types';
import { formatTime, initials } from '../format';
import { useLang, useT } from '../i18n';
import type { PendingMessage } from '../useLiveSessions';
import { ActionsGroup } from './ActionsGroup';
import { QuestionCard } from './QuestionCard';
import { Composer } from './Composer';
import { BackIcon, WarningIcon } from './icons';
import { AssistantBubble, FailedBubble, QueuedBubble, UserBubble } from './MessageBubble';

type Props = {
  session: SessionView;
  events: ChatEvent[];
  pending: PendingMessage[];
  loading: boolean;
  onSend: (text: string) => Promise<void>;
  onRetry?: (id: string) => void;
  answersFromApp?: boolean;
  onAnswer?: (toolUseId: string, answers: Record<string, string>) => Promise<void>;
  onRelease?: (toolUseId: string) => Promise<void>;
  onBack: () => void;
};

const NEAR_BOTTOM = 80;

const NOTICE_KEY = {
  connected: 'ui.chat.connectedAt',
  disconnected: 'ui.chat.disconnectedAt',
  compacted: 'ui.chat.compacted',
} as const;

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

export function ChatView({ session, events, pending, loading, onSend, onRetry, onBack, answersFromApp = false, onAnswer, onRelease }: Props) {
  const t = useT();
  const lang = useLang();
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const { state } = session;

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
    <section className="flex h-full min-h-0 flex-col" aria-label={session.name}>
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
          {initials(session.name)}
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{session.name}</h2>
          <p className="truncate font-mono text-xs text-muted">{session.cwd}</p>
        </div>
        <StatusPill state={state} asking={session.waitingKind === 'question'} />
      </header>

      <div
        ref={scroller}
        onScroll={onScroll}
        role="log"
        aria-label={t('ui.chat.messages')}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-page px-4 py-5 md:px-12"
      >
        {loading && events.length === 0 && <p className="self-center text-sm text-muted">{t('ui.chat.loading')}</p>}
        {events.map(render)}
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

      <Composer key={session.sessionId} name={session.name} disabled={state === 'disconnected'}
        blockedByQuestion={Boolean(session.pendingQuestion)} onSend={onSend} />
    </section>
  );
}
