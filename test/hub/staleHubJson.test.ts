import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

/**
 * Audit R4-C1: the hub dies without its cleanup (SIGKILL here; on Windows a reboot, Task Manager,
 * Stop-Process or process.kill, none of which runs the SIGTERM handler), so hub.json still names its
 * port. The next /cc starts a hub that binds that very port (now free); its last "is another hub live?"
 * check dialed hub.json's port, reached ITSELF, got a valid proof and exited: /cc failed forever.
 *
 * Real processes on a REAL fixed port (port 0 never reproduces it), built from the sources with esbuild
 * so the test does not depend on the committed plugin/dist.
 */

const root = path.resolve(__dirname, '..', '..');
let dir: string;
let dist: string;
const started: number[] = [];

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

async function freePort(): Promise<number> {
  const s = http.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const p = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-stale-'));
  dist = path.join(dir, 'dist');
  await build({
    entryPoints: { hook: path.join(root, 'src/bin/hook.ts'), hub: path.join(root, 'src/bin/hub.ts') },
    outdir: dist,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    outExtension: { '.js': '.mjs' },
    banner: { js: "import { createRequire as __acc_createRequire } from 'node:module';\nconst require = __acc_createRequire(import.meta.url);" },
    logLevel: 'silent',
  });
}, 60_000);

afterAll(() => {
  for (const pid of started) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('a hub killed without cleanup (R4-C1)', () => {
  it('the next /cc starts a hub on the same port, fast, and hub.json names it', async () => {
    const home = path.join(dir, 'state');
    const port = await freePort();
    // No `claude` on PATH: the pid lookup fails fast (the hook still connects).
    const env = { ...process.env, AI_CHAT_CENTER_HOME: home, AI_CHAT_CENTER_PORT: String(port), PATH: path.dirname(process.execPath) };
    const cc = () => {
      const t0 = Date.now();
      const r = spawnSync(process.execPath, [path.join(dist, 'hook.mjs'), 'prompt-submit'], {
        input: JSON.stringify({ session_id: 'stale-1', transcript_path: path.join(dir, 't.jsonl'), cwd: dir, prompt: '/cc' }),
        encoding: 'utf8',
        env,
        timeout: 30_000,
        windowsHide: true,
      });
      const out = JSON.parse(r.stdout || '{}') as { hookSpecificOutput?: { additionalContext?: string } };
      const hub = JSON.parse(fs.readFileSync(path.join(home, 'hub.json'), 'utf8')) as { pid: number; port: number };
      started.push(hub.pid);
      return { ms: Date.now() - t0, ctx: out.hookSpecificOutput?.additionalContext ?? '', hub };
    };

    const first = cc();
    expect(first.ctx.split('\n')[0]).toBe('AI Chat Center: connected');
    expect(first.hub.port).toBe(port);
    expect(isAlive(first.hub.pid)).toBe(true);

    process.kill(first.hub.pid, 'SIGKILL'); // no cleanup: hub.json stays behind
    for (let i = 0; i < 50 && isAlive(first.hub.pid); i++) await new Promise((r) => setTimeout(r, 50));
    expect(isAlive(first.hub.pid)).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(home, 'hub.json'), 'utf8')).pid).toBe(first.hub.pid);

    const second = cc();
    expect(second.ctx.split('\n')[0]).toBe('AI Chat Center: connected');
    // The bug's own signature (no wall-clock bound: this runs under load in the stress gate): the new hub
    // never took itself for another live hub.
    expect(fs.readFileSync(path.join(home, 'logs', 'hub.log'), 'utf8')).not.toMatch(/another live hub answers/);
    expect(second.hub.pid).not.toBe(first.hub.pid);
    expect(isAlive(second.hub.pid)).toBe(true);
    const health = await fetch(`http://127.0.0.1:${second.hub.port}/api/health`);
    expect(health.status).toBe(200);

    // And it stays up (it does not exit right after answering).
    await new Promise((r) => setTimeout(r, 500));
    expect(isAlive(second.hub.pid)).toBe(true);
  });
});
