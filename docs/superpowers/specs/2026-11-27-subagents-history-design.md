# Subagents panel: old ones in a closed History (0.6.8)

Backlog item "Painel de subagentes: antigos num 'Histórico' fechado". In a long session the subagents panel
listed every subagent the session ever launched, mostly "Finished", and the ones working now got lost.

## Behaviour

The list in the side panel (`SubagentList`, `ui/src/components/SubagentsPanel.tsx`) has three parts:

1. **Working** (`status: 'running'`) on top. When none is working, a line says "No subagents running now."
2. **This round**: ended subagents (`finished` or `stale`) whose last activity is at or after the person's
   last message, right below the working ones, always visible.
3. **History (N)**: every other ended subagent, newest first, in a section closed by default. The button
   uses the same look as "Other open sessions" in the session list (`ChevronIcon`, rotated 90° when open,
   `min-h-11`, muted semibold text) and carries `aria-expanded`.

An empty list keeps "No subagents in this conversation." The History section is left out when it is empty.
Opening the panel from the status button ("working" or "N subagents working") shows the working ones on top
with no extra step.

The History open/closed state lives in `ChatView`, so it survives opening a subagent's transcript and coming
back with Back. It starts closed for each chat view.

## The "this round" cut (the optional point)

Done in the UI, with no hub change: the hub already gives each subagent `lastActivityAt` (its transcript's
last line or file time, which for an ended one is when it ended), and the app already has the conversation's
events, where the person's messages are `kind: 'user'` (terminal or app; task notifications and subagent
messages are `kind: 'agent'`, so they do not count). `lastUserMessageAt(events)` takes the last one's `ts`.
Without a user message in the loaded events, every ended subagent goes to the History.

`stale` ones (not finished, no news for 10 minutes) are grouped like finished ones: they are not working.

## Limits

- The hub lists at most 50 subagents (`MAX_LIST`), newest first, so N counts at most those. Working ones are
  the newest, so they are never cut.
- No hub or route change; the parallel work on how a blocked `Agent` call is counted does not touch this.

## Tests

`ui/src/components/SubagentsPanel.test.tsx`: `groupSubagents` (split and order, no last message, no time),
`lastUserMessageAt`, and the panel: none working with a closed History that opens and closes
(`aria-expanded`), this round's finished ones visible below the working ones, no History when all are in
view, and the History staying open after viewing a subagent and going back.
