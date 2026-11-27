# Review fixes C (0.6.12): failed sends and signed answers

Two findings of the full review of 0.6.11 (`docs/backlog.md`, "Revisão geral de 2026-11-27").

## 1. A failed send is lost by the next one

**Problem.** `Composer.deliver` started with `setFailure(null)`. The text of a send that failed with an
error other than 409 lived only in the "Could not send the message / Retry" banner, so sending another
message dropped it.

**Decision.** The failed text goes back into the box when another message is delivered:

- `deliver(body)` (a new send) first moves the failed text into the box (`joinText(failed, box)`, older
  first, a blank line between) and then sends. If the new send fails too, the banner now holds the new text
  and the box the old one; nothing is lost.
- `deliver(text, retry = true)` (the Retry button) only clears the banner: that text is the one being sent.
- A 409 on a new send puts its text into the box after what is there (`joinText(box, body)`) instead of
  keeping it only when the box was empty.
- A slash command (`runCommand`) and the start of an upload leave a failed banner up: the box is not free
  (a command failure puts the command back in it; an upload keeps the text until the files are on the hub).
  The upload's `deliver` then brings the failed text back. An upload refused with 409 replaces the banner,
  so the failed text joins the box first.
- Switching chats keeps the existing behaviour (the failed text becomes the draft when the box is empty).

No new UI strings.

## 2. AskUserQuestion answers are signed

**Problem.** `ask.mjs` (PreToolUse on AskUserQuestion) returned `permissionDecision: "allow"` with the
answers of any well-formed `questions/<sid>/<toolUseId>.answer.json`. Its gates (`answersFromApp` in the
config, `turns/<sid>.json`, `app-presence.json`) are plain files too, so anything able to write under
`~/.ai-chat-center` (e.g. a prompt-injected Claude using Write or Bash) could answer the question in
Claude's place.

**Decision.** The hub signs each answer file with the install secret, as it signs inbox messages, and the
hook allows only answers that check out.

- Format (`src/core/questions.ts`): the file is `{ answers | release, createdAt, sig }` with
  `sig = HMAC-SHA256(install secret, "ask1|<sid>|<toolUseId>|<createdAt>|<payload>")`. The payload is
  `release`, or `answers:` + `JSON.stringify` of the `[question, answer]` pairs sorted by question (the
  signature does not depend on key order). Only the payload may contain `|` (ids are `[A-Za-z0-9_-]`,
  createdAt is checked). The `ask1` prefix keeps it apart from the inbox format (`v2|…`): an inbox
  signature can never be replayed as an answer or the reverse.
- `writeAnswer` (used only by the hub's answer route) signs; `server.ts` is unchanged.
- `ask.ts` checks, before using the file: createdAt parses and is not earlier than the question
  (`start - 1 s`, so an old file for the same id is not accepted), the install secret can be read
  (`loadSecret`, never creates one), and `verifyAnswer` matches in constant time (`timingSafeEqual`) for
  this session and this tool use. Exactly one of `answers` / `release: true` must be present. The existing
  checks stay as they were (registration active and same `connectedAt` before reading the answer, parent
  alive, `validAnswers` against the questions).
- An unsigned or badly signed file (or no secret) is not an answer: the hook removes it, writes one line to
  `logs/ask.log` (session and tool use ids only, never the secret or the signature; nothing on stderr),
  sets the waiting state to `question` and returns no decision. Claude Code then shows its own dialog, and
  the app shows "question waiting in the terminal". This fails closed: a forged file can at most push the
  question to the terminal, never approve it.
- A signed answer whose keys do not match the questions keeps the old behaviour (removed, still waiting).

**Turn origin and the other gates.** They stay unsigned. They only decide whether the hook waits for the
app or hands the question to the terminal at once; none of them can produce an `allow`. With them forged,
the hook still needs an answer file signed with the install secret, which only the hub writes, and only for
the pending question the user answered in the app (with its token). So signing the answer is enough to stop
a forged approval. The worst a forged gate does is route the question to the app (or to the terminal),
which writing files can already disturb in other ways.

**Limit (unchanged).** Like inbox messages, this protects against files written into the state folder, not
against a process of the same user that reads `install-secret` (mode 0600, same uid). That is the existing
security model of the README.

**PROTOCOL.** Not bumped. `PROTOCOL` versions the hub ⇄ waiter inbox message and its signature
(`v2|sid|id|createdAt|text`), which did not change; the hub uses it to refuse sends to a session running
another plugin copy. Answer files are a separate channel between the hub and the ask hook. Mixed versions
during an upgrade:

- old hub + new hook: the old hub writes unsigned answers, the new hook refuses them and falls back to the
  terminal dialog (fail closed). After the hub restarts on the new code, answers work again.
- new hub + old hook: the old hook ignores the extra `createdAt` and `sig` fields and works as before.

## Tests

- `ui/src/components/Composer.test.tsx`: next send succeeds (failed text back in the box), next send fails
  (box keeps the first, Retry sends the second), next send gets 409 (both texts in the box), Retry does not
  refill the box, a command leaves the banner up, a message with a file brings the failed text back, an
  upload refused with 409 keeps both texts.
- `test/core/questions.test.ts`: the signature string and HMAC; rejects unsigned, tampered answer,
  tampered createdAt, cut signature, answer swapped for release, another session, another tool use,
  another secret, both fields, null; `writeAnswer` signs with the install secret.
- `test/hooks/ask.test.ts`: a valid signed answer is allowed; unsigned answer, unsigned release, tampered,
  signed for another session, for another tool use, with another secret, dated before the question, and no
  install secret all give no decision, remove the file, leave the `question` waiting state and log to
  `ask.log` without the secret.
- `test/hub/server.test.ts`: the answer route writes a signed answer (answers and release).
