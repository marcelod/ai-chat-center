#!/usr/bin/env node
// Runtime smoke test of the built plugin, as Claude Code runs it: plain Node (18+), no npm install,
// no package.json around the bundles. Used by CI on Node 18/20/22/24 against a `git archive` of HEAD.
//
// Usage: node scripts/smoke-runtime.mjs <checkout-dir>
//   <checkout-dir> holds plugin/ (plugin/dist/*.mjs and plugin/hooks/hooks.json).
// Checks:
//   1. hook.mjs and waiter.mjs, on an unregistered session: exit 0, no output, nothing written;
//   2. every hooks.json entry spawned as exec form (command + args, no shell): same result;
//   3. hub.mjs on a temp home and port: /api/health answers {ok, version} without a pid, and the
//      challenge form returns a proof made with the token on disk, bound to the port;
//   4. the UI page is served; then the hub is stopped.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.');
const pluginDir = path.join(root, 'plugin');
const dist = path.join(pluginDir, 'dist');
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-smoke-'));
const stateHome = path.join(home, 'state');
const env = { ...process.env, AI_CHAT_CENTER_HOME: stateHome };
const input = JSON.stringify({ session_id: 'smoke-unregistered', transcript_path: '', cwd: home, prompt: 'hello', source: 'startup', notification_type: 'permission_prompt' });

console.log(`node ${process.version} on ${process.platform}, plugin at ${pluginDir}`);

// 1. Bundles, called directly.
for (const [file, arg] of [['hook.mjs', 'prompt-submit'], ['hook.mjs', 'notification'], ['waiter.mjs', 'stop'], ['waiter.mjs', 'start'], ['waiter.mjs', 'prompt']]) {
  const r = spawnSync(process.execPath, [path.join(dist, file), arg], { input, encoding: 'utf8', env, cwd: home, timeout: 15_000 });
  check(r.status === 0 && r.stdout === '' && r.stderr === '', `${file} ${arg}: exit ${r.status}, stdout ${JSON.stringify(r.stdout)}, stderr ${JSON.stringify((r.stderr ?? '').slice(0, 300))}`);
}
check(!fs.existsSync(stateHome), 'unregistered session wrote nothing');

// 2. The hooks.json entries, as Claude Code runs exec-form hooks: `command` spawned directly with
//    `args` (the plugin-root placeholder substituted), no shell on any platform.
const hooks = JSON.parse(fs.readFileSync(path.join(pluginDir, 'hooks', 'hooks.json'), 'utf8')).hooks;
const entries = Object.values(hooks).flat().flatMap((g) => g.hooks);
const seen = new Set();
for (const h of entries) {
  const key = JSON.stringify([h.command, h.args]);
  if (seen.has(key)) continue;
  seen.add(key);
  const ok = h.command === 'node' && Array.isArray(h.args) && !('shell' in h);
  check(ok, `exec form: ${key}`);
  if (!ok) continue;
  const args = h.args.map((a) => a.split('${CLAUDE_PLUGIN_ROOT}').join(pluginDir));
  const r = spawnSync(h.command, args, { input, encoding: 'utf8', env, cwd: home, timeout: 15_000, shell: false });
  check(!r.error && r.status === 0 && r.stdout === '' && r.stderr === '', `exec ${h.args.join(' ')}: exit ${r.status} ${r.error?.code ?? ''} ${JSON.stringify((r.stderr ?? '').slice(0, 300))}`);
}
check(!fs.existsSync(stateHome), 'hooks.json entries on an unregistered session wrote nothing');

// 3. The hub.
function get(port, p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, headers: { accept: 'text/html' }, timeout: 3000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

const hub = spawn(process.execPath, [path.join(dist, 'hub.mjs')], {
  env: { ...env, AI_CHAT_CENTER_PORT: '0' },
  cwd: home,
  stdio: ['ignore', 'ignore', 'pipe'],
});
let hubErr = '';
hub.stderr.on('data', (c) => (hubErr += c));
try {
  let info = null;
  for (let i = 0; i < 100 && !info; i++) {
    try {
      info = JSON.parse(fs.readFileSync(path.join(stateHome, 'hub.json'), 'utf8'));
    } catch {
      await sleep(100);
    }
  }
  check(Boolean(info?.port), `hub wrote hub.json ${hubErr ? `(stderr: ${hubErr.slice(0, 300)})` : ''}`);
  if (info?.port) {
    const health = JSON.parse((await get(info.port, '/api/health')).body);
    check(health.ok === true && typeof health.version === 'string' && !('pid' in health), `/api/health ${JSON.stringify(health)}`);
    const token = fs.readFileSync(path.join(stateHome, 'token'), 'utf8').trim();
    const challenge = crypto.randomBytes(16).toString('hex');
    const proven = JSON.parse((await get(info.port, `/api/health?challenge=${challenge}`)).body);
    const expected = crypto.createHmac('sha256', token).update(`${challenge}|${info.port}|${proven.pid}|${proven.version}`).digest('hex');
    check(proven.ok === true && proven.pid === hub.pid && proven.proof === expected, '/api/health?challenge= proves the token on disk and the port');
    const page = await get(info.port, '/');
    check(page.status === 200 && page.body.includes('<html'), `GET / -> ${page.status}`);
  }
} catch (e) {
  check(false, `hub check threw: ${e?.message ?? e}`);
} finally {
  hub.kill();
  await new Promise((r) => (hub.exitCode !== null ? r() : hub.once('exit', r)));
}
try {
  // Windows may hold the hub's cwd or logs for a moment after the kill.
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
} catch (e) {
  console.log(`note: could not remove ${home}: ${e?.code ?? e}`);
}

if (failures.length) {
  console.error(`runtime smoke FAILED (${failures.length})`);
  process.exit(1);
}
console.log(`runtime smoke OK on node ${process.version}`);
