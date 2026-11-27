# Export a conversation as Markdown or PDF (0.6.8)

Backlog idea 10. The ⋮ menu of a conversation gets **Export conversation**, which opens two items in place:
**Markdown (.md)** and **PDF**.

## Content

- The **whole** conversation. The hub's `GET /api/sessions/:id/events` returns every event of the transcript
  (no paging; the UI keeps that full list in `eventsById`). At export time the app asks the hub again and falls
  back to the list it already holds when the hub does not answer.
- One document model (`buildExport` in `ui/src/exportConversation.ts`) feeds both formats:
  - header: session name (as shown, after a rename), folder, branch when known, export date and time;
  - a heading per day; every message with its author and `HH:MM`: You / Claude / `Claude → <agent>` /
    `Agent <name>` / Recap;
  - message text kept as Markdown;
  - tool actions as one line each (`Edit src/x.ts`); consecutive action groups merged; no diffs or results;
  - attachments by name, images by count; a `!` shell command as inline code;
  - an AskUserQuestion as Claude's question with its options, then the answer as a message from You;
  - notices (connected, disconnected, compacted) as short italic lines.
- Labels follow the app language (`ui.export.*`, plus existing `ui.you`, `ui.chat.*`, `ui.notice.*`).

## Redaction

Every string (name, folder, branch, texts, action summaries, attachment names) goes through
`cleanExportText`: `stripAppBlocks` (an `[AI Chat Center message id=… key=…]` block becomes its body, stray
tags go), then the session screen's filters. Those filters moved from `src/hub/sessionScreen.ts` to
`src/shared/redact.ts` (`stripTerminalCodes`, `redactAppSecrets`) so the hub and the UI share them; `cleanScreen`
keeps its behaviour. The app's addresses (127.x, localhost, `[::1]`, `0.0.0.0` with any scheme), `#token=` /
`#pair=` fragments and hex runs of 16+ characters are removed. The UI passes no secret list: the token, key and
secret are long hex and are caught by the hex rule.

Side fix in the move: the scheme part of the address pattern now only starts after a non-letter. The leftmost
match is the same, but a long run of letters is no longer rescanned from every position (the 200k-character
screen test took about a minute under load).

Known cost: a full git hash (40 hex) in a message becomes `[redacted]`, as on the session screen.

## Formats

- **Markdown:** a Blob download, `<name>-<YYYY-MM-DD>.md`. The name has `\ / : * ? " < > |` and control characters
  removed, whitespace replaced by `-`, at most 80 characters, and falls back to `conversation`/`conversa`.
- **PDF:** no new dependency. `printConversation` mounts the print view (`PrintConversation`, react-markdown with
  GFM, no raw HTML, images replaced by their alt text) in a `.print-export` element appended to `<body>`, sets
  `document.title` to the file name (the browser's default PDF name) and calls `window.print()`, so the person
  picks "Save as PDF". CSS in `index.css`: hidden on screen; in print media everything else in `<body>` is hidden
  and the view is light whatever the theme. The element and the title are put back on `afterprint`, or at the
  next export if the browser never fires it. In the same document instead of an iframe so it also prints on
  mobile browsers, which print the top page rather than an iframe.
- No `alert`/`confirm`: a failure shows "Couldn't export" inside the menu (`role="alert"`).

## Tests

- `test/shared/redact.test.ts`: the filters, app blocks, and the speed on a long run of letters.
- `ui/src/exportConversation.test.ts`: the model and the Markdown (authors, days, actions, attachments, question,
  notices, no link/token/key/block, language), `inlineCode`, file names.
- `ui/src/components/PrintConversation.test.tsx`: the print view during `print()`, cleanup on `afterprint`,
  cleanup of a view left behind, the Markdown download.
- `ui/src/components/ChatView.test.tsx`: the menu items, the shown name passed on, the failure message.
