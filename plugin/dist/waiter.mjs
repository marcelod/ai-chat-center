import { createRequire as __acc_createRequire } from 'node:module';
const require = __acc_createRequire(import.meta.url);

// src/hooks/waiter.ts
import fs6 from "node:fs";
import path6 from "node:path";

// src/core/paths.ts
import os from "node:os";
import path from "node:path";
var SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
function assertSessionId(sid) {
  if (typeof sid !== "string" || !SESSION_ID_RE.test(sid)) {
    throw new Error(`Invalid session id: ${JSON.stringify(sid)}`);
  }
}
function paths() {
  const home = path.resolve(process.env.AI_CHAT_CENTER_HOME ?? path.join(os.homedir(), ".ai-chat-center"));
  return {
    home,
    token: path.join(home, "token"),
    hubJson: path.join(home, "hub.json"),
    config: path.join(home, "config.json"),
    sessionsDir: path.join(home, "sessions"),
    inboxDir: (sid) => (assertSessionId(sid), path.join(home, "inbox", sid)),
    sessionLock: (sid) => (assertSessionId(sid), path.join(home, "sessions", `${sid}.lock`)),
    waiterLock: (sid) => (assertSessionId(sid), path.join(home, "waiters", `${sid}.lock`)),
    waitingFile: (sid) => (assertSessionId(sid), path.join(home, "waiting", `${sid}.json`)),
    busyFile: (sid) => (assertSessionId(sid), path.join(home, "busy", sid)),
    logDir: path.join(home, "logs")
  };
}

// src/core/registry.ts
import fs5 from "node:fs/promises";
import path5 from "node:path";

// src/core/fsAtomic.ts
import fs from "node:fs/promises";
import path2 from "node:path";
import crypto from "node:crypto";
var DIR_MODE = 448;
var FILE_MODE = 384;
async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true, mode: DIR_MODE });
}
var TRANSIENT = /* @__PURE__ */ new Set(["EPERM", "EBUSY", "EACCES"]);
var RETRIES = 5;
async function withFsRetry(op) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await op();
    } catch (e) {
      if (attempt >= RETRIES || !TRANSIENT.has(e.code ?? "")) throw e;
      await new Promise((r) => setTimeout(r, 20 + Math.floor(Math.random() * 31)));
    }
  }
}
function removeFile(file) {
  return withFsRetry(() => fs.rm(file, { force: true }));
}
async function writeJsonAtomic(file, data) {
  await ensureDir(path2.dirname(file));
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), { encoding: "utf8", mode: FILE_MODE });
    await withFsRetry(() => fs.rename(tmp, file));
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}
async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

// src/core/inbox.ts
import fs2 from "node:fs/promises";
import path3 from "node:path";
import crypto2 from "node:crypto";
var isRace = (e) => ["ENOENT", "EPERM", "EBUSY"].includes(e.code ?? "");
async function list(sid) {
  const dir = paths().inboxDir(sid);
  try {
    return (await fs2.readdir(dir)).filter((n) => n.endsWith(".msg")).sort().map((n) => path3.join(dir, n));
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}
async function drain(sid) {
  const out = [];
  for (const f of await list(sid)) {
    const claimed = `${f}.claimed-${crypto2.randomUUID()}`;
    try {
      await fs2.rename(f, claimed);
    } catch (e) {
      if (isRace(e)) continue;
      throw e;
    }
    let m = null;
    try {
      m = JSON.parse(await fs2.readFile(claimed, "utf8"));
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
    }
    await withFsRetry(() => fs2.rm(claimed, { force: true }));
    if (m) out.push(m);
  }
  return out;
}
async function clearInbox(sid) {
  const dir = paths().inboxDir(sid);
  let names;
  try {
    names = await fs2.readdir(dir);
  } catch (e) {
    if (e.code === "ENOENT") return;
    throw e;
  }
  for (const n of names) {
    if (!n.endsWith(".msg") && !n.endsWith(".tmp") && !n.includes(".msg.claimed-")) continue;
    try {
      await withFsRetry(() => fs2.rm(path3.join(dir, n), { force: true }));
    } catch (e) {
      if (!isRace(e)) throw e;
    }
  }
}

// src/core/busy.ts
import fs3 from "node:fs/promises";
async function clearBusy(sid) {
  await removeFile(paths().busyFile(sid));
}
async function isBusy(sid) {
  try {
    await fs3.access(paths().busyFile(sid));
    return true;
  } catch {
    return false;
  }
}

// src/core/waiting.ts
async function clearWaiting(sid) {
  await removeFile(paths().waitingFile(sid));
}

// src/core/lock.ts
import fs4 from "node:fs/promises";
import path4 from "node:path";
import crypto3 from "node:crypto";
var EMPTY_GRACE_MS = 1e4;
var LOCK_STALE_MS = 9e4;
function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}
var code = (e) => e.code;
function lockPid(content) {
  const t = content.trim();
  let pid = null;
  if (/^\d+$/.test(t)) pid = parseInt(t, 10);
  else {
    try {
      pid = JSON.parse(t)?.pid;
    } catch {
    }
  }
  return typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : null;
}
async function publish(file) {
  const tmp = `${file}.${crypto3.randomUUID()}.tmp`;
  try {
    await fs4.writeFile(tmp, JSON.stringify({ pid: process.pid, ts: (/* @__PURE__ */ new Date()).toISOString() }), { flag: "wx" });
    await fs4.link(tmp, file);
    return true;
  } catch (e) {
    if (["EEXIST", "EPERM", "EBUSY"].includes(code(e) ?? "")) return false;
    throw e;
  } finally {
    await fs4.rm(tmp, { force: true });
  }
}
async function staleContent(file) {
  let content;
  let mtimeMs;
  try {
    content = await fs4.readFile(file, "utf8");
  } catch (e) {
    if (code(e) === "ENOENT") return null;
    content = "";
  }
  try {
    mtimeMs = (await fs4.stat(file)).mtimeMs;
  } catch {
    return null;
  }
  const age = Date.now() - mtimeMs;
  const pid = lockPid(content);
  if (pid !== null) return !isAlive(pid) || age > LOCK_STALE_MS ? content : null;
  return age > EMPTY_GRACE_MS ? content : null;
}
var GUARD_STALE_MS = 1e4;
var contention = (e) => ["EEXIST", "EPERM", "EBUSY"].includes(code(e) ?? "");
async function reclaimStaleLock(file, seen) {
  const guard = `${file}.reclaim`;
  if (!await publish(guard)) {
    try {
      const st = await fs4.stat(guard);
      if (Date.now() - st.mtimeMs > GUARD_STALE_MS) await fs4.rm(guard, { force: true });
    } catch {
    }
    return false;
  }
  try {
    if (await staleContent(file) !== seen) return false;
    try {
      await fs4.unlink(file);
    } catch (e) {
      if (code(e) !== "ENOENT") {
        if (contention(e)) return false;
        throw e;
      }
    }
    return await publish(file);
  } finally {
    try {
      if (lockPid(await fs4.readFile(guard, "utf8")) === process.pid) await fs4.rm(guard, { force: true });
    } catch {
    }
  }
}
async function acquireLock(file) {
  await ensureDir(path4.dirname(file));
  if (await publish(file)) return true;
  const seen = await staleContent(file);
  if (seen === null) return false;
  return reclaimStaleLock(file, seen);
}
async function touchLock(file) {
  try {
    if (lockPid(await fs4.readFile(file, "utf8")) !== process.pid) return;
    const now = /* @__PURE__ */ new Date();
    await fs4.utimes(file, now, now);
  } catch {
  }
}
async function releaseLock(file) {
  try {
    if (lockPid(await fs4.readFile(file, "utf8")) !== process.pid) return;
  } catch {
    return;
  }
  await fs4.rm(file, { force: true });
}
async function withLock(file, waitMs, fn) {
  const deadline = Date.now() + waitMs;
  let held = false;
  for (; ; ) {
    if (await acquireLock(file)) {
      held = true;
      break;
    }
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, 10 + Math.floor(Math.random() * 15)));
  }
  try {
    return await fn();
  } finally {
    if (held) await releaseLock(file);
  }
}

// src/core/registry.ts
var SESSION_LOCK_WAIT_MS = 2e3;
var locked = (sid, fn) => withLock(paths().sessionLock(sid), SESSION_LOCK_WAIT_MS, fn);
function regFile(sid) {
  assertSessionId(sid);
  return path5.join(paths().sessionsDir, `${sid}.json`);
}
var isActive = (r) => !r.disconnectedAt;
async function updateRegistration(sid, patch, opts = {}) {
  if (!await getRegistration(sid)) return null;
  return locked(sid, async () => {
    const r = await getRegistration(sid);
    if (!r) return null;
    if (opts.ifConnectedAt !== void 0 && (!isActive(r) || r.connectedAt !== opts.ifConnectedAt)) return null;
    const next = { ...r, ...patch };
    await writeJsonAtomic(regFile(sid), next);
    return next;
  });
}
async function getRegistration(sid) {
  return readJson(regFile(sid));
}
async function listRegistrations() {
  let names;
  try {
    names = await fs5.readdir(paths().sessionsDir);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const out = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    const r = await readJson(path5.join(paths().sessionsDir, n));
    if (r) out.push(r);
  }
  return out;
}
async function markDisconnected(sid, reason) {
  const done = await locked(sid, async () => {
    const r = await getRegistration(sid);
    if (!r) return false;
    if (isActive(r)) await writeJsonAtomic(regFile(sid), { ...r, disconnectedAt: (/* @__PURE__ */ new Date()).toISOString(), disconnectReason: reason });
    return true;
  });
  if (!done) return;
  await clearInbox(sid);
  await clearBusy(sid);
}

// src/core/claudeAgents.ts
import { execFile } from "node:child_process";
import os2 from "node:os";
function runClaudeAgentsJson() {
  return new Promise((resolve, reject) => {
    execFile(
      "claude",
      ["agents", "--json"],
      { cwd: os2.homedir(), shell: process.platform === "win32", windowsHide: true, timeout: 5e3, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => err ? reject(err) : resolve(String(stdout))
    );
  });
}

// src/hooks/claudePid.ts
async function lookupClaudePid(sessionId, opts = {}) {
  try {
    const list2 = JSON.parse(await (opts.run ?? runClaudeAgentsJson)());
    if (!Array.isArray(list2)) return { ok: false };
    for (const a of list2) {
      if (a?.sessionId === sessionId && typeof a.pid === "number") return { ok: true, pid: a.pid };
    }
    return { ok: true, pid: null };
  } catch {
    return { ok: false };
  }
}

// src/core/protocol.ts
var OPEN = (id, key) => `[AI Chat Center message id=${id}${key ? ` key=${key}` : ""}]`;
var CLOSE = "[/AI Chat Center message]";
var escapeBody = (t) => t.replace(/\[(\\*)\/AI Chat Center message\]/g, "[$1\\/AI Chat Center message]");
function wrapMessages(msgs, key) {
  return msgs.map((m) => `${OPEN(m.id, key)}
${escapeBody(m.text)}
${CLOSE}`).join("\n\n");
}

// src/hooks/waiter.ts
var HOOK_TIMEOUT_S = 86400;
var WAITER_BUDGET_MS = (HOOK_TIMEOUT_S - 60) * 1e3;
var MAX_MESSAGE_AGE_MS = 30 * 6e4;
var RERESOLVE_MS = 6e4;
var MAX_MISSES = 3;
var HEARTBEAT_MS = 1e4;
var SWITCH_SOURCES = /* @__PURE__ */ new Set(["startup", "resume", "clear", "fork"]);
var NOTHING = { exitCode: 0, stderr: "" };
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function activeReg(sid) {
  const r = await getRegistration(sid);
  return r && isActive(r) ? r : null;
}
async function sessionSwitch(sid, input, lookup) {
  const source = input.source ?? "";
  if (!SWITCH_SOURCES.has(source)) return;
  const active = (await listRegistrations()).filter(isActive);
  const others = active.filter((r2) => r2.sessionId !== sid && r2.pid !== null);
  const own = active.find((r2) => r2.sessionId === sid);
  const refresh = own !== void 0 && (source === "resume" || source === "startup");
  if (others.length === 0 && !refresh) return;
  const r = await lookup();
  const pid = r.ok ? r.pid : null;
  if (pid !== null) {
    for (const o of others) if (o.pid === pid) await markDisconnected(o.sessionId, "clear");
  }
  if (refresh) {
    const tp = typeof input.transcript_path === "string" && input.transcript_path ? { transcriptPath: input.transcript_path } : {};
    await updateRegistration(sid, { pid, ...tp }, { ifConnectedAt: own.connectedAt });
  }
}
async function runWaiter(event, input, opts = {}) {
  const sid = input?.session_id;
  try {
    assertSessionId(sid);
  } catch {
    return NOTHING;
  }
  const startedAt = Date.now();
  const pollMs = opts.pollMs ?? 1e3;
  const isAlive2 = opts.isAlive ?? isAlive;
  const clear = opts.clearWaiting ?? clearWaiting;
  const reresolveMs = opts.reresolveMs ?? RERESOLVE_MS;
  const deadlineMs = opts.deadlineMs ?? WAITER_BUDGET_MS;
  const now = opts.now ?? Date.now;
  const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
  const lookupFn = opts.lookup ?? ((id) => lookupClaudePid(id));
  let misses = 0;
  let lastLookupAt = 0;
  let lookups = 0;
  const lookup = async () => {
    lookups++;
    lastLookupAt = Date.now();
    const r = await lookupFn(sid);
    if (r.ok) misses = r.pid === null ? misses + 1 : 0;
    return r;
  };
  if (event === "start") {
    try {
      await sessionSwitch(sid, input, lookup);
    } catch (e) {
      logError(e);
    }
  }
  const first = await activeReg(sid);
  if (!first) return NOTHING;
  if (event === "stop") {
    try {
      await clearBusy(sid);
      await clear(sid);
    } catch (e) {
      logError(e);
    }
  }
  const adopt = async (found) => {
    await updateRegistration(sid, { pid: found }, { ifConnectedAt: first.connectedAt });
  };
  let pid = first.pid ?? null;
  if (pid === null && lookups === 0) {
    const r = await lookup();
    if (r.ok && r.pid !== null) {
      pid = r.pid;
      await adopt(pid);
    }
  }
  const lock = paths().waiterLock(sid);
  if (!await acquireLock(lock)) return NOTHING;
  let lastBeat = Date.now();
  let deadChecked = false;
  try {
    for (; ; ) {
      if (Date.now() - startedAt >= deadlineMs) return NOTHING;
      const reg = await activeReg(sid);
      if (!reg) return NOTHING;
      if (Date.now() - lastBeat >= heartbeatMs) {
        lastBeat = Date.now();
        await touchLock(lock);
      }
      const regPid = reg.pid ?? pid;
      if (regPid === null) {
        if (misses >= MAX_MISSES) return NOTHING;
        if (Date.now() - lastLookupAt >= reresolveMs) {
          const r = await lookup();
          if (misses >= MAX_MISSES) return NOTHING;
          if (r.ok && r.pid !== null) {
            pid = r.pid;
            await adopt(pid);
          }
        }
      } else if (!isAlive2(regPid)) {
        if (deadChecked) return NOTHING;
        deadChecked = true;
        const r = await lookup();
        const fresh = r.ok ? r.pid : null;
        if (fresh === null || fresh === regPid || !isAlive2(fresh)) return NOTHING;
        pid = fresh;
        await adopt(fresh);
        continue;
      }
      if (!await isBusy(sid)) {
        const drained = await drain(sid);
        const cutoff = now() - MAX_MESSAGE_AGE_MS;
        const msgs = drained.filter((m) => !(Date.parse(m.createdAt) < cutoff));
        if (msgs.length < drained.length) {
          logError(`discarded ${drained.length - msgs.length} message(s) older than 30 min for session ${sid}`);
        }
        if (msgs.length > 0) {
          const result = { exitCode: 2, stderr: wrapMessages(msgs, reg.key) };
          try {
            await clear(sid);
          } catch (e) {
            logError(e);
          }
          return result;
        }
      }
      await sleep(pollMs);
    }
  } finally {
    await releaseLock(lock);
  }
}
async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}
function logError(e) {
  try {
    const dir = paths().logDir;
    fs6.mkdirSync(dir, { recursive: true, mode: 448 });
    fs6.appendFileSync(
      path6.join(dir, "waiter.log"),
      `${(/* @__PURE__ */ new Date()).toISOString()} ${e instanceof Error ? e.stack ?? e.message : String(e)}
`
    );
  } catch {
  }
}
function releaseOwnLockSync(sid) {
  try {
    assertSessionId(sid);
    const lock = paths().waiterLock(sid);
    if (lockPid(fs6.readFileSync(lock, "utf8")) === process.pid) fs6.rmSync(lock, { force: true });
  } catch {
  }
}
async function main() {
  let result = NOTHING;
  try {
    const event = process.argv[2];
    if (event !== "start" && event !== "stop") return;
    const input = JSON.parse(await readStdin());
    const onSignal = () => {
      releaseOwnLockSync(input?.session_id);
      process.exit(0);
    };
    process.on("SIGTERM", onSignal);
    process.on("SIGINT", onSignal);
    result = await runWaiter(event, input);
  } catch (e) {
    logError(e);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr, () => process.exit(result.exitCode));
  } else {
    process.exitCode = result.exitCode;
  }
}

// src/bin/waiter.ts
void main();
