import type { DiffLine, ToolDiff } from './types.js';

/** Most lines of diff kept in the payload; the rest is cut and the diff marked truncated. */
export const DIFF_MAX_LINES = 400;
/** Longest text (characters) taken from each side; beyond it the text is cut. */
const SIDE_MAX_CHARS = 200_000;
/** Largest LCS table (cells); beyond it the middle is shown as all removed then all added. */
const LCS_MAX_CELLS = 1_000_000;
/** Longest line (characters) kept in a diff; beyond it the line is cut. */
export const DIFF_LINE_MAX_CHARS = 500;
/** Most text (characters) kept in one diff, besides the line cap. */
export const DIFF_MAX_CHARS = 32 * 1024;
const CONTEXT = 2;

const lines = (s: string): string[] => (s === '' ? [] : s.replace(/\r\n/g, '\n').split('\n'));

/** Line diff by longest common subsequence (common head and tail trimmed first). */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = lines(oldText);
  const b = lines(newText);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const am = a.slice(head, a.length - tail);
  const bm = b.slice(head, b.length - tail);
  const mid: DiffLine[] = [];
  if (am.length * bm.length > LCS_MAX_CELLS) {
    for (const s of am) mid.push({ op: '-', text: s });
    for (const s of bm) mid.push({ op: '+', text: s });
  } else {
    const w = bm.length + 1;
    const t = new Uint32Array((am.length + 1) * w);
    for (let i = am.length - 1; i >= 0; i--) {
      for (let j = bm.length - 1; j >= 0; j--) {
        t[i * w + j] = am[i] === bm[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < am.length && j < bm.length) {
      if (am[i] === bm[j]) {
        mid.push({ op: ' ', text: am[i] });
        i++;
        j++;
      } else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) mid.push({ op: '-', text: am[i++] });
      else mid.push({ op: '+', text: bm[j++] });
    }
    while (i < am.length) mid.push({ op: '-', text: am[i++] });
    while (j < bm.length) mid.push({ op: '+', text: bm[j++] });
  }
  const before = a.slice(Math.max(0, head - CONTEXT), head).map((text): DiffLine => ({ op: ' ', text }));
  const after = a.slice(a.length - tail, a.length - tail + CONTEXT).map((text): DiffLine => ({ op: ' ', text }));
  return [...before, ...mid, ...after];
}

const cut = (s: string) => (s.length > SIDE_MAX_CHARS ? s.slice(0, SIDE_MAX_CHARS) : s);

/** A diff of one or more edits (old to new), capped for the payload. Null when nothing changes. */
export function toolDiff(edits: { oldText: string; newText: string }[]): ToolDiff | null {
  const all: DiffLine[] = [];
  let tooBig = false;
  edits.forEach((e, k) => {
    if (e.oldText.length > SIDE_MAX_CHARS || e.newText.length > SIDE_MAX_CHARS) tooBig = true;
    if (k > 0 && all.length) all.push({ op: '~', text: '' });
    all.push(...diffLines(cut(e.oldText), cut(e.newText)));
  });
  const added = all.filter((l) => l.op === '+').length;
  const removed = all.filter((l) => l.op === '-').length;
  if (added === 0 && removed === 0) return null;
  let truncated = tooBig || all.length > DIFF_MAX_LINES;
  const kept: DiffLine[] = [];
  let chars = 0;
  for (const l of all.slice(0, DIFF_MAX_LINES)) {
    let text = l.text;
    if (text.length > DIFF_LINE_MAX_CHARS) {
      text = text.slice(0, DIFF_LINE_MAX_CHARS);
      truncated = true;
    }
    if (chars + text.length > DIFF_MAX_CHARS) {
      truncated = true;
      break;
    }
    chars += text.length;
    kept.push(text === l.text ? l : { op: l.op, text });
  }
  return { lines: kept, added, removed, ...(truncated ? { truncated: true as const } : {}) };
}
