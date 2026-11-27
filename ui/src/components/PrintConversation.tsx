import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatEvent, SessionView } from '@shared/types';
import { buildExport, exportFileName, exportMarkdown, stamp, type ExportDoc } from '../exportConversation';
import { translate, type T } from '../i18n';
import type { Language } from '../api';

export type ExportFormat = 'md' | 'pdf';

/** Markdown for print: GitHub flavour, no raw HTML, no image loaded (its text instead). */
function PrintMarkdown({ text }: { text: string }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: ({ alt }) => <span className="img">{`🖼 ${alt ?? ''}`}</span> }}>
      {text}
    </Markdown>
  );
}

/** The conversation as a page to print (light, plain): the same content as the Markdown export. */
export function PrintConversation({ doc, t }: { doc: ExportDoc; t: T }) {
  const ex = stamp(doc.exportedAt);
  let day = '';
  return (
    <article>
      <h1>{doc.title}</h1>
      <p className="meta">
        {t('ui.export.folder')}: <code>{doc.folder}</code>
        {doc.branch && (
          <>
            {' · '}
            {t('ui.export.branch')}: <code>{doc.branch}</code>
          </>
        )}
        {' · '}
        {t('ui.export.exportedAt')}: {ex.day} {ex.time}
      </p>
      {doc.items.map((it, i) => {
        const s = stamp(new Date(it.ts));
        const heading = s.day && s.day !== day ? (day = s.day) : null;
        return (
          <section key={i}>
            {heading && <h2 className="day">{heading}</h2>}
            {it.kind === 'notice' && (
              <p className="notice">
                {it.text}
                {s.time && ` · ${s.time}`}
              </p>
            )}
            {it.kind === 'actions' && (
              <ul className="actions">
                {it.lines.map((l, j) => (
                  <li key={j}>
                    {l.name} {l.summary && <code>{l.summary}</code>}
                  </li>
                ))}
              </ul>
            )}
            {it.kind === 'message' && (
              <div className={`msg ${it.role}`}>
                <p className="who">
                  <strong>{it.author}</strong>
                  {s.time && ` · ${s.time}`}
                </p>
                {it.text && (
                  <div className="body">
                    <PrintMarkdown text={it.text} />
                  </div>
                )}
                {it.notes.map((n, j) => (
                  <p key={j} className="note">
                    {n}
                  </p>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </article>
  );
}

let pendingCleanup: (() => void) | null = null;

/**
 * Puts the print view in the page (shown only when printing, see `.print-export` in index.css), names the
 * page after the file (the browser's default PDF name) and opens the print dialog. Everything is taken out
 * after printing, or at the next export when the browser never says printing ended.
 */
export function printConversation(doc: ExportDoc, title: string, t: T, print: () => void = () => window.print()): void {
  pendingCleanup?.();
  const host = document.createElement('div');
  host.className = 'print-export';
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(<PrintConversation doc={doc} t={t} />));
  const previousTitle = document.title;
  document.title = title;
  const cleanup = () => {
    window.removeEventListener('afterprint', cleanup);
    if (pendingCleanup === cleanup) pendingCleanup = null;
    root.unmount();
    host.remove();
    document.title = previousTitle;
  };
  pendingCleanup = cleanup;
  window.addEventListener('afterprint', cleanup);
  print();
}

/** Saves a text file through the browser (a Blob link). */
export function downloadText(text: string, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Exports the whole conversation: a Markdown download, or the print dialog (Save as PDF). */
export function exportConversation(
  format: ExportFormat,
  session: SessionView,
  events: ChatEvent[],
  lang: Language,
  now: Date = new Date(),
): void {
  const t: T = (key, vars) => translate(lang, key, vars);
  const doc = buildExport(session, events, t, now);
  const name = exportFileName(doc.title, now, format, t);
  if (format === 'md') downloadText(exportMarkdown(doc, t), name, 'text/markdown;charset=utf-8');
  else printConversation(doc, name.replace(/\.pdf$/, ''), t);
}
