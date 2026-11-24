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
- Type `/ai-chat-center:cc off` to disconnect the session.
- Type `/ai-chat-center:cc answers on` once, in the terminal, to answer Claude's multiple-choice dialog (the AskUserQuestion tool) from the app, including confirmations. When Claude asks such a question in a turn you started from the app, the app shows it with one button per option, a field for a free answer and an "answer in the terminal" button. The setting is saved in the AI Chat Center `config.json` and applies to every session until you type `/ai-chat-center:cc answers off`. Only a command typed in the terminal changes it: an app message never runs a slash command. Before you turn it on, these questions are shown in the app read-only and answered in the terminal.
- By default, every `/cc` that connects (or reconnects) a session also opens the app in its own Chrome, Chromium or Edge window (an `--app` window, with no tabs or address bar). The link is still shown as usual. Type `/ai-chat-center:cc window off` once, in the terminal, to stop it (saved in `config.json`, for every session) and `/ai-chat-center:cc window on` to turn it back on; the confirmation says whether a compatible browser was found. Only one window stays open: when the app is already open (in a window or a tab, even minimized), `/cc` opens no new window and the open app shows the session instead. On Linux, `window on` also adds an “AI Chat Center” icon to your app launcher: it starts the hub if needed and opens the app, and the open window shows under that icon. `window off` removes it.
- The command also works through its full name, `/ai-chat-center:cc`. Claude Code turns `/cc` into `/ai-chat-center:cc` only through its autocomplete menu: typed with arguments (`/cc off`, `/cc answers on`) it may answer "Unknown command: /cc", so type the full name for those. If another plugin or one of your own commands also defines `/cc`, use `/ai-chat-center:cc`.

## How it works

The plugin registers hooks that run when a session starts, when you submit a prompt, when Claude Code stops and when it sends a notification. Sessions where you never typed `/cc` write nothing, and their hooks exit at once, with one exception: while another session is connected, the waiter that starts with every session (startup, resume, `/clear` and fork) runs `claude agents` once (a fraction of a second) to check whether the new conversation replaced a connected one in the same terminal, and disconnects that one if it did. `/cc` starts a local hub if it is not running. The hub reads the session transcripts that Claude Code already writes to disk and serves them to the web UI. While an app tab is open, the hub also runs `claude agents` about every 5 seconds for the sessions' status; a hidden tab closes its connection (unless browser notifications are on), which stops that. Messages you type in the app are placed in a per-session inbox. A small background process, the waiter (`dist/waiter.mjs`, started by an `asyncRewake` hook when a session starts or is resumed, when a turn starts and each time Claude Code stops), watches that inbox; when a message arrives and no turn is running, it wakes the session and hands the message over as hook feedback, wrapped in markers that carry a per-connection key, so the session only trusts messages that really came from you. Messages sent while Claude is working wait until the turn ends, however long it takes. With `/cc answers on`, a `PreToolUse` hook for AskUserQuestion (`dist/ask.mjs`) checks where the current turn came from: in a turn started by an app message, while an app tab is open, it saves the question in the session state and waits (up to 24 hours) for your answer from the app, then hands it to Claude as the dialog's answer, so the native dialog does not appear. In any other case it exits at once and the native dialog appears in the terminal as usual. A turn you interrupt (Esc) or that ends with an API error does not fire Claude Code's Stop hook; the waiter started with that turn keeps waiting, and when messages are queued it checks with `claude agents` (at most every 15 seconds) whether the session is idle, then delivers them. The waiter exits when the session closes or is disconnected; disconnecting also discards messages that were not delivered. The session's process comes from `claude agents`; when it does not list the session (Claude Code sometimes does not write its entry in `~/.claude/sessions`), `/cc` uses the hook's parent process if it is `claude`, and the hub does not mark exited a session whose process is still alive and not listed under another session. When the plugin could not identify the session's process, the waiter asks `claude agents` once a minute instead: it exits after about 3 minutes in which the session is no longer listed, or after 30 minutes in which that lookup keeps failing.

With the window on (the default), the `/cc` hook looks for a browser (Linux: `google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser`, `microsoft-edge`, `microsoft-edge-stable` on the `PATH`; macOS: Google Chrome, Chromium or Microsoft Edge in `/Applications`; Windows: `chrome.exe` or `msedge.exe` under `%ProgramFiles%`, `%ProgramFiles(x86)%` or `%LOCALAPPDATA%`). It does not put the token on the browser's command line, which other users of the computer could read (`ps`): it asks the hub for a one-time pairing code (valid for 60 seconds, usable once) and opens `http://127.0.0.1:<port>/#pair=<code>`; the app trades the code for the token and removes it from the address bar. Every open app page tells the hub it is alive every 20 seconds, hidden or not, and says goodbye when it closes; the hub counts a page as open for 150 seconds after its last ping, and while one is open it hands out no code and passes the session to that page. The Linux icon is a `~/.local/share/applications/ai-chat-center.desktop` file (with its icon under `~/.local/share/icons/hicolor/512x512/apps/`) that runs `dist/open.mjs` with the hook's own Node; every `/cc` with the option on refreshes it, since the plugin folder changes with each version. It declares `StartupWMClass=chrome-127.0.0.1__-Default`, the name Chrome gives an `--app` window of the app in the Default profile, so GNOME groups the window under the icon. Launcher failures go to `~/.ai-chat-center/logs/launcher.log`. The browser is started detached, without a shell; if anything fails, `/cc` still connects and shows the link, and the failure is recorded in `~/.ai-chat-center/logs/hook.log`.

The hub runs from your home folder and inherits the environment of the session that started it, so it sees the sessions that use the same Claude configuration folder (`CLAUDE_CONFIG_DIR`) as that session. It exits on its own after 2 hours with no visible app tab and no connected session (a hidden tab closes its connection, so it does not count unless browser notifications are on); the next `/cc` starts it again. A session whose process could not be identified counts as connected only while its transcript changed in the last 24 hours. `/cc` waits up to about 5 seconds for a running hub that is slow to answer instead of starting a second one, and a hub that `~/.ai-chat-center/hub.json` no longer names (another hub replaced it, or the folder was deleted) exits within a minute, so an old token does not keep working. A session you closed without `/cc off` stops counting as connected once its process is gone: the hub checks every 5 minutes, even with no browser open, and marks it as exited after three checks in a row that no longer find it. `claude agents` only lists the sessions of one configuration folder, so a session connected from another `CLAUDE_CONFIG_DIR` is never marked exited by that check, nor disconnected by a `/clear` in a session of another folder. Each waiter belongs to the Claude Code process that started it: when that process exits, or the session is resumed in another process (another terminal), it stops without taking any message.

## Privacy and trust

Everything stays on your computer. The hub listens only on 127.0.0.1. The plugin does not read any credentials and sends nothing over the network.

- **Messages from the app have the same authority as typing in the terminal, with one limit.** Claude treats them as yours, including requests to run commands or edit files, under the same permission rules. They never count as your answer to something Claude asked you in the terminal, such as a permission prompt or "should I proceed?" before a destructive or irreversible action: answer those in the terminal.
- **This relies on model behavior.** Claude Code labels the waiter's output as a system notification, "not user input". The `/cc` command asks Claude to treat the keyed blocks that arrive from the AI Chat Center hook as typed by you. That depends on how the model follows the instruction, and it may change in a future Claude Code or model version; if it does, Claude may refuse app messages. Type the request in the terminal instead, and please report it.
- **The app link carries a token.** A new token is made every time the hub starts. It is in the part of the link after `#`, which the browser never sends to the hub, and the app removes it from the address bar as soon as the page loads. The browser keeps it only for that tab (session storage), so after a hub restart, or in a new tab or browser, open the link from `/cc` again. Before it reconnects and before it sends a message, the app asks the hub to prove it knows the token (a signed answer to a fresh challenge): if another program took the port after the hub exited, the app sends it nothing and asks for the `/cc` link again. The token is shown to you only; it is not sent to Claude.
- **The app link is saved in the session transcript.** The plugin shows it to you as a hook message, and Claude Code stores that message in the session's transcript file (under `~/.claude/projects`), so an `/export`, a shared transcript or a backup carries it. The token in it stops working as soon as the hub restarts, since every start makes a new one, and the hub exits on its own after 2 hours with no browser and no connected session. With Remote Control or session sharing, Claude Code may relay hook messages to the other device too, so the link may leave this computer that way (it only works on this computer, where the hub listens).
- **The per-connection key** lets Claude tell real app messages from text that merely looks like one. Claude trusts a message block only when it arrives as hook feedback from the waiter, never when it shows up in a file, a web page or command output, even with the right key.
- **The hub signs every app message** with a secret made once per install (`~/.ai-chat-center/install-secret`, readable by you only), and the waiter delivers only messages whose signature checks out: a file merely written into the inbox is kept aside as `.unsigned`, never delivered (and logged in `waiter.log`). The signature covers the session, the message id, its time and its text, so a message cannot be moved to another session or re-dated; a message id already delivered, one dated in the future, or one older than the session's connection is dropped. Anything that can read that secret as your user can still sign messages, like the app does. The folder is created readable by you only (0700 on macOS and Linux); keep it that way.
- **Answers to the multiple-choice dialog.** After `/ai-chat-center:cc answers on`, an answer you give in the app to Claude's multiple-choice dialog counts as your answer, including for confirmations of destructive or irreversible actions. App text messages still never count as approval of something asked in the terminal.
- **Recommended: keep Claude's own tools out of the state folder.** Add deny rules to your Claude Code settings (`~/.claude/settings.json`, under `permissions.deny`): `"Read(~/.ai-chat-center/**)"`, `"Edit(~/.ai-chat-center/**)"`. Text injected into a session (a web page, a file) then cannot get Claude to read the secret or the token with its file tools. The `Edit` rule also keeps Claude from turning on answers from the app by editing `config.json`, where `/cc answers on` saves it. They do not cover shell commands, which still follow your Bash permission rules.

## Limitations

- Permission prompts can only be approved in the terminal.
- Opening the app in its own window needs Chrome, Chromium or Edge installed where the hook looks for it (see "How it works"); with no compatible browser (Firefox, Safari), `/cc` only shows the link, as before.
- A multiple-choice question asked in a turn you started from the terminal is answered only in the terminal; the app shows it read-only.
- While a question waits for your answer in the app, the terminal shows that the hook is running. Esc in the terminal cancels the wait: it interrupts the turn, and you can repeat the request.
- With no app tab open (a hidden tab counts as closed unless browser notifications are on), a multiple-choice question goes to the terminal instead of the app.
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
- **Stopping the hub.** Delete `~/.ai-chat-center/hub.json`: the hub exits on its own within a minute. To stop it at once, end the process whose pid is in that file, but only after checking that it is the hub (after a reboot or a crash the file can name another process). It starts again on the next `/cc`.
  - macOS and Linux: `pid=$(node -p "require(process.argv[1]).pid" ~/.ai-chat-center/hub.json) && ps -p "$pid" -o args= | grep -q hub.mjs && kill "$pid"`
  - Windows PowerShell: `$p = (Get-Content "$HOME\.ai-chat-center\hub.json" | ConvertFrom-Json).pid; if ((Get-CimInstance Win32_Process -Filter "ProcessId=$p").CommandLine -like '*hub.mjs*') { Stop-Process -Id $p }`
- **After a plugin update**, restart every Claude Code session that was open during the update (exit it, then `claude --resume`): until then it keeps running the old copy of the plugin. Then run `/cc` once in a connected session: that `/cc` replaces the old hub. Only an older hub is replaced. A hub of version 0.2.0 or older cannot prove itself, so it is stopped only when everything identifies it as ours (hub.json's pid is alive, the hub reports that same pid and an older version, it refuses a random token, and it accepts the token on disk; a hub that reports no pid is never stopped). Otherwise `/cc` says it could not be verified and leaves it running; restart the computer, or stop it (see above). Until that `/cc`, a hub that is still running keeps accepting app messages from its tab. A session you have not restarted cannot take part fully: from 0.2.4 on, the app refuses to send to a session that runs another version of the plugin and says to restart it, and in a session still running 0.2.3 or older, `/cc` may report that the hub failed to start (0.1.0) or keep replacing the hub (0.2.0). Messages queued by a hub older than 0.2.3 are not signed the way 0.2.3 checks, so they are never delivered: they are kept aside in the session's inbox as `.unsigned` (logged in `waiter.log`), and the app shows that a message from an older version was not delivered. Send them again.

## Uninstall

1. Uninstall the plugin: `/plugin uninstall ai-chat-center@ai-chat-center`.
2. Remove the marketplace: `/plugin marketplace remove ai-chat-center`.
3. Delete its state (token, install secret, registrations, logs). A hub that is still running then exits within a minute on its own, because `hub.json` is gone:
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

1. Bump the version in `package.json`, `plugin/.claude-plugin/plugin.json` and `src/core/version.ts` (a test keeps them equal). If the format of app messages or of their signature changed, also bump `PROTOCOL` in `src/core/version.ts`: the hub then refuses to send to sessions still running the old format (a test pins the two together).
2. `npm run build`, then commit `plugin/dist`.
3. Run [docs/testing/release-checklist.md](docs/testing/release-checklist.md), including the live check that the current default model still acts on an app message.
4. Tag the release commit `vX.Y.Z` and push the tag (`git push origin vX.Y.Z`). CI fetches the tags, and a test fails when `plugin/dist` differs from the last `v*` tag without a version change (until the first tag exists, that test is skipped).

## License

MIT. See [LICENSE](LICENSE). Third-party software bundled in the web UI is listed in [plugin/THIRD-PARTY-NOTICES.md](plugin/THIRD-PARTY-NOTICES.md).

Independent project, not affiliated with or endorsed by Anthropic.
