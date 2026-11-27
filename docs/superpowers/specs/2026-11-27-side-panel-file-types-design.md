# Side panel: code, PDF and diffs (0.6.8, front E)

Backlog item "Painel lateral: próximos tipos de arquivo". Builds on 2026-11-26-side-panel (same route, same
checks). `/status` in the panel is front A, not here.

## File types (`src/shared/fileTypes.ts`)

One list shared by the hub (what it serves) and the app (which cited paths are candidates):

- Markdown `md markdown`; images `png jpg jpeg gif webp` (unchanged).
- Text, shown as code: `ts tsx mts cts js jsx mjs cjs json jsonc css scss sass less html htm vue svelte astro
  py rb php go rs java kt kts scala swift dart lua c h cc cpp cxx hpp cs sh bash zsh fish ps1 sql graphql gql
  proto yaml yml toml xml txt log csv tsv`.
- PDF `pdf`.
- Left out on purpose: formats that usually hold secrets (`.env*`, `.ini`, `.conf`, keys, certificates), and
  one-letter extensions other than C's `c`/`h` (too many words would become candidates). Files without an
  extension (`Makefile`, `Dockerfile`) are not opened.

## Hub (`src/hub/sessionFiles.ts`)

- Same roots, realpath checks, refusal of links that leave the folder, "the real file has the type of the name
  asked" rule, error codes without a path.
- Text: `text/plain; charset=utf-8`, at most 1 MB; refused (`file-type`) when the first 8000 bytes hold a NUL
  (a binary file named `.ts`).
- PDF: `application/pdf`, at most 20 MB; the bytes must start with `%PDF-`.
- The read buffer is the size seen at the stat (never the type's limit): a small PDF does not allocate 20 MB.
- Every file response keeps `Content-Security-Policy: default-src 'none'; sandbox`, `X-Content-Type-Options:
  nosniff` and `Cache-Control: no-store`.
- App CSP: `frame-src blob:; object-src blob:` added, so the panel can frame a PDF from a blob URL (with
  `default-src 'self'` both were blocked). Only the app's own scripts can create blob URLs, and the app makes
  one for a PDF only (see below).

## App

- Paths (`ui/src/filePaths.ts`): the regular expression takes every extension of the shared list (longest
  first) and keeps a `:line` (or `:line:col`) suffix. The link text includes the suffix (`server.ts:42`); the
  href is `acc-file:<encoded path>#L<line>` (the path is encoded, so a `#` in it cannot be confused). Inline
  code `src/a.py:7` and Markdown links with a GitHub anchor (`a.ts#L12`, `#L12-L20`) carry the line too. As
  before, only paths the hub says exist become links (`files/exists`), so `Node.js` costs a check, not a link.
- `FileLinks.open(path, line?)`; the panel item `file` has an optional `line`.
- Code view (`components/CodeView.tsx`): line numbers, `whitespace-pre` with horizontal scroll, the cited line
  marked (`aria-current`, accent tint and bar) and scrolled to the middle (`scrollIntoView({block:'center'})`).
  A Markdown file cited with a line opens as its source at that line; without a line it is still rendered.
- Highlight (`ui/src/highlight.ts`), no dependency: per line, with block comments carried across lines; comment
  styles `//` + `/* */` (C family, CSS, JSON…), `#` (Python, shell, YAML, TOML), `--` + `/* */` (SQL, Lua),
  `<!-- -->` (markup); strings (single line), numbers, and one shared keyword list (upper-case for SQL). Not
  exact by design. Files over 512 KB or lines over 2000 characters are shown plain. Colours come from the theme
  tokens (`--c-accent`, `--c-ok`, `--c-waiting-text`, `--c-muted`), so both themes follow.
- PDF: fetched with the token like images; the app checks the first bytes are `%PDF-`, then makes a blob with a
  fixed `application/pdf` type (whatever the response said) and shows it in an `<iframe>` (no `sandbox`
  attribute: Chrome refuses to show a PDF in a sandboxed frame). Below it, "Open in a new tab" and "Download"
  (the same blob URL), with a hint: phone browsers often show no PDF inside a frame. The URL is revoked when
  the item closes. The token never goes in a URL.
- Attachments: any attachment of a type the panel opens (not only images) is a button.
- Diff in the panel: with "Show file changes" on, each Edit/MultiEdit/Write diff has "Open in the panel" next to
  "Show changes". The panel item `diff` shows the whole diff (up to the 400 lines the hub keeps) at the panel's
  width, titled "Changes · <file name>", with the full path under the header. `DiffLines` is shared by the
  inline view and the panel.

## Not done

- Exact highlighting (a real grammar) would need a dependency.
- No "wrap lines" in the code view yet; long lines scroll sideways.
