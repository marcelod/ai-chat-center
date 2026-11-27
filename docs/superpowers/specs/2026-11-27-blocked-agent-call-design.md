# Blocked agent call (0.6.8)

## Problem

An `Agent`/`Task` call that auto mode (or the user) denied still showed in the conversation as
"Claude → <agent>", as if the subagent had been started. Its `tool_result` carries `is_error: true` and a
text such as "Permission for this tool use was denied…".

## Decision

Keep the bubble (the author wants to see that it was tried), but mark it:

- `ChatEvent` `toAgent` gains `blocked?: true` and `blockedReason?: string`.
- `TranscriptParser` keeps each toAgent event by its `tool_use_id` until the result arrives. When the
  result is an error, it sets `blocked` and re-emits the same event (same id), so a live session updates
  the bubble in place when the result lands after the call (the reader and `mergeEvents` replace by id).
  A successful result emits nothing new. The same applies to a text `SendMessage` whose result is an error
  (the teammate never got the message).
- `blockedReason` is the first non-empty line of the error, with tags (`<tool_use_error>`) removed, paths
  (absolute, `~/…`, `C:\…`) replaced by "…", cut to 200 characters with "…". The full error is not sent
  to the app.
- UI (`ToAgentBubble`): the header (Claude → name) and the request are dimmed (`opacity-60`), a red
  outlined tag "Not run" / "Não executado" sits next to the name, and the reason follows in small italic
  text. The bubble keeps its filled background, so it reads over a conversation background in both themes.
  The list preview reads "→ name: (Not run) …".
- Wording: "Not run" rather than "Blocked", since the same error shape also covers a user rejection or a
  failed call; the reason line says which.

## Subagents panel and "agents working"

No change needed: both come from `<sessionId>/subagents/agent-<id>.meta.json`, which Claude Code writes
only for a subagent that actually started. A denied call creates no file, so it is never listed or counted.

## Tests

- `test/hub/parse.test.ts`: synthetic Agent `tool_use` + `tool_result` `is_error` (pushed separately, as
  live); the update keeps the id, has the short reason without paths or tags; `Task` with a long string
  result; a launched agent emits no update.
- `ui/src/components/ChatView.test.tsx`: blocked bubble dimmed with the tag and reason; a normal one without.
- `ui/src/format.test.ts`: preview tag.
