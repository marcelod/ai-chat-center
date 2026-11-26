# AI Chat Center

A Claude Code plugin plus a local web app (WhatsApp-style) to follow and reply to Claude Code sessions. See [README.md](README.md) for what it does and how it works. The open work is in [docs/backlog.md](docs/backlog.md).

## Language

- Talk to the author in Brazilian Portuguese. `docs/backlog.md`, the testing guides in `docs/testing/` and the notes to the author are in Portuguese too.
- Code, comments, identifiers, commit messages and the specs in `docs/superpowers/` are in English.
- Every UI string exists in both `src/core/locales/en.json` and `src/core/locales/pt-BR.json`; a test (`test/core/i18n.test.ts`) requires the same keys in both. UI code uses `t('ui.…')`, the hooks use `t(language, 'hook.…')`.

## Layout

- `src/hooks/`: the hooks that Claude Code runs (`hook.ts`: `/cc` and the prompt hook; `waiter.ts`: delivers app messages, started by `asyncRewake` hooks; `ask.ts`: AskUserQuestion; window, launcher and status line helpers). Entry points are in `src/bin/`.
- `src/hub/`: the local HTTP server on 127.0.0.1 (`server.ts` routes, `provider.ts` session state from registrations, transcripts and `claude agents`, `bgSessions.ts` background sessions, `search.ts`, `transcript/` parsing).
- `src/core/`: state under `~/.ai-chat-center` (registry, inbox, busy and waiting markers, config, signatures), paths, i18n, version.
- `src/shared/`: types and helpers used by both the hub and the UI (imported in the UI as `@shared/…`).
- `ui/`: the React + Vite + Tailwind 4 app (`ui/src/components/`, hooks such as `useLiveSessions.ts`). Its tests sit next to the code (`*.test.tsx`).
- `plugin/`: what Claude Code loads: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `commands/cc.md`, and the built `dist/`.
- `test/`: Vitest tests for `src/` (`test/core`, `test/hooks`, `test/hub`, `test/shared`); `test/plugin` is the slow build suite.
- `docs/superpowers/specs/` and `plans/`: one design spec per round, named `YYYY-MM-DD-<topic>-design.md`.

## Commands

```
npm test            # src tests
npm -w ui test      # UI tests (or: cd ui && npx vitest run)
npx tsc --noEmit -p . && (cd ui && npx tsc --noEmit -p .)
npm run build       # regenerates plugin/dist (committed)
npm run test:build  # slow build + bundle smoke tests
```

## Rules

- **`plugin/dist` is committed and must match the source.** After changing `src/`, `ui/` or the locales, run `npm run build` and commit `plugin/dist` with the change. Any change to `plugin/dist` needs a version bump: `package.json`, `ui/package.json`, `plugin/.claude-plugin/plugin.json` and `src/core/version.ts` (a test compares `plugin/dist` with the last `v*` tag). See `docs/testing/release-checklist.md`.
- **Bump `PROTOCOL`** in `src/core/version.ts` only when the app message format or its signature changes.
- **Hook output on stderr reaches Claude.** Never write warnings or debug output to stderr in the hooks or the waiter; log to `~/.ai-chat-center/logs/` instead.
- **Security model:** app messages are signed with the install secret and wrapped with a per-connection key; the waiter delivers only valid ones. Do not weaken signature, key or token checks, and never print the token, the key or the app link in Claude's replies or in logs.
- **UI styling:** Tailwind utilities live in a CSS layer, so the plain `.md …` rules in `ui/src/index.css` beat them. To change Markdown elements (`pre`, `code`, tables), add a rule in `index.css` instead of a utility class. Check both themes (light and dark) and a conversation with a background.
- **Tests:** add or update a test for every behaviour change. Hub tests inject `claude agents` output and the clock (`new ClaudeCodeProvider(lookup, { now, isAlive })`); UI tests render inside `<LangProvider lang="en">`.
- Commits use Conventional Commits with a scope, as in the history: `feat(app): …`, `fix(hub): …`, `docs(backlog): …`, `build: 0.6.6 and regenerate plugin/dist`.

## Working in this repo

- Several Claude sessions often work here at once, some in the background. Work in a git worktree under `.claude/worktrees/` (the main checkout may be blocked for editing), and before starting a backlog item check `git worktree list` and the other branches, so two sessions do not do the same work.
- Merge into `main`, push and tag only when the author asks. The author runs the plugin straight from this repo's `plugin/` folder (a directory marketplace), so merging into `main` updates the plugin in every session after `/reload-plugins`. Pushing to GitHub uses the `marcelod` account.
- Keep `docs/backlog.md` current: move a finished item to "Feito" with its version, and add what still needs a live check to "A testar no uso".

## Live tests

- `/model` and `/effort` sent to a real session also rewrite the defaults in `~/.claude/settings.json` (`model`, `effortLevel`): note the previous values and put them back.
- `claude logs <id>` and the session screen show the `/cc` link with the app token: do not paste them into chat or files.
- `claude --bg --help` creates a real session; use `claude --help`. Remove test sessions you create (`claude rm`).
- For an isolated run, set `AI_CHAT_CENTER_HOME` and `AI_CHAT_CENTER_PORT` (see `docs/testing/release-checklist.md`).
