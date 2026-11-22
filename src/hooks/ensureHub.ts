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

function readHub(): { port: number; token: string } | null {
  try {
    const { port } = JSON.parse(fs.readFileSync(paths().hubJson, 'utf8')) as { port?: unknown };
    const token = fs.readFileSync(paths().token, 'utf8').trim();
    if (typeof port !== 'number' || !token) return null;
    return { port, token };
  } catch {
    return null;
  }
}

const urlOf = (h: { port: number; token: string }) => `http://127.0.0.1:${h.port}/?token=${h.token}`;

/**
 * Returns the hub URL, starting the hub if it is not answering (or replacing one of another version).
 * A hub is trusted only when it proves, with an HMAC over a fresh random challenge, that it knows the
 * token on disk. Anything else on the recorded port is foreign: its URL is never returned (that would
 * hand it the token); a hub of our own is started instead (it skips busy ports).
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

  const proven = async (h: { port: number; token: string }) => {
    const challenge = newChallenge();
    const r = await health(h.port, challenge);
    return r && proofMatches(h.token, challenge, r) ? r : null;
  };

  const hub = readHub();
  if (hub) {
    const h = await proven(hub);
    if (h) {
      if (h.version === VERSION) return urlOf(hub);
      // A proven hub from another plugin version: stop it and wait (bounded) until it is gone, or the
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
    if (h && h.version === VERSION) return urlOf(cur);
  }
  throw new Error('AI Chat Center hub did not start in time');
}
