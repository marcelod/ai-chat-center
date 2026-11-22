import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { paths } from '../core/paths.js';
import { ensureDir, readJson, withFsRetry, writeJsonAtomic } from '../core/fsAtomic.js';
import { newChallenge, proofMatches } from '../core/healthProof.js';
import { ClaudeCodeProvider } from './provider.js';
import { acquireLock, releaseLock } from '../core/lock.js';
import { isActive, listRegistrations, pruneRegistrations } from '../core/registry.js';
import { createHub } from './server.js';

const TOKEN_RE = /^[0-9a-f]{64}$/;
/** Disconnected registrations older than this are deleted (with their inbox, busy and waiting files). */
export const PRUNE_AGE_MS = 30 * 86_400_000;
const PRUNE_EVERY_MS = 10 * 60_000;
/** The hub exits after this long with no browser connected and no active session. */
export const IDLE_EXIT_MS = 2 * 3600_000;

export interface StartHubOptions {
  idleMs?: number;
  idleCheckMs?: number;
  /** Called once when the hub has been idle for idleMs. Default (main): close and exit. */
  onIdle?: () => void;
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

/** True only when the hub recorded in hub.json proves it knows the token on disk (see ensureHub). */
async function liveHubExists(): Promise<boolean> {
  const info = await readJson<{ pid?: number; port?: number }>(paths().hubJson);
  if (!info || typeof info.port !== 'number') return false;
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
      proofMatches(token, challenge, { pid: j.pid, version: j.version, proof: j.proof })
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
  if (await liveHubExists()) return null;
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
  const lock = path.join(paths().home, 'hub.lock');
  // If the lock stays busy for 5 s we proceed anyway (it may be stale); the re-checks below still guard.
  const locked = await acquireHubLock(lock);
  let hub: Awaited<ReturnType<typeof createHub>> | undefined;
  try {
    if (await liveHubExists()) return null;
    const token = await rotateToken();
    secret = token;

    const base = pickPort();
    const tries = base === 0 ? 1 : 11;
    const staticDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui');
    const provider = new ClaudeCodeProvider();
    let lastErr: unknown;
    for (let i = 0; i < tries && !hub; i++) {
      try {
        hub = await createHub({ provider, token, port: base + i, staticDir, log });
      } catch (e) {
        lastErr = e;
        if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
      }
    }
    if (!hub) throw lastErr;
    if (await liveHubExists()) {
      await hub.close();
      return null;
    }
    const port = Number(new URL(hub.url).port);
    await writeJsonAtomic(paths().hubJson, { pid: process.pid, port });
    log(`hub listening on ${hub.url}`);
    await prune(log);
    const pruneTimer = setInterval(() => void prune(log), PRUNE_EVERY_MS);

    const started = hub;
    const idleMs = opts.idleMs ?? IDLE_EXIT_MS;
    let lastUsed = Date.now();
    let idleFired = false;
    const idleTimer = setInterval(async () => {
      try {
        if (started.clients() > 0 || (await listRegistrations()).some(isActive)) {
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
    let done = false;
    return {
      port,
      close: async () => {
        if (done) return;
        done = true;
        clearInterval(pruneTimer);
        clearInterval(idleTimer);
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
  hub = await startHub({ onIdle: stop });
  if (!hub) process.exit(0);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
