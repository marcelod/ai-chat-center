import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatEvent } from '@shared/types';
import { formatTime } from '../format';
import { useLang, useT } from '../i18n';
import { splitAttachments } from '@shared/attachments';
import { ClockIcon, KeyboardIcon, PhoneIcon } from './icons';
import { SentAttachments } from './Attachments';

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
      {event.attachments?.length ? <SentAttachments names={event.attachments} /> : null}
      <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-bubble-meta">
        <span role="img" aria-label={label} title={label} className="flex">
          <Icon width={13} height={13} />
        </span>
        {t(`ui.chat.originWord.${event.origin}`)} · {formatTime(event.ts, lang, t)}
      </p>
    </div>
  );
}

export function QueuedBubble({ text: raw }: { text: string }) {
  const t = useT();
  const { text, attachments } = splitAttachments(raw);
  return (
    <div
      data-bubble="queued"
      className="max-w-[560px] self-end rounded-[14px_14px_4px_14px] border border-dashed border-queued-border bg-queued-bg px-3.5 py-2.5 text-[15px]"
    >
      {text && <p className="whitespace-pre-wrap break-words">{text}</p>}
      <SentAttachments names={attachments} />
      <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-bubble-meta">
        <ClockIcon width={13} height={13} />
        {t('ui.chat.queued')}
      </p>
    </div>
  );
}

export function FailedBubble({ text: raw, onRetry }: { text: string; onRetry: () => void }) {
  const t = useT();
  const { text, attachments } = splitAttachments(raw);
  return (
    <div
      data-bubble="failed"
      className="max-w-[560px] self-end rounded-[14px_14px_4px_14px] border border-line bg-field px-3.5 py-2.5 text-[15px] text-muted"
    >
      {text && <p className="whitespace-pre-wrap break-words">{text}</p>}
      <SentAttachments names={attachments} />
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

type Agent = Extract<ChatEvent, { kind: 'agent' }>;
type ToAgent = Extract<ChatEvent, { kind: 'toAgent' }>;

/** Initials and a fixed colour per agent name, so each participant of the "group" is told apart at a glance. */
export function agentIdentity(name: string): { initials: string; color: string } {
  const words = name.split(/[\s_\-./:]+/).filter(Boolean);
  const initials = (words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { initials, color: `hsl(${h % 360} 55% 42%)` };
}

function AgentAvatar({ name }: { name: string }) {
  const { initials, color } = agentIdentity(name);
  return (
    <span
      aria-hidden="true"
      data-avatar
      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
      style={{ backgroundColor: color }}
    >
      {initials}
    </span>
  );
}

function MarkdownText({ text }: { text: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
      }}
    >
      {text}
    </Markdown>
  );
}

/** A teammate's or subagent's message: on the Claude side, with the agent's avatar and name. */
export function AgentBubble({ event }: { event: Agent }) {
  const t = useT();
  const name = event.from || t('ui.chat.agent');
  return (
    <div data-bubble="agent" className="flex max-w-[min(100%,760px)] items-start gap-2 self-start">
      <AgentAvatar name={name} />
      <div className="md min-w-0 break-words rounded-[14px_14px_14px_4px] border border-line bg-field px-3.5 py-2.5 text-[15px] leading-relaxed">
        <p className="mb-1 text-xs font-semibold" style={{ color: agentIdentity(name).color }}>
          {event.from ? t('ui.chat.agentFrom', { name: event.from }) : t('ui.chat.agent')}
        </p>
        <MarkdownText text={event.text} />
      </div>
    </div>
  );
}

const CLAMP = 280;

/** What Claude asked an agent: "Claude → name", the request clamped with a toggle to read it all. */
export function ToAgentBubble({ event }: { event: ToAgent }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const long = event.text.length > CLAMP;
  const shown = open || !long ? event.text : `${event.text.slice(0, CLAMP).trimEnd()}…`;
  const name = event.to || t('ui.chat.agent');
  return (
    <div
      data-bubble="toAgent"
      className="md max-w-[min(100%,720px)] self-start break-words rounded-[14px_14px_14px_4px] border border-dashed border-line px-3.5 py-2 text-sm leading-relaxed text-muted"
    >
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
        <span>{t('ui.chat.toAgent')}</span>
        <AgentAvatarSmall name={name} />
        <span style={{ color: agentIdentity(name).color }}>{name}</span>
      </p>
      <MarkdownText text={shown} />
      {long && (
        <button type="button" className="mt-1 text-xs font-semibold underline" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? t('ui.chat.showLess') : t('ui.chat.showAll')}
        </button>
      )}
    </div>
  );
}

function AgentAvatarSmall({ name }: { name: string }) {
  const { initials, color } = agentIdentity(name);
  return (
    <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white" style={{ backgroundColor: color }}>
      {initials}
    </span>
  );
}
