# Release checklist

> **Nota (pt-BR):** Rode este roteiro antes de cada release. A verificação 2 é manual e gasta tokens: ela confirma, numa sessão real com o modelo padrão atual, que o Claude ainda age sobre uma mensagem do app. Se o resultado for `REFUSED`, não publique.

## 1. Automated

- CI green on the release commit: `test`, `dist` and `runtime-smoke` (runtime and flow smoke) on Ubuntu, Windows and macOS.
- `claude plugin validate plugin` and `claude plugin validate .` pass.

## 2. A keyed app message is acted on (manual, live)

Claude Code labels the waiter's output as a system notification ("not user input"). The `/cc` command asks Claude to treat keyed blocks from the AI Chat Center hook as typed by the user. That relies on model behavior, so check it on every release with the **current default model** (do not pass `--model`; never type `/model` in a driven session, it rewrites `~/.claude/settings.json`).

Use an isolated state folder and port, and a fresh project folder:

```sh
export AI_CHAT_CENTER_HOME="$(mktemp -d)/home" AI_CHAT_CENTER_PORT=7790 CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1
P="$(mktemp -d)"; S="$(mktemp -d)"
node scripts/e2e/drive-session.mjs run --dir "$P" --state "$S" --max-secs 600 -- --plugin-dir "$PWD/plugin" &
node scripts/e2e/drive-session.mjs screen --state "$S"            # trust the folder if asked:
node scripts/e2e/drive-session.mjs send --state "$S" '\e[B' '\r'
node scripts/e2e/drive-session.mjs send --state "$S" '/cc' '\r'
node scripts/e2e/drive-session.mjs wait --state "$S" --text 'AI Chat Center is ready'
node scripts/e2e/drive-session.mjs app --state "$S" --home "$AI_CHAT_CENTER_HOME" --port 7790
```

- `ACTED <word>` (exit 0): pass.
- `REFUSED <word>` (exit 2): the message was delivered but the model declined it. Release blocker: record the Claude Code version, the model and the screen (`screen --state "$S"`), and do not publish.
- `UNDELIVERED <word>` (exit 1): delivery itself failed; see `$AI_CHAT_CENTER_HOME/logs/waiter.log`.

Clean up: stop the driver (`kill %1`), stop the hub (delete `$AI_CHAT_CENTER_HOME/hub.json` and it exits within a minute, or kill its pid after checking that its command line contains `hub.mjs`), and check that no `waiter.mjs`, `hub.mjs` or `claude --plugin-dir` process is left.

Record the result (Claude Code version, model, verdict) in [e2e-results.md](e2e-results.md).

## 3. Windows

Run [windows-checklist.md](windows-checklist.md) once on a Windows machine for any release that changes the hooks, the hub start or the waiter.

## 4. Tag

Bump the version (see "Releasing" in the README) for every release that changes the hub API, such as the question endpoint: a running hub of an older version is replaced only when the version differs, and an older hub without the endpoint would answer the app's question POSTs with 404.

Tag the release commit `vX.Y.Z` and push the tag (see "Releasing" in the README).
