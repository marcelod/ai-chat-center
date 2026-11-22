import { describe, it, expect, beforeAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const dist = path.join(root, 'plugin', 'dist');
const stdin = JSON.stringify({ session_id: 'x', transcript_path: '', cwd: '.' });

function tmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'acc-build-'));
}

function run(script: string, args: string[], home: string) {
  return spawnSync(process.execPath, [path.join(dist, script), ...args], {
    input: stdin,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, AI_CHAT_CENTER_HOME: home },
  });
}

describe('plugin bundle', () => {
  beforeAll(() => {
    const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'build.mjs')], {
      cwd: root,
      encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(`build failed:\n${r.stdout}\n${r.stderr}`);
  }, 180_000);

  it('produces the bundles and the UI', () => {
    for (const f of ['hook.mjs', 'waiter.mjs', 'hub.mjs', path.join('ui', 'index.html')]) {
      expect(fs.existsSync(path.join(dist, f)), f).toBe(true);
    }
    for (const f of ['hook.js', 'waiter.js', 'hub.js']) expect(fs.existsSync(path.join(dist, f)), f).toBe(false);
  });

  it('hook.mjs prompt-submit is silent for an unconnected session', () => {
    const r = run('hook.mjs', ['prompt-submit'], tmpHome());
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  it('waiter.mjs exits quickly and silently for an unconnected session', () => {
    const t = Date.now();
    const r = run('waiter.mjs', ['stop'], tmpHome());
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(Date.now() - t).toBeLessThan(10_000);
  });

  it('hub.mjs serves health and the UI', async () => {
    const home = tmpHome();
    const child = spawn(process.execPath, [path.join(dist, 'hub.mjs')], {
      env: { ...process.env, AI_CHAT_CENTER_HOME: home, AI_CHAT_CENTER_PORT: '0' },
      stdio: 'ignore',
    });
    try {
      const hubJson = path.join(home, 'hub.json');
      let port = 0;
      for (let i = 0; i < 100 && !port; i++) {
        try {
          port = JSON.parse(fs.readFileSync(hubJson, 'utf8')).port;
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      expect(port).toBeGreaterThan(0);
      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(await health.json()).toMatchObject({ ok: true });
      const page = await fetch(`http://127.0.0.1:${port}/`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('<html');
    } finally {
      child.kill();
    }
  });
});
