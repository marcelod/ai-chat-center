# AI Chat Center

[Português](README.pt-BR.md)

AI Chat Center is a Claude Code plugin with a small local web app. Follow your Claude Code sessions in a WhatsApp-style window and reply from there: keep an eye on long tasks, answer when Claude is done, and start or resume sessions without opening a terminal. Everything runs on your own computer.

```
+----------------------+--------------------------------------+
| Sessions             | my-project                           |
|----------------------|--------------------------------------|
| > my-project    (2)  |  you:    add a retry to the uploader |
|   api-server         |  claude: done, 3 files changed       |
|   docs-site          |  you:    now run the tests           |
|                      |--------------------------------------|
|                      | [ type a message...            ] [>] |
+----------------------+--------------------------------------+
```

## What you can do

- **Chat with every connected session** from one window: messages, Claude's replies, the actions it ran (with the diff of edited files, if you turn it on) and the agents it talked to, in a group-chat view.
- **Send messages while Claude works.** They wait in a queue and are delivered when the turn ends.
- **See the state of each session** (working, idle, waiting for you) and, if you turn them on in the settings, get a browser notification when Claude replies.
- **Answer Claude's multiple-choice questions** from the app (opt-in, see `answers on` below).
- **Attach files and images** (📎, drag and drop, or paste).
- **Background sessions:** start a new session in any folder under your home folder, resume one that ended, run slash commands (`/compact`, `/model`, `/effort`…), switch the model and effort, and open the session in a terminal (`claude attach`).
- **Search** the open conversation (every occurrence highlighted, with previous and next) and all conversations, including ended ones.
- **Organize:** rename, pin, remove from the list, and give each conversation a background colour, gradient or image. Its colour also tints the conversation's avatar in the list.
- **See your 5-hour usage** in the list (opt-in, see `usage on` below).
- The app is available in English and Brazilian Portuguese.

## Requirements

- **Claude Code 2.1.139 or newer.** Background sessions use `claude --bg`, `claude agents` and `claude attach`, which need a recent Claude Code.
- **Node.js 18 or newer on the PATH that Claude Code sees.** The hooks run with `node`; the plugin needs no `npm install` and no shell (no Git Bash on Windows). Without Node, every prompt in every session shows a hook error: install Node, or uninstall the plugin.
- **Windows:** the native Claude Code installer does not install Node. Install Node.js (from nodejs.org, or `winget install OpenJS.NodeJS.LTS`), then close every terminal and editor and open a new one, so Claude Code sees it (`node -v` should work there).
- **A browser.** Chrome, Chromium or Edge give the app its own window; any other browser opens it in a tab.

## Install

In Claude Code:

```
/plugin marketplace add marcelod/ai-chat-center
/plugin install ai-chat-center@ai-chat-center
```

Then type `/cc` in a session.

**From a local clone** (to try changes): `/plugin marketplace add /path/to/ai-chat-center`, then the same `/plugin install`. The plugin then runs straight from the clone's `plugin/` folder: after `npm run build`, run `/reload-plugins` in each open session.

## Update

1. `/plugin marketplace update ai-chat-center` (or update it from the `/plugin` menu).
2. In each session that was already open, run `/reload-plugins`, or restart it. Until then it keeps running the old copy, and the app shows its plugin version in yellow under the message field.
3. Run `/cc` once in any session: it replaces the running hub with the new one.

From 0.6.6 on, a session opened before an update also starts running the newest installed copy's hooks once another session has used it.

## Usage

Type `/cc` in a session to connect it. The plugin shows a link to the app in the terminal (`http://127.0.0.1:7777/#token=…`) and, by default, opens the app in its own window. Claude only confirms the connection; it never repeats the link.

| Command | What it does |
| --- | --- |
| `/cc` | Connects the session (or reconnects it) and opens the app. |
| `/ai-chat-center:cc off` | Disconnects the session. Messages not yet delivered are discarded. |
| `/ai-chat-center:cc answers on` / `off` | Lets the app answer Claude's multiple-choice dialog (AskUserQuestion), including confirmations. Off by default: the app then shows these questions read-only. |
| `/ai-chat-center:cc window on` / `off` | Opens the app in its own window on every `/cc` (on by default). On Linux, `on` also adds an "AI Chat Center" icon to the app launcher. |
| `/ai-chat-center:cc usage on` / `off` | Shows your 5-hour usage at the bottom of the list. It wraps your status line in `~/.claude/settings.json`; `off` puts yours back. |

`answers`, `window` and `usage` are saved for every session, and only a command typed in the terminal changes them: an app message never runs `/cc`.

Type the arguments with the full name, `/ai-chat-center:cc`. Claude Code turns `/cc` into the full name only through its autocomplete menu: typed with arguments, `/cc off` may answer "Unknown command". If another plugin or one of your own commands also defines `/cc`, use the full name for every command.

### Background sessions

A session started with the app's **+** button, or resumed from the app, runs as a Claude Code background session (`claude --bg`). It has no terminal, so the app can also run slash commands in it (through `claude attach`), switch its model and effort, and open it in a terminal from the ⋮ menu when it needs something only the terminal can do, such as a permission prompt. A session you opened in a terminal can't receive slash commands from the app (they would arrive as plain text): type those in its terminal.

Notes:

- New sessions can start in any folder under your home folder. A folder you never opened in Claude Code must be trusted first: open a terminal there, run `claude` once and accept.
- `/model` and `/effort` in Claude Code also save the choice as the default for new sessions (`model` and `effortLevel` in `~/.claude/settings.json`). Switching them from the app does the same.
- Slash commands from the app don't work on Windows yet. Resuming does.

## How it works

The plugin registers hooks for session start, prompt submit, Stop, notifications and the AskUserQuestion tool. Sessions where you never typed `/cc` write nothing, and their hooks exit at once.

- **The hub.** `/cc` starts a local server (the hub) on 127.0.0.1 if it is not running. It reads the transcripts Claude Code already writes under `~/.claude/projects` and serves them to the app. For each session's state it runs `claude agents`: about every 5 seconds while something is changing and every 30 seconds when everything is idle. A hidden app window stops these lookups, unless browser notifications are on; a check every 5 minutes still notices sessions that ended. It exits on its own after 2 hours with no visible app and no connected session; the next `/cc` starts it again.
- **Messages from the app.** The hub signs each message and puts it in the session's inbox under `~/.ai-chat-center`. A small background process, the waiter (`dist/waiter.mjs`, started by `asyncRewake` hooks), watches the inbox. When a message arrives and no turn is running, it wakes the session and hands the message to Claude as hook feedback, wrapped in markers that carry a per-connection key. Messages sent during a turn wait for it to end, however long it takes.
- **Questions.** With `answers on`, the AskUserQuestion hook (`dist/ask.mjs`) sends the question to the app when the turn was started from the app and the app is open, and waits up to 24 hours for your answer. In any other case the usual dialog appears in the terminal.
- **The window.** On `/cc`, the hook looks for Chrome, Chromium or Edge and opens the app as an `--app` window. Without them, it opens a tab of your default browser (on macOS, `/cc` then says how to add it to the Dock with Safari). The token never goes on the browser's command line: the hook asks the hub for a one-time pairing code, valid for 60 seconds. Only one app window stays open: when the app is already open, `/cc` shows the session in it instead.
- **Ending.** A session you close without `/cc off` is marked as ended once its process is gone. `/clear`, `/resume` of another conversation and forks disconnect the old conversation.

## Privacy and trust

Everything stays on your computer. The hub listens only on 127.0.0.1. The plugin reads no credentials and sends nothing over the network.

- **App messages have the same authority as typing in the terminal, with one limit.** Claude treats them as yours, including requests to run commands or edit files, under the same permission rules. They never count as your answer to something Claude asked in the terminal, such as a permission prompt or "should I proceed?" before a destructive action: answer those in the terminal.
- **This relies on model behavior.** Claude Code labels hook output as "not user input", and `/cc` asks Claude to trust the keyed blocks from the AI Chat Center waiter anyway. A future Claude Code or model version may refuse app messages; if that happens, type the request in the terminal and please report it.
- **The app link carries a token.** It is made fresh every time the hub starts, sits after the `#` (the browser never sends it to the hub), and is removed from the address bar when the page loads. The tab keeps it in session storage. Before it connects or sends anything, the app asks the hub to prove it knows the token, so another program on the port gets nothing.
- **The link is saved in the session transcript**, since Claude Code stores hook messages there. An `/export` or a shared transcript carries it. It stops working when the hub restarts.
- **Signed messages.** The hub signs every app message with a secret made once per install (`~/.ai-chat-center/install-secret`, readable only by you). The waiter delivers only messages whose signature checks out, for that session, that are not repeated, not dated in the future and not older than the connection. A file merely written into the inbox is set aside as `.unsigned`.
- **The per-connection key** lets Claude tell real app messages from text that only looks like one. Claude trusts a block only when it arrives as hook feedback from the waiter, never from a file, a web page or command output.
- **Recommended:** keep Claude's own file tools out of the state folder. Add `"Read(~/.ai-chat-center/**)"` and `"Edit(~/.ai-chat-center/**)"` to `permissions.deny` in `~/.claude/settings.json`. Shell commands still follow your Bash permission rules.

## Limitations

- Permission prompts can only be approved in the terminal (for a background session, open it with ⋮ > Open in terminal).
- A multiple-choice question asked in a turn you started from the terminal is answered in the terminal; the app shows it read-only. With no app window open, questions go to the terminal too.
- After a session sits idle for more than 24 hours, app messages are no longer delivered until the next turn: Claude Code stops the waiter after 24 hours. The app tells you to send any prompt in the terminal.
- After you interrupt a turn (Esc), app messages arrive 10 to 25 seconds later, once `claude agents` reports the session idle.
- When you resume an old session, app messages queued more than 30 minutes earlier are discarded; the app marks them as not delivered.
- After `/compact`, Claude may forget the connection; if it refuses an app message, run `/cc` again.
- Subagent work shows as the parent's action, not as messages.
- The app is reachable only from this computer (127.0.0.1).
- Claude Code only, for now.

## Troubleshooting

- **The app can't reach the hub, or asks for the `/cc` link.** Type `/cc` in any session: it starts the hub if needed and shows a fresh link.
- **Every prompt shows a hook error.** Node.js is missing from the PATH that Claude Code sees. Install it and restart Claude Code (on Windows, close every terminal and editor first).
- **Port.** The hub uses 127.0.0.1:7777, or the next free one up to 7787; the link always shows the real port. `AI_CHAT_CENTER_PORT` sets the first port to try.
- **State folder.** `~/.ai-chat-center` (set `AI_CHAT_CENTER_HOME` to move it). Logs are in its `logs/` folder: `hub.log`, `hook.log`, `waiter.log` and `launcher.log`.
- **Stopping the hub.** Delete `~/.ai-chat-center/hub.json`: the hub exits within a minute. It starts again on the next `/cc`.

## Uninstall

1. If you turned on `usage`, run `/ai-chat-center:cc usage off` to put your status line back.
2. `/plugin uninstall ai-chat-center@ai-chat-center`, then `/plugin marketplace remove ai-chat-center`.
3. Delete the state folder (token, install secret, sessions, logs). A running hub exits within a minute.
   - macOS and Linux: `rm -rf ~/.ai-chat-center`
   - Windows PowerShell: `Remove-Item -Recurse -Force "$HOME\.ai-chat-center"`
4. On Linux, if you used `window on`, `window off` removes the launcher icon; or delete `~/.local/share/applications/ai-chat-center.desktop`.

## Development

Needs Node.js `^22.22.2 || >=24.15` (jsdom, in the UI tests).

```
npm install
npm test            # hub, hooks and core tests
npm -w ui test      # web app tests
npm run build       # bundles the plugin into plugin/dist (committed)
npm run test:build  # slow: builds, then smoke-tests the bundles
node scripts/smoke-runtime.mjs .   # runtime smoke of the built plugin, plain Node 18+
node scripts/smoke-flow.mjs .      # /cc, hub, app message, delivery, /cc off
```

`plugin/dist` is committed so the plugin works straight from the marketplace: rebuild it after changing the source. CI fails if it is out of date. The project's working notes are in [CLAUDE.md](CLAUDE.md) and the backlog in [docs/backlog.md](docs/backlog.md).

## Releasing

Installed copies update only when the plugin version changes.

1. Bump the version in `package.json`, `plugin/.claude-plugin/plugin.json` and `src/core/version.ts` (a test keeps them equal), and in `ui/package.json`. If the format of app messages or of their signature changed, also bump `PROTOCOL` in `src/core/version.ts`.
2. `npm run build` and commit `plugin/dist`.
3. Run [docs/testing/release-checklist.md](docs/testing/release-checklist.md), including the live check that the current default model still acts on an app message.
4. Tag the commit `vX.Y.Z` and push the tag. A test fails when `plugin/dist` differs from the last `v*` tag without a version change.

## License

MIT. See [LICENSE](LICENSE). Third-party software bundled in the web app is listed in [plugin/THIRD-PARTY-NOTICES.md](plugin/THIRD-PARTY-NOTICES.md).

Independent project, not affiliated with or endorsed by Anthropic.
