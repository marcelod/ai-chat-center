// What the "AI Chat Center" launcher icon runs (dist/open.mjs): starts the hub if it is not running and
// opens the app window, or leaves the one already open (it then shows nothing new). The window gets a
// one-time pairing code, never the token (see openWindow.ts).
import fs from 'node:fs';
import path from 'node:path';
import { ensureHub } from './ensureHub.js';
import { launchAppWindow } from './openWindow.js';
import { paths } from '../core/paths.js';

export interface OpenDeps {
  ensureHub?: (notice: (msg: string) => void) => Promise<string>;
  launch?: typeof launchAppWindow;
  log?: (msg: string) => void;
}

export async function openApp(deps: OpenDeps = {}): Promise<'opened' | 'tab' | 'reused' | 'no-browser' | 'failed'> {
  const log = deps.log ?? logLine;
  try {
    const url = await (deps.ensureHub ?? ((notice) => ensureHub({ notice })))(log);
    const r = await (deps.launch ?? launchAppWindow)(url, { onError: log });
    if (r === false) {
      log('launcher: no browser found');
      return 'no-browser';
    }
    return r;
  } catch (e) {
    // Messages from ensureHub and launchAppWindow never carry the token.
    log(`launcher: ${e instanceof Error ? e.message : String(e)}`);
    return 'failed';
  }
}

function logLine(msg: string): void {
  try {
    const dir = paths().logDir;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(path.join(dir, 'launcher.log'), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* nothing to show it on */
  }
}
