# Side panel: what was left (0.6.9)

Backlog: "Painel lateral: o que ainda falta". Follows `2026-11-27-side-panel-file-types-design.md`.

## Wrap lines in the code view

- The file bar of a code/text file gets a "Wrap lines" / "Don't wrap lines" button (the same texts and look as
  the code blocks' toggle, `aria-pressed`).
- Remembered per browser in `localStorage` (`acc.codeWrap`, `prefs.ts` `booleanPref`), off by default; it
  applies to every file opened afterwards.
- Wrapped: the view takes the panel's width (no `min-w-max`), each line uses `pre-wrap` and breaks anywhere
  (long paths, minified code); the line numbers stay at the top of their wrapped line, the cited line keeps its
  mark.

## Highlighting, still without a dependency

`highlight.ts` keeps its families by comment style (`langOf`) and now takes the extension (`extOf`) for the
rest:

- Keywords per language: JS/TS, Python, shell, Go, Rust, Ruby, Lua, SQL (any case), a C-like set (Java, Kotlin,
  C, C++, C#, Swift, Dart, PHP); JSON/TOML only `true false null`, YAML also `yes no on off`; CSS and HTML none.
  An unknown extension of a known family keeps the old mixed list.
- Multi-line strings, carried across lines like block comments: template strings (JS/TS, Go raw strings) and
  triple quotes (Python; `"""` in Java/Kotlin/Scala/Swift). `${…}` inside a template stays string-coloured.
- Decorators and annotations (`@name`, dots allowed) in JS/TS, Python, Java, Kotlin, Scala, Swift: class `d`.
  CSS at-rules (`@media`) are keywords.
- Keys: a JSON string followed by `:`; the name before `:` at the start of a YAML line (also after `- `); the
  name before `=` at the start of a TOML line: class `p`.
- HTML/XML/Vue/Svelte: tag names are keywords; words of the text are no longer coloured as keywords.
- Colours: `.tok-p` (the avatar text colour) and `.tok-d` (accent mixed with danger) in `index.css`, theme
  variables only, so both themes follow.

Left out on purpose: regex literals, string interpolation colouring, nested languages (script/style in HTML),
Markdown source colouring.

## PDF on a phone

No pdf.js. On a touch screen (`(pointer: coarse)`), the "Open in a new tab" / "Download" bar moves above the
frame with a hint for phones ("Phones often show nothing here…", both locales); elsewhere it stays below, as
before.

## Tests

`ui/src/highlight.test.ts` (per-language keywords, template strings, triple quotes, decorators, at-rules,
JSON/YAML/TOML keys, HTML tags, no character lost); `ui/src/components/SidePanelFileTypes.test.tsx` (the wrap
toggle and its storage; the PDF bar first on a touch screen).
