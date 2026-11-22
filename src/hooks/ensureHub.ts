import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, type SpawnOptions } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { paths } from '../core/paths.js';
import { isAlive as pidAlive } from '../core/lock.js';
import { VERSION } from '../core/version.js';
import { newChallenge, proofMatches } from '../core/healthProof.js';

/** Answer of `GET /api/health?challenge=…`; trusted only once `proof` checks out against the token on disk. */
export type Health = { ok: true; version: string; pid: number; proof: string };

export interface EnsureHubOptions {
  /** Starts the hub detached. Injected in tests: they must never start a real hub. */
  spawnHub?: () => void;
  health?: (port: number, challenge: string) => Promise<Health | null>;
  /** Stops a hub of another version. Default: process.kill, errors ignored. */
  kill?: (pid: number) => void;
  isAlive?: (pid: number) => boolean;
  pollMs?: number;
  timeoutMs?: number;
  /** How long a recorded hub whose pid is alive may stay silent before another is started. Default 5 s. */
  stalledWaitMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** GET /api/health?challenge= on loopback. Null unless it answers 200 with `{ ok: true, version, pid, proof }` within 500 ms. */
export function checkHealth(port: number, challenge: string): Promise<Health | null> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: `/api/health?challenge=${challenge}`, timeout: 500 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => {
        if (body.length < 4096) body += c;
      });
      res.on('end', () => {
        try {
          const j = JSON.parse(body) as Partial<Health>;
          const ok =
            res.statusCode === 200 && j.ok === true && typeof j.pid === 'number' && typeof j.version === 'string' && typeof j.proof === 'string';
          resolve(ok ? { ok: true, version: j.version!, pid: j.pid!, proof: j.proof! } : null);
        } catch {
          resolve(null);
        }
      });
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

/**
 * The hub outlives the session that started it: run it from the home directory so it never holds
 * a project folder (Windows locks the cwd of a running process). It inherits the environment,
 * so it sees the sessions of the same Claude config dir as that session.
 */
export function hubSpawnOptions(): SpawnOptions {
  return { detached: true, stdio: 'ignore', windowsHide: true, cwd: os.homedir() };
}

/** The hub bundle sits beside the hook bundle in plugin/dist. */
export function defaultSpawnHub(): void {
  const hubPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hub.mjs');
  spawn(process.execPath, [hubPath], hubSpawnOptions()).unref();
}

function readHub(): { port: number; token: string; pid: number | null } | null {
  try {
    const { port, pid } = JSON.parse(fs.readFileSync(paths().hubJson, 'utf8')) as { port?: unknown; pid?: unknown };
    const token = fs.readFileSync(paths().token, 'utf8').trim();
    if (typeof port !== 'number' || !token) return null;
    return { port, token, pid: typeof pid === 'number' ? pid : null };
  } catch {
    return null;
  }
}

/** The token goes in the fragment: never sent in a request, and the UI clears it from the address bar. */
const urlOf = (h: { port: number; token: string }) => `http://127.0.0.1:${h.port}/#token=${h.token}`;

/** Semver order of `a` vs `b` (major.minor.patch; a pre-release sorts before its release). NaN if either is unparsable. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return NaN;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d !== 0) return Math.sign(d);
  }
  if (x[4] === y[4]) return 0;
  if (x[4] === undefined) return 1;
  if (y[4] === undefined) return -1;
  return x[4] < y[4] ? -1 : 1;
}

/**
 * Returns the hub URL, starting the hub if it is not answering (or replacing one of an OLDER version;
 * a newer one is used as is). A hub is trusted only when it proves, with an HMAC over a fresh random
 * challenge, that it knows the token on disk and listens on the very port we dialed. Anything else on
 * the recorded port is foreign, including a squatter that relays the challenge to the real hub: its URL
 * is never returned (that would hand it the token); a hub of our own is started instead (it skips busy
 * ports and rewrites hub.json under the hub lock). A token is only ever paired with a verified port.
 */
export async function ensureHub(opts: EnsureHubOptions = {}): Promise<string> {
  const health = opts.health ?? checkHealth;
  const isAlive = opts.isAlive ?? pidAlive;
  const kill =
    opts.kill ??
    ((pid: number) => {
      try {
        process.kill(pid);
      } catch {
        /* already gone */
      }
    });
  const pollMs = opts.pollMs ?? 100;
  const timeoutMs = opts.timeoutMs ?? 5000;

  const stalledWaitMs = opts.stalledWaitMs ?? 5000;
  /** The proven answer; 'silent' when nothing answered; null when something answered without a valid proof. */
  const check = async (h: { port: number; token: string }) => {
    const challenge = newChallenge();
    const r = await health(h.port, challenge);
    if (!r) return 'silent' as const;
    return proofMatches(h.token, challenge, h.port, r) ? r : null;
  };
  const proven = async (h: { port: number; token: string }) => {
    const r = await check(h);
    return r === 'silent' ? null : r;
  };

  const hub = readHub();
  if (hub) {
    // A hub that is alive but does not answer right now (load, antivirus, resume from sleep) is waited
    // for: replacing it would rotate the token while it keeps running with the old one.
    let r = await check(hub);
    const until = Date.now() + stalledWaitMs;
    while (r === 'silent' && hub.pid !== null && isAlive(hub.pid) && Date.now() < until) {
      await sleep(Math.max(pollMs, 50));
      r = await check(hub);
    }
    const h = r === 'silent' ? null : r;
    if (h) {
      // Same or newer (another installed copy of the plugin): use it. Killing a newer hub would make two
      // installed versions keep replacing each other, rotating the token every time.
      if (!(compareVersions(h.version, VERSION) < 0)) return urlOf(hub);
      // A proven hub of an older plugin version: stop it and wait (bounded) until it is gone, or the
      // new hub would see it answering and defer to it.
      kill(h.pid);
      const until = Date.now() + 3000;
      while (isAlive(h.pid) && Date.now() < until) await sleep(50);
    }
  }

  (opts.spawnHub ?? defaultSpawnHub)();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const cur = readHub();
    if (!cur) continue;
    const h = await proven(cur);
    if (h && compareVersions(h.version, VERSION) >= 0) return urlOf(cur);
  }
  throw new Error('AI Chat Center hub did not start in time');
}
