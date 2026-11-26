import { describe, expect, it } from 'vitest';
import { fileKind, findFilePaths, remarkFileLinks, FILE_HREF, resolveRelative } from './filePaths';

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
    expect(findFilePaths('https://example.com/a.png http://x/y.md file.ts notes.mdx a.md5 .md')).toEqual([]);
  });
  it('lists each path once', () => {
    expect(findFilePaths('a.md a.md b.md')).toEqual(['a.md', 'b.md']);
  });
});

describe('fileKind', () => {
  it('tells Markdown from images', () => {
    expect(fileKind('a/B.MD')).toBe('markdown');
    expect(fileKind('x.markdown')).toBe('markdown');
    expect(fileKind('x.jpg')).toBe('image');
    expect(fileKind('x.ts')).toBeNull();
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
    expect(kids[0]).toEqual({ type: 'link', url: FILE_HREF + encodeURIComponent('src/x.md'), children: [{ type: 'inlineCode', value: 'src/x.md:12' }] });
    expect(kids[1].url).toBe(FILE_HREF + encodeURIComponent('docs/b.md'));
    expect(kids[2].url).toBe('https://e.com/c.md');
  });
  it('leaves code blocks alone', () => {
    const tree = run({ type: 'root', children: [{ type: 'code', value: 'cat a.md' }] });
    expect(tree.children![0]).toEqual({ type: 'code', value: 'cat a.md' });
  });
});
