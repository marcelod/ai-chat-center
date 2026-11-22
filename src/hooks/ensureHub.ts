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
/**
 * What checkHealth saw: a Health answer (still to be proven); 'unproven' when something answered 200
 * `{ ok: true, version }` without a proof (an AI Chat Center hub older than 0.2.1, or a foreign server);
 * 'refused' when nothing listens (ECONNREFUSED); null for a timeout or anything else.
 */
export type HealthAnswer = Health | 'unproven' | 'refused' | null;
/** `GET /api/health` without a challenge (every version answers it): `{ ok, version, pid? }`. */
export type Identity = { ok: true; version: string; pid?: number };

export interface EnsureHubOptions {
  /** Starts the hub detached. Injected in tests: they must never start a real hub. */
  spawnHub?: () => void;
  health?: (port: number, challenge: string) => Promise<HealthAnswer>;
  /** Unauthenticated `GET /api/health` (identifies an older hub that cannot prove the token). */
  identify?: (port: number) => Promise<Identity | null>;
  /** True when the hub on `port` accepts `token` (an authenticated `GET /api/config` answers 200). */
  tokenAccepted?: (port: number, token: string) => Promise<boolean>;
  /** A line for the user (and the model's status line), e.g. an older hub that could not be stopped. */
  notice?: (msg: string) => void;
  /** Stops a hub of another version. Default: process.kill, errors ignored. */
  kill?: (pid: number) => void;
  isAlive?: (pid: number) => boolean;
  pollMs?: number;
  timeoutMs?: number;
  /** How long a recorded hub whose pid is alive may stay silent before another is started. Default 5 s. */
  stalledWaitMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One GET on loopback (500 ms): the status and up to 4 KiB of body, 'refused', or null (timeout, error). */
function get(port: number, p: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string } | 'refused' | null> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, headers, timeout: 500 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => {
        if (body.length < 4096) body += c;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', (e: NodeJS.ErrnoException) => resolve(e.code === 'ECONNREFUSED' ? 'refused' : null));
  });
}

const parse = (body: string): Record<string, unknown> | null => {
  try {
    const j = JSON.parse(body) as unknown;
    return j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/**
 * GET /api/health?challenge= on loopback (500 ms). A `{ ok: true, version, pid, proof }` answer (proof still
 * unchecked); 'unproven' for `{ ok: true, version }` without a proof; 'refused' when nothing listens (a hub
 * whose event loop is stalled still accepts connections in the kernel backlog, so that is never "slow");
 * null otherwise.
 */
export async function checkHealth(port: number, challenge: string): Promise<HealthAnswer> {
  const r = await get(port, `/api/health?challenge=${challenge}`);
  if (r === 'refused' || r === null) return r;
  const j = parse(r.body);
  if (r.status !== 200 || !j || j.ok !== true || typeof j.version !== 'string') return null;
  if (typeof j.pid === 'number' && typeof j.proof === 'string') return { ok: true, version: j.version, pid: j.pid, proof: j.proof };
  return 'unproven';
}

/** Unauthenticated `GET /api/health`: what any version of the hub answers. */
export async function identifyHub(port: number): Promise<Identity | null> {
  const r = await get(port, '/api/health');
  if (r === 'refused' || r === null || r.status !== 200) return null;
  const j = parse(r.body);
  if (!j || j.ok !== true || typeof j.version !== 'string') return null;
  return typeof j.pid === 'number' ? { ok: true, version: j.version, pid: j.pid } : { ok: true, version: j.version };
}

/** True when the hub on `port` accepts `token`. Asked only of a hub that hub.json names, whose pid is alive. */
export async function hubAcceptsToken(port: number, token: string): Promise<boolean> {
  const r = await get(port, '/api/config', { authorization: `Bearer ${token}` });
  return r !== 'refused' && r !== null && r.status === 200;
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
  const identify = opts.identify ?? identifyHub;
  const tokenAccepted = opts.tokenAccepted ?? hubAcceptsToken;
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
  /**
   * The proven answer; 'silent' when nothing answered in time; 'refused' when nothing listens;
   * 'unproven' for an answer without a proof; 'foreign' for a proof that does not check out.
   */
  const check = async (h: { port: number; token: string }) => {
    const challenge = newChallenge();
    const r = await health(h.port, challenge);
    if (r === null) return 'silent' as const;
    if (r === 'refused' || r === 'unproven') return r;
    return proofMatches(h.token, challenge, h.port, r) ? r : ('foreign' as const);
  };
  const proven = async (h: { port: number; token: string }) => {
    const r = await check(h);
    return typeof r === 'string' ? null : r;
  };
  const stop = async (pid: number) => {
    kill(pid);
    // Bounded wait until it is gone, or the new hub would see it answering and defer to it.
    const until = Date.now() + 3000;
    while (isAlive(pid) && Date.now() < until) await sleep(50);
  };

  const hub = readHub();
  if (hub) {
    // A hub that is alive but does not answer right now (load, antivirus, resume from sleep) is waited
    // for: replacing it would rotate the token while it keeps running with the old one. Not when the
    // connection is refused: nothing listens, whatever the pid (reused after a reboot) says.
    let r = await check(hub);
    const until = Date.now() + stalledWaitMs;
    while (r === 'silent' && hub.pid !== null && isAlive(hub.pid) && Date.now() < until) {
      await sleep(Math.max(pollMs, 50));
      r = await check(hub);
    }
    if (typeof r !== 'string') {
      // Same or newer (another installed copy of the plugin): use it. Killing a newer hub would make two
      // installed versions keep replacing each other, rotating the token every time.
      if (!(compareVersions(r.version, VERSION) < 0)) return urlOf(hub);
      // A proven hub of an older plugin version: stop it.
      await stop(r.pid);
    } else if ((r === 'unproven' || r === 'foreign') && hub.pid !== null && isAlive(hub.pid)) {
      // Audit R4-M2: a hub of ours older than the proof (0.1.0) keeps running, accepting messages that are
      // never delivered. It is stopped only when it is certainly ours: hub.json's pid is alive, it says it
      // is an older AI Chat Center with that same pid, and it accepts the token on disk. Anything less
      // certain is never killed (a foreign process, a reused pid): the user is told instead.
      const id = await identify(hub.port);
      if (id && compareVersions(id.version, VERSION) < 0) {
        const pidMatches = id.pid === undefined || id.pid === hub.pid;
        if (pidMatches && (await tokenAccepted(hub.port, hub.token))) await stop(hub.pid);
        else {
          opts.notice?.(
            `AI Chat Center: an older AI Chat Center hub (version ${id.version.slice(0, 32)}) seems to still run on port ${hub.port}, ` +
              'but it could not be verified, so it was not stopped. Restart the computer (or stop that process) ' +
              'so that app messages are not sent through it: they would not be delivered.',
          );
        }
      }
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
