// `/cc usage on|off`: the account's rate-limit usage only reaches Claude Code's status line, so `usage on`
// points the status line of settings.json at a wrapper (dist/statusline.mjs, copied to <home>/bin so the path
// survives plugin updates). The wrapper records the usage and runs the status line the user had, so the
// terminal shows the same as before. `usage off` puts that status line back.
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../core/paths.js';
import { readJson, writeJsonAtomic } from '../core/fsAtomic.js';
import { claudeConfigDir } from '../core/registry.js';

import { readStatuslineState, type StatusLine, type StatuslineState } from '../core/statuslineState.js';

export type InstallResult = 'installed' | 'refreshed' | 'failed';
export type RemoveResult = 'restored' | 'not-installed' | 'changed-since';

export interface StatuslineOptions {
  /** The wrapper built next to the running hook (dist/statusline.mjs). */
  source: string;
  /** Claude's settings.json. Default: <claude config dir>/settings.json. */
  settingsFile?: string;
  /** The node binary that runs the wrapper. Default: this process's. */
  nodePath?: string;
}

const settingsPath = (o: StatuslineOptions) => o.settingsFile ?? path.join(claudeConfigDir(), 'settings.json');

/** A shell-safe double-quoted argument (the status line command runs through a shell). */
const quote = (a: string) => `"${a.replace(/\\/g, '/').replace(/(["`$])/g, '\\$1')}"`;

export function wrapperCommand(o: StatuslineOptions): string {
  return `${quote(o.nodePath ?? process.execPath)} ${quote(paths().statuslineScript)}`;
}

/** Our status line: its command runs the copied wrapper (any node path: the user may move node). */
export function isOurs(sl: unknown): boolean {
  return !!sl && typeof sl === 'object' && typeof (sl as StatusLine).command === 'string' &&
    ((sl as StatusLine).command as string).includes(paths().statuslineScript.replace(/\\/g, '/'));
}

async function readSettings(file: string): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await fs.promises.readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw e;
  }
  const d = JSON.parse(text) as unknown; // a settings.json we cannot parse is never rewritten
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error(`${file} is not a JSON object`);
  return d as Record<string, unknown>;
}

/** Writes settings.json keeping its file mode (writeJsonAtomic creates 0600). */
async function writeSettings(file: string, data: Record<string, unknown>): Promise<void> {
  let mode: number | null = null;
  try {
    mode = (await fs.promises.stat(file)).mode & 0o777;
  } catch {
    /* new file */
  }
  await writeJsonAtomic(file, data);
  if (mode !== null) await fs.promises.chmod(file, mode).catch(() => {});
}

/** Copies the wrapper to its stable path when it differs (a plugin update brings a new one). */
export async function refreshWrapper(o: StatuslineOptions): Promise<void> {
  const dest = paths().statuslineScript;
  const src = await fs.promises.readFile(o.source);
  const cur = await fs.promises.readFile(dest).catch(() => null);
  if (cur && cur.equals(src)) return;
  await fs.promises.mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
  const tmp = `${dest}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, src, { mode: 0o600 });
  await fs.promises.rename(tmp, dest);
}

export async function installStatusline(o: StatuslineOptions): Promise<InstallResult> {
  const file = settingsPath(o);
  const settings = await readSettings(file);
  if (settings === null) return 'failed';
  await refreshWrapper(o);
  const current = settings.statusLine as StatusLine | undefined;
  if (isOurs(current)) {
    // Already on: only the node path may have changed.
    const command = wrapperCommand(o);
    if (current!.command !== command) await writeSettings(file, { ...settings, statusLine: { ...current, command } });
    return 'refreshed';
  }
  const original = current && typeof current === 'object' ? current : null;
  await writeJsonAtomic(paths().statuslineFile, { original } satisfies StatuslineState);
  const statusLine: StatusLine = { type: 'command', command: wrapperCommand(o) };
  if (original && original.padding !== undefined) statusLine.padding = original.padding;
  await writeSettings(file, { ...settings, statusLine });
  return 'installed';
}

export async function removeStatusline(o: Pick<StatuslineOptions, 'settingsFile'>): Promise<RemoveResult> {
  const file = settingsPath(o as StatuslineOptions);
  const settings = await readSettings(file);
  const state = await readStatuslineState();
  const current = settings?.statusLine;
  if (!isOurs(current)) {
    // Changed by hand since `usage on`: leave the user's choice alone.
    await fs.promises.rm(paths().statuslineFile, { force: true });
    return state ? 'changed-since' : 'not-installed';
  }
  const { statusLine: _ours, ...rest } = settings!;
  await writeSettings(file, state?.original ? { ...rest, statusLine: state.original } : rest);
  await fs.promises.rm(paths().statuslineFile, { force: true });
  return 'restored';
}
