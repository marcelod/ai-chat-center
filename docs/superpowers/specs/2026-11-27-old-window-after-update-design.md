# Old app window after an update (0.6.9)

Backlog: "Janela antiga do app fica aberta e vazia depois de um update".

## Cause (checked in the code)

- `/cc` runs `ensureHub`: a proven hub of an older plugin version is stopped (`process.kill(pid)`, SIGTERM;
  on Windows an immediate kill) and a new hub is spawned.
- The token **does change**: `startHub` calls `rotateToken()` on every start (32 random bytes, 0600).
- The new hub knows no page (`/api/window` pings live in the old hub's memory), so `/api/pair-code` issues a
  code and `/cc` opens a new window.
- The old page keeps its old token. Its stream errors; the reconnect asks `/api/health?challenge=` and the
  new hub's proof does not match the old token, so the token is dropped and the page showed the generic
  "Open the link shown by /cc" screen (made for a page opened without a link). A hidden page (no stream) gets
  the same through a 401 on its next `/api/window` ping. If the new hub binds another port, the old page
  only finds `unreachable` and retries forever behind a stale list.

## What changes

1. **The hub says goodbye.** `createHub().close()` ends every open stream with
   `event: bye` / `data: {"reason":"stopped"}` before closing. `main.ts` already calls `close()` on SIGTERM,
   SIGINT and when hub.json names another hub, so a hub stopped by `ensureHub` tells its pages. The reason
   is "stopped": the hub cannot tell an update from any other stop (a dedicated shutdown route would be one
   more way to stop the hub for no gain). On Windows the kill is immediate and no `bye` goes out: the page
   falls back to point 3.
2. **The page ends.** On `bye` the page closes its stream, drops the token (it dies with the hub) and shows
   "The app was updated; this window can be closed" (`ui.ended.*`, both locales). A window opened with
   `#pair=` (by `/cc` or the launcher, a Chrome `--app` window) also calls `window.close()`; a normal tab does
   not try (browsers refuse it) and only shows the screen.
3. **Lost connection.** A page that had a token and loses it (proof mismatch, 401) shows the same screen
   instead of the "/cc link" one; the "/cc link" screen stays for a page that never had a token. A hub that
   stays `unreachable` for `LOST_MS` (2 min) of reconnect attempts ends the page the same way.

Both only help from the update after 0.6.9: the window of an older version runs the older page code.

## Idea 1 (reconnect and pair again by itself): not done

The new hub has a new random token and no channel to the old page: the old hub dies without knowing it,
and the old page cannot prove anything to the new hub. Every way to re-pair would need a credential that
survives the hub restart (a per-window secret saved on disk by the old hub and kept in the page), which is a
long-lived token in disguise and undoes the rotation on every start; or the token/code in a URL or on the
Chrome command line, which the pairing codes exist to avoid. A new hub may also listen on another port (another
origin, other storage). So the old window ends and `/cc` opens a fresh one.

## Tests

- `test/hub/server.test.ts`: closing the hub sends `bye` on an open stream, then ends it.
- `ui/src/hubStopped.test.tsx`: `bye` closes a `#pair=` window and shows the screen; a `#token=` tab only
  shows the screen.
- `ui/src/staleToken.test.tsx`: a token rotation now shows the "updated" screen.
- `ui/src/useLiveSessions.test.tsx`: `unreachable` for `LOST_MS` drops the token.
