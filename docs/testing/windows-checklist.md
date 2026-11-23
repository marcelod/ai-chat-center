# Windows test checklist

> **Nota (pt-BR):** Este roteiro é para rodar à mão numa máquina Windows. Ele repete os cenários (a)–(j) do teste ponta a ponta e acrescenta as verificações específicas do Windows. Marque cada item com PASS, FAIL ou SKIPPED e anote o que viu. Se algo falhar, copie a mensagem de erro e o conteúdo de `%USERPROFILE%\.ai-chat-center\logs`, sem o token.

Use Windows 10 or 11, with Node.js 18+ and Claude Code on the `PATH`. Run all commands in **PowerShell**. Linux results for comparison are in [e2e-results.md](e2e-results.md).

## 0. Preparation

1. Make sure Node.js and Claude Code are on the `PATH`:
   ```powershell
   node -v
   claude --version
   ```
2. Install the plugin, either from the marketplace (`/plugin marketplace add …`, then `/plugin install ai-chat-center@ai-chat-center`), or without installing it, from a clone:
   ```powershell
   claude --plugin-dir "C:\path\to\ai-chat-center\plugin"
   ```
3. Start from a clean state. Close any open hub first (see section W), then:
   ```powershell
   Remove-Item -Recurse -Force "$env:USERPROFILE\.ai-chat-center" -ErrorAction SilentlyContinue
   ```
4. Create a test folder **with a space in its name**, for example `C:\Temp\cc test`, and open a terminal there. Use cheap prompts. `claude --model haiku` is enough.

Useful inspection commands (keep a second PowerShell window open):
```powershell
$h = "$env:USERPROFILE\.ai-chat-center"
Get-ChildItem -Recurse $h | Select-Object FullName, Length, LastWriteTime
Get-Content "$h\hub.json"                         # port and hub pid
Get-ChildItem "$h\sessions" | ForEach-Object { Get-Content $_.FullName }   # registrations
Get-ChildItem "$h\waiters", "$h\waiting", "$h\inbox" -ErrorAction SilentlyContinue
Get-Content "$h\logs\*.log" -Tail 20
# Node processes with their command lines (hub.mjs / waiter.mjs / hook.mjs):
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Select-Object ProcessId, ParentProcessId, CommandLine | Format-List
```
To call the hub API the same way the app does:
```powershell
$port = (Get-Content "$h\hub.json" | ConvertFrom-Json).port
$tok  = (Get-Content "$h\token").Trim()
$hdr  = @{ Authorization = "Bearer $tok" }
Invoke-RestMethod "http://127.0.0.1:$port/api/sessions" -Headers $hdr | ConvertTo-Json -Depth 6
```

## Scenarios

- [ ] **(a) `/cc` shows the URL and the session is connected.** Type `/cc`. The reply shows a link like `http://127.0.0.1:7777/#token=…`. Open it in the browser. The session appears in the list as connected. `sessions\<id>.json` exists, and after the reply a file appears in `waiters\`.
- [ ] **(b) Question from the app.** In the app, ask `What is 2+3? Answer with just the number.` The answer appears in the app and in the terminal, where it shows as "Stop hook feedback".
- [ ] **(c) Action from the app.** In the app, ask `Create a file ola.txt containing: ola`. `ola.txt` is created in the test folder (`Test-Path .\ola.txt`).
- [ ] **(d) Two quick messages, in order.** Send `Reply ALPHA` and then `Reply BETA` from the app right away. Both arrive in the right order, and the answer covers both.
- [ ] **(e) Terminal message in the app.** Type a prompt in the terminal. It appears in the app with the keyboard icon (⌨, "Sent from the terminal").
- [ ] **(f) Permission prompt.** Press Shift+Tab until the footer shows manual mode (not auto, not accept edits). From the app, ask `Run this shell command: echo hi > perm.txt`. While the terminal asks for permission, the app shows "Waiting for you in the terminal". Then approve in the terminal.
  The session stays connected during the prompt, and the "waiting" badge goes away once you approve and the turn ends.
- [ ] **(g) `/clear`.** Type `/clear`. The conversation shows as disconnected in the app, and the new session id appears under "Other sessions". The waiter for the old session ends (see section W).
- [ ] **(h) Closing the terminal.** Run `/cc` again, then close the terminal window with the X button (not `/exit`). Within about 30 s the app shows the session as disconnected. In Task Manager → Details (or with the `Get-CimInstance` command above), **no `node.exe` running `waiter.mjs` is left** for that session, and `waiters\` holds no lock for it.
- [ ] **(i) Session without `/cc`.** Open a second terminal in another folder and start `claude` without `/cc`. It appears under "Other sessions" and behaves normally. No lock is created for it in `waiters\`, and sending to it from the app is refused ("session disconnected").
- [ ] **(j) After `/compact`.** In a connected session, run `/compact`, then ask for an action from the app (`Create a file after.txt containing: ok`). It is executed. If the model refuses, run `/cc` once more and retry. Note which one happened.

## Windows-specific checks

- [ ] **W1. Quoting and `${CLAUDE_PLUGIN_ROOT}` in the hooks.** Install the plugin into a path with spaces, for example with `--plugin-dir "C:\Temp\cc test\plugin"` from a copy. All hooks run: (a) works, a waiter starts and `logs\hook.log` has no "Cannot find module" error. `plugin/hooks/hooks.json` uses the exec form (`"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/dist/hook.mjs", "prompt-submit"]`), which Claude Code spawns without any shell. Check that it works both with and without Git for Windows installed. Then, with `node` removed from PATH, check that each prompt shows a visible, non-blocking hook error and the session keeps working.
- [ ] **W2. `claude agents --json` via `shell: true`.** The hub runs `claude agents --json` with `shell: true` on Windows, because `claude` is a `.cmd` shim. Check that the "Other sessions" list is filled in (scenario i). Also check that a closed session becomes disconnected (scenario h), which depends on the same call. If the list stays empty, run `claude agents --json` by hand in PowerShell and note the output.
- [ ] **W3. The hub has no console window.** When `/cc` starts the hub, no black console window flashes or stays open (the hub is spawned with `windowsHide`). The waiter runs on each Stop, so it must not flash a window either. Task Manager shows the hub as a `node.exe` with `hub.mjs` in its command line.
- [ ] **W4. Paths with spaces.** Use a project folder with a space (`C:\Temp\cc test`). If you can, also use a Windows user name with a space or an accent; otherwise set `$env:AI_CHAT_CENTER_HOME = "C:\Temp\cc home"` before starting `claude`. Scenarios (a) to (c) still work, and the files appear under that folder.
- [ ] **W5. Lock left by a dead process.** While a session is connected, kill its waiter in Task Manager (End task on the `node.exe` running `waiter.mjs`), or with:
  ```powershell
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object CommandLine -like '*waiter.mjs*' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  ```
  The lock file in `waiters\` stays behind. Type any prompt in the terminal so a new waiter starts on Stop. It must take over the stale lock (the pid in the lock is dead). Then a message from the app is delivered again. Do the same for the hub: kill the `hub.mjs` process, leave `hub.json` in place, and run `/cc`. A new hub starts and the link works.
- [ ] **W6. No orphan processes at the end.** Close all test terminals. Within a minute, Task Manager → Details shows no `node.exe` running `waiter.mjs`. The hub (`hub.mjs`) is expected to keep running; stop it with:
  ```powershell
  $p = (Get-Content "$env:USERPROFILE\.ai-chat-center\hub.json" | ConvertFrom-Json).pid
  if ((Get-CimInstance Win32_Process -Filter "ProcessId=$p").CommandLine -like '*hub.mjs*') { Stop-Process -Id $p }
  ```
  Also check the README's stop command (the same check) and that deleting `hub.json` alone makes the hub exit within a minute.
- [ ] **W8. No console flash from `claude agents`.** With the app open on a connected session, watch the desktop for a minute: the hub runs `claude agents --json` every few seconds, and no console window may flash (it runs with `windowsHide`). Also run `/cc` in a session that was never connected and check that no window flashes during the pid lookup.
- [ ] **W9. The project folder is not locked by the hub.** Start the hub from a fresh test folder (close any running hub first, see W6, then `/cc` in a session opened in `C:\Temp\cc lock`). Exit that session, then delete the folder (`Remove-Item -Recurse "C:\Temp\cc lock"`) while the hub keeps running. The delete succeeds (the hub's working directory is your user folder), and the app keeps working for other sessions.
- [ ] **W10. A hub killed without its cleanup.** With a hub running, kill it the way Windows does (`Stop-Process -Id <hub pid>`, Task Manager, or a reboot): `hub.json` stays behind. Run `/cc` again: it answers within a second or two with a working link, and `hub.json` names the new hub's pid.
- [ ] **W11. A planted `node` in the project folder is never run.** Every hook runs `node` with the project as its working directory. In an empty folder `C:\Temp\cc node`, create `node.cmd` with `@echo planted > "%TEMP%\acc-planted-node.txt"` (and, separately, copy any harmless `.exe` there as `node.exe`). Open `claude` in that folder, type a prompt and `/cc`. `%TEMP%\acc-planted-node.txt` must not exist, and the hooks must work (they ran the real Node from the `PATH`). If the marker file appears, stop and report it: Claude Code resolved `node` from the project folder.
- [ ] **W12. Delivery confirms the claude process first.** Windows never re-parents a process, so before taking queued messages the waiter runs `claude agents --json` once and delivers only if the session runs in its parent process. With a connected session, send a message from the app while the session is idle: it is delivered as usual (no console window flashes for that lookup), and `waiter.log` has no "not in this waiter's parent" line. Then close the terminal with a message queued (send it during a long turn, then close the window): the message is not delivered anywhere, stays queued, and `waiter.log` shows either "is gone" or "not in this waiter's parent".
- [ ] **W13. Esc while a question waits in the app clears the card and re-enables the composer.** On Windows Esc kills the `ask.mjs` hook with TerminateProcess, so no signal handler or `finally` runs. With `/cc answers on`, start a turn from the app that makes Claude call AskUserQuestion; when the question card shows in the app, press Esc in the terminal. Within a few seconds the card no longer offers to answer, the session leaves "waiting" and the composer is enabled again (the hub drops the question because the hook's pid is dead). Typing `/cc` also clears any question left behind.
- [ ] **W14. The app window opens visible.** Close every Chrome and Edge window (check Task Manager: no `chrome.exe`/`msedge.exe` left), type `/ai-chat-center:cc window on`, then `/cc`. A new app window (no tabs, no address bar) opens **visible** and loads the app without asking for the link; repeat with the browser already running. In the `Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'"` command line the URL has `#pair=`, never `#token=`, and `logs\hook.log` has no new "app window" line.
- [ ] **W7. Line endings.** In a clone made with default Git for Windows settings (`core.autocrlf=true`), `git status` is clean after `npm ci` and `npm run build`, with no CRLF changes in `plugin/dist`.

## Results

| # | Result | Notes |
|---|--------|-------|
| a | | |
| b | | |
| c | | |
| d | | |
| e | | |
| f | | |
| g | | |
| h | | |
| i | | |
| j | | |
| W1 | | |
| W2 | | |
| W3 | | |
| W4 | | |
| W5 | | |
| W6 | | |
| W7 | | |
| W8 | | |
| W9 | | |
| W10 | | |
| W11 | | |
| W12 | | |
| W13 | | |
