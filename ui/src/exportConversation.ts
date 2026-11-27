// Export of a conversation (spec 2026-11-27-export-conversation): the whole list of events the app holds,
// turned into a small document model, then into Markdown (download) or a print view (Save as PDF). Every
// string goes through the same redaction as the session screen, so no app link, token or key leaves.
import type { ChatEvent, SessionView } from '@shared/types';
import { redactAppSecrets, stripAppBlocks, stripTerminalCodes } from '@shared/redact';
import type { T } from './i18n';

export type ExportRole = 'user' | 'claude' | 'agent' | 'recap';
export type ExportItem =
  | { kind: 'message'; role: ExportRole; author: string; ts: string; text: string; notes: string[] }
  | { kind: 'actions'; ts: string; lines: { name: string; summary: string }[] }
  | { kind: 'notice'; ts: string; text: string };

export type ExportDoc = {
  title: string;
  folder: string;
  branch?: string;
  exportedAt: Date;
  items: ExportItem[];
};

const SUMMARY_MAX = 200;

/** Text that may leave the app: app blocks reduced to their body, terminal codes, links and secrets out. */
export function cleanExportText(s: string): string {
  return redactAppSecrets(stripTerminalCodes(stripAppBlocks(s)));
}

const oneLine = (s: string) => {
  const l = cleanExportText(s).replace(/\s+/g, ' ').trim();
  return l.length > SUMMARY_MAX ? `${l.slice(0, SUMMARY_MAX - 1)}…` : l;
};

const pad = (n: number) => String(n).padStart(2, '0');
/** Local day (`YYYY-MM-DD`) and time (`HH:MM`) of a date; empty strings when it is invalid. */
export function stamp(d: Date): { day: string; time: string } {
  if (Number.isNaN(d.getTime())) return { day: '', time: '' };
  return { day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** Inline code that survives backticks inside: a longer fence, with spaces when the text starts or ends with one. */
export function inlineCode(s: string): string {
  const longest = Math.max(0, ...(s.match(/`+/g) ?? []).map((r) => r.length));
  const fence = '`'.repeat(longest + 1);
  const padded = s.startsWith('`') || s.endsWith('`') ? ` ${s} ` : s;
  return `${fence}${padded}${fence}`;
}

/** The document model of a conversation: what both the Markdown and the print view show. */
export function buildExport(session: SessionView, events: ChatEvent[], t: T, now: Date): ExportDoc {
  const items: ExportItem[] = [];
  const message = (role: ExportRole, author: string, ts: string, text: string, notes: string[] = []) =>
    items.push({ kind: 'message', role, author: cleanExportText(author), ts, text: cleanExportText(text).trim(), notes });
  for (const e of events) {
    switch (e.kind) {
      case 'user': {
        const notes: string[] = [];
        if (e.attachments?.length) notes.push(t('ui.export.attachments') + ': ' + e.attachments.map(oneLine).join(', '));
        if (e.images) notes.push(t('ui.export.images', { n: e.images }));
        const text = e.shell ? inlineCode(`! ${oneLine(e.text)}`) : e.text;
        message('user', t('ui.you'), e.ts, text, notes);
        break;
      }
      case 'assistant':
        message('claude', t('ui.export.claude'), e.ts, e.text);
        break;
      case 'toAgent':
        message('claude', e.to ? t('ui.export.toAgent', { name: e.to }) : t('ui.chat.toAgent'), e.ts, e.text);
        break;
      case 'agent':
        message('agent', e.from ? t('ui.chat.agentFrom', { name: e.from }) : t('ui.chat.agent'), e.ts, e.text);
        break;
      case 'recap':
        message('recap', t('ui.chat.recap'), e.ts, e.text);
        break;
      case 'actions': {
        const lines = e.items.map((i) => ({ name: oneLine(i.name), summary: oneLine(i.summary) }));
        const last = items.at(-1);
        if (last?.kind === 'actions') last.lines.push(...lines);
        else items.push({ kind: 'actions', ts: e.ts, lines });
        break;
      }
      case 'question': {
        const text = e.questions
          .map((q) => {
            const head = q.header ? `**${q.header}:** ${q.question}` : q.question;
            const opts = q.options.map((o) => `- ${o.label}`).join('\n');
            return opts ? `${head}\n\n${opts}` : head;
          })
          .join('\n\n');
        message('claude', t('ui.export.claude'), e.ts, text);
        const answer = e.answerText ?? (e.answers ? Object.values(e.answers).join('\n') : '');
        if (!e.error && answer.trim()) message('user', t('ui.you'), e.ts, answer);
        break;
      }
      case 'notice':
        items.push({ kind: 'notice', ts: e.ts, text: t(`ui.notice.${e.code}`) });
        break;
    }
  }
  return {
    title: oneLine(session.name) || t('ui.export.untitled'),
    folder: oneLine(session.cwd),
    branch: session.branch ? oneLine(session.branch) : undefined,
    exportedAt: now,
    items,
  };
}

/** The conversation as a Markdown file: a header, a heading per day, each message with its author and time. */
export function exportMarkdown(doc: ExportDoc, t: T): string {
  const out: string[] = [`# ${doc.title}`, ''];
  out.push(`- **${t('ui.export.folder')}:** ${inlineCode(doc.folder)}`);
  if (doc.branch) out.push(`- **${t('ui.export.branch')}:** ${inlineCode(doc.branch)}`);
  const ex = stamp(doc.exportedAt);
  out.push(`- **${t('ui.export.exportedAt')}:** ${ex.day} ${ex.time}`, '', '---');
  let day = '';
  for (const it of doc.items) {
    const s = stamp(new Date(it.ts));
    if (s.day && s.day !== day) {
      day = s.day;
      out.push('', `## ${day}`);
    }
    const time = s.time ? ` · ${s.time}` : '';
    out.push('');
    if (it.kind === 'notice') out.push(`_${it.text}${time}_`);
    else if (it.kind === 'actions') out.push(it.lines.map((l) => (l.summary ? `- ${l.name} ${inlineCode(l.summary)}` : `- ${l.name}`)).join('\n'));
    else {
      out.push(`**${it.author}**${time}`);
      if (it.text) out.push('', it.text);
      for (const n of it.notes) out.push('', `_${n}_`);
    }
  }
  return out.join('\n') + '\n';
}

const NAME_MAX = 80;

/** `<session name>-<YYYY-MM-DD>.<ext>`, with the name safe as a file name on every system. */
export function exportFileName(name: string, now: Date, ext: 'md' | 'pdf', t: T): string {
  const safe = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\x00-\x1f\x7f]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, NAME_MAX)
    .replace(/[-.]+$/, '');
  return `${safe || t('ui.export.untitled')}-${stamp(now).day}.${ext}`;
}
