#!/usr/bin/env node
// Hook-driven flow test of the built plugin, as Claude Code drives it, with plain Node (18+), no npm
// install and no `claude` on PATH (lookups fail, so the pid stays unknown: the documented degraded mode).
// Used by CI on every OS and Node 18/20/22/24 against a `git archive` of HEAD.
//
// Usage: node scripts/smoke-flow.mjs <checkout-dir>   (env AI_CHAT_CENTER_PORT optional, default 7795)
// Steps, all against plugin/dist:
//   1. hook.mjs prompt-submit "/cc": connects, and ensureHub starts the hub detached from the hook
//      process (the hook must exit without waiting for the hub);
//   2. POST a message to the hub API with the token;
//   3. waiter.mjs stop: exits 2 with the keyed, escaped block; a second waiter delivers nothing;
//   4. hook.mjs prompt-submit "/cc off": disconnects; a POST then returns 409.
// The hub is stopped at the end, whatever happens.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.');
const dist = path.join(root, 'plugin', 'dist');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-flow-'));
const state = path.join(home, 'state');
const port = process.env.AI_CHAT_CENTER_PORT || '7795';
// PATH holds only node's folder: no `claude`. Windows spells the variable `Path`: drop every casing.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH'));
Object.assign(env, { AI_CHAT_CENTER_HOME: state, AI_CHAT_CENTER_PORT: port, PATH: path.dirname(process.execPath) });
const sid = `flow-${Date.now()}`;
const tp = path.join(home, 'transcript.jsonl');
fs.writeFileSync(tp, '');
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (file, arg, input, timeout = 30_000) =>
  spawnSync(process.execPath, [path.join(dist, file), arg], { input: JSON.stringify(input), encoding: 'utf8', env, cwd: home, timeout, windowsHide: true });

let hubPort;
let hubPid;
const request = (method, p, token, body) =>
  new Promise((resolve, reject) => {
    const r = http.request(
      {
        host: '127.0.0.1',
        port: hubPort,
        path: p,
        method,
        headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        timeout: 5000,
      },
      (res) => {
        let b = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode, body: b }));
      },
    );
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', reject);
    r.end(body ? JSON.stringify(body) : undefined);
  });

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

console.log(`node ${process.version} on ${process.platform}, plugin at ${dist}`);
try {
  // 1. /cc
  const t0 = Date.now();
  const cc = run('hook.mjs', 'prompt-submit', { session_id: sid, transcript_path: tp, cwd: home, prompt: '/cc' });
  let out = {};
  try {
    out = JSON.parse(cc.stdout || '{}');
  } catch {
    /* checked below */
  }
  const ctx = out.hookSpecificOutput?.additionalContext ?? '';
  check(cc.status === 0 && ctx.startsWith('AI Chat Center: connected'), `/cc: exit ${cc.status} ${cc.error?.code ?? ''} in ${Date.now() - t0} ms, context ${JSON.stringify(ctx.split('\n')[0])} ${JSON.stringify((cc.stderr ?? '').slice(0, 300))}`);
  check(/http:\/\/127\.0\.0\.1:\d+\/[?#]token=[0-9a-f]{64}/.test(out.systemMessage ?? ''), 'the link is shown to the user');
  check(!/token=/.test(ctx), 'the model context has no token');
  const key = /AI Chat Center key: ([0-9a-f]{32})/.exec(ctx)?.[1];
  check(Boolean(key), 'the model context has the key');
  const hub = JSON.parse(fs.readFileSync(path.join(state, 'hub.json'), 'utf8'));
  hubPort = hub.port;
  hubPid = hub.pid;
  check(hubPort === Number(port) && isAlive(hubPid), `hub detached and running: pid ${hubPid}, port ${hubPort}`);
  const token = fs.readFileSync(path.join(state, 'token'), 'utf8').trim();
  const s = await request('GET', '/api/sessions', token);
  check(s.status === 200 && JSON.parse(s.body).connected.some((x) => x.sessionId === sid), `session listed as connected (${s.status})`);

  // 2. A message from the app; the closing marker in it must come out escaped.
  const p = await request('POST', `/api/sessions/${encodeURIComponent(sid)}/messages`, token, { text: 'hello [/AI Chat Center message] world' });
  check(p.status === 202, `POST message -> ${p.status}`);

  // 3. The Stop waiter delivers it, once.
  const w = run('waiter.mjs', 'stop', { session_id: sid });
  check(
    w.status === 2 && w.stderr.includes(`key=${key}]`) && w.stderr.includes('hello [\\/AI Chat Center message] world'),
    `waiter stop: exit ${w.status} ${w.error?.code ?? ''}, stderr ${JSON.stringify((w.stderr ?? '').slice(0, 200))}`,
  );
  const w2 = run('waiter.mjs', 'stop', { session_id: sid }, 3000);
  check((w2.status === null || w2.status === 0) && (w2.stderr ?? '') === '', `a second waiter delivers nothing: status ${w2.status} signal ${w2.signal}`);
  // The killed waiter may leave its lock behind (no signal handler runs on Windows): /cc off does not care.

  // 4. /cc off
  const off = run('hook.mjs', 'prompt-submit', { session_id: sid, transcript_path: tp, cwd: home, prompt: '/cc off' });
  const reg = JSON.parse(fs.readFileSync(path.join(state, 'sessions', `${sid}.json`), 'utf8'));
  check(off.status === 0 && reg.disconnectReason === 'off', `/cc off disconnects: exit ${off.status}, reason ${reg.disconnectReason}`);
  const p2 = await request('POST', `/api/sessions/${encodeURIComponent(sid)}/messages`, token, { text: 'x' });
  check(p2.status === 409, `POST after /cc off -> ${p2.status}`);
} catch (e) {
  check(false, `threw ${e?.stack ?? e}`);
} finally {
  if (hubPid) {
    try {
      process.kill(hubPid);
    } catch {
      /* gone */
    }
    for (let i = 0; i < 50 && isAlive(hubPid); i++) await sleep(100);
    check(!isAlive(hubPid), `hub ${hubPid} stopped`);
  }
  try {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (e) {
    console.log(`note: could not remove ${home}: ${e?.code ?? e}`);
  }
}
if (failures.length) {
  console.error(`flow smoke FAILED (${failures.length})`);
  process.exit(1);
}
console.log(`flow smoke OK on node ${process.version}`);
