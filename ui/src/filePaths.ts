// File paths cited in a conversation (specs 2026-11-26-side-panel and 2026-11-27-side-panel-file-types):
// Markdown, images, code and text, PDFs that the side panel can open, with the cited line (`a.ts:42`). Only paths the hub says exist become links (see useFileLinks); this module only finds
// candidates and marks them in the Markdown tree.

import { PANEL_EXTENSIONS, panelFileKind, type PanelFileKind } from '@shared/fileTypes';

export type FileKind = PanelFileKind;
/** A file to open, with the line cited (1-based) when there is one. */
export type FileTarget = { path: string; line?: number };

const EXT = `(?:${PANEL_EXTENSIONS.join('|')})`;
/** A path: optional `/`, `./` or `../`, folders, a name, a known extension; never part of a URL or a longer word. */
const PATH_BODY = String.raw`(?:\.{1,2}\/|\/)?(?:[\w@+\-.]+\/)*[\w@+\-.]*[\w@+\-]\.${EXT}`;
const LINE = String.raw`(?::(\d{1,7})(?::\d{1,7})?)?`;
const PATH_RE = new RegExp(String.raw`(^|[\s(\[{"'<>*_\`])(${PATH_BODY})${LINE}(?=$|[\s)\]}"'<>,;:!?*_\`]|\.(?:\s|$))`, 'gi');
/** Inline code made of one path, maybe with a `:line` suffix. */
const WHOLE_RE = new RegExp(String.raw`^(${PATH_BODY})${LINE}$`, 'i');

/** The href prefix of a file link in the Markdown tree (allowed through react-markdown's urlTransform). */
export const FILE_HREF = 'acc-file:';

export const fileKind = (p: string): FileKind | null => panelFileKind(p);

const lineOf = (s: string | undefined): number | undefined => {
  const n = s ? Number(s) : NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
};
const target = (path: string, line: number | undefined): FileTarget => (line ? { path, line } : { path });

/** The candidate paths in a text, each once, in order. */
export function findFilePaths(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(PATH_RE)) out.add(m[2]);
  return [...out];
}

/** `rel` (a link inside the file at `from`) as a path of the session: absolute stays, relative joins the file's folder. */
export function resolveRelative(from: string, rel: string): string {
  if (rel.startsWith('/')) return rel;
  const abs = from.startsWith('/');
  const parts = from.split('/').filter(Boolean);
  parts.pop();
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..' && parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop();
    else parts.push(seg);
  }
  return (abs ? '/' : '') + parts.join('/');
}

/** A link target that is a local file of a known type (no scheme, no `//host`); a `#L12` anchor is its line. */
export function localLinkTarget(url: string): FileTarget | null {
  if (!url || url.startsWith('#') || url.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(url)) return null;
  let p = url.replace(/[?#].*$/, '');
  try {
    p = decodeURI(p);
  } catch {
    return null;
  }
  if (!fileKind(p)) return null;
  return target(p, lineOf(/#L(\d{1,7})(?:-L?\d+)?$/.exec(url)?.[1]));
}

/** The path of localLinkTarget, without its line. */
export const localLinkPath = (url: string): string | null => localLinkTarget(url)?.path ?? null;

type MdNode = { type: string; value?: string; url?: string; children?: MdNode[] };
/** The href of a file link: the path encoded (so a `#` in it stays), then `#L<line>` when a line is cited. */
export const fileHref = (p: string, line?: number) => FILE_HREF + encodeURIComponent(p) + (line ? `#L${line}` : '');
const fileLink = (p: string, line: number | undefined, children: MdNode[]): MdNode => ({ type: 'link', url: fileHref(p, line), children });

function splitText(node: MdNode): MdNode[] {
  const text = node.value ?? '';
  const out: MdNode[] = [];
  let last = 0;
  for (const m of text.matchAll(PATH_RE)) {
    const start = m.index! + m[1].length;
    const whole = m[0].slice(m[1].length);
    if (start > last) out.push({ type: 'text', value: text.slice(last, start) });
    out.push(fileLink(m[2], lineOf(m[3]), [{ type: 'text', value: whole }]));
    last = start + whole.length;
  }
  if (out.length === 0) return [node];
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

/**
 * A remark plugin: paths in text and inline code, and Markdown links to local files, become links to
 * FILE_HREF + path. `linkBase`: the file a Markdown file's own relative links are relative to.
 */
export function remarkFileLinks(opts: { linkBase?: string } = {}) {
  const walk = (node: MdNode) => {
    if (!node.children) return;
    const next: MdNode[] = [];
    for (const child of node.children) {
      if (child.type === 'text') next.push(...splitText(child));
      else if (child.type === 'inlineCode') {
        const m = WHOLE_RE.exec((child.value ?? '').trim());
        next.push(m ? fileLink(m[1], lineOf(m[2]), [child]) : child);
      } else if (child.type === 'link') {
        const tg = localLinkTarget(child.url ?? '');
        if (tg) child.url = fileHref(opts.linkBase ? resolveRelative(opts.linkBase, tg.path) : tg.path, tg.line);
        next.push(child);
      } else {
        if (child.type !== 'code' && child.type !== 'linkReference' && child.type !== 'definition') walk(child);
        next.push(child);
      }
    }
    node.children = next;
  };
  return (tree: MdNode) => walk(tree);
}

/** The file (and line) behind a file link's href, or null for any other href. */
export function fileTargetOf(href: string | undefined): FileTarget | null {
  if (!href || !href.startsWith(FILE_HREF)) return null;
  const m = /^([^#]*)(?:#L(\d+))?$/.exec(href.slice(FILE_HREF.length));
  if (!m) return null;
  try {
    return target(decodeURIComponent(m[1]), lineOf(m[2]));
  } catch {
    return null;
  }
}

/** The path behind a file link's href, or null for any other href. */
export const filePathOf = (href: string | undefined): string | null => fileTargetOf(href)?.path ?? null;
