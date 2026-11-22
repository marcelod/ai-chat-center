#!/usr/bin/env node
// Runtime smoke test of the built plugin, as Claude Code runs it: plain Node (18+), no npm install,
// no package.json around the bundles. Used by CI on Node 18/20/22/24 against a `git archive` of HEAD.
//
// Usage: node scripts/smoke-runtime.mjs <checkout-dir>
//   <checkout-dir> holds plugin/ (plugin/dist/*.mjs and plugin/hooks/hooks.json).
// Checks:
//   1. hook.mjs and waiter.mjs, on an unregistered session: exit 0, no output, nothing written;
//   2. every hooks.json command line under sh (when sh exists): same result;
//   3. hub.mjs on a temp home and port: /api/health answers {ok, version} without a pid, and the
//      challenge form returns a proof made with the token on disk;
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
for (const [file, arg] of [['hook.mjs', 'prompt-submit'], ['hook.mjs', 'notification'], ['waiter.mjs', 'stop'], ['waiter.mjs', 'start']]) {
  const r = spawnSync(process.execPath, [path.join(dist, file), arg], { input, encoding: 'utf8', env, cwd: home, timeout: 15_000 });
  check(r.status === 0 && r.stdout === '' && r.stderr === '', `${file} ${arg}: exit ${r.status}, stdout ${JSON.stringify(r.stdout)}, stderr ${JSON.stringify((r.stderr ?? '').slice(0, 300))}`);
}
check(!fs.existsSync(stateHome), 'unregistered session wrote nothing');

// 2. The hooks.json command lines, under the POSIX shell Claude Code uses (Git Bash on Windows).
const sh = ['sh', 'bash'].find((s) => spawnSync(s, ['-c', 'exit 0']).status === 0);
const hooks = JSON.parse(fs.readFileSync(path.join(pluginDir, 'hooks', 'hooks.json'), 'utf8')).hooks;
const commands = [...new Set(Object.values(hooks).flat().flatMap((g) => g.hooks.map((h) => h.command)))];
if (!sh) console.log('skip hooks.json command lines: no sh on PATH');
for (const cmd of sh ? commands : []) {
  const r = spawnSync(sh, ['-c', cmd], { input, encoding: 'utf8', env: { ...env, CLAUDE_PLUGIN_ROOT: pluginDir }, cwd: home, timeout: 15_000 });
  check(r.status === 0 && r.stdout === '' && r.stderr === '', `sh: ${cmd.split('; exec ')[1] ?? cmd}: exit ${r.status} ${JSON.stringify((r.stderr ?? '').slice(0, 300))}`);
}

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
    const expected = crypto.createHmac('sha256', token).update(`${challenge}.${proven.pid}.${proven.version}`).digest('hex');
    check(proven.ok === true && proven.pid === hub.pid && proven.proof === expected, '/api/health?challenge= proves the token on disk');
    const page = await get(info.port, '/');
    check(page.status === 200 && page.body.includes('<html'), `GET / -> ${page.status}`);
  }
} catch (e) {
  check(false, `hub check threw: ${e?.message ?? e}`);
} finally {
  hub.kill();
  await new Promise((r) => (hub.exitCode !== null ? r() : hub.once('exit', r)));
}
fs.rmSync(home, { recursive: true, force: true });

if (failures.length) {
  console.error(`runtime smoke FAILED (${failures.length})`);
  process.exit(1);
}
console.log(`runtime smoke OK on node ${process.version}`);
