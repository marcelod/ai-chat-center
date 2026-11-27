// A small syntax highlighter for the side panel's code view (spec 2026-11-27-side-panel-file-types): comments,
// strings, numbers and a shared list of keywords, line by line, with block comments carried across lines. It
// is meant to make code easier to read, not to be exact (no dependency, no grammar per language).

export type Lang = 'c' | 'hash' | 'sql' | 'markup' | 'plain';
/** A piece of a line: `c` is its class (keyword, string, number, comment), none for plain text. */
export type Tok = { t: string; c?: 'k' | 's' | 'n' | 'c' };

const LANGS: Record<string, Lang> = {};
const put = (lang: Lang, exts: string) => exts.split(' ').forEach((e) => (LANGS[e] = lang));
put('c', 'ts tsx mts cts js jsx mjs cjs json jsonc css scss sass less go rs java kt kts scala swift dart c h cc cpp cxx hpp cs php proto graphql gql');
put('hash', 'py rb sh bash zsh fish ps1 yaml yml toml');
put('sql', 'sql lua');
put('markup', 'html htm xml vue svelte astro');

export function langOf(path: string): Lang {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return (m && LANGS[m[1].toLowerCase()]) || 'plain';
}

const KEYWORDS = new Set(
  (
    'abstract and as async await break case catch class const continue def default defer del delete do elif else ' +
    'end enum except export extends false finally fn for from func function go if impl implements import in ' +
    'interface is lambda let local match mod module mut new nil none None not null or package pass private ' +
    'protected pub public raise readonly return self static struct super switch then this throw throws trait ' +
    'true True False try type typeof undefined use var void while with yield fi done esac echo local ' +
    'select from where insert into update delete create table join left right inner outer on group by order ' +
    'having limit values set and or not null as distinct union'
  ).split(' '),
);
/** A keyword as written, or an upper-case one (SQL). */
const isKeyword = (w: string) => KEYWORDS.has(w) || (/^[A-Z]+$/.test(w) && KEYWORDS.has(w.toLowerCase()));

type Syntax = { line?: string; block?: [string, string]; quotes: string };
const SYNTAX: Record<Lang, Syntax | null> = {
  c: { line: '//', block: ['/*', '*/'], quotes: `"'\`` },
  hash: { line: '#', quotes: `"'` },
  sql: { line: '--', block: ['/*', '*/'], quotes: `"'` },
  markup: { block: ['<!--', '-->'], quotes: '"' },
  plain: null,
};

/** Longest file (characters) and line highlighted; past them the text is shown plain. */
const MAX_CHARS = 512 * 1024;
const MAX_LINE = 2000;

const WORD = /[A-Za-z_$][\w$]*/y;
const NUMBER = /\d[\w.]*/y;

/** The lines of `text`, each as pieces with their class. */
export function highlightLines(text: string, lang: Lang): Tok[][] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  const syn = text.length <= MAX_CHARS ? SYNTAX[lang] : null;
  if (!syn) return lines.map((l) => [{ t: l }]);
  let inBlock = false;
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
    if (inBlock && syn.block) {
      const end = line.indexOf(syn.block[1]);
      if (end < 0) return [{ t: line, c: 'c' }];
      i = end + syn.block[1].length;
      push(line.slice(0, i), 'c');
      inBlock = false;
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
          inBlock = true;
          break;
        }
        const stop = end + syn.block[1].length;
        push(line.slice(i, stop), 'c');
        i = stop;
        continue;
      }
      if (syn.quotes.includes(ch)) {
        let j = i + 1;
        while (j < line.length && line[j] !== ch) j += line[j] === '\\' ? 2 : 1;
        const stop = Math.min(j + 1, line.length);
        push(line.slice(i, stop), 's');
        i = stop;
        continue;
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
