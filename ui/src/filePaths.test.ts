import { describe, expect, it } from 'vitest';
import { fileKind, fileTargetOf, findFilePaths, localLinkTarget, remarkFileLinks, FILE_HREF, resolveRelative } from './filePaths';

describe('findFilePaths on long runs without spaces', () => {
  it('stays linear: 100 KB of `_a`, `_a.` or `_a/` takes well under a second', () => {
    for (const s of ['_a'.repeat(50_000), '_a.'.repeat(33_000), '_a/'.repeat(33_000), '*a'.repeat(50_000)]) {
      const t = performance.now();
      findFilePaths(s);
      expect(performance.now() - t).toBeLessThan(300);
    }
  });
  it('still finds paths in Markdown emphasis and names with underscores', () => {
    expect(findFilePaths('_notes.md_ and **b.md** and __init__.py and *c/d.ts*')).toEqual(['_notes.md', 'b.md', '__init__.py', 'c/d.ts']);
    expect(findFilePaths('x _a.md and (*b.md*)')).toEqual(['_a.md', 'b.md']);
  });
});

describe('findFilePaths', () => {
  it('finds Markdown and image paths: absolute, relative, with ./ and ../', () => {
    expect(findFilePaths('See docs/backlog.md and /home/me/p/shot.PNG, then ./a.jpeg or ../b.webp.')).toEqual([
      'docs/backlog.md',
      '/home/me/p/shot.PNG',
      './a.jpeg',
      '../b.webp',
    ]);
  });
  it('keeps the path without a line suffix or closing punctuation', () => {
    expect(findFilePaths('(README.md:42) "x.gif" [y.md]; z.jpg!')).toEqual(['README.md', 'x.gif', 'y.md', 'z.jpg']);
  });
  it('ignores URLs, other extensions and words that only end like one', () => {
    expect(findFilePaths('https://example.com/a.png http://x/y.md https://e.com/x.ts file.exe notes.mdx a.md5 .md a.ts2')).toEqual([]);
  });
  it('lists each path once', () => {
    expect(findFilePaths('a.md a.md b.md')).toEqual(['a.md', 'b.md']);
  });
});

describe('findFilePaths: code, text and PDF (spec 2026-11-27-side-panel-file-types)', () => {
  it('finds code and PDF paths, with or without a line suffix', () => {
    expect(findFilePaths('See src/hub/server.ts:42, ui/src/App.tsx:7:3 and docs/a.pdf; also package.json.')).toEqual([
      'src/hub/server.ts',
      'ui/src/App.tsx',
      'docs/a.pdf',
      'package.json',
    ]);
  });
  it('prefers the longest extension', () => {
    expect(findFilePaths('a.tsx b.jsonc c.cpp')).toEqual(['a.tsx', 'b.jsonc', 'c.cpp']);
  });
});

describe('fileKind', () => {
  it('tells Markdown, images, text and PDF apart', () => {
    expect(fileKind('a/B.MD')).toBe('markdown');
    expect(fileKind('x.markdown')).toBe('markdown');
    expect(fileKind('x.jpg')).toBe('image');
    expect(fileKind('x.ts')).toBe('text');
    expect(fileKind('x.PY')).toBe('text');
    expect(fileKind('x.pdf')).toBe('pdf');
    expect(fileKind('.env')).toBeNull();
    expect(fileKind('x.exe')).toBeNull();
  });
});

describe('file link targets', () => {
  it('carries the cited line in the href', () => {
    expect(fileTargetOf(FILE_HREF + encodeURIComponent('a#b.ts') + '#L42')).toEqual({ path: 'a#b.ts', line: 42 });
    expect(fileTargetOf(FILE_HREF + encodeURIComponent('a.ts'))).toEqual({ path: 'a.ts' });
    expect(fileTargetOf('https://x/a.ts')).toBeNull();
  });
  it('reads a GitHub-style line anchor of a local link', () => {
    expect(localLinkTarget('src/a.ts#L12')).toEqual({ path: 'src/a.ts', line: 12 });
    expect(localLinkTarget('src/a.ts#L12-L20')).toEqual({ path: 'src/a.ts', line: 12 });
    expect(localLinkTarget('docs/b.md#intro')).toEqual({ path: 'docs/b.md' });
    expect(localLinkTarget('https://e.com/a.ts#L1')).toBeNull();
  });
});

describe('resolveRelative', () => {
  it('resolves a link of a file against its folder', () => {
    expect(resolveRelative('docs/specs/a.md', '../backlog.md')).toBe('docs/backlog.md');
    expect(resolveRelative('/p/docs/a.md', './img/x.png')).toBe('/p/docs/img/x.png');
    expect(resolveRelative('/p/docs/a.md', '/abs/b.md')).toBe('/abs/b.md');
    expect(resolveRelative('a.md', 'b.md')).toBe('b.md');
  });
});

type Node = { type: string; value?: string; url?: string; children?: Node[] };
const run = (tree: Node) => {
  (remarkFileLinks() as (t: Node) => void)(tree);
  return tree;
};

describe('remarkFileLinks', () => {
  it('turns paths in text into file links, keeping the text around them', () => {
    const tree = run({ type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'open docs/a.md now' }] }] });
    expect(tree.children![0].children).toEqual([
      { type: 'text', value: 'open ' },
      { type: 'link', url: FILE_HREF + encodeURIComponent('docs/a.md'), children: [{ type: 'text', value: 'docs/a.md' }] },
      { type: 'text', value: ' now' },
    ]);
  });
  it('wraps inline code that is a path, and a relative Markdown link to a file', () => {
    const tree = run({
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'inlineCode', value: 'src/x.md:12' },
            { type: 'link', url: 'docs/b.md', children: [{ type: 'text', value: 'spec' }] },
            { type: 'link', url: 'https://e.com/c.md', children: [{ type: 'text', value: 'web' }] },
          ],
        },
      ],
    });
    const kids = tree.children![0].children!;
    expect(kids[0]).toEqual({ type: 'link', url: FILE_HREF + encodeURIComponent('src/x.md') + '#L12', children: [{ type: 'inlineCode', value: 'src/x.md:12' }] });
    expect(kids[1].url).toBe(FILE_HREF + encodeURIComponent('docs/b.md'));
    expect(kids[2].url).toBe('https://e.com/c.md');
  });
  it('links a path with its line, the suffix included in the link text', () => {
    const tree = run({ type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'at src/a.ts:42, see' }] }] });
    expect(tree.children![0].children).toEqual([
      { type: 'text', value: 'at ' },
      { type: 'link', url: FILE_HREF + encodeURIComponent('src/a.ts') + '#L42', children: [{ type: 'text', value: 'src/a.ts:42' }] },
      { type: 'text', value: ', see' },
    ]);
    const code = run({ type: 'root', children: [{ type: 'paragraph', children: [{ type: 'inlineCode', value: 'src/b.py:7:2' }] }] });
    expect(code.children![0].children![0].url).toBe(FILE_HREF + encodeURIComponent('src/b.py') + '#L7');
    const link = run({ type: 'root', children: [{ type: 'paragraph', children: [{ type: 'link', url: './c.ts#L3', children: [] }] }] });
    expect(link.children![0].children![0].url).toBe(FILE_HREF + encodeURIComponent('./c.ts') + '#L3');
  });
  it('leaves code blocks alone', () => {
    const tree = run({ type: 'root', children: [{ type: 'code', value: 'cat a.md' }] });
    expect(tree.children![0]).toEqual({ type: 'code', value: 'cat a.md' });
  });
});
