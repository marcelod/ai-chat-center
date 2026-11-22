import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { paths } from '../core/paths.js';
import { ensureDir, readJson, writeJsonAtomic } from '../core/fsAtomic.js';
import { ClaudeCodeProvider } from './provider.js';
import { acquireLock, releaseLock } from '../core/lock.js';
import { createHub } from './server.js';

const TOKEN_RE = /^[0-9a-f]{64}$/;

async function ensureToken(log: (m: string) => void = () => {}): Promise<string> {
  const file = paths().token;
  await ensureDir(path.dirname(file));
  for (let attempt = 0; attempt < 3; attempt++) {
    const t = crypto.randomBytes(32).toString('hex');
    try {
      await fs.writeFile(file, t, { flag: 'wx', mode: 0o600 });
      return t;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    let existing = '';
    try {
      existing = (await fs.readFile(file, 'utf8')).trim();
    } catch {
      continue; // vanished; retry creation
    }
    if (TOKEN_RE.test(existing)) {
      await fs.chmod(file, 0o600).catch(() => {});
      return existing;
    }
    await writeFileAtomic600(file, t);
    log('token file was invalid; regenerated');
    return t;
  }
  throw new Error('could not create token file');
}

async function writeFileAtomic600(file: string, data: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, data, { mode: 0o600 });
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}

async function liveHubExists(): Promise<boolean> {
  const info = await readJson<{ pid?: number; port?: number }>(paths().hubJson);
  if (!info || typeof info.port !== 'number') return false;
  try {
    const r = await fetch(`http://127.0.0.1:${info.port}/api/health`, { signal: AbortSignal.timeout(1000) });
    return r.ok && ((await r.json()) as { ok?: boolean }).ok === true;
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
export async function startHub(): Promise<{ port: number; close(): Promise<void> } | null> {
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
    const token = await ensureToken(log);
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

    const started = hub;
    let done = false;
    return {
      port,
      close: async () => {
        if (done) return;
        done = true;
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
  const hub = await startHub();
  if (!hub) process.exit(0);
  const stop = () => void hub.close().finally(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
