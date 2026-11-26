// File paths cited in a conversation (spec 2026-11-26-side-panel): Markdown files and images that the side
// panel can open. Only paths the hub says exist become links (see useFileLinks); this module only finds
// candidates and marks them in the Markdown tree.

export type FileKind = 'markdown' | 'image';

const EXT = '(?:md|markdown|png|jpe?g|gif|webp)';
/** A path: optional `/`, `./` or `../`, folders, a name, a known extension; never part of a URL or a longer word. */
const PATH_BODY = String.raw`(?:\.{1,2}\/|\/)?(?:[\w@+\-.]+\/)*[\w@+\-.]*[\w@+\-]\.${EXT}`;
const PATH_RE = new RegExp(String.raw`(^|[\s(\[{"'<>*_\`])(${PATH_BODY})(?=$|[\s)\]}"'<>,;:!?*_\`]|\.(?:\s|$))`, 'gi');
/** Inline code made of one path, maybe with a `:line` suffix. */
const WHOLE_RE = new RegExp(String.raw`^(${PATH_BODY})(?::\d+(?::\d+)?)?$`, 'i');

/** The href prefix of a file link in the Markdown tree (allowed through react-markdown's urlTransform). */
export const FILE_HREF = 'acc-file:';

export function fileKind(p: string): FileKind | null {
  const m = /\.([A-Za-z]+)$/.exec(p);
  const ext = m?.[1].toLowerCase();
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp') return 'image';
  return null;
}

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

/** A link target that is a local file of a known type (no scheme, no `//host`), without its `#…`/`?…`. */
export function localLinkPath(url: string): string | null {
  if (!url || url.startsWith('#') || url.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(url)) return null;
  let p = url.replace(/[?#].*$/, '');
  try {
    p = decodeURI(p);
  } catch {
    return null;
  }
  return fileKind(p) ? p : null;
}

type MdNode = { type: string; value?: string; url?: string; children?: MdNode[] };
const fileLink = (p: string, children: MdNode[]): MdNode => ({ type: 'link', url: FILE_HREF + encodeURIComponent(p), children });

function splitText(node: MdNode): MdNode[] {
  const text = node.value ?? '';
  const out: MdNode[] = [];
  let last = 0;
  for (const m of text.matchAll(PATH_RE)) {
    const start = m.index! + m[1].length;
    if (start > last) out.push({ type: 'text', value: text.slice(last, start) });
    out.push(fileLink(m[2], [{ type: 'text', value: m[2] }]));
    last = start + m[2].length;
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
        next.push(m ? fileLink(m[1], [child]) : child);
      } else if (child.type === 'link') {
        const p = localLinkPath(child.url ?? '');
        if (p) child.url = FILE_HREF + encodeURIComponent(opts.linkBase ? resolveRelative(opts.linkBase, p) : p);
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

/** The path behind a file link's href, or null for any other href. */
export function filePathOf(href: string | undefined): string | null {
  if (!href || !href.startsWith(FILE_HREF)) return null;
  try {
    return decodeURIComponent(href.slice(FILE_HREF.length));
  } catch {
    return null;
  }
}
