import { describe, expect, it } from 'vitest';
import { highlightLines, langOf, type Tok } from './highlight';

// Spec 2026-11-27-side-panel-file-types: a small highlighter, no dependency.

const kinds = (line: Tok[]) => line.filter((t) => t.c).map((t) => [t.c, t.t]);
const text = (line: Tok[]) => line.map((t) => t.t).join('');

describe('langOf', () => {
  it('groups extensions by comment style', () => {
    expect(langOf('a/b.ts')).toBe('c');
    expect(langOf('x.PY')).toBe('hash');
    expect(langOf('q.sql')).toBe('sql');
    expect(langOf('i.html')).toBe('markup');
    expect(langOf('n.txt')).toBe('plain');
    expect(langOf('README.md')).toBe('plain');
  });
});

describe('highlightLines', () => {
  it('keeps every character of every line', () => {
    const src = 'const a = "x"; // hi\n\nlet b = 2';
    const out = highlightLines(src, 'c');
    expect(out).toHaveLength(3);
    expect(out.map(text)).toEqual(['const a = "x"; // hi', '', 'let b = 2']);
  });
  it('drops a final newline and Windows line ends', () => {
    expect(highlightLines('a\r\nb\n', 'plain').map(text)).toEqual(['a', 'b']);
  });
  it('marks keywords, strings, numbers and line comments', () => {
    const [line] = highlightLines("const s = 'it\\'s' + 42; // done", 'c');
    expect(kinds(line)).toEqual([
      ['k', 'const'],
      ['s', "'it\\'s'"],
      ['n', '42'],
      ['c', '// done'],
    ]);
  });
  it('carries a block comment across lines', () => {
    const out = highlightLines('a /* one\ntwo\nthree */ return', 'c');
    expect(kinds(out[0])).toEqual([['c', '/* one']]);
    expect(kinds(out[1])).toEqual([['c', 'two']]);
    expect(kinds(out[2])).toEqual([
      ['c', 'three */'],
      ['k', 'return'],
    ]);
  });
  it('uses # comments for Python and shell, -- for SQL, <!-- --> for markup', () => {
    expect(kinds(highlightLines('def f(): # note', 'hash')[0])).toEqual([
      ['k', 'def'],
      ['c', '# note'],
    ]);
    expect(kinds(highlightLines('SELECT 1 -- why', 'sql')[0])).toEqual([
      ['k', 'SELECT'],
      ['n', '1'],
      ['c', '-- why'],
    ]);
    expect(kinds(highlightLines('<a href="x"><!-- c -->', 'markup')[0])).toEqual([
      ['s', '"x"'],
      ['c', '<!-- c -->'],
    ]);
  });
  it('does not mark a number inside a word, nor anything in plain text', () => {
    expect(kinds(highlightLines('x1 = v2', 'c')[0])).toEqual([]);
    expect(kinds(highlightLines('const "a" // b', 'plain')[0])).toEqual([]);
  });
});
