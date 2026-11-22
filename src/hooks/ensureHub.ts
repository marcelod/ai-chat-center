import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, type SpawnOptions } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { paths } from '../core/paths.js';
import { isAlive as pidAlive } from '../core/lock.js';
import { VERSION } from '../core/version.js';

export type Health = { ok: true; pid: number; version: string };

export interface EnsureHubOptions {
  /** Starts the hub detached. Injected in tests: they must never start a real hub. */
  spawnHub?: () => void;
  health?: (port: number) => Promise<Health | null>;
  /** Stops a hub of another version. Default: process.kill, errors ignored. */
  kill?: (pid: number) => void;
  isAlive?: (pid: number) => boolean;
  pollMs?: number;
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** GET /api/health on loopback. Null unless it answers 200 with JSON `{ ok: true, pid, version }` within 500 ms. */
export function checkHealth(port: number): Promise<Health | null> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 500 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => {
        if (body.length < 4096) body += c;
      });
      res.on('end', () => {
        try {
          const j = JSON.parse(body) as Partial<Health>;
          const ok = res.statusCode === 200 && j.ok === true && typeof j.pid === 'number' && typeof j.version === 'string';
          resolve(ok ? { ok: true, pid: j.pid!, version: j.version! } : null);
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

function readHub(): { port: number; pid: number | undefined; token: string } | null {
  try {
    const { port, pid } = JSON.parse(fs.readFileSync(paths().hubJson, 'utf8')) as { port?: unknown; pid?: unknown };
    const token = fs.readFileSync(paths().token, 'utf8').trim();
    if (typeof port !== 'number' || !token) return null;
    return { port, pid: typeof pid === 'number' ? pid : undefined, token };
  } catch {
    return null;
  }
}

const urlOf = (h: { port: number; token: string }) => `http://127.0.0.1:${h.port}/?token=${h.token}`;

/** Returns the hub URL, starting the hub if it is not answering (or replacing one of another version). */
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

  const hub = readHub();
  if (hub) {
    const h = await health(hub.port);
    if (h && h.pid === hub.pid) {
      if (h.version === VERSION) return urlOf(hub);
      // A hub from an earlier plugin version: stop it and wait (bounded) until it is gone, or the
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
    const h = await health(cur.port);
    if (h && h.pid === cur.pid && h.version === VERSION) return urlOf(cur);
  }
  throw new Error('AI Chat Center hub did not start in time');
}
