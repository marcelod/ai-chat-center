# Side panel: files, subagents and the session screen (0.6.7, front D)

Backlog items: "Painel lateral para ver imagens, Markdown e outros arquivos", "Subagentes trabalhando",
"\"idle\" com subagentes em segundo plano rodando" and idea 2 "Ver a tela da sessão no app".

## Panel

- `ui/src/components/SidePanel.tsx`. Right of the conversation on a wide screen (`md:`, about half the width,
  at most 640 px); the whole screen (`fixed inset-0`) on a narrow one, with a Back button.
- A stack of items (`file`, `subagents`, `subagent`, `screen`): opening a link pushes, Back pops, X and Esc close
  it all (Esc is ignored while focus is in a field, a menu or a dialog). Changing conversation closes it.
- `ChatView` takes one optional `panel` prop (`PanelApi`, bound to the session in `App` with `api.panelApi`).
  Without it there is no panel and nothing becomes a link.

## Step 1: Markdown files and images

- Hub: `src/hub/sessionFiles.ts`, modelled on `folderBrowse.ts`.
  - `GET /api/sessions/:sid/file?path=` and `POST /api/sessions/:sid/files/exists {paths}` (max 200), same token
    and Origin/Host checks as every route; a registered, not removed session only.
  - Roots: the session folder (`reg.cwd`, also the base of a relative path) and the session's own attachments
    folder (`~/.ai-chat-center/attachments/<sid>`), not the whole attachments folder.
  - Decided on real paths: the given path must be inside a root before anything is looked at, then its realpath
    must be too; a missing file behind a link that leaves the root answers `outside`, like folderBrowse.
  - Types: `.md`/`.markdown` (2 MB, `text/markdown; charset=utf-8`), `.png .jpg .jpeg .gif .webp` (10 MB, fixed
    image type, and the first bytes must be that image). The real file must have the same type as the name
    asked (a `x.md` link to `.env` is refused). Read capped at the limit (a file that grows is refused).
  - Response: fixed `Content-Type`, `X-Content-Type-Options: nosniff` (all routes), `Cache-Control: no-store`,
    `Content-Security-Policy: default-src 'none'; sandbox`. Errors carry a code (`file-outside`, `file-not-found`,
    `file-type`, `file-too-large`, `file-invalid`, `file-denied`), never a path.
- Links only for files that exist: decided for the batch check. The app collects candidate paths from the
  messages (`ui/src/filePaths.ts`: absolute, relative, `./`, `../`, a `:line` suffix dropped, never part of a
  URL), asks the hub once per path per conversation (`useExistingFiles`), and links only the answered ones. No
  disk scan: the hub only resolves the paths it is given.
- Markdown: one renderer for messages and files (`components/Markdown.tsx`): GFM, raw HTML skipped, no image ever
  loads (a local image becomes a panel link, a remote one shows its alt text), cited paths become panel links
  through a small remark plugin (`remarkFileLinks`) and an `acc-file:` href allowed by `urlTransform`. Inside a
  Markdown file, its relative links resolve against the file and always open in the panel ("not found" there).
- Images: fetched with the token (`api.getSessionFile`) and shown from a blob URL; the token never goes in a URL.
- Attachments: user events now also carry `attachmentPaths` (full paths, same order as `attachments`), so an
  image attachment chip opens the image.

## Step 2: subagents

- Hub: `src/hub/subagents.ts`. Folder `<dirname(transcriptPath)>/<sid>/subagents`. Format checked on real files
  (read only): `agent-<id>.meta.json` has `agentType`, `description`, `model`, `requestShape: "background"`,
  and `finished: true` once done (absent while running); `stoppedByUser` is treated as finished.
- The list reads the meta and only the first 16 KB and last 256 KB of each `agent-<id>.jsonl` (start time, last
  line time, last `tool_use` name), cached by size and mtime. A first line longer than the head (a long prompt)
  falls back to the file's creation time.
- Status: `finished` (meta), `running` (not finished, transcript written in the last 10 minutes, `STALE_MS`),
  `stale` otherwise. Newest first, at most 50. Model as the short name (`Opus 5.5`).
- Routes: `GET /api/sessions/:sid/subagents` and `GET /api/sessions/:sid/subagents/:id/events` (id
  `^[A-Za-z0-9_-]{1,64}$`; the transcript parsed by `TranscriptParser` with a new `sidechain` option, no diffs).
- App: the status pill in the header is a button ("Show subagents") that opens the list; the list and an open
  transcript refresh every 3 s while shown.

## Extra step: "agents working (N)"

- `SessionView.agentsWorking`: for an active session only, the subagents with status `running` above. An orphan
  (its session died, or its meta never got `finished`) stops counting after 10 minutes without a new line, and a
  disconnected session never counts, so the 0.4.4 stuck "working" cannot come back.
- Cost: counted at most every 5 s per session (`AGENTS_TTL_MS`); finished agents are not looked at again; others
  cost a stat of their two files, and a transcript is read (ends only) only when it changed. Part of the poll
  signature, so the app updates when the count changes.
- App: an idle session with agents working shows "agents working (N)" (own `data-state="agents"`, hollow dot),
  never "working"; clicking it opens the subagents. The session list shows a hollow dot and a small count chip
  (with a screen-reader text). A busy session keeps "working…".

## Step 3: the session screen

- Hub: `src/hub/sessionScreen.ts`. `GET /api/sessions/:sid/screen`, active background sessions only (bgId from
  `claude agents`), 501 on Windows. Runs `claude logs <bgId>` with `spawn` (`shell: false`, argument array,
  cleaned environment and the session's config dir, 10 s timeout, last 512 KB kept). A failure never returns or
  logs the output.
- Cleaning (`cleanScreen`), tested with explicit cases: terminal codes (CSI, OSC, DCS, charset), `\r`, control
  characters; then the literal token, every key of the session and the install secret; then every loopback
  address with its path (`127.x`, `localhost`, `[::1]`, `0.0.0.0`), `#token=`/`#pair=` fragments, and any run of
  16+ hex characters (a token cut by the terminal width). At most 200 000 characters, the end kept.
- App: "Session screen" in the ⋮ menu of a connected background session; monospaced text with Refresh.
