# Review fixes B (0.6.12)

Four findings of the full review of 0.6.11 (see "Revisão geral de 2026-11-27" in `docs/backlog.md`).

## 1. A poll slower than the timeout lost its changes (`src/hub/server.ts`)

`provider.poll()` empties its pending events and moves its signature as it runs. When the stream's 10 s
timeout won the race, the pass sent nothing and the poll's result was thrown away when it settled.

Decision:
- The tracked promise of the in-flight poll now fans out the result itself when the poll ends after the
  timeout (`timedOut`). The timed-out pass sends nothing, so each change is sent once.
- The next poll already waits for `inFlight`, which settles only after that fan-out: no overlap, and the
  late changes go out before the next poll's.
- One source of truth for "timed out": the timer sets `timedOut` only while the poll has not settled
  (`settled` is set first in the poll's own reaction), so the timeout and the result cannot both count.
- Same rule as a normal pass: nothing is sent once the hub is closed or the poll generation changed (all
  pages left; pages that come back reload their state).
- `HubOptions.pollTimeoutMs` (tests only, default 10 s). A late result and a late failure are logged.

## 2. After a resume, messages sent during a long turn were dropped (`src/hooks/waiter.ts`)

`discardOld` (start waiter, source `resume`) applied the 30-minute age cut for the waiter's whole life. A
start waiter can hold the lock across a long terminal turn, so an app message that waited more than
30 minutes for that turn was discarded (and recorded as delivered).

Decision: the cut drops a message only when it is older than 30 minutes AND was created before the waiter
started (`resumedAt = now()` at entry, the same clock as the cutoff). Leftovers from before the resume are
still dropped; anything sent after it is delivered whatever its age, like a stop waiter.

## 3. The deadline could end a waiter before any drain pass (`src/hooks/waiter.ts`)

`runWaiter` measures the deadline from entry and checked it at the top of the loop, after the startup work
(lookups, the claimed sweep). On a slow runner a short deadline returned before the inbox was ever read;
CI failed on Windows Node 22.

Decision:
- The deadline is checked after each pass, just before the sleep, so a waiter always makes at least one
  pass. The only `continue` (a dead pid re-resolved once) is bounded, so the loop still ends.
- The four tests that relied on `deadlineMs: 150/200` now use a long deadline, `vi.waitFor` the side effect
  (a `.unsigned` file, a log line, a count of passes) and end the waiter by disconnecting the session.
  Disconnect empties the inbox, so inbox assertions come before it.
- New tests: `deadlineMs: 0` with a queued message delivers it; with nothing queued it exits after one pass.

## 4. The command route used a different busy rule (`src/hub/server.ts`)

`POST /api/sessions/:id/command` refused with 409 whenever the raw `claude agents` status was not idle. The
session list (`provider.ts`) shows a raw `busy` without the hub's turn marker as idle (a background task
runs after the turn), so `/model`, `/effort` and `/compact` were refused while the app showed the session
idle.

Decision: the route uses the provider's rule. Raw `busy` counts only with the turn marker (`isBusy(sid)`);
`waiting` (or any other non-idle status) is still refused, and so is a command already being typed.

## Live checks

- A background session with a running background task (e.g. a `sleep 600 &` shell or a monitor) after its
  turn: the app shows it idle and `/model`, `/effort` and `/compact` go through.
- `claude --resume` a connected session, start a long terminal turn, send from the app, wait more than
  30 minutes: delivered at the end of the turn.
