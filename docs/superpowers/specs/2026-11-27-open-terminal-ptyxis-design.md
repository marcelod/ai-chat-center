# "Open in terminal" with Ptyxis and GNOME Console (0.6.8)

## Problem

On Ubuntu with Ptyxis as the default terminal and no `gnome-terminal`, "Open in terminal" opened a window
"claude attach <id> (Failed)": "Failed to find executable claude attach <id>". `linuxTerminal`
(`src/hub/openTerminal.ts`) fell through to its last entry, `x-terminal-emulator -e "claude attach <id>"`,
and Ptyxis (the target of `/usr/bin/x-terminal-emulator` there) takes the string of `-e` as the program name.

## Decisions

- **Two new terminals in the list**, after `gnome-terminal` and before `konsole`, both with the folder and the
  command as separate arguments:
  - Ptyxis: `ptyxis --new-window --working-directory <cwd> -- claude attach <id>`.
    `ptyxis --help` (50.1) says `-d/--working-directory` applies to `--tab`, `--new-window` or `-x`, and shows
    `ptyxis -- bash -c '…'` as "run a custom command in a new window". `-x/--execute` takes ONE string that
    Ptyxis parses itself (`-x "bash -c 'sleep 3'"`), so it is not used. `--new-window` is passed so the
    working directory option has the window it applies to.
  - GNOME Console: `kgx --working-directory <cwd> -- claude attach <id>`. `kgx` is not installed on this
    machine, so the form comes from its documented options (`--working-directory`, and `--` for "the remaining
    arguments are the command"); old Console versions only had `-e`.
  - Both open their window from a GApplication server, whose cwd is not ours, hence the explicit
    working-directory option (the process cwd is still set to the folder too).
  - The folder goes as its own argument (not `--opt=<cwd>`), which GOption accepts for long options.
- **`x-terminal-emulator` resolves to the real terminal.** It is still the last resort, but now
  `realpath(x-terminal-emulator)` is taken; when its basename is one of the known terminals (gnome-terminal,
  ptyxis, kgx, konsole, xfce4-terminal, kitty, alacritty, xterm), that program is spawned (by its resolved
  path) with its own syntax. The single-string `-e "claude attach <id>"` stays only for an unknown target, a
  Debian `*.wrapper` script (they translate the xterm syntax themselves), or when `realpath` fails.
  `realpath` is injectable (`linuxTerminal(..., realpath)`, `OpenTerminalDeps.realpath`; default
  `fs.realpathSync`).
- No shell anywhere, arguments as arrays; the only variable values are the validated 8-hex id and the absolute
  session folder, as before.
- The list order is unchanged for the terminals already there (gnome-terminal still first), so nothing changes
  for a machine where "Open in terminal" already worked.

## Not done

- **Warning when the terminal fails right away** (backlog "Known limits"). Not simple enough to be reliable:
  gnome-terminal, Ptyxis and Console start a short-lived client that hands the window to a server and exits
  with 0, and a failing command shows inside the window ("Failed"), so the exit code of the process the hub
  started says nothing. It needs a different signal (for example the hub seeing the attach show up for the
  session) and is left for a later round.

## Needs a live check

- Ubuntu with Ptyxis (the author's machine): `ptyxis` is found by name in the PATH, so the new entry is used
  directly; check that the window opens in the session folder and runs `claude attach <id>`.
- If `--new-window` together with `--` misbehaves on some Ptyxis version, the alternative is dropping
  `--new-window` (`ptyxis -d <cwd> -- …`).
- GNOME Console (`kgx`) on a distribution that ships it (Fedora Workstation, Debian GNOME): `--` form.
