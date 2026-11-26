import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { paths } from '../core/paths.js';
import { VERSION } from '../core/version.js';

/**
 * Plugin updates for sessions already open (backlog "Atualização do plugin valer para todas as sessões").
 *
 * Claude Code runs a session's hooks from the plugin folder it loaded when the session opened, until a
 * /reload-plugins: an update installs a new version folder next to the old one (…/<plugin>/<version>/dist),
 * and the sessions opened before it keep running the old code. So every hook records the newest version it
 * knows in ~/.ai-chat-center/plugin.json, and a hook of an older version runs the newer one's script instead
 * of its own.
 *
 * Safety: only a SIBLING version folder of this one is ever run (same parent folder, so the same install
 * source), only a strictly newer version, and only when that folder's own plugin.json says that version.
 * A copy loaded from a development folder has no siblings and never delegates. Anything unexpected: run
 * this copy, as before.
 */

/** Set in this process once it runs another copy: never a chain (not an env var, which a spawned hub would inherit). */
const FLAG = Symbol.for('ai-chat-center.delegated');
const flags = globalThis as unknown as Record<symbol, string | undefined>;
const VERSION_RE = /^\d+\.\d+\.\d+$/;

export interface PluginRecord {
  version: string;
  dist: string;
}

/** -1, 0 or 1; versions are x.y.z. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

const recordFile = () => path.join(paths().home, 'plugin.json');

function readRecord(): PluginRecord | null {
  try {
    const r = JSON.parse(fs.readFileSync(recordFile(), 'utf8')) as Partial<PluginRecord>;
    if (typeof r?.version !== 'string' || !VERSION_RE.test(r.version) || typeof r.dist !== 'string') return null;
    return { version: r.version, dist: r.dist };
  } catch {
    return null;
  }
}

function writeRecord(rec: PluginRecord): void {
  try {
    fs.mkdirSync(paths().home, { recursive: true, mode: 0o700 });
    const tmp = `${recordFile()}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rec), { mode: 0o600 });
    fs.renameSync(tmp, recordFile());
  } catch {
    // best effort: the next hook tries again
  }
}

function pluginVersionOf(dist: string): string | null {
  try {
    const v = (JSON.parse(fs.readFileSync(path.join(dist, '..', '.claude-plugin', 'plugin.json'), 'utf8')) as { version?: unknown }).version;
    return typeof v === 'string' && VERSION_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * The script to run instead of this copy's `entry` (e.g. 'waiter.mjs'), or null to run this copy.
 * Also records this version as the newest when it is. `ownDist` is the folder of the running bundle.
 */
export function newerScript(entry: string, ownDist: string, version = VERSION): string | null {
  if (flags[FLAG]) return null; // already delegated once: never a chain
  let own: string;
  try {
    own = fs.realpathSync(ownDist);
  } catch {
    return null;
  }
  const rec = readRecord();
  let target: string | null = null;
  if (rec && compareVersions(rec.version, version) > 0) {
    try {
      const dist = fs.realpathSync(rec.dist);
      const versionDir = path.dirname(dist);
      const siblings = path.dirname(path.dirname(own)) === path.dirname(versionDir) && dist !== own;
      if (
        siblings &&
        path.basename(dist) === 'dist' &&
        path.basename(versionDir) === rec.version &&
        pluginVersionOf(dist) === rec.version &&
        fs.statSync(path.join(dist, entry)).isFile()
      ) {
        target = path.join(dist, entry);
      }
    } catch {
      target = null;
    }
  }
  if (target) return target;
  // No usable newer copy (no record, an older one, or a folder that is gone): this copy is the newest this hook
  // knows. Only an installed version folder is recorded, never a development copy.
  const same = rec && rec.version === version && rec.dist === own;
  if (!same && path.basename(path.dirname(own)) === version && pluginVersionOf(own) === version) writeRecord({ version, dist: own });
  return null;
}

/**
 * Runs the newer copy's script in this process when there is one; resolves true when it did (the caller then
 * does nothing else), false to run this copy.
 */
export async function delegateToNewer(entry: string, moduleUrl: string): Promise<boolean> {
  let target: string | null = null;
  try {
    target = newerScript(entry, path.dirname(fileURLToPath(moduleUrl)));
  } catch {
    return false;
  }
  if (!target) return false;
  flags[FLAG] = VERSION;
  try {
    // The bundle runs its main when evaluated; a failure here comes before it reads stdin, so this copy can run.
    await import(pathToFileURL(target).href);
    return true;
  } catch {
    flags[FLAG] = undefined;
    return false;
  }
}
