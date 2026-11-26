import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { fold } from '@shared/search';

// Find in the open conversation, like the browser's Ctrl+F: every occurrence of the text is highlighted
// (CSS Custom Highlight API, so the rendered Markdown is never touched) and ↑/↓ move between them.
// Case and accents are ignored, as in the hub's search. Text split by formatting (half bold) is not found,
// nor text inside buttons or hidden parts (a collapsed agent message shows only its first line).

const ALL = 'acc-search';
const CURRENT = 'acc-search-current';

type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void };
type HighlightCtor = new (...ranges: Range[]) => unknown;

function registry(): { reg: HighlightRegistry; Highlight: HighlightCtor } | null {
  const reg = (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights;
  const Highlight = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight;
  return reg && Highlight ? { reg, Highlight } : null;
}

function clearHighlights(): void {
  const r = registry();
  r?.reg.delete(ALL);
  r?.reg.delete(CURRENT);
}

/** Ranges of every occurrence of `query` in the text under `root`, in document order. */
export function findRanges(root: HTMLElement, query: string): Range[] {
  const q = fold(query.trim());
  if (!q) return [];
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      (n.parentElement?.closest('button, input, textarea, [aria-hidden="true"], [data-no-find]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const raw = node.data;
    // fold() keeps one char per char for the usual letters; when it does not, match without removing accents.
    let text = fold(raw);
    let needle = q;
    if (text.length !== raw.length) {
      text = raw.toLowerCase();
      needle = query.trim().toLowerCase();
      if (text.length !== raw.length) continue;
    }
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
      const r = document.createRange();
      r.setStart(node, at);
      r.setEnd(node, at + needle.length);
      ranges.push(r);
    }
  }
  return ranges;
}

/**
 * `query` null or shorter than the minimum: nothing is searched. `version` changes when the content does
 * (new events), so the ranges are found again. Starts at the newest occurrence (the bottom of the chat).
 */
export function useFindInChat(root: RefObject<HTMLElement | null>, query: string | null, version: unknown) {
  const ranges = useRef<Range[]>([]);
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState(0);
  const lastQuery = useRef<string | null>(null);

  const show = useCallback((i: number, scroll: boolean) => {
    const r = registry();
    const target = ranges.current[i];
    if (r) {
      r.reg.set(ALL, new r.Highlight(...ranges.current));
      if (target) r.reg.set(CURRENT, new r.Highlight(target));
      else r.reg.delete(CURRENT);
    }
    if (scroll && target) target.startContainer.parentElement?.scrollIntoView?.({ block: 'center' });
  }, []);

  useLayoutEffect(() => {
    if (!query || !root.current) {
      ranges.current = [];
      setTotal(0);
      lastQuery.current = null;
      clearHighlights();
      return;
    }
    const found = findRanges(root.current, query);
    ranges.current = found;
    setTotal(found.length);
    // A new text jumps to the newest occurrence; new messages keep the place (clamped).
    const fresh = lastQuery.current !== query;
    lastQuery.current = query;
    setCurrent((c) => {
      const next = fresh ? found.length - 1 : Math.min(c, found.length - 1);
      show(Math.max(next, 0), fresh);
      return Math.max(next, 0);
    });
  }, [root, query, version, show]);

  useLayoutEffect(() => clearHighlights, []);

  const step = useCallback(
    (delta: number) => {
      const n = ranges.current.length;
      if (n === 0) return;
      setCurrent((c) => {
        const next = (c + delta + n) % n;
        show(next, true);
        return next;
      });
    },
    [show],
  );

  return { total, current, next: () => step(1), previous: () => step(-1) };
}
