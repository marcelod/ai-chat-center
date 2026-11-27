# Audit fixes after 0.6.9

Fixes for the confirmed findings of the 0.6.5–0.6.9 audits (security, hub, UI, compliance). Each finding was
confirmed first (a failing test or a measurement); the ones left out are decisions still with the author
(a closed group showing "waiting", the gnome-terminal/Ptyxis order, a redacted git hash, the config lock,
plugin downgrade).

## App

- **Markdown keeps its nodes.** `components` and the remark plugins of `MarkdownText` are defined once
  (the `img` renderer reads `linkBase` from a context; the plugin list is memoized per `linkBase`).
  react-markdown uses the renderers as element types, so new ones per render remounted every code block
  and link: "wrap" and "Copied" were lost and find-in-chat ranges pointed at detached nodes.
  `MarkdownText` and `CodeView` are `React.memo`: an SSE event of any session no longer parses or
  reconciles them again when their props did not change.
- **File path finder is linear.** `*` and `_` open a path only when they do not follow a path character
  (`(?<![\w@+\-.\/])[*_]+`). Before, every `_` of a long `_a_a…` run started a scan to its end: 4 s for
  100 KB, on every render.
- **Effort menu on a phone.** Below `md` the effort list stacks above the model list (`flex-col`,
  `md:flex-row`, `max-w-[calc(100vw-1rem)]`).
- **File links past 200 paths.** Each answer of `files/exists` sends the next batch, one request at a time;
  a failure waits for the next change of the events.
- **Status pill name.** The accessible name is the state, then "Show subagents".
- **Wording.** `ui.panel.agentsWorkingOne` ("1 subagent working"); `formatTokens(n, lang)` uses the
  language's decimal mark through `Intl.NumberFormat` ("1,3M" in pt-BR).
- **Subagents polling** pauses while the tab is hidden and loads at once when shown; an unchanged answer
  keeps the same object (nothing redrawn).
- **Session screen** drops an answer older than the latest load (sequence number).
- **Stopped sessions dialog** gives the focus back to Close when the confirm row goes away, so Escape
  still closes it.
- **Window size** after a reload: the saved size is read (without resizing), so an unchanged size is not
  sent again.
- **Errors of stop/respawn/rm** show the app's own message only (see the hub below).

## Hub

- **Redaction is linear.** The app-link scheme is at most 32 characters (`[a-z][a-z0-9+.-]{0,31}`), so a
  hex blob or an `a1a1…` run costs a bounded scan per position (it was 2 s for 100 KB; the screen fallback
  cleans up to 512 KB). OSC/DCS/PM/APC codes end at the next ESC instead of a lazy match across ESCs
  (quadratic with many unterminated openers); a lone opener is then removed by the two-byte rule. Everything
  redacted before still is: the host, path and fragment of every loopback link, the secrets, long hex runs.
- **Windows: no `claude.cmd` from the session folder.** `runClaude` (resume, start, stop, respawn, rm) and
  `claude agents` set `NoDefaultCurrentDirectoryInExePath=1`, as `openTerminal` does.
- **Private files in the side panel.** `FileRoots` gains `home` and `open`. Refused with
  `403 file-private`: anything in a dot folder or a dot file right in the home (`~/.ssh`, `~/.config`,
  `~/.claude`, `~/.ai-chat-center`…), and names of secrets anywhere (`.env*`, `*.pem`, `*.key`, `id_rsa*`,
  `id_dsa*`, `id_ecdsa*`, `id_ed25519*`, `*credentials*`, `.netrc`, `.npmrc`, `.pypirc`). Checked on the
  given path (before any probe) and on the real path (a link to a private file is private). The session's
  attachments folder is `open`: an attachment always opens. Dot folders inside a project (`.github/…`)
  still open. A session whose folder is itself a dot folder of the home loses the panel for its files: a
  conscious trade.
- **Subagent transcripts** never carry app messages: in side-chain mode the parser strips app blocks to
  their body (no id, no key) and shows them as ordinary text.
- **502 of stop/respawn/rm** is `claude <action> failed` with code `claude-failed`; claude's output (which
  may hold paths) goes only to the hub log, redacted with `redactAppSecrets`. The app no longer appends it.
- **Clean-up of stopped sessions** does not mark removed a registration that is active again (the same
  session resumed). Both routes that run `claude rm` lock on `bg:<bgId>`.
- **readCapped** reads up to the size seen by the stat; a file that grew since is shown as it was, never
  refused. Only that size is judged against the limit.
- **Restart marks** are pruned in `poll()` once their grace ends or when the session has no registration.
- **Subagent cache** is an LRU capped at 2000 entries.

## Tests added

Loopback addresses in the app-link filter, the shared file type list, the `!` exclusion, the 64 KiB line
skip and the file cap of suggestions, a blocked `SendMessage` (and a Windows path hidden in its reason),
"Wrap lines" kept after a remount, and a test for each fix above (performance tests with a time limit for
the regular expressions).
