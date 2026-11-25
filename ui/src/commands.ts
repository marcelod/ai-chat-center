// Slash commands the app knows, for the list shown when `/` is typed in a background session (spec
// 2026-11-25-app-batch). Seen live with Claude Code 2.1.332: the app types one line through `claude attach`,
// so a command works only when that line does everything; a command that opens a menu (arrows and Enter)
// or that only draws on the screen has to be used in a terminal.

export type CommandKind =
  /** Runs from the app. */
  | 'app'
  /** Runs, but its result is drawn on the screen only: the app would show nothing. */
  | 'screen'
  /** Opens a menu or needs the terminal (or ends the conversation in the app). */
  | 'terminal';

export type CommandInfo = {
  cmd: string;
  kind: CommandKind;
  /** i18n key of the argument hint shown in the list (`<name>`). */
  arg?: string;
  /** Without an argument the command opens a menu: then it is a terminal one. */
  needsArg?: true;
  /** i18n key of the one-line description. */
  desc: string;
};

const d = (k: string) => `ui.commands.desc.${k}`;
const a = (k: string) => `ui.commands.arg.${k}`;
export const COMMANDS: CommandInfo[] = [
  { cmd: '/compact', kind: 'app', arg: a('instructions'), desc: d('compact') },
  { cmd: '/rename', kind: 'app', arg: a('name'), needsArg: true, desc: d('rename') },
  { cmd: '/model', kind: 'app', arg: a('model'), needsArg: true, desc: d('model') },
  { cmd: '/effort', kind: 'app', arg: a('effort'), needsArg: true, desc: d('effort') },
  { cmd: '/reload-plugins', kind: 'app', desc: d('reloadPlugins') },
  { cmd: '/ai-chat-center:cc', kind: 'app', arg: a('cc'), desc: d('cc') },
  { cmd: '/status', kind: 'screen', desc: d('status') },
  { cmd: '/cost', kind: 'screen', desc: d('cost') },
  { cmd: '/context', kind: 'screen', desc: d('context') },
  { cmd: '/usage', kind: 'screen', desc: d('usage') },
  { cmd: '/help', kind: 'screen', desc: d('help') },
  { cmd: '/doctor', kind: 'screen', desc: d('doctor') },
  { cmd: '/resume', kind: 'terminal', desc: d('resume') },
  { cmd: '/clear', kind: 'terminal', desc: d('clear') },
  { cmd: '/config', kind: 'terminal', desc: d('config') },
  { cmd: '/agents', kind: 'terminal', desc: d('agents') },
  { cmd: '/permissions', kind: 'terminal', desc: d('permissions') },
  { cmd: '/mcp', kind: 'terminal', desc: d('mcp') },
  { cmd: '/plugin', kind: 'terminal', desc: d('plugin') },
  { cmd: '/hooks', kind: 'terminal', desc: d('hooks') },
  { cmd: '/memory', kind: 'terminal', desc: d('memory') },
  { cmd: '/theme', kind: 'terminal', desc: d('theme') },
  { cmd: '/login', kind: 'terminal', desc: d('login') },
  { cmd: '/logout', kind: 'terminal', desc: d('logout') },
  { cmd: '/exit', kind: 'terminal', desc: d('exit') },
];

const byName = new Map(COMMANDS.map((c) => [c.cmd, c]));

/** The commands that run from the app whose name starts with `typed` (the first word only). */
export function suggestions(typed: string): CommandInfo[] {
  if (!typed.startsWith('/') || /\s/.test(typed)) return [];
  const q = typed.toLowerCase();
  return COMMANDS.filter((c) => c.kind === 'app' && c.cmd.startsWith(q));
}

/**
 * How a full command line would behave from the app: 'app' (send it), 'screen' or 'terminal' (do not send:
 * say why). Commands the app does not know (skills, plugin commands) are sent: they may well work.
 */
export function classify(line: string): CommandKind {
  const [name, ...rest] = line.trim().split(/\s+/);
  const c = byName.get(name.toLowerCase());
  if (!c) return 'app';
  if (c.kind === 'app' && c.needsArg && rest.length === 0) return 'terminal';
  return c.kind;
}
