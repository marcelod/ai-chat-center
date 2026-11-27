# Session screen as a terminal, and screen-only commands from the app (0.6.8)

Two fixes to the "Session screen" of 0.6.7 (spec 2026-11-26-side-panel), from the author's live test.

## 1. Play `claude logs` as a terminal

**Problem.** `claude logs <bgId>` prints a terminal stream, not text: absolute cursor moves (`CSI r;c H`),
column moves (`CSI n G`), line erases (`CSI K`), cursor up/down, and "cursor forward" (`CSI n C`) in place of
runs of spaces. 0.6.7 only stripped the codes, so every redraw (each frame of "Doodling…") became a new line
and the spaces vanished ("Falameurei").

**What the stream looks like (seen live, Claude Code 2.1.3xx).** A snapshot of the session's screen, drawn
at 200 columns and 50 rows (rows up to 50 in `CSI r;c H`, columns up to ~197 in `CSI n G`), with CR and no
LF; `COLUMNS`/`LINES` in the environment of `claude logs` do not change it. The attach the hub uses to type
commands (`script … claude attach`, `COLUMNS=120 LINES=40`) does not change it either.

**Decision.** The hub plays the stream in `@xterm/headless` (already a devDependency for the e2e driver;
bundled by esbuild into `plugin/dist/hub.mjs`, MIT, added to the third-party notices) and reads the final
screen back:

- `screenSize(raw)`: at least 200x50, larger when the stream moves the cursor further (a session attached
  from a bigger window), capped at 400x200. A bigger terminal is harmless: the stream places its lines with
  absolute moves and does not scroll.
- `renderScreen(raw, size)`: one `Terminal` per request (`scrollback: 0`, `convertEol: true`,
  `logLevel: 'off'`), disposed in `finally`; only the last 512 KB of the stream are played (`readScreen`
  already keeps at most that much); `write` is asynchronous, so the buffer is read in its callback, with a 5 s
  guard. The visible rows are read with `translateToString(true)`, rows the terminal wrapped are joined back
  into one line (so a token is never cut by the terminal itself), and the empty rows above and below are
  dropped.
- `screenText(raw, secrets)`: `renderScreen` then the existing `cleanScreen` (codes, app addresses,
  `#token=`/`#pair=`, the token, the keys, the install secret, any hex run of 16+). If the terminal fails, the
  old strip-only path is used. The route `GET /api/sessions/:sid/screen` answers `screenText`.

**Redaction, widened.** A secret cut by the session itself at the end of a line (Ink wraps long text with
its own line breaks): a line that ends with the start of a secret (6+ chars) or starts, after its indent,
with the end of one is redacted too. The scheme part of the app-address pattern is bounded
(`[a-z0-9+.-]{0,31}`): unbounded, a long line without spaces took quadratic time (the existing "keeps the
end of a long screen" test took ~50 s).

## 2. `/status`, `/cost`, `/context` and the other screen-only commands

**Before.** The app refused the commands classified `screen` (`/status`, `/cost`, `/context`, `/usage`,
`/help`, `/doctor`): "only shows its result on the session's screen…" (rule from 0.6.0, before the screen
existed).

**Decision.** In a background session whose screen the app can show (the same condition as the ⋮ "Session
screen" item: a panel with `screen`, a `bgId`, not disconnected), the Composer sends them like any other
command; they also show in the `/` list. Once the hub has typed the command, the app opens the "Session
screen" in the side panel by itself, with a line "Result of {cmd}: the screen refreshes in a moment.", and
loads the screen at once and again after 2 s and 6 s (the Refresh button stays). The status line under the
composer says "{cmd} sent. Its result is on the session screen." Elsewhere (no screen: Windows, a panel-less
host) the old refusal stays; in an interactive (terminal) session nothing changes (the app still asks before
sending a `/…` line as text).

**Open question for the live test.** Some of these commands open a dialog in the session (in recent Claude
Code `/status` and `/usage` open the settings tabs, `/help` a help dialog) that may stay open after the
attach closes. Check that the session still takes the next message and the next command from the app; if
not, keep those commands blocked or send Escape after a delay.
