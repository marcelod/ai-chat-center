# Follow a transcript moved into a worktree folder

## Problem

A session that connects with `/cc` and then enters a worktree has its transcript moved by Claude Code to
`<projects>/<project>--claude-worktrees-<name>/<id>.jsonl`. The registration keeps the old `transcriptPath`
and `cwd`, so the hub stops reading replies and shows the "does not save its history" warning.

## Decisions

- `src/hub/relocateTranscript.ts`: `findMovedTranscript(oldPath, sid, projectsDir)` looks for `<id>.jsonl`
  in the `<project>--claude-worktrees-*` folders first, then in every other project folder; the newest copy
  wins within a group. Only regular files (`lstat`, symbolic links ignored); the session id is validated.
  `transcriptCwd(file)` reads the last 64 KB and returns the `cwd` of the last line that has one.
- `ClaudeCodeProvider.relocated(reg)`: when `stat(transcriptPath)` says ENOENT, searches (at most every 10 s
  per session) under `<configDir or ~/.claude>/projects`, then writes the new `transcriptPath` and `cwd`
  with `updateRegistration` (`ifConnectedAt` for an active session). Called by `listSessions`, `poll` and
  `events`. The subagent routes read the updated registration, so `<id>/subagents/` follows.
- The warning stays as it was: it shows only when the file is found nowhere, and clears on the next
  listing once the path is valid.
- When a reader is replaced with the same keys (moved file, resume, a new `/cc`), the ids it already sent
  are not emitted again, so the app does not count the whole history as new.
- A new `/cc` already rewrites `transcriptPath` and `cwd` from the hook input (now covered by a test).
