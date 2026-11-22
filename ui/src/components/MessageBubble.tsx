import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatEvent } from '@shared/types';
import { formatTime } from '../format';
import { useLang, useT } from '../i18n';
import { ClockIcon, KeyboardIcon, PhoneIcon } from './icons';

type User = Extract<ChatEvent, { kind: 'user' }>;

export function UserBubble({ event }: { event: User }) {
  const t = useT();
  const lang = useLang();
  const label = t(`ui.chat.origin.${event.origin}`);
  const Icon = event.origin === 'app' ? PhoneIcon : KeyboardIcon;
  return (
    <div
      data-bubble="user"
      className="max-w-[560px] self-end rounded-[14px_14px_4px_14px] bg-bubble-user px-3.5 py-2.5 text-[15px]"
    >
      {event.shell ? (
        <p className="whitespace-pre-wrap break-words font-mono text-[14px]">{`! ${event.text}`}</p>
      ) : (
        event.text && <p className="whitespace-pre-wrap break-words">{event.text}</p>
      )}
      {event.images ? (
        <span className="mt-1 inline-block rounded-md bg-field px-2 py-0.5 text-[12px] text-muted">
          {event.images === 1 ? t('ui.chat.image') : t('ui.chat.images', { n: event.images })}
        </span>
      ) : null}
      <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-bubble-meta">
        <span role="img" aria-label={label} title={label} className="flex">
          <Icon width={13} height={13} />
        </span>
        {t(`ui.chat.originWord.${event.origin}`)} · {formatTime(event.ts, lang, t)}
      </p>
    </div>
  );
}

export function QueuedBubble({ text }: { text: string }) {
  const t = useT();
  return (
    <div
      data-bubble="queued"
      className="max-w-[560px] self-end rounded-[14px_14px_4px_14px] border border-dashed border-queued-border bg-queued-bg px-3.5 py-2.5 text-[15px]"
    >
      <p className="whitespace-pre-wrap break-words">{text}</p>
      <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-bubble-meta">
        <ClockIcon width={13} height={13} />
        {t('ui.chat.queued')}
      </p>
    </div>
  );
}

export function FailedBubble({ text, onRetry }: { text: string; onRetry: () => void }) {
  const t = useT();
  return (
    <div
      data-bubble="failed"
      className="max-w-[560px] self-end rounded-[14px_14px_4px_14px] border border-line bg-field px-3.5 py-2.5 text-[15px] text-muted"
    >
      <p className="whitespace-pre-wrap break-words">{text}</p>
      <p className="mt-1 flex items-center justify-end gap-2 text-[11px]">
        {t('ui.chat.notDelivered')}
        <button type="button" onClick={onRetry} className="min-h-11 rounded-lg px-3 text-[12px] font-semibold underline">
          {t('ui.composer.retry')}
        </button>
      </p>
    </div>
  );
}

export function AssistantBubble({ text }: { text: string }) {
  return (
    <div
      data-bubble="assistant"
      className="md max-w-[min(100%,720px)] self-start break-words rounded-[14px_14px_14px_4px] border border-line bg-surface px-3.5 py-2.5 text-[15px] leading-relaxed"
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
