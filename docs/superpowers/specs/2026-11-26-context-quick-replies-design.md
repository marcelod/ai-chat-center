# Context size and quick replies (0.6.7, front B)

Two additions to the bar under the message field (0.6.5: keyboard hint on the left; model · effort chip, mode and
plugin version on the right).

## 1. Context size of the conversation

### What the app shows

- In the bar, before the model chip: a 14 px pie (a ring plus a slice that fills clockwise from the top) and the
  percentage, e.g. `◔ 62%` (`ContextMeter.tsx`). It never shrinks (`shrink-0`); the model and mode chips truncate
  instead (the model chip got `min-w-0`), and the keyboard hint already truncates with "…".
- Colour: muted below 80%, yellow (`text-waiting-text`, bold) from 80%, red (`text-danger`, bold) from 90%. Not
  colour only: the percentage is always visible, and the button's accessible name adds "near the limit" /
  "almost full".
- Details in a tooltip (`role="tooltip"`, `aria-describedby` on the button), opened by hover, by keyboard focus and
  by a tap (stays open until a tap elsewhere, blur or Escape): `124k / 200k tokens`, the model, `38% left until the
  limit (76k tokens)`, a line saying Claude Code compacts automatically before the limit, the last compaction time
  (or "No compaction yet"), and, when the window size was deduced, a line saying so and pointing to
  `/ai-chat-center:cc usage on`.
- Only for active sessions, and only after the first reply (or a compaction that reported its size).

### Where the numbers come from

- **Tokens in use** (`TranscriptParser.contextTokens`): the `usage` of the latest main-thread assistant entry,
  `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` (output left out, the same formula Claude
  Code's status line uses for `used_percentage`). Sidechain (subagent) entries, `<synthetic>` entries and usages
  with invalid counts or a zero sum are ignored.
- **Compaction**: Claude Code writes a `system` entry with `subtype: "compact_boundary"` and
  `compactMetadata: { trigger: "manual" | "auto", preTokens, postTokens, … }`, followed by the `isCompactSummary`
  user entry (which still yields the existing "compacted" notice). The parser takes `postTokens` as the tokens in
  use (so the pie drops at once, before the next reply), and records the time (`lastCompact`). Without
  `postTokens` the size is unknown until the next reply. Checked on a real transcript (Claude Code 2.1.322):
  `preTokens 247217 → postTokens 20467`, next reply 91439.
- **Window size** (`shared/context.ts`, `contextWindowSize`):
  1. The size Claude Code reports to the status line, when `/cc usage on` is set and it is at least the tokens in
     use (a smaller one is stale after a model switch). Marked `exact`.
  2. Otherwise 1,000,000 when the model id says so (`[1m]` suffix or `-1m`) or the tokens in use are already over
     200k; else 200,000.
  The transcript's `message.model` does not carry the `[1m]` suffix (the session above was `claude-opus-5-5` at
  247k tokens), so without the status line a 1M session reads as 200k until it passes 200k. Hence the "estimated"
  line in the tooltip.
- **Status line input** (checked against the Claude Code status line docs, 2026-11-26): it carries `session_id`,
  `model.id`, and `context_window: { total_input_tokens, total_output_tokens, context_window_size,
  used_percentage, remaining_percentage, current_usage }`. `used_percentage` is input-only, like ours.
  `current_usage` is null after `/compact` until the next call. There is also `exceeds_200k_tokens`, a fixed
  threshold. The wrapper (`bin/statusline.ts`) now also records `context_window_size` in the session's meta file
  (`meta/<sid>.json`, field `contextWindow`), only for sessions that have a registration (connected to the app at
  some point), only a whole number between 1,000 and 100,000,000, and only when it changed (`setContextWindow`).
- **Auto-compact threshold**: not reported anywhere reliable (the status line has no such field; the transcript
  above shows an auto compaction at 247k on a 1M window, so it is not a fixed share of the window). The app
  therefore shows only "X% left until the limit" plus a line that Claude Code compacts before it.

### Contract

`SessionView.context?: { used: number; size: number; exact?: true; lastCompactAt?: string }`
(`src/shared/types.ts`, `ContextUsage`). The provider fills it for active sessions and includes it in the poll
signature, so a new reply or a compaction refreshes the list.

## 2. Quick replies

- A discreet ⚡ button at the start of the bar (left of the keyboard hint, `shrink-0`), disabled while a question
  blocks the field or files upload. It opens a small popover (`role="dialog"`) above it with the list.
- **A pick fills the field, it does not send** (appended after what is already typed, with a space; focus goes to
  the field). Sending stays an explicit Enter: a slip of the finger on a phone must not send "commit it" to a busy
  session, and the user can still add details.
- "Edit" shows a remove (×) button per item and a field to add one (Enter or Add); "Done" leaves edit mode.
- Storage: `localStorage` key `acc.quickReplies` (`ui/src/quickReplies.ts`), JSON array, read and written inside
  try/catch; a failed write keeps the list in memory until reload (like `prefs.ts`). Cleaned on save and load:
  trimmed, no blanks or repeats, at most 12 items of at most 500 characters. Until the user edits the list, the
  defaults come from the locales in the app's language (`ui.quickReplies.defaults.d1..d3`: "Go ahead", "Commit
  it", "Summarize what's left" / "Pode seguir", "Faz o commit", "Resume o que falta").
- The text is shown as plain text (React escapes it) and sent only through the normal composer path.

## Tests

- Hub: `test/hub/parseContext.test.ts` (usage sum, sidechain/synthetic/invalid ignored, compaction with and
  without `postTokens`, notice kept), `test/shared/context.test.ts` (window size rules), `test/core/meta.test.ts`
  (store and validate the size; read it from a status line input), `test/hub/provider.test.ts` (view field,
  exact size, drop after compaction and poll change, none when disconnected).
- UI: `ContextMeter.test.tsx` (pie and percentage, levels with words, tooltip by hover/tap/focus, Escape,
  estimated note, Portuguese, inside the bar), `QuickReplies.test.tsx` (storage cleaning and failures, defaults per
  language, pick fills without sending, append, edit add/remove persisted, empty list, Escape, disabled).
