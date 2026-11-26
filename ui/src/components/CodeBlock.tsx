import { isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../i18n';

/** Blocks of prose (a prompt to paste elsewhere, a plain note) wrap; real code keeps its lines unless asked. */
const PROSE = new Set(['', 'text', 'txt', 'plain', 'plaintext', 'markdown', 'md', 'prompt']);

/** The fence language, from the `language-x` class react-markdown puts on the inner `code`. */
export function codeLanguage(children: ReactNode): string {
  const child = Array.isArray(children) ? children[0] : children;
  if (!isValidElement<{ className?: string }>(child)) return '';
  const m = /\blanguage-([\w+-]+)/.exec(child.props.className ?? '');
  return m ? m[1].toLowerCase() : '';
}

type Copy = 'idle' | 'copied' | 'failed';

/** A fenced code block: a Copy button (the plain text) and a toggle between wrapped and scrolled lines. */
export function CodeBlock({ children }: { children?: ReactNode }) {
  const t = useT();
  const pre = useRef<HTMLPreElement>(null);
  const [wrap, setWrap] = useState(() => PROSE.has(codeLanguage(children)));
  const [copy, setCopy] = useState<Copy>('idle');
  useEffect(() => {
    if (copy === 'idle') return;
    const id = setTimeout(() => setCopy('idle'), 1500);
    return () => clearTimeout(id);
  }, [copy]);

  const doCopy = async () => {
    const text = (pre.current?.textContent ?? '').replace(/\n$/, '');
    try {
      await navigator.clipboard.writeText(text);
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  };

  const btn = 'rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] font-medium text-muted hover:text-ink';
  return (
    <div data-code-block className="group relative">
      <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-80 group-hover:opacity-100">
        <button type="button" className={btn} aria-pressed={wrap} onClick={() => setWrap((w) => !w)}>
          {wrap ? t('ui.chat.code.noWrap') : t('ui.chat.code.wrap')}
        </button>
        <button type="button" className={btn} onClick={() => void doCopy()} aria-live="polite">
          {copy === 'copied' ? t('ui.chat.code.copied') : copy === 'failed' ? t('ui.chat.code.copyFailed') : t('ui.chat.code.copy')}
        </button>
      </div>
      <pre ref={pre} data-wrap={wrap ? 'on' : 'off'} className="pt-8">
        {children}
      </pre>
    </div>
  );
}
