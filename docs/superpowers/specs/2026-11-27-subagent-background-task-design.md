# Subagent waiting on its own background task (0.6.9)

Backlog: "Subagente com tarefa própria em segundo plano aparece como terminado".

## What Claude Code writes (checked on a real subagent transcript, Claude Code 2.1.x)

- The launch: an assistant line with `tool_use` `{ id, name: "Bash", input: { …, run_in_background: true } }`;
  its `tool_result` says "Command running in background with ID: …" (`toolUseResult.backgroundTaskId`). A launch
  the tool refused has an error result (`<tool_use_error>…`, `is_error`).
- The agent ends its turn ("waiting for the background command"); `agent-<id>.meta.json` gets `finished: true`.
- When the task ends, a `user` line (`isMeta: true`, `origin.kind: "task-notification"`) is appended to the
  subagent's own transcript, with a string content holding
  `<task-notification><task-id>…</task-id><tool-use-id>toolu_…</tool-use-id><status>completed</status>…`.
  The agent then works again and hands its result back.

## Rule

`src/hub/subagents.ts` keeps, from the tail it already reads (last 256 KiB), the number of **pending**
background tasks: `tool_use` ids with `run_in_background: true`, minus those with an error result, minus those
named by a `<tool-use-id>` inside a `<task-notification>` (any status: completed, failed, killed).

A subagent whose meta says `finished` but has pending tasks is `waiting`:

- `SubagentInfo.status` gains `'waiting'`; the panel shows it with the working ones, labelled "Waiting for
  task" / "Aguardando tarefa", with "Working for …".
- `runningSubagents` (the "agents working (N)" in the header and the list) counts `running` and `waiting`.
- Same anti-stuck rule as 0.6.7: with no new line (and no transcript change) for `STALE_MS` (10 min) the agent
  is plain `finished`; an agent stopped by the user (`stoppedByUser`) is never `waiting`.
- A finished agent with nothing pending is still skipped by `runningSubagents` (one stat less per poll); one
  with pending tasks is looked at again (two stats; the tail read only when the file changed).

Not used: "new lines after `finished`" (comparing the transcript's and the meta's times). It is unknown whether
Claude Code rewrites the meta when the agent ends the second time, so an agent could stay "working" for 10 min
after it really ended. The notification covers the same case. A launch older than the tail read (a very long
transcript) is not seen: the agent shows as finished, as before.

## Tests

`test/hub/subagents.test.ts` (synthetic transcripts): waiting until the notification, finished after it, a
refused launch, the orphan and stopped cases; `ui/src/components/SubagentsPanel.test.tsx`: the waiting agent
stays with the working ones and shows its label.
