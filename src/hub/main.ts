import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { paths } from '../core/paths.js';
import { ensureDir, readJson, withFsRetry, writeJsonAtomic } from '../core/fsAtomic.js';
import { newChallenge, proofMatches } from '../core/healthProof.js';
import { ClaudeCodeProvider } from './provider.js';
import { acquireLock, releaseLock, isAlive } from '../core/lock.js';
import { isActive, listRegistrations, pruneRegistrations, type Registration } from '../core/registry.js';
import type { LiveSession } from '../shared/types.js';
import { createHub } from './server.js';
import { installSecret } from '../core/secret.js';

const TOKEN_RE = /^[0-9a-f]{64}$/;
/** Disconnected registrations older than this are deleted (with their inbox, busy and waiting files). */
export const PRUNE_AGE_MS = 30 * 86_400_000;
const PRUNE_EVERY_MS = 10 * 60_000;
/** The hub exits after this long with no browser connected and no active session. */
export const IDLE_EXIT_MS = 2 * 3600_000;
/** Background exit detection (one `claude agents` lookup), with or without a browser connected. */
export const EXIT_CHECK_MS = 5 * 60_000;

/** A registration whose claude pid was never identified holds the hub only while active this recently. */
export const UNKNOWN_PID_HOLD_MS = 24 * 3600_000;

/**
 * Counts toward keeping the hub up: active, and its claude process is not known to be dead. With an
 * unknown pid (and a hub that cannot run `claude agents`, the exit may never be detected), only while its
 * transcript (or, unreadable, its connection) changed in the last 24 h (audit R4-Info).
 */
async function holdsHub(r: Registration, now = Date.now()): Promise<boolean> {
  if (!isActive(r)) return false;
  if (r.pid !== null) return isAlive(r.pid);
  let last = Date.parse(r.connectedAt) || 0;
  try {
    last = Math.max(last, (await fs.stat(r.transcriptPath)).mtimeMs);
  } catch {
    /* no transcript yet: the connection time */
  }
  return now - last < UNKNOWN_PID_HOLD_MS;
}

export interface StartHubOptions {
  idleMs?: number;
  idleCheckMs?: number;
  /** How often exits are detected in the background. Default EXIT_CHECK_MS. */
  exitCheckMs?: number;
  /** Live session lookup (tests). Default: `claude agents`. */
  listLive?: () => Promise<LiveSession[] | null>;
  /** Called once when the hub has been idle for idleMs. Default (main): close and exit. */
  onIdle?: () => void;
  /** How often the hub checks that hub.json still names it. Default 60 s. */
  ownershipCheckMs?: number;
  /** Called once when hub.json names another hub or is gone. Default (main): close and exit. */
  onReplaced?: () => void;
  /** Binds the HTTP server (tests). Default: createHub. */
  createHub?: typeof createHub;
}

async function prune(log: (m: string) => void): Promise<void> {
  try {
    const gone = await pruneRegistrations(PRUNE_AGE_MS);
    if (gone.length) log(`pruned ${gone.length} old registration(s)`);
  } catch (e) {
    log(`prune failed: ${(e as Error).message}`);
  }
}

/** A new random token on every hub start (0600, written atomically): a copy kept anywhere goes stale. */
async function rotateToken(): Promise<string> {
  const file = paths().token;
  await ensureDir(path.dirname(file));
  const t = crypto.randomBytes(32).toString('hex');
  await writeFileAtomic600(file, t);
  await fs.chmod(file, 0o600).catch(() => {});
  return t;
}

async function writeFileAtomic600(file: string, data: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, data, { mode: 0o600 });
    await withFsRetry(() => fs.rename(tmp, file));
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}

/**
 * True only when the hub recorded in hub.json proves it knows the token on disk AND listens on the
 * recorded port (see ensureHub). A timeout (1 s), an error or a bad proof all mean "no live hub", so a
 * squatter on a stale port can neither stall nor stop a starting hub.
 *
 * `self`: the port this starting hub is bound to. A hub that died without its cleanup (SIGKILL, a crash,
 * any kill on Windows) leaves hub.json naming its port; the new hub may bind that same port, and dialing
 * it then reaches ITSELF, which proves the token it has just written. That is not another hub (audit
 * R4-C1: the new hub used to exit, and every /cc failed until hub.json was deleted by hand).
 */
async function liveHubExists(self?: { port: number }): Promise<boolean> {
  const info = await readJson<{ pid?: number; port?: number }>(paths().hubJson);
  if (!info || typeof info.port !== 'number') return false;
  if (self && info.port === self.port) return false; // we hold that port: whatever answers there is us
  let token: string;
  try {
    token = (await fs.readFile(paths().token, 'utf8')).trim();
  } catch {
    return false;
  }
  if (!TOKEN_RE.test(token)) return false;
  const challenge = newChallenge();
  try {
    const r = await fetch(`http://127.0.0.1:${info.port}/api/health?challenge=${challenge}`, { signal: AbortSignal.timeout(1000) });
    if (!r.ok) return false;
    const j = (await r.json()) as { ok?: unknown; pid?: unknown; version?: unknown; proof?: unknown };
    return (
      j.ok === true &&
      typeof j.pid === 'number' &&
      typeof j.version === 'string' &&
      typeof j.proof === 'string' &&
      proofMatches(token, challenge, info.port, { pid: j.pid, version: j.version, proof: j.proof })
    );
  } catch {
    return false;
  }
}

function pickPort(): number {
  const raw = process.env.AI_CHAT_CENTER_PORT;
  if (raw === undefined || raw === '') return 7777;
  const n = Number(raw);
  if (n === 0 && raw.trim() === '0') return 0; // ephemeral port (tests)
  return Number.isInteger(n) && n >= 1 && n <= 65525 ? n : 7777;
}

async function acquireHubLock(lock: string): Promise<boolean> {
  const deadline = Date.now() + 5000;
  for (;;) {
    if (await acquireLock(lock)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Start the hub. Resolves null when another live hub already runs. */
export async function startHub(opts: StartHubOptions = {}): Promise<{ port: number; close(): Promise<void> } | null> {
  const logDir = paths().logDir;
  await ensureDir(logDir);
  const logFile = path.join(logDir, 'hub.log');
  let secret = '';
  const log = (msg: string) => {
    try {
      const line = secret ? msg.split(secret).join('[redacted]') : msg;
      fsSync.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
    } catch {
      /* logging must never crash the hub */
    }
  };
  const deferred = (when: string) => {
    log(`another live hub answers on the port in hub.json (${when}): not starting (pid ${process.pid})`);
    return null;
  };
  if (await liveHubExists()) return deferred('before the lock');
  const lock = path.join(paths().home, 'hub.lock');
  // If the lock stays busy for 5 s we proceed anyway (it may be stale); the re-checks below still guard.
  const locked = await acquireHubLock(lock);
  let hub: Awaited<ReturnType<typeof createHub>> | undefined;
  try {
    if (await liveHubExists()) return deferred('under the lock');
    const token = await rotateToken();
    secret = token;

    const base = pickPort();
    const tries = base === 0 ? 1 : 11;
    const staticDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui');
    const provider = opts.listLive ? new ClaudeCodeProvider(opts.listLive) : new ClaudeCodeProvider();
    const bind = opts.createHub ?? createHub;
    let lastErr: unknown;
    for (let i = 0; i < tries && !hub; i++) {
      try {
        hub = await bind({ provider, token, port: base + i, staticDir, log });
      } catch (e) {
        lastErr = e;
        // EACCES: a port inside a range Windows reserves (Hyper-V/WSL); try the next one as for a busy port.
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== 'EADDRINUSE' && code !== 'EACCES') throw e;
      }
    }
    if (!hub) throw lastErr;
    const port = Number(new URL(hub.url).port);
    if (await liveHubExists({ port })) {
      await hub.close();
      return deferred(`after binding port ${port}`);
    }
    // Audit R5-L3: the waiter judges queued messages only once the install secret exists. After an upgrade
    // from 0.1.0 it did not exist until the first send, so old unsigned messages stayed "pending" with no
    // notice. A secret that cannot be read right now is not replaced (installSecret throws): logged only.
    try {
      await installSecret();
    } catch (e) {
      log(`the install secret could not be prepared: ${(e as Error).message}`);
    }
    await writeJsonAtomic(paths().hubJson, { pid: process.pid, port });
    log(`hub listening on ${hub.url}`);
    await prune(log);
    const pruneTimer = setInterval(() => void prune(log), PRUNE_EVERY_MS);
    // Exits used to be detected only while a browser polled, so a session closed without /cc off kept
    // its registration active (and the hub up) forever. Never overlapping; errors only logged.
    let exitCheckRunning = false;
    const exitTimer = setInterval(async () => {
      if (exitCheckRunning) return;
      exitCheckRunning = true;
      try {
        const gone = await provider.detectExits();
        if (gone.length) log(`marked ${gone.length} exited session(s)`);
      } catch (e) {
        log(`exit check failed: ${(e as Error).message}`);
      } finally {
        exitCheckRunning = false;
      }
    }, opts.exitCheckMs ?? EXIT_CHECK_MS);

    const started = hub;
    const idleMs = opts.idleMs ?? IDLE_EXIT_MS;
    let lastUsed = Date.now();
    let idleFired = false;
    const idleTimer = setInterval(async () => {
      try {
        // An open app page holds the hub even while hidden (a hidden page keeps no stream open).
        let held = started.clients() > 0 || (started.windows?.() ?? 0) > 0;
        for (const r of held ? [] : await listRegistrations()) if ((held = await holdsHub(r))) break;
        if (held) {
          lastUsed = Date.now();
          return;
        }
      } catch {
        lastUsed = Date.now(); // unsure: stay up
        return;
      }
      if (!idleFired && Date.now() - lastUsed >= idleMs) {
        idleFired = true;
        log(`idle for ${Math.round(idleMs / 60_000)} min with no browser and no connected session: exiting`);
        opts.onIdle?.();
      }
    }, opts.idleCheckMs ?? 60_000);
    // A hub that hub.json no longer names (another hub replaced it, or the state folder was deleted)
    // exits: it would otherwise keep running unseen, still accepting its old token.
    let replacedFired = false;
    let ownChecking = false; // checks never overlap (a slow read under load), so onReplaced fires once
    const ownTimer = setInterval(async () => {
      if (replacedFired || ownChecking) return;
      ownChecking = true;
      let cur: { pid?: number; port?: number } | null;
      try {
        cur = await readJson<{ pid?: number; port?: number }>(paths().hubJson);
      } finally {
        ownChecking = false;
      }
      if (replacedFired) return;
      if (cur?.pid === process.pid && cur?.port === port) return;
      if (!cur && fsSync.existsSync(paths().hubJson)) return; // unreadable for a moment (Windows): next time
      replacedFired = true;
      log(cur ? `hub.json now names pid ${cur.pid} port ${cur.port}: exiting` : 'hub.json is gone: exiting');
      opts.onReplaced?.();
    }, opts.ownershipCheckMs ?? 60_000);
    let done = false;
    return {
      port,
      close: async () => {
        if (done) return;
        done = true;
        clearInterval(pruneTimer);
        clearInterval(exitTimer);
        clearInterval(idleTimer);
        clearInterval(ownTimer);
        await started.close();
        const cur = await readJson<{ pid?: number; port?: number }>(paths().hubJson);
        if (cur?.pid === process.pid && cur?.port === port) await fs.rm(paths().hubJson, { force: true });
        log('hub stopped');
      },
    };
  } finally {
    if (locked) await releaseLock(lock);
  }
}

export async function main(): Promise<void> {
  let hub: Awaited<ReturnType<typeof startHub>> = null;
  const stop = () => void (hub ? hub.close() : Promise.resolve()).finally(() => process.exit(0));
  hub = await startHub({ onIdle: stop, onReplaced: stop });
  if (!hub) process.exit(0);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
