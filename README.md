# AI Chat Center

[Português](README.pt-BR.md)

AI Chat Center is a plugin for Claude Code plus a small local app. It lets you follow your terminal coding sessions in a WhatsApp-style web UI and reply from there, so you can keep an eye on a long-running session from another browser window on the same computer.

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

## Requirements

- **To use:** Claude Code, and Node.js 18 or newer on the `PATH` that Claude Code hooks see. The plugin needs no `npm install`. If `node` is not found, the hooks do nothing (silently), and `/cc` cannot connect.
- **To develop:** Node.js 22.12 or newer.

## Install

```
/plugin marketplace add marcelod/ai-chat-center
/plugin install ai-chat-center@ai-chat-center
```

## Usage

- Type `/cc` in a session to connect it. The plugin shows a link to the app in the terminal, in the form `http://127.0.0.1:7777/?token=…`; open it in your browser. Claude only confirms the connection: the link is shown to you by the plugin and is never repeated by Claude.
- Type `/cc off` to disconnect the session.
- The command also works through its full name, `/ai-chat-center:cc`. If another plugin or one of your own commands also defines `/cc`, use `/ai-chat-center:cc`.

## How it works

The plugin registers hooks that run when a session starts, when you submit a prompt, when Claude Code stops and when it sends a notification. Sessions where you never typed `/cc` are left alone: the hooks exit at once and write nothing. `/cc` starts a local hub if it is not running. The hub reads the session transcripts that Claude Code already writes to disk and serves them to the web UI. Messages you type in the app are placed in a per-session inbox. A small background process, the waiter (`dist/waiter.mjs`, started by an `asyncRewake` hook when a session starts or is resumed and each time Claude Code stops), watches that inbox; when a message arrives and no turn is running, it wakes the session and hands the message over as hook feedback, wrapped in markers that carry a per-connection key, so the session only trusts messages that really came from you. Messages sent while Claude is working wait until the turn ends. The waiter exits as soon as the session closes or is disconnected; disconnecting also discards messages that were not delivered.

The hub runs from your home folder and inherits the environment of the session that started it, so it sees the sessions that use the same Claude configuration folder (`CLAUDE_CONFIG_DIR`) as that session. It exits on its own after 2 hours with no browser connected and no connected session; the next `/cc` starts it again.

## Privacy and trust

Everything stays on your computer. The hub listens only on 127.0.0.1. The plugin does not read any credentials and sends nothing over the network.

- **Messages from the app have the same authority as typing in the terminal.** Claude treats them as yours, including requests to run commands or edit files, under the same permission rules.
- **The app link carries a token.** A new token is made every time the hub starts. The browser keeps it only for that tab (session storage), so after a hub restart, or in a new tab or browser, open the link from `/cc` again. The token is shown to you only; it is not sent to Claude.
- **The per-connection key** lets Claude tell real app messages from text that merely looks like one. Claude trusts a message block only when it arrives as hook feedback from the waiter, never when it shows up in a file, a web page or command output, even with the right key.
- **Anything that can write to `~/.ai-chat-center` as your user can send messages** to your connected sessions, like the app does. The folder is created readable by you only (0700 on macOS and Linux); keep it that way.

## Limitations

- Permission prompts can only be approved in the terminal.
- `/clear`, `/resume` of another conversation and forks disconnect the previous conversation; run `/cc` again.
- After a session sits idle for more than 24 hours, app messages are no longer delivered: Claude Code stops the waiter after 24 hours, and nothing restarts it until the next turn. Type anything in the terminal, or run `/cc` again.
- App messages that wait more than 30 minutes without being delivered (for example while a long turn runs) are discarded; the app marks them as not delivered.
- After `/compact`, Claude may forget the connection; if it refuses an app message, run `/cc` again.
- Subagent work is not shown as messages: it appears as the parent's action.
- Messages sent from the app show up in the terminal as hook feedback.
- Claude Code only, for now.

## Troubleshooting

- **The app says it can't reach the hub, or asks for the `/cc` link.** Type `/cc` in any session; it starts the hub again if needed and shows a fresh link. The token changes whenever the hub restarts, and each browser tab needs the link once.
- **Port.** The hub uses 127.0.0.1:7777. If that port is busy, it tries 7778 to 7787; the `/cc` link always shows the real port.
- **Environment variables.** `AI_CHAT_CENTER_PORT` sets the first port to try. `AI_CHAT_CENTER_HOME` moves the state folder (default `~/.ai-chat-center`). Set them in the environment Claude Code starts from.
- **Logs** are in `~/.ai-chat-center/logs/`: `hub.log` (the hub), `hook.log` (`/cc` and the prompt hook) and `waiter.log` (message delivery, including discarded old messages).
- **Stopping the hub.** End the process whose pid is in `~/.ai-chat-center/hub.json` (for example `kill <pid>`, or `Stop-Process -Id <pid>` on Windows). It starts again on the next `/cc`.
- **After a plugin update** the old hub is replaced automatically on the next `/cc`. Only an older hub is replaced: a session still running an older copy of the plugin uses a newer hub as it is. Exception: a hub of version 0.2.0 or older cannot prove itself to 0.2.1 and later, so it is left running on its port and the new hub takes the next one. Stop it once (see above) or reboot.

## Uninstall

1. Uninstall the plugin: `/plugin uninstall ai-chat-center@ai-chat-center`.
2. Stop the hub (pid in `~/.ai-chat-center/hub.json`):
   - macOS and Linux: `kill "$(node -p "require(process.env.HOME + '/.ai-chat-center/hub.json').pid")"`
   - Windows PowerShell: `Stop-Process -Id (Get-Content "$HOME\.ai-chat-center\hub.json" | ConvertFrom-Json).pid`
3. Delete its state (token, registrations, logs):
   - macOS and Linux: `rm -rf ~/.ai-chat-center`
   - Windows PowerShell: `Remove-Item -Recurse -Force "$HOME\.ai-chat-center"`

## Development

```
npm install
npm test            # unit tests (fast; does not run the build)
npm -w ui test      # web UI tests
npm run build       # bundles the plugin into plugin/dist (committed)
npm run test:build  # slow: builds, then smoke-tests the bundles
node scripts/smoke-runtime.mjs .   # runtime smoke of the built plugin, plain Node 18+
```

`plugin/dist` is committed so the plugin works straight from the marketplace; rebuild and commit it after changing the source. CI fails if it is out of date. The build also writes `plugin/LICENSE` and `plugin/THIRD-PARTY-NOTICES.md`.

## Releasing

Installed copies update only when the plugin version changes.

1. Bump the version in `package.json`, `plugin/.claude-plugin/plugin.json` and `src/core/version.ts` (a test keeps them equal).
2. `npm run build`, then commit `plugin/dist`.
3. Tag the release commit `vX.Y.Z`. A test fails when `plugin/dist` differs from the last `v*` tag without a version change.

## License

MIT. See [LICENSE](LICENSE). Third-party software bundled in the web UI is listed in [plugin/THIRD-PARTY-NOTICES.md](plugin/THIRD-PARTY-NOTICES.md).

Independent project, not affiliated with or endorsed by Anthropic.
