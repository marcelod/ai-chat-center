// A small syntax highlighter for the side panel's code view (spec 2026-11-27-side-panel-file-types): comments,
// strings, numbers and keywords, line by line, with block comments and multi-line strings carried across lines.
// Since 0.6.9 (spec 2026-11-27-side-panel-leftovers) the keywords follow the file's language, and it marks
// decorators, JSON/YAML/TOML keys and HTML tag names. It is meant to make code easier to read, not to be exact
// (no dependency, no grammar per language).

export type Lang = 'c' | 'hash' | 'sql' | 'markup' | 'plain';
/**
 * A piece of a line: `c` is its class (keyword, string, number, comment, property key, decorator), none for
 * plain text.
 */
export type Tok = { t: string; c?: 'k' | 's' | 'n' | 'c' | 'p' | 'd' };

const LANGS: Record<string, Lang> = {};
const put = (lang: Lang, exts: string) => exts.split(' ').forEach((e) => (LANGS[e] = lang));
put('c', 'ts tsx mts cts js jsx mjs cjs json jsonc css scss sass less go rs java kt kts scala swift dart c h cc cpp cxx hpp cs php proto graphql gql');
put('hash', 'py rb sh bash zsh fish ps1 yaml yml toml');
put('sql', 'sql lua');
put('markup', 'html htm xml vue svelte astro');

/** The file's extension, lower case ('' without one). */
export function extOf(path: string): string {
  return /\.([A-Za-z0-9]+)$/.exec(path)?.[1].toLowerCase() ?? '';
}

export function langOf(path: string): Lang {
  return LANGS[extOf(path)] || 'plain';
}

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

/** The keywords used when the language is not known (only the comment style is): a mix of the common ones. */
const GENERIC = words(
  'abstract and as async await break case catch class const continue def default defer del delete do elif else ' +
    'end enum except export extends false finally fn for from func function go if impl implements import in ' +
    'interface is lambda let local match mod module mut new nil none None not null or package pass private ' +
    'protected pub public raise readonly return self static struct super switch then this throw throws trait ' +
    'true True False try type typeof undefined use var void while with yield fi done esac echo local ' +
    'select from where insert into update delete create table join left right inner outer on group by order ' +
    'having limit values set and or not null as distinct union',
);
const JS = words(
  'abstract as async await break case catch class const continue debugger declare default delete do else enum ' +
    'export extends false finally for from function get if implements import in infer instanceof interface keyof ' +
    'let namespace new null of private protected public readonly return satisfies set static super switch this ' +
    'throw true try type typeof undefined var void while with yield',
);
const PY = words(
  'and as assert async await break case class continue def del elif else except False finally for from global if ' +
    'import in is lambda match None nonlocal not or pass raise return self True try while with yield',
);
const SH = words(
  'case do done elif else esac exit export false fi for function if in local readonly return set shift source ' +
    'then true unset until while echo',
);
const GO = words(
  'break case chan const continue default defer else fallthrough false for func go goto if import interface map ' +
    'nil package range return select struct switch true type var',
);
const RS = words(
  'as async await break const continue crate dyn else enum Err extern false fn for if impl in let loop match mod ' +
    'move mut None Ok pub ref return self Self Some static struct super trait true type unsafe use where while',
);
const RB = words(
  'alias and begin break case class def do else elsif end ensure false for if in module next nil not or redo ' +
    'require rescue retry return self super then true undef unless until when while yield',
);
const LUA = words('and break do else elseif end false for function goto if in local nil not or repeat return then true until while');
const CLIKE = words(
  'abstract auto bool boolean break byte case catch char class const continue data default delete do double else ' +
    'enum extends false final finally float for fun if implements import in int interface internal is let long ' +
    'namespace new null object open operator override package private protected public return sealed short ' +
    'signed sizeof static struct super switch this throw throws true try typedef typename union unsigned using ' +
    'val var virtual void volatile when while',
);
const SQL = words(
  'add all alter and as asc begin between by case column commit create cross default delete desc distinct drop ' +
    'else end exists false foreign from full group having if in index inner insert into is join key left like ' +
    'limit not null offset on or order outer primary references returning right rollback select set table then ' +
    'true union unique update values view when where with',
);
const LITERALS = words('true false null');
const NONE = new Set<string>();

type Syntax = {
  line?: string;
  block?: [string, string];
  /** Quotes that end on the same line. */
  quotes: string;
  /** Delimiters of strings that may span lines (longest first): template strings, triple quotes. */
  multi?: string[];
  words: Set<string>;
  /** SQL: keywords in any case. */
  anyCase?: boolean;
  /** `@name` (dots allowed): 'd' a decorator or annotation, 'k' a CSS at-rule. */
  at?: 'd' | 'k';
  /** JSON: a string followed by `:` is a key. YAML / TOML: the name before `:` / `=` at the line start is a key. */
  keys?: 'json' | 'yaml' | 'toml';
  /** Markup: the name after `<` or `</` is a keyword; words of the text are not. */
  tags?: boolean;
};

const FAMILY: Record<Lang, Syntax | null> = {
  c: { line: '//', block: ['/*', '*/'], quotes: `"'\``, words: GENERIC },
  hash: { line: '#', quotes: `"'`, words: GENERIC },
  sql: { line: '--', block: ['/*', '*/'], quotes: `"'`, words: GENERIC },
  markup: { block: ['<!--', '-->'], quotes: '"', words: NONE, tags: true },
  plain: null,
};

/** What a known extension changes in its family's syntax. */
const BY_EXT: Record<string, Partial<Syntax>> = {};
const ext = (exts: string, s: Partial<Syntax>) => exts.split(' ').forEach((e) => (BY_EXT[e] = s));
ext('ts tsx mts cts js jsx mjs cjs', { quotes: `"'`, multi: ['`'], words: JS, at: 'd' });
ext('json jsonc', { quotes: '"', words: LITERALS, keys: 'json' });
ext('css scss sass less', { quotes: `"'`, words: NONE, at: 'k' });
ext('go', { quotes: `"'`, multi: ['`'], words: GO });
ext('rs', { quotes: '"', words: RS });
ext('java kt kts scala swift', { quotes: `"'`, multi: ['"""'], words: CLIKE, at: 'd' });
ext('dart c h cc cpp cxx hpp cs php', { quotes: `"'`, words: CLIKE });
ext('py', { multi: ['"""', "'''"], words: PY, at: 'd' });
ext('rb', { words: RB });
ext('sh bash zsh fish', { words: SH });
ext('yaml yml', { words: words('true false null yes no on off'), keys: 'yaml' });
ext('toml', { words: LITERALS, keys: 'toml' });
ext('sql', { words: SQL, anyCase: true });
ext('lua', { words: LUA });

function syntaxOf(lang: Lang, extension?: string): Syntax | null {
  const base = FAMILY[lang];
  if (!base) return null;
  const own = extension ? BY_EXT[extension] : undefined;
  // SQL keeps its upper-case keywords without an extension too, as before.
  return { ...base, ...(lang === 'sql' && !own ? { anyCase: true } : {}), ...own };
}

/** Longest file (characters) and line highlighted; past them the text is shown plain. */
const MAX_CHARS = 512 * 1024;
const MAX_LINE = 2000;

const WORD = /[A-Za-z_$][\w$]*/y;
const AT_NAME = /@[A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)*/y;
const NUMBER = /\d[\w.]*/y;
const YAML_KEY = /^(\s*(?:-\s+)?)([A-Za-z_][\w.-]*|"[^"]*"|'[^']*')(?=\s*:(?:\s|$))/;
const TOML_KEY = /^(\s*)([A-Za-z_][\w.-]*|"[^"]*")(?=\s*=)/;

/** Where `delim` closes in `line` from `from` (a backslash escapes in template strings), or -1. */
function closeOf(line: string, delim: string, from: number): number {
  for (let j = from; j < line.length; j++) {
    if (line[j] === '\\') {
      j++;
      continue;
    }
    if (line.startsWith(delim, j)) return j;
  }
  return -1;
}

/**
 * The lines of `text`, each as pieces with their class. `lang` gives the comment style; the extension (see
 * `extOf`), when known, the keywords and the extras of that language.
 */
export function highlightLines(text: string, lang: Lang, extension?: string): Tok[][] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  const syn = text.length <= MAX_CHARS ? syntaxOf(lang, extension) : null;
  if (!syn) return lines.map((l) => [{ t: l }]);
  const isKeyword = (w: string) => syn.words.has(w) || (syn.anyCase === true && syn.words.has(w.toLowerCase()));
  /** The block comment or the multi-line string still open at the end of the previous line. */
  let open: { c: 'c' | 's'; end: string } | null = null;
  return lines.map((line) => {
    if (line.length > MAX_LINE) return [{ t: line }];
    const out: Tok[] = [];
    let plain = '';
    const push = (t: string, c?: Tok['c']) => {
      if (!c) return void (plain += t);
      if (plain) out.push({ t: plain });
      plain = '';
      out.push({ t, c });
    };
    let i = 0;
    if (open) {
      const end = open.c === 'c' ? line.indexOf(open.end) : closeOf(line, open.end, 0);
      if (end < 0) return [{ t: line, c: open.c }];
      i = end + open.end.length;
      push(line.slice(0, i), open.c);
      open = null;
    } else if (syn.keys === 'yaml' || syn.keys === 'toml') {
      const m = (syn.keys === 'yaml' ? YAML_KEY : TOML_KEY).exec(line);
      if (m) {
        push(m[1]);
        push(m[2], 'p');
        i = m[0].length;
      }
    }
    while (i < line.length) {
      const ch = line[i];
      if (syn.line && line.startsWith(syn.line, i)) {
        push(line.slice(i), 'c');
        break;
      }
      if (syn.block && line.startsWith(syn.block[0], i)) {
        const end = line.indexOf(syn.block[1], i + syn.block[0].length);
        if (end < 0) {
          push(line.slice(i), 'c');
          open = { c: 'c', end: syn.block[1] };
          break;
        }
        const stop = end + syn.block[1].length;
        push(line.slice(i, stop), 'c');
        i = stop;
        continue;
      }
      const multi = syn.multi?.find((d) => line.startsWith(d, i));
      if (multi) {
        const end = closeOf(line, multi, i + multi.length);
        if (end < 0) {
          push(line.slice(i), 's');
          open = { c: 's', end: multi };
          break;
        }
        const stop = end + multi.length;
        push(line.slice(i, stop), 's');
        i = stop;
        continue;
      }
      if (syn.quotes.includes(ch)) {
        let j = i + 1;
        while (j < line.length && line[j] !== ch) j += line[j] === '\\' ? 2 : 1;
        const stop = Math.min(j + 1, line.length);
        const key = syn.keys === 'json' && /^\s*:/.test(line.slice(stop));
        push(line.slice(i, stop), key ? 'p' : 's');
        i = stop;
        continue;
      }
      if (ch === '@' && syn.at) {
        AT_NAME.lastIndex = i;
        const a = AT_NAME.exec(line);
        if (a) {
          push(a[0], syn.at);
          i += a[0].length;
          continue;
        }
      }
      if (syn.tags && ch === '<') {
        const m = /^<\/?([A-Za-z][\w:.-]*)/.exec(line.slice(i, i + 200));
        if (m) {
          push(m[0].slice(0, m[0].length - m[1].length));
          push(m[1], 'k');
          i += m[0].length;
          continue;
        }
      }
      WORD.lastIndex = i;
      const w = WORD.exec(line);
      if (w) {
        push(w[0], isKeyword(w[0]) ? 'k' : undefined);
        i += w[0].length;
        continue;
      }
      NUMBER.lastIndex = i;
      const n = NUMBER.exec(line);
      if (n) {
        push(n[0], 'n');
        i += n[0].length;
        continue;
      }
      push(ch);
      i++;
    }
    if (plain || out.length === 0) out.push({ t: plain });
    return out;
  });
}
