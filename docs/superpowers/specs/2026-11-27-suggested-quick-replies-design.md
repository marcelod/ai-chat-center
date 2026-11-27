# Suggested quick replies (0.6.8, front D)

The quick replies of 0.6.7 (⚡ under the message field, spec 2026-11-26-context-quick-replies) start with three
fixed defaults and then hold only what the user edits. This round the app notices the messages the user keeps
repeating and offers them as suggestions inside the same ⚡ menu.

## Where the suggestions come from (hub)

- New route `GET /api/quick-replies/suggestions` → `{ suggestions: { text: string; count: number }[] }`. Same
  bearer token and Origin/Host checks as every other API route (it sits after the token check in `handleApi`).
- Sources: the transcripts of the sessions the hub knows (every registration, connected or ended, except the ones
  the user removed from the list). Sessions never connected to the app are not read.
- Reading (`src/hub/suggestions.ts`), bounded for CPU and memory:
  - only files whose real path ends in `.jsonl`, is a regular file and lies inside `<configDir>/projects` of the
    registration (`configDir`, else the hub's Claude config dir), both resolved with `realpath`, so a link never
    leads out of it; files not changed in the last 30 days are skipped;
  - at most the last 8 MiB of each file (recent messages are at the end; a cut first line is dropped), read as a
    stream line by line; lines over 64 KiB, or without a user/queued marker, are skipped before `JSON.parse`;
  - at most 200 files (most recently changed first);
  - any error on a file only drops that file; nothing is logged with a path.
- What counts as a user message:
  - `type: "user"` entries that are not `isMeta`, not sidechain (subagents), not a compaction summary and not a
    peer/agent message; a string content or text blocks only (an image, document or `tool_result` block drops the
    entry);
  - app messages: the inner text of each `[AI Chat Center message …]` block with a trusted key of that session
    (the same check as the transcript parser); a block with an untrusted key counts as nothing, and the raw block
    never counts;
  - prompts typed while Claude was busy (`queued_command` attachments, `commandMode: "prompt"`, `humanTurn`); a
    user entry with the same text within 30 minutes after one is not counted twice (older Claude Code wrote both);
  - left out: commands (`/…`), `!` shell input, anything with `[Attachment: …]`, Claude Code wrapper or system text
    (`<command-…>`, `<local-command-…>`, `<system-reminder>`, `<task-notification>`, `<bash-…>`,
    `<pasted_content>`), the interrupted marker, empty texts and texts over 80 characters.
- Counting: the text is normalized (`normalizeReply` in `src/shared/quickReplies.ts`: lowercase, without accents,
  every run of non-letters/digits turned into one space, trimmed). A normalized text that appears 3 or more times in
  the last 30 days is a suggestion; it is shown in its most recent original form (trimmed, inner whitespace
  collapsed). Order: most used first, then most recent. At most 10.
- Cache: the result is kept for 10 minutes per hub; concurrent requests share one scan. A failed scan is not
  cached.

## The menu (app)

- The ⚡ menu loads the suggestions when it opens (`api.quickReplySuggestions()`; a failure shows nothing).
- Below the list, a section "Suggestions" / "Sugestões" with each suggestion: the text (click: fills the field like
  a reply), "+" (adds it to the end of the list; disabled when the list is full) and "×" (dismisses it).
- Not shown: a suggestion already in the list (compared normalized, including the default replies while the list
  was never edited) and a dismissed one. Dismissed texts are kept normalized in `localStorage`
  (`acc.quickReplies.dismissed`, at most 200, same try/catch and in-memory fallback as the list), so a dismissed
  suggestion never returns in that browser.
- The section is hidden when nothing is left to suggest. Plain text (React escapes it). Both themes and narrow
  screens use the same tokens and widths as the existing menu.

## Privacy

Everything stays on the computer: the hub reads local transcripts and answers only the app on 127.0.0.1 with the
token; the list and the dismissed texts stay in the browser.

## Later

The list (and the dismissed texts) still live in the browser's `localStorage`. Since the suggestions now come from
the hub, a next step is to keep the list in the hub too (e.g. `~/.ai-chat-center/quick-replies.json` through a
`GET/PUT` route), so it is the same in every browser and on the phone.

## Tests

- Hub: `test/hub/suggestions.test.ts` (normalization; what counts and what does not; threshold, 30 days, 80
  characters, most recent original form, order and limit; queued duplicates; untrusted app blocks; byte cap from
  the end; files outside the projects folder and links out of it; cache and shared scan), `test/hub/server.test.ts`
  (route with and without the token).
- UI: `QuickReplies.test.tsx` (section shown, add, dismiss persisted, already listed or dismissed hidden, defaults
  compared, failure shows nothing), `quickReplies` storage of the dismissed texts.
