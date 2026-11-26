# Stop, restart and remove background sessions from the app

Backlog idea 3 (0.6.7 round): `claude stop`, `claude respawn` and `claude rm` from the ⋮ menu, and a way
to clean up the background sessions that no longer run.

## Claude Code commands (checked with `--help`, Claude Code of 2026-11)

- `claude stop <id>` (alias `kill`): stops a background session; the conversation is kept.
- `claude respawn <id>|--all`: restarts a background session so it picks up the current Claude binary.
- `claude rm <id> [--discard-unpushed …] [--force-remove-worktree …]`: "if it's safe", removes a background
  session from the list and deletes its worktree; the conversation stays in `claude --resume`. Works on
  sessions that already exited. The app never passes the two override flags: a refusal is shown as is.
- `claude agents --json --all` also lists finished background sessions. A background entry with no `pid`
  does not run (seen live: states `done` and `blocked`); one with a `pid` runs, whatever its `state`.

## Hub

- `bgSessions.manageBackground(action, bgId, configDir, deps)`: runs `claude <stop|respawn|rm> <bgId>` from
  the home folder, `shell: false` (Windows: the `.cmd` shim through the shell as one line built from the
  validated action and 8-hex id only), environment cleaned like `claude --bg` (`cleanEnv`), the session's own
  `CLAUDE_CONFIG_DIR` only when it is not the default, 30 s timeout (the child is killed). It shares
  `runClaude` with `claude --bg` (same output and error handling: exit 0 or the first 500 characters of the
  output without escapes).
- `status.queryStoppedBackground()`: `claude agents --json --all`, background entries with no pid, a valid
  short id, a session id and a folder → `StoppedBackground { bgId, sessionId, cwd, name, state?, startedAt? }`.
- Routes (same token, Origin and Host checks as every other `/api` route):
  - `POST /api/sessions/<sid>/stop|respawn|rm`. 404 unknown or removed session. A connected session must be
    listed by `claude agents` as a background one with a short id (else 409 `not-background`; 503 if the
    lookup fails). Stop and respawn need a connected session (409 `session-disconnected`). Rm also takes an
    ended session, by finding its short id among the stopped ones. One action at a time per session (409
    `busy`). A refusal of claude is 502 `claude-failed` with claude's words as `error` (never the token: the
    command line holds only the action and the id).
    After success: stop marks the registration disconnected (`exited`) at once; rm marks it removed (out of
    the app, like "Remove from app"); respawn tells the provider a restart is coming (below).
  - `GET /api/background/stopped` → `{ sessions: StoppedBackground[] }` (503 when the lookup fails).
  - `POST /api/background/<bgId>/rm`: 400 for an id that is not 8 hex; 409 `not-stopped` unless the id is in
    the stopped list right now (the cleanup never removes a running session); runs `claude rm` with the hub's
    own config dir (the only one `claude agents` lists); then the app registration of that session, if any,
    is marked removed.

## Does a restarted session stay connected?

`claude respawn` keeps the session id and resumes the conversation in a new process. The registration is
keyed by session id and stays active; the new process fires `SessionStart` (`resume`), whose waiter
(`sessionSwitch`) records the new pid and transcript path, so app messages keep flowing with no new `/cc`.
The risk is the gap: while the old process is gone and the new one is not listed yet, the provider could take
three missing lookups for an exit and mark the session disconnected, and a waiter then finds no active
registration. So the respawn route calls `provider.expectRestart(sid)`: for `RESTART_GRACE_MS` (90 s) an
absence from `claude agents` is not an exit (the grace ends early as soon as the session is listed again).
The app says after a restart: "The conversation reconnects by itself; if it doesn't within a minute, open it
in a terminal and type /cc." This has to be confirmed live (see the report).

## App

- ⋮ menu (`ChatMenu`), only for a background session that runs (`bgId` present and not disconnected):
  "Restart session" (one click), "Stop session" and "Remove from Claude Code" (each asks for a second click
  in place, the same confirmation as Disconnect and Remove from app; never `window.confirm`). A refusal is
  shown in the menu, with claude's words when the code is `claude-failed`. "Remove from Claude Code" drops
  the conversation from the list at once and selects a neighbour, like "Remove from app"
  (`useLiveSessions.remove(sid, api.rmSession)`).
- After a stop the conversation shows as ended, with the usual "Resume in the background". The ⋮ menu of an
  ended session does not offer "Remove from Claude Code" (the session view has no short id once it is not
  running); the cleanup below covers it.
- Settings → "Clean up stopped sessions" opens a dialog that lists the stopped background sessions (name or
  "Unnamed", short id, state, folder), with checkboxes and "Select all". "Remove (n)" asks to confirm inside
  the dialog; the hub then runs `claude rm` for each, one after the other. Removed ones leave the list;
  failures stay selected and are listed with claude's words.
- Strings in `en.json` and `pt-BR.json` (`ui.chatMenu.*`, `ui.chat.respawned`, `ui.stopped.*`).

## Not done

- `claude respawn --all` and `claude rm` overrides (`--discard-unpushed`, `--force-remove-worktree`).
- Stop/rm for sessions of a non-default Claude config dir that the hub's `claude agents` does not list.
