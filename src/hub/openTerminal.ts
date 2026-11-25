// "Open in terminal" (backlog 2026-11-25): opens the system terminal in the session's folder running
// `claude attach <bgId>`, so a background session can be answered where the app cannot (a permission, a
// dialog, an interactive command). Closing that terminal detaches only: the session keeps running.
// No shell is ever given text: every process gets an argument array, and the only variable values are the
// 8-hex id (validated) and the session's folder (from the registry, absolute, passed as its own argument
// or as the process cwd). `claude` is found the way bgSessions runs it: by name, through the PATH of the
// terminal's own shell environment.
import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanEnv, configDirFor, isBgId, type Spawn } from './bgSessions.js';
import { isExecutableFile } from '../hooks/openWindow.js';
import { shQuote } from '../hooks/launcherMac.js';

type Env = Record<string, string | undefined>;

/** A terminal command line: the program and its arguments (the folder is also the process cwd). */
export interface TerminalCommand {
  cmd: string;
  args: string[];
}

/**
 * Linux terminals in the order tried, each with the arguments that run `claude attach <id>` in `cwd`.
 * Where a terminal has a working-directory option it is used (gnome-terminal opens its window from a
 * server process, whose own cwd is not ours); the process cwd is set as well for the others.
 */
const LINUX_TERMINALS: [string, (cwd: string, run: string[]) => string[]][] = [
  ['x-terminal-emulator', (_cwd, run) => ['-e', ...run]],
  ['gnome-terminal', (cwd, run) => [`--working-directory=${cwd}`, '--', ...run]],
  ['konsole', (cwd, run) => ['--workdir', cwd, '-e', ...run]],
  ['xfce4-terminal', (cwd, run) => [`--working-directory=${cwd}`, '-x', ...run]],
  ['kitty', (cwd, run) => ['--directory', cwd, ...run]],
  ['alacritty', (cwd, run) => ['--working-directory', cwd, '-e', ...run]],
  ['xterm', (_cwd, run) => ['-e', ...run]],
];

/** The first Linux terminal found in an absolute PATH entry, with its arguments; null when there is none. */
export function linuxTerminal(id: string, cwd: string, env: Env, exists: (p: string) => boolean): TerminalCommand | null {
  const run = ['claude', 'attach', id];
  // Only absolute PATH entries: a relative one would resolve against the hub's cwd.
  const dirs = (env.PATH ?? '').split(path.posix.delimiter).filter((d) => path.posix.isAbsolute(d));
  for (const [name, argsFor] of LINUX_TERMINALS) {
    for (const d of dirs) {
      const p = path.posix.join(d, name);
      let ok = false;
      try {
        ok = exists(p);
      } catch {
        ok = false;
      }
      if (ok) return { cmd: p, args: argsFor(cwd, run) };
    }
  }
  return null;
}

/**
 * The `.command` script Terminal.app runs on macOS: it removes itself (and its private folder) first, sets
 * the config dir of the session when it has its own, goes to the folder and execs `claude attach <id>`.
 * Every path is a single-quoted shell word (shQuote); the id is 8 hex characters.
 */
export function macCommandScript(id: string, cwd: string, file: string, configDir?: string): string {
  if (!isBgId(id)) throw new Error('invalid background session id');
  return [
    '#!/bin/sh',
    `rm -f ${shQuote(file)}`,
    `rmdir ${shQuote(path.posix.dirname(file))} 2>/dev/null`,
    ...(configDir ? [`export CLAUDE_CONFIG_DIR=${shQuote(configDir)}`] : []),
    `cd ${shQuote(cwd)} || exit 1`,
    `exec claude attach ${id}`,
    '',
  ].join('\n');
}

export interface OpenTerminalDeps {
  spawn?: Spawn;
  platform?: NodeJS.Platform;
  env?: Env;
  home?: string;
  /** Whether a terminal program exists (Linux, Windows). */
  exists?: (p: string) => boolean;
  /** macOS: makes the private folder of the `.command` file (default: mkdtemp under os.tmpdir(), 0700). */
  mkdtemp?: () => string;
  writeFile?: (p: string, data: string, mode: number) => void;
}

export type OpenTerminalResult = { ok: true } | { ok: false; code: 'no-terminal' | 'spawn-failed'; error: string };

export interface TerminalTarget {
  bgId: string;
  cwd: string;
  configDir?: string;
}

/**
 * Starts a terminal (detached, no shell) running `claude attach <bgId>` in `cwd`. Resolves once the
 * terminal process started, or with the reason it could not: no terminal found, or the spawn failed.
 */
export async function openTerminal(t: TerminalTarget, deps: OpenTerminalDeps = {}): Promise<OpenTerminalResult> {
  if (!isBgId(t.bgId)) throw new Error('invalid background session id');
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const spawn = deps.spawn ?? (nodeSpawn as Spawn);
  const configDir = configDirFor(t.configDir, deps.home, platform);
  const isAbs = platform === 'win32' ? path.win32.isAbsolute : path.posix.isAbsolute;
  if (!isAbs(t.cwd)) return { ok: false, code: 'spawn-failed', error: 'the session folder is not an absolute path' };

  let cmd: string;
  let args: string[];
  if (platform === 'darwin') {
    // A `.command` file opened by Terminal (`open -a Terminal`): no Automation permission prompt (osascript
    // driving Terminal needs one), and the script text holds only quoted words and the validated id.
    let dir: string;
    try {
      dir = (deps.mkdtemp ?? (() => fs.mkdtempSync(path.join(os.tmpdir(), 'ai-chat-center-term-'))))();
      const file = path.posix.join(dir, `attach-${t.bgId}.command`);
      (deps.writeFile ?? ((p, d, mode) => fs.writeFileSync(p, d, { mode, flag: 'wx' })))(file, macCommandScript(t.bgId, t.cwd, file, configDir), 0o700);
      cmd = '/usr/bin/open';
      args = ['-a', 'Terminal', file];
    } catch (e) {
      return { ok: false, code: 'spawn-failed', error: `could not write the terminal script: ${(e as Error).message}` };
    }
  } else if (platform === 'win32') {
    // cmd.exe /k (not `claude` directly): `claude` may be a .cmd shim, which only a shell resolves. Its
    // command line holds constants and the validated id only; the folder is the process cwd, never text
    // on a command line (cmd.exe would expand % and & in it, even in quotes).
    const root = env.SystemRoot ?? env.SYSTEMROOT ?? env.windir;
    if (!root || !path.win32.isAbsolute(root)) return { ok: false, code: 'no-terminal', error: 'SystemRoot is not set' };
    const cmdExe = path.win32.join(root, 'System32', 'cmd.exe');
    const run = [cmdExe, '/k', 'claude', 'attach', t.bgId];
    const local = env.LOCALAPPDATA;
    const wt = local && path.win32.isAbsolute(local) ? path.win32.join(local, 'Microsoft', 'WindowsApps', 'wt.exe') : null;
    // wt.exe is an app execution alias (a reparse point): checked for presence, not as a regular file.
    const has = deps.exists ?? ((p: string) => fs.existsSync(p));
    if (wt && has(wt)) {
      // `-d .`: the new tab starts in wt's own cwd, the session folder; no path on the command line.
      cmd = wt;
      args = ['-d', '.', ...run];
    } else {
      // A detached cmd.exe gets a console window of its own: no `start` (a cmd builtin) needed.
      cmd = cmdExe;
      args = run.slice(1);
    }
  } else {
    const term = linuxTerminal(t.bgId, t.cwd, env, deps.exists ?? ((p) => isExecutableFile(p, platform)));
    if (!term) return { ok: false, code: 'no-terminal', error: 'no terminal program found' };
    cmd = term.cmd;
    args = term.args;
  }

  return new Promise((resolve) => {
    let child: ReturnType<Spawn>;
    try {
      child = spawn(cmd, args, {
        cwd: t.cwd,
        env: cleanEnv(env as NodeJS.ProcessEnv, configDir),
        detached: true,
        stdio: 'ignore',
        shell: false,
        // The terminal window must show: no windowsHide.
      });
    } catch (e) {
      return resolve({ ok: false, code: 'spawn-failed', error: `could not start ${cmd}: ${(e as Error).message}` });
    }
    child.once('error', (e: Error) => resolve({ ok: false, code: 'spawn-failed', error: `could not start ${cmd}: ${e.message}` }));
    child.once('spawn', () => {
      child.unref();
      resolve({ ok: true });
    });
  });
}
