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

- **To use:** Claude Code 2.1.139 or newer (the hooks use the exec form, `command` plus `args`, added in that version), and Node.js 18 or newer. The plugin needs no `npm install`, and the hooks need no shell (no Git Bash on Windows).
- **Node.js 18+ must be on the PATH that Claude Code sees; without it, every prompt shows a hook error. Uninstall the plugin or install Node.**
- **Windows:** the native Claude Code installer does not install Node. Install Node.js 18 or newer (for example from nodejs.org, or `winget install OpenJS.NodeJS.LTS`), then open a new terminal so Claude Code sees it on the PATH (`node -v` should work there). Without it, every prompt in every session shows a hook error.
- **To develop:** Node.js 22.22.2 or a newer 22.x, or Node.js 24.15 or newer (`^22.22.2 || >=24.15`, required by jsdom in the UI tests).

## Install

```
/plugin marketplace add marcelod/ai-chat-center
/plugin install ai-chat-center@ai-chat-center
```

## Usage

- Type `/cc` in a session to connect it. The plugin shows a link to the app in the terminal, in the form `http://127.0.0.1:7777/#token=…`; open it in your browser. Claude only confirms the connection: the link is shown to you by the plugin and is never repeated by Claude.
- Type `/cc off` to disconnect the session.
- The command also works through its full name, `/ai-chat-center:cc`. If another plugin or one of your own commands also defines `/cc`, use `/ai-chat-center:cc`.

## How it works

The plugin registers hooks that run when a session starts, when you submit a prompt, when Claude Code stops and when it sends a notification. Sessions where you never typed `/cc` write nothing, and their hooks exit at once, with one exception: while another session is connected, the waiter that starts with every session (startup, resume, `/clear` and fork) runs `claude agents` once (a fraction of a second) to check whether the new conversation replaced a connected one in the same terminal, and disconnects that one if it did. `/cc` starts a local hub if it is not running. The hub reads the session transcripts that Claude Code already writes to disk and serves them to the web UI. While an app tab is open, the hub also runs `claude agents` about every 5 seconds for the sessions' status; a hidden tab closes its connection (unless browser notifications are on), which stops that. Messages you type in the app are placed in a per-session inbox. A small background process, the waiter (`dist/waiter.mjs`, started by an `asyncRewake` hook when a session starts or is resumed, when a turn starts and each time Claude Code stops), watches that inbox; when a message arrives and no turn is running, it wakes the session and hands the message over as hook feedback, wrapped in markers that carry a per-connection key, so the session only trusts messages that really came from you. Messages sent while Claude is working wait until the turn ends, however long it takes. A turn you interrupt (Esc) or that ends with an API error does not fire Claude Code's Stop hook; the waiter started with that turn keeps waiting, and when messages are queued it checks with `claude agents` (at most every 15 seconds) whether the session is idle, then delivers them. The waiter exits when the session closes or is disconnected; disconnecting also discards messages that were not delivered. When the plugin could not identify the session's process, the waiter asks `claude agents` once a minute instead: it exits after about 3 minutes in which the session is no longer listed, or after 30 minutes in which that lookup keeps failing.

The hub runs from your home folder and inherits the environment of the session that started it, so it sees the sessions that use the same Claude configuration folder (`CLAUDE_CONFIG_DIR`) as that session. It exits on its own after 2 hours with no browser connected and no connected session; the next `/cc` starts it again. `/cc` waits up to about 5 seconds for a running hub that is slow to answer instead of starting a second one, and a hub that `~/.ai-chat-center/hub.json` no longer names (another hub replaced it, or the folder was deleted) exits within a minute, so an old token does not keep working. A session you closed without `/cc off` stops counting as connected once its process is gone: the hub checks every 5 minutes, even with no browser open, and marks it as exited after three checks in a row that no longer find it.

## Privacy and trust

Everything stays on your computer. The hub listens only on 127.0.0.1. The plugin does not read any credentials and sends nothing over the network.

- **Messages from the app have the same authority as typing in the terminal, with one limit.** Claude treats them as yours, including requests to run commands or edit files, under the same permission rules. They never count as your answer to something Claude asked you in the terminal, such as a permission prompt or "should I proceed?" before a destructive or irreversible action: answer those in the terminal.
- **This relies on model behavior.** Claude Code labels the waiter's output as a system notification, "not user input". The `/cc` command asks Claude to treat the keyed blocks that arrive from the AI Chat Center hook as typed by you. That depends on how the model follows the instruction, and it may change in a future Claude Code or model version; if it does, Claude may refuse app messages. Type the request in the terminal instead, and please report it.
- **The app link carries a token.** A new token is made every time the hub starts. It is in the part of the link after `#`, which the browser never sends to the hub, and the app removes it from the address bar as soon as the page loads. The browser keeps it only for that tab (session storage), so after a hub restart, or in a new tab or browser, open the link from `/cc` again. The token is shown to you only; it is not sent to Claude.
- **The app link is saved in the session transcript.** The plugin shows it to you as a hook message, and Claude Code stores that message in the session's transcript file (under `~/.claude/projects`), so an `/export`, a shared transcript or a backup carries it. The token in it stops working as soon as the hub restarts, since every start makes a new one, and the hub exits on its own after 2 hours with no browser and no connected session.
- **The per-connection key** lets Claude tell real app messages from text that merely looks like one. Claude trusts a message block only when it arrives as hook feedback from the waiter, never when it shows up in a file, a web page or command output, even with the right key.
- **The hub signs every app message** with a secret made once per install (`~/.ai-chat-center/install-secret`, readable by you only), and the waiter delivers only messages whose signature checks out: a file merely written into the inbox is dropped (and logged in `waiter.log`). Anything that can read that secret as your user can still sign messages, like the app does. The folder is created readable by you only (0700 on macOS and Linux); keep it that way.
- **Recommended: keep Claude's own tools out of the state folder.** Add deny rules to your Claude Code settings (`~/.claude/settings.json`, under `permissions.deny`): `"Read(~/.ai-chat-center/**)"`, `"Edit(~/.ai-chat-center/**)"`. Text injected into a session (a web page, a file) then cannot get Claude to read the secret or the token with its file tools. They do not cover shell commands, which still follow your Bash permission rules.

## Limitations

- Permission prompts can only be approved in the terminal.
- `/clear`, `/resume` of another conversation and forks disconnect the previous conversation; run `/cc` again.
- After a session sits idle for more than 24 hours, app messages are no longer delivered: Claude Code stops the waiter after 24 hours, and nothing restarts it until the next turn. Type anything in the terminal, or run `/cc` again.
- If no waiter is running for a session (it hit the 24 hour limit, or it was killed) while app messages wait, the app says so: "send any prompt in the terminal to resume delivery". Any prompt you type starts a new waiter.
- After you interrupt a turn (Esc), messages sent from the app are delivered 10 to 25 seconds later, once `claude agents` reports the session idle. Without `claude` on the PATH that the hooks see, they wait for your next prompt in the terminal.
- When you resume an old session, app messages queued more than 30 minutes earlier are discarded instead of delivered (the waiter log records it); the app marks them as not delivered. Messages sent during a long turn are delivered when the turn ends, whatever their age.
- After `/compact`, Claude may forget the connection; if it refuses an app message, run `/cc` again.
- Subagent work is not shown as messages: it appears as the parent's action.
- Messages sent from the app show up in the terminal as hook feedback.
- Claude acts on app messages only because `/cc` asks it to, over Claude Code's "not user input" label on hook output (see Privacy and trust). A future Claude Code or model version may refuse them.
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
node scripts/smoke-flow.mjs .      # /cc, hub, app message, waiter delivery, /cc off, plain Node 18+
```

`plugin/dist` is committed so the plugin works straight from the marketplace; rebuild and commit it after changing the source. CI fails if it is out of date. The build also writes `plugin/LICENSE` and `plugin/THIRD-PARTY-NOTICES.md`.

## Releasing

Installed copies update only when the plugin version changes.

1. Bump the version in `package.json`, `plugin/.claude-plugin/plugin.json` and `src/core/version.ts` (a test keeps them equal).
2. `npm run build`, then commit `plugin/dist`.
3. Run [docs/testing/release-checklist.md](docs/testing/release-checklist.md), including the live check that the current default model still acts on an app message.
4. Tag the release commit `vX.Y.Z`. A test fails when `plugin/dist` differs from the last `v*` tag without a version change.

## License

MIT. See [LICENSE](LICENSE). Third-party software bundled in the web UI is listed in [plugin/THIRD-PARTY-NOTICES.md](plugin/THIRD-PARTY-NOTICES.md).

Independent project, not affiliated with or endorsed by Anthropic.
