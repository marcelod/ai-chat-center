import { createRequire as __acc_createRequire } from 'node:module';
const require = __acc_createRequire(import.meta.url);

// src/hooks/waiter.ts
import fs7 from "node:fs";
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
    secret: path.join(home, "install-secret"),
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
import fs6 from "node:fs/promises";
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
import fs3 from "node:fs/promises";
import path3 from "node:path";
import crypto3 from "node:crypto";

// src/core/secret.ts
import fs2 from "node:fs/promises";
import crypto2 from "node:crypto";
var SECRET_RE = /^[0-9a-f]{64}$/;
async function readSecret() {
  try {
    const s = (await fs2.readFile(paths().secret, "utf8")).trim();
    return SECRET_RE.test(s) ? s : null;
  } catch {
    return null;
  }
}
var mac = (secret, id, text) => crypto2.createHmac("sha256", secret).update(`${id}|${text}`).digest("hex");
async function verifyMessage(m) {
  if (typeof m?.id !== "string" || typeof m.text !== "string" || typeof m.sig !== "string" || m.id.includes("|")) return false;
  const secret = await readSecret();
  if (!secret) return false;
  const want = Buffer.from(mac(secret, m.id, m.text));
  const got = Buffer.from(m.sig);
  return want.length === got.length && crypto2.timingSafeEqual(want, got);
}

// src/core/inbox.ts
var isRace = (e) => ["ENOENT", "EPERM", "EBUSY"].includes(e.code ?? "");
async function list(sid) {
  const dir = paths().inboxDir(sid);
  try {
    return (await fs3.readdir(dir)).filter((n) => n.endsWith(".msg")).sort().map((n) => path3.join(dir, n));
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}
var READ_RETRIES = 3;
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
var CLAIMED_RE = /\.msg\.claimed-(?:(\d{13,})-)?/;
async function readClaimed(file) {
  for (let attempt = 0; ; attempt++) {
    try {
      return JSON.parse(await fs3.readFile(file, "utf8"));
    } catch (e) {
      if (e instanceof SyntaxError) return "malformed";
      if (attempt >= READ_RETRIES) return "unreadable";
      await sleep(20 + Math.floor(Math.random() * 31));
    }
  }
}
var CLAIM_MARK = ".claim";
var MARKER_STALE_MS = 6e4;
async function removeMarker(marker) {
  try {
    await withFsRetry(() => fs3.rm(marker, { force: true }));
  } catch {
  }
}
async function drain(sid) {
  const out = [];
  for (const f of await list(sid)) {
    const claimed = `${f}.claimed-${Date.now()}-${crypto3.randomUUID()}`;
    const marker = `${f}${CLAIM_MARK}`;
    try {
      await fs3.writeFile(marker, "", { flag: "wx", mode: FILE_MODE });
    } catch (e) {
      if (isRace(e) || ["EEXIST", "EACCES"].includes(e.code ?? "")) continue;
      if (out.length > 0) break;
      throw e;
    }
    try {
      await withFsRetry(() => fs3.rename(f, claimed));
    } catch (e) {
      await removeMarker(marker);
      if (isRace(e)) continue;
      if (out.length > 0) break;
      throw e;
    }
    await removeMarker(marker);
    const m = await readClaimed(claimed);
    if (m === "unreadable") {
      try {
        await withFsRetry(() => fs3.rename(claimed, f));
      } catch {
      }
      continue;
    }
    if (m !== "malformed") out.push(m);
    try {
      await withFsRetry(() => fs3.rm(claimed, { force: true }));
    } catch {
    }
  }
  return out;
}
async function sweepClaimed(sid, maxAgeMs) {
  const dir = paths().inboxDir(sid);
  let names;
  try {
    names = await fs3.readdir(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  const now = Date.now();
  for (const n of names) {
    if (n.endsWith(`.msg${CLAIM_MARK}`)) {
      try {
        if (now - (await fs3.stat(path3.join(dir, n))).mtimeMs <= Math.min(maxAgeMs, MARKER_STALE_MS)) continue;
        await withFsRetry(() => fs3.rm(path3.join(dir, n), { force: true }));
        removed++;
      } catch {
      }
      continue;
    }
    const m = CLAIMED_RE.exec(n);
    if (!m) continue;
    const file = path3.join(dir, n);
    try {
      const at = m[1] ? Number(m[1]) : (await fs3.stat(file)).mtimeMs;
      if (now - at <= maxAgeMs) continue;
      await withFsRetry(() => fs3.rm(file, { force: true }));
      removed++;
    } catch {
    }
  }
  return removed;
}
async function clearInbox(sid) {
  const dir = paths().inboxDir(sid);
  let names;
  try {
    names = await fs3.readdir(dir);
  } catch (e) {
    if (e.code === "ENOENT") return;
    throw e;
  }
  for (const n of names) {
    if (!n.endsWith(".msg") && !n.endsWith(".tmp") && !n.includes(".msg.claimed-") && !n.endsWith(`.msg${CLAIM_MARK}`)) continue;
    try {
      await withFsRetry(() => fs3.rm(path3.join(dir, n), { force: true }));
    } catch (e) {
      if (!isRace(e)) throw e;
    }
  }
}

// src/core/busy.ts
import fs4 from "node:fs/promises";
async function clearBusy(sid) {
  await removeFile(paths().busyFile(sid));
}
async function clearBusyIfOlder(sid, before) {
  let mtimeMs;
  try {
    mtimeMs = (await fs4.stat(paths().busyFile(sid))).mtimeMs;
  } catch {
    return true;
  }
  if (mtimeMs >= before) return false;
  await removeFile(paths().busyFile(sid));
  return true;
}
async function isBusy(sid) {
  try {
    await fs4.access(paths().busyFile(sid));
    return true;
  } catch {
    return false;
  }
}
async function busyAge(sid, now = Date.now()) {
  try {
    return now - (await fs4.stat(paths().busyFile(sid))).mtimeMs;
  } catch {
    return null;
  }
}

// src/core/waiting.ts
async function clearWaiting(sid) {
  await removeFile(paths().waitingFile(sid));
}

// src/core/lock.ts
import fs5 from "node:fs/promises";
import path4 from "node:path";
import crypto4 from "node:crypto";
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
  const tmp = `${file}.${crypto4.randomUUID()}.tmp`;
  const content = JSON.stringify({ pid: process.pid, ts: (/* @__PURE__ */ new Date()).toISOString() });
  try {
    await fs5.writeFile(tmp, content, { flag: "wx" });
    await fs5.link(tmp, file);
    return content;
  } catch (e) {
    if (["EEXIST", "EPERM", "EBUSY"].includes(code(e) ?? "")) return null;
    throw e;
  } finally {
    await fs5.rm(tmp, { force: true });
  }
}
async function staleContent(file) {
  let content;
  let mtimeMs;
  try {
    content = await fs5.readFile(file, "utf8");
  } catch (e) {
    if (code(e) === "ENOENT") return null;
    content = "";
  }
  try {
    mtimeMs = (await fs5.stat(file)).mtimeMs;
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
async function reclaim(file, seen) {
  const guard = `${file}.reclaim`;
  if (await publish(guard) === null) {
    try {
      const st = await fs5.stat(guard);
      if (Date.now() - st.mtimeMs > GUARD_STALE_MS) await fs5.rm(guard, { force: true });
    } catch {
    }
    return null;
  }
  try {
    if (await staleContent(file) !== seen) return null;
    try {
      await fs5.unlink(file);
    } catch (e) {
      if (code(e) !== "ENOENT") {
        if (contention(e)) return null;
        throw e;
      }
    }
    return await publish(file);
  } finally {
    try {
      if (lockPid(await fs5.readFile(guard, "utf8")) === process.pid) await fs5.rm(guard, { force: true });
    } catch {
    }
  }
}
async function acquireLock(file) {
  return await acquireLockContent(file) !== null;
}
async function acquireLockContent(file) {
  await ensureDir(path4.dirname(file));
  const mine = await publish(file);
  if (mine !== null) return mine;
  const seen = await staleContent(file);
  if (seen === null) return null;
  return reclaim(file, seen);
}
async function touchLock(file) {
  try {
    if (lockPid(await fs5.readFile(file, "utf8")) !== process.pid) return;
    const now = /* @__PURE__ */ new Date();
    await fs5.utimes(file, now, now);
  } catch {
  }
}
async function releaseLock(file) {
  try {
    if (lockPid(await fs5.readFile(file, "utf8")) !== process.pid) return;
  } catch {
    return;
  }
  await fs5.rm(file, { force: true });
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
    names = await fs6.readdir(paths().sessionsDir);
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
function runClaudeAgentsJson(platform = process.platform) {
  const win = platform === "win32";
  return new Promise((resolve, reject) => {
    execFile(
      win ? "claude agents --json" : "claude",
      win ? [] : ["agents", "--json"],
      { cwd: os2.homedir(), shell: win, windowsHide: true, timeout: 5e3, maxBuffer: 10 * 1024 * 1024 },
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

// src/core/ccCommand.ts
var CC_RE = /^\s*\/(?:ai-chat-center:)?cc(?:\s+(\S[\s\S]*?))?\s*$/i;
function isCcCommand(prompt) {
  if (typeof prompt !== "string") return null;
  const m = CC_RE.exec(prompt);
  if (!m) return null;
  if (m[1] === void 0) return "on";
  return m[1].toLowerCase() === "off" ? "off" : "unknown";
}

// src/hub/status.ts
function toLive(x) {
  if (!x || typeof x !== "object") return null;
  const o = x;
  if (typeof o.sessionId !== "string" || !o.sessionId) return null;
  if (typeof o.pid !== "number" || typeof o.cwd !== "string") return null;
  if (o.kind !== "interactive" && o.kind !== "background") return null;
  return {
    pid: o.pid,
    cwd: o.cwd,
    kind: o.kind,
    sessionId: o.sessionId,
    name: typeof o.name === "string" ? o.name : "",
    // Presence never depends on status: unknown values degrade to idle.
    status: o.status === "busy" || o.status === "waiting" ? o.status : "idle"
  };
}
async function queryLiveSessions(run = runClaudeAgentsJson) {
  try {
    const parsed = JSON.parse(await run());
    if (!Array.isArray(parsed)) return null;
    return parsed.map(toLive).filter((s) => s !== null);
  } catch {
    return null;
  }
}

// src/hooks/waiter.ts
var HOOK_TIMEOUT_S = 86400;
var WAITER_BUDGET_MS = (HOOK_TIMEOUT_S - 60) * 1e3;
var MAX_MESSAGE_AGE_MS = 30 * 6e4;
var LOOKUP_FAIL_EXIT_MS = 30 * 6e4;
var CLAIMED_SWEEP_MS = 36e5;
var RERESOLVE_MS = 6e4;
var MAX_MISSES = 3;
var HEARTBEAT_MS = 1e4;
var STALE_BUSY_MS = 1e4;
var BUSY_CHECK_MS = 15e3;
var PROMPT_SETTLE_MS = 3e3;
var SWITCH_SOURCES = /* @__PURE__ */ new Set(["startup", "resume", "clear", "fork"]);
var NOTHING = { exitCode: 0, stderr: "" };
var sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
async function activeReg(sid) {
  const r = await getRegistration(sid);
  return r && isActive(r) ? r : null;
}
async function liveStatus(sid) {
  const list2 = await queryLiveSessions();
  return list2?.find((l) => l.sessionId === sid)?.status ?? null;
}
async function hasQueued(sid) {
  try {
    return (await fs7.promises.readdir(paths().inboxDir(sid))).some((n) => n.endsWith(".msg"));
  } catch {
    return false;
  }
}
async function sessionSwitch(sid, input, lookup, lookupOther) {
  const source = input.source ?? "";
  if (!SWITCH_SOURCES.has(source)) return;
  const active = (await listRegistrations()).filter(isActive);
  const others = active.filter((r2) => r2.sessionId !== sid && r2.pid !== null);
  if (source === "clear") {
    for (const u of active.filter((r2) => r2.sessionId !== sid && r2.pid === null)) {
      const r2 = await lookupOther(u.sessionId);
      if (r2.ok && r2.pid !== null) {
        await updateRegistration(u.sessionId, { pid: r2.pid }, { ifConnectedAt: u.connectedAt });
        others.push({ ...u, pid: r2.pid });
      } else if (r2.ok || typeof input.cwd === "string" && u.cwd === input.cwd) {
        await markDisconnected(u.sessionId, "clear");
      }
    }
  }
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
  const lookupFailMs = opts.lookupFailMs ?? LOOKUP_FAIL_EXIT_MS;
  const discardOld = event === "start" && input.source === "resume";
  const statusFn = opts.status ?? liveStatus;
  const staleBusyMs = opts.staleBusyMs ?? STALE_BUSY_MS;
  const busyCheckMs = opts.busyCheckMs ?? BUSY_CHECK_MS;
  const settleUntil = event === "prompt" ? startedAt + (opts.promptSettleMs ?? PROMPT_SETTLE_MS) : 0;
  if (event === "prompt" && isCcCommand(input.prompt) !== null) return NOTHING;
  let misses = 0;
  let lastLookupAt = 0;
  let lookups = 0;
  let failingSince = null;
  const lookup = async () => {
    lookups++;
    lastLookupAt = Date.now();
    const r = await lookupFn(sid);
    if (r.ok) {
      misses = r.pid === null ? misses + 1 : 0;
      failingSince = null;
    } else failingSince ??= now();
    return r;
  };
  const failingTooLong = () => failingSince !== null && now() - failingSince >= lookupFailMs;
  if (event === "start") {
    try {
      await sessionSwitch(sid, input, lookup, lookupFn);
    } catch (e) {
      logError(e);
    }
  }
  const first = await activeReg(sid);
  if (!first) return NOTHING;
  if (event === "stop") {
    try {
      if (!await clearBusyIfOlder(sid, opts.spawnedAt ?? startedAt)) logError(`stop of session ${sid}: the busy marker is newer than this waiter (the next turn started): kept`);
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
  const mine = await acquireLockContent(lock);
  if (mine === null) return NOTHING;
  let lastBeat = Date.now();
  let deadChecked = false;
  let lastStatusAt = -Infinity;
  const dropStaleBusy = async () => {
    const age = await busyAge(sid);
    if (age === null) return true;
    if (age <= staleBusyMs || Date.now() - lastStatusAt < busyCheckMs || !await hasQueued(sid)) return false;
    lastStatusAt = Date.now();
    if (await statusFn(sid) !== "idle") return false;
    const again = await busyAge(sid);
    if (again !== null && again <= staleBusyMs) return false;
    await clearBusy(sid);
    logError(`dropped a busy marker left by an interrupted turn of session ${sid}`);
    return true;
  };
  try {
    try {
      await sweepClaimed(sid, CLAIMED_SWEEP_MS);
    } catch (e) {
      logError(e);
    }
    for (; ; ) {
      if (Date.now() - startedAt >= deadlineMs) return NOTHING;
      try {
        const lockLost = async () => {
          if (await readLock(lock) === mine) return false;
          logError(`waiter lock for session ${sid} is no longer ours: exiting without draining`);
          return true;
        };
        if (await lockLost()) return NOTHING;
        const reg = await activeReg(sid);
        if (!reg) return NOTHING;
        if (Date.now() - lastBeat >= heartbeatMs) {
          lastBeat = Date.now();
          await touchLock(lock);
        }
        const regPid = reg.pid ?? pid;
        if (regPid === null) {
          if (misses >= MAX_MISSES || failingTooLong()) return NOTHING;
          if (Date.now() - lastLookupAt >= reresolveMs) {
            const r = await lookup();
            if (misses >= MAX_MISSES || failingTooLong()) return NOTHING;
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
        if (Date.now() < settleUntil) {
        } else if (await isBusy(sid) && !await dropStaleBusy()) {
        } else {
          if (await lockLost()) return NOTHING;
          const claimed = await drain(sid);
          const drained = [];
          for (const m of claimed) if (await verifyMessage(m)) drained.push(m);
          if (drained.length < claimed.length) {
            logError(`dropped ${claimed.length - drained.length} unsigned or invalid message(s) in the inbox of session ${sid}`);
          }
          let msgs = drained;
          if (discardOld) {
            const cutoff = now() - MAX_MESSAGE_AGE_MS;
            msgs = drained.filter((m) => !(Date.parse(m.createdAt) < cutoff));
            if (msgs.length < drained.length) {
              logError(`discarded ${drained.length - msgs.length} message(s) older than 30 min on resume of session ${sid}`);
            }
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
      } catch (e) {
        logError(e);
      }
      await sleep2(pollMs);
    }
  } finally {
    if (await readLock(lock) === mine) await releaseLock(lock);
  }
}
async function readLock(file) {
  try {
    return await fs7.promises.readFile(file, "utf8");
  } catch {
    return null;
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
    fs7.mkdirSync(dir, { recursive: true, mode: 448 });
    fs7.appendFileSync(
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
    if (lockPid(fs7.readFileSync(lock, "utf8")) === process.pid) fs7.rmSync(lock, { force: true });
  } catch {
  }
}
async function main() {
  let result = NOTHING;
  try {
    const event = process.argv[2];
    if (event !== "start" && event !== "stop" && event !== "prompt") return;
    const input = JSON.parse(await readStdin());
    const onSignal = () => {
      releaseOwnLockSync(input?.session_id);
      process.exit(0);
    };
    process.on("SIGTERM", onSignal);
    process.on("SIGINT", onSignal);
    result = await runWaiter(event, input, { spawnedAt: Date.now() - process.uptime() * 1e3 });
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
process.noDeprecation = true;
void main();
