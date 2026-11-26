# System notifications (backlog idea 16)

## Goal

Tell the user, through the operating system's notifications, when a session needs them while the app is in the
background: it finished its turn, it asks for a permission, or it asks a question.

## Decisions

- **Web Notifications API in the app**, no new process. The app already receives every session's state over
  SSE (`useLiveSessions`): a `sessions` change triggers a refresh of the list, and the notifications are derived
  from the state changes between two consecutive lists.
- **Replaces the MVP notification** (one notification per assistant reply, with the start of the reply as its
  body). That body carried conversation text, which this item forbids; "finished its turn" covers the same
  moment. The localStorage key `acc.notify` is kept, so a user who had turned it on keeps it on.
- **Transitions** (`sessionAlert(prev, next)` in `ui/src/notify.ts`), only for a session that was already in the
  previous list (the first list after load, and a session that just appeared, never notify):
  - `busy` -> `idle`: "Finished its turn".
  - not waiting for a permission -> `waiting` with `waitingKind` `permission` (or none): "Needs your permission".
  - not waiting for a question -> `waiting` with `waitingKind` `question`: "Asked a question".
  - `waitingKind` `input` (Claude Code's "waiting for your input" reminder) does not notify: the turn end already did.
  The previous states are tracked even while notifications are off, so turning them on never fires stale ones.
- **Only when the user is away:** `document.visibilityState !== 'visible'` or `!document.hasFocus()`.
- **One notification per session at a time:** `tag` = `acc-session-<sessionId>`, so a newer one replaces the older.
- **Content:** title = the session's display name (cut at 60 characters); body = one of the three short,
  translated phrases. No conversation text, no folder path, no token or link.
- **Click:** focuses the window, opens that conversation (`select(sessionId)`) and closes the notification.
- **Settings menu:** "System notifications" checkbox, off by default. Turning it on calls
  `Notification.requestPermission()` (from the click, as browsers require). Below it, the state: allowed,
  blocked by the browser, the browser will ask, or not available here. The preference lives in `ui/src/prefs.ts`
  (localStorage with try/catch, memory fallback, `useSyncExternalStore`).
- **Support:** unavailable when `Notification` is undefined or `window.isSecureContext === false`. The app runs on
  `http://127.0.0.1:<port>`, which Chrome, Edge, Firefox and Safari treat as a secure context. Constructing a
  `Notification` can still throw (Chrome on Android requires a service worker): caught and ignored.
- While notifications are on and allowed, a hidden tab keeps its SSE stream open (unchanged behaviour), since that
  is what delivers the state changes.
