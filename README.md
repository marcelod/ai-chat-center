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

- Node.js 20 or newer
- Claude Code

## Install

```
/plugin marketplace add marcelod/ai-chat-center
/plugin install ai-chat-center@ai-chat-center
```

## Usage

- Type `/cc` in a session to connect it. The terminal prints a link to the app, in the form `http://127.0.0.1:7777/?token=…`; open it in your browser.
- Type `/cc off` to disconnect the session.
- The command also works through its autocomplete form, `/ai-chat-center:cc`.

## How it works

The plugin registers hooks that run when a session starts, when you submit a prompt, when Claude Code stops and when it sends a notification. Sessions where you never typed `/cc` are left alone: the hooks exit at once and write nothing. `/cc` starts a local hub if it is not running. The hub reads the session transcripts that Claude Code already writes to disk and serves them to the web UI. Messages you type in the app are placed in a per-session inbox. A small background process, the waiter (`dist/waiter.js`, started by an `asyncRewake` hook when the session starts and each time Claude Code stops), watches that inbox; when a message arrives and no turn is running, it wakes the session and hands the message over as hook feedback, wrapped in markers that carry a per-connection key, so the session only trusts messages that really came from you. Messages sent while Claude is working wait until the turn ends. The waiter exits as soon as the session closes or is disconnected; disconnecting also discards messages that were not delivered.

The hub runs from your home folder and inherits the environment of the session that started it, so it sees the sessions that use the same Claude configuration folder (`CLAUDE_CONFIG_DIR`) as that session.

## Privacy

Everything stays on your computer. The hub listens only on 127.0.0.1 and requires a token stored in your home folder. The plugin does not read any credentials and sends nothing over the network.

## MVP limitations

- Permission prompts can only be approved in the terminal.
- `/clear` disconnects the session; run `/cc` again.
- Messages sent from the app show up in the terminal as hook feedback.
- Claude Code only, for now.

## Troubleshooting

- **The app says it can't reach the hub.** Type `/cc` in any session; it starts the hub again and prints a fresh link.
- **Stopping the hub.** End the process whose pid is in `~/.ai-chat-center/hub.json` (for example `kill <pid>`, or `Stop-Process -Id <pid>` on Windows). It starts again on the next `/cc`.
- **After a plugin update** the old hub is replaced automatically on the next `/cc`.

## Development

```
npm install
npm test            # unit tests (fast; does not run the build)
npm -w ui test      # web UI tests
npm run build       # bundles the plugin into plugin/dist (committed)
npm run test:build  # slow: builds, then smoke-tests the bundles
```

`plugin/dist` is committed so the plugin works straight from the marketplace; rebuild and commit it after changing the source. CI fails if it is out of date.

## License

MIT. See [LICENSE](LICENSE).

Independent project, not affiliated with or endorsed by Anthropic.
