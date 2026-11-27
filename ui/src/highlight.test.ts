import { describe, expect, it } from 'vitest';
import { extOf, highlightLines, langOf, type Tok } from './highlight';

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
      ['k', 'a'],
      ['s', '"x"'],
      ['c', '<!-- c -->'],
    ]);
  });
  it('does not mark a number inside a word, nor anything in plain text', () => {
    expect(kinds(highlightLines('x1 = v2', 'c')[0])).toEqual([]);
    expect(kinds(highlightLines('const "a" // b', 'plain')[0])).toEqual([]);
  });
});

// 0.6.9 (spec 2026-11-27-side-panel-leftovers): keywords per language, multi-line strings, decorators, keys.
describe('highlightLines with the file extension', () => {
  const hl = (src: string, path: string) => highlightLines(src, langOf(path), extOf(path));
  it('uses the keywords of the language', () => {
    expect(kinds(hl('def f(): return func', 'a.py')[0])).toEqual([
      ['k', 'def'],
      ['k', 'return'],
    ]);
    expect(kinds(hl('func f() { return def }', 'a.go')[0])).toEqual([
      ['k', 'func'],
      ['k', 'return'],
    ]);
    expect(kinds(hl('interface A { x: keyof B }', 'a.ts')[0])).toEqual([
      ['k', 'interface'],
      ['k', 'keyof'],
    ]);
  });
  it('carries a template string across lines, and Python triple quotes', () => {
    const js = hl('const s = `a ${x}\nstill // in\nend` + 1', 'a.ts');
    expect(kinds(js[0])).toEqual([
      ['k', 'const'],
      ['s', '`a ${x}'],
    ]);
    expect(kinds(js[1])).toEqual([['s', 'still // in']]);
    expect(kinds(js[2])).toEqual([
      ['s', 'end`'],
      ['n', '1'],
    ]);
    const py = hl('x = """doc\n# not a comment\n""" # c', 'a.py');
    expect(kinds(py[1])).toEqual([['s', '# not a comment']]);
    expect(kinds(py[2])).toEqual([
      ['s', '"""'],
      ['c', '# c'],
    ]);
    expect(py.map(text)).toEqual(['x = """doc', '# not a comment', '""" # c']);
  });
  it('marks decorators and CSS at-rules', () => {
    expect(kinds(hl('@Component({}) class A {}', 'a.ts')[0])).toEqual([
      ['d', '@Component'],
      ['k', 'class'],
    ]);
    expect(kinds(hl('@functools.cache', 'a.py')[0])).toEqual([['d', '@functools.cache']]);
    expect(kinds(hl('@media (max-width: 600px) {', 'a.css')[0])).toEqual([
      ['k', '@media'],
      ['n', '600px'],
    ]);
  });
  it('marks JSON keys apart from string values', () => {
    expect(kinds(hl('{"name": "x", "n": 1, "ok": true, "v": null}', 'a.json')[0])).toEqual([
      ['p', '"name"'],
      ['s', '"x"'],
      ['p', '"n"'],
      ['n', '1'],
      ['p', '"ok"'],
      ['k', 'true'],
      ['p', '"v"'],
      ['k', 'null'],
    ]);
  });
  it('marks YAML and TOML keys', () => {
    expect(kinds(hl('  name: value # c', 'a.yml')[0])).toEqual([
      ['p', 'name'],
      ['c', '# c'],
    ]);
    expect(kinds(hl('- run: true', 'a.yaml')[0])).toEqual([
      ['p', 'run'],
      ['k', 'true'],
    ]);
    expect(kinds(hl('port = 8080', 'a.toml')[0])).toEqual([
      ['p', 'port'],
      ['n', '8080'],
    ]);
  });
  it('in HTML marks tag names, not words of the text', () => {
    expect(kinds(hl('<div class="a">if for</div>', 'a.html')[0])).toEqual([
      ['k', 'div'],
      ['s', '"a"'],
      ['k', 'div'],
    ]);
  });
  it('keeps every character', () => {
    const src = '@a.b x = `t\n${y}` "k": 1\n<p>x</p>';
    for (const p of ['a.ts', 'a.py', 'a.json', 'a.html', 'a.yml', 'a.go']) expect(hl(src, p).map(text).join('\n')).toBe(src);
  });
});
