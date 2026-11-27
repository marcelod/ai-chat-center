// A code or text file in the side panel (spec 2026-11-27-side-panel-file-types): line numbers, a light
// highlight, and the cited line scrolled to and marked.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { highlightLines, langOf } from '../highlight';

export function CodeView({ text, path, line, label }: { text: string; path: string; line?: number; label: string }) {
  const lines = useMemo(() => highlightLines(text, langOf(path)), [text, path]);
  const current = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    current.current?.scrollIntoView?.({ block: 'center' });
  }, [lines, line]);
  const digits = String(lines.length).length;
  return (
    <div data-testid="panel-code" role="region" aria-label={label} className="code-view min-w-max py-2 font-mono text-xs leading-5">
      {lines.map((toks, i) => {
        const n = i + 1;
        const here = n === line;
        return (
          <div
            key={i}
            ref={here ? current : undefined}
            data-line={n}
            aria-current={here ? 'true' : undefined}
            className={`flex pr-4 ${here ? 'code-current' : ''}`}
          >
            <span aria-hidden="true" className="code-num shrink-0 select-none pl-3 pr-3 text-right" style={{ width: `${digits + 3}ch` }}>
              {n}
            </span>
            <span className="whitespace-pre">
              {toks.map((tk, k) => (tk.c ? <span key={k} className={`tok-${tk.c}`}>{tk.t}</span> : tk.t))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
