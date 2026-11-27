import { createRequire as __acc_createRequire } from 'node:module';
const require = __acc_createRequire(import.meta.url);

// src/hooks/delegate.ts
import fs from "node:fs";
import path2 from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
    turnFile: (sid) => (assertSessionId(sid), path.join(home, "turns", `${sid}.json`)),
    deliveredFile: (sid) => (assertSessionId(sid), path.join(home, "delivered", `${sid}.json`)),
    questionsDir: (sid) => (assertSessionId(sid), path.join(home, "questions", sid)),
    namesFile: (sid) => (assertSessionId(sid), path.join(home, "names", `${sid}.json`)),
    pinsFile: (sid) => (assertSessionId(sid), path.join(home, "pins", `${sid}.json`)),
    metaFile: (sid) => (assertSessionId(sid), path.join(home, "meta", `${sid}.json`)),
    backgroundsDir: path.join(home, "backgrounds"),
    backgroundFile: (sid) => (assertSessionId(sid), path.join(home, "backgrounds", `${sid}.json`)),
    presenceFile: path.join(home, "app-presence.json"),
    attachmentsDir: path.join(home, "attachments"),
    usageFile: path.join(home, "usage.json"),
    statuslineFile: path.join(home, "statusline.json"),
    statuslineScript: path.join(home, "bin", "statusline.mjs"),
    logDir: path.join(home, "logs")
  };
}

// src/core/version.ts
var VERSION = "0.6.12";
var PROTOCOL = 2;

// src/hooks/delegate.ts
var FLAG = /* @__PURE__ */ Symbol.for("ai-chat-center.delegated");
var flags = globalThis;
var VERSION_RE = /^\d+\.\d+\.\d+$/;
function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}
var recordFile = () => path2.join(paths().home, "plugin.json");
function readRecord() {
  try {
    const r = JSON.parse(fs.readFileSync(recordFile(), "utf8"));
    if (typeof r?.version !== "string" || !VERSION_RE.test(r.version) || typeof r.dist !== "string") return null;
    return { version: r.version, dist: r.dist };
  } catch {
    return null;
  }
}
function writeRecord(rec) {
  try {
    fs.mkdirSync(paths().home, { recursive: true, mode: 448 });
    const tmp = `${recordFile()}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rec), { mode: 384 });
    fs.renameSync(tmp, recordFile());
  } catch {
  }
}
function pluginVersionOf(dist) {
  try {
    const v = JSON.parse(fs.readFileSync(path2.join(dist, "..", ".claude-plugin", "plugin.json"), "utf8")).version;
    return typeof v === "string" && VERSION_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}
function newerScript(entry, ownDist, version = VERSION) {
  if (flags[FLAG]) return null;
  let own;
  try {
    own = fs.realpathSync(ownDist);
  } catch {
    return null;
  }
  const rec = readRecord();
  let target = null;
  if (rec && compareVersions(rec.version, version) > 0) {
    try {
      const dist = fs.realpathSync(rec.dist);
      const versionDir = path2.dirname(dist);
      const siblings = path2.dirname(path2.dirname(own)) === path2.dirname(versionDir) && dist !== own;
      if (siblings && path2.basename(dist) === "dist" && path2.basename(versionDir) === rec.version && pluginVersionOf(dist) === rec.version && fs.statSync(path2.join(dist, entry)).isFile()) {
        target = path2.join(dist, entry);
      }
    } catch {
      target = null;
    }
  }
  if (target) return target;
  const same = rec && rec.version === version && rec.dist === own;
  if (!same && path2.basename(path2.dirname(own)) === version && pluginVersionOf(own) === version) writeRecord({ version, dist: own });
  return null;
}
async function delegateToNewer(entry, moduleUrl) {
  let target = null;
  try {
    target = newerScript(entry, path2.dirname(fileURLToPath(moduleUrl)));
  } catch {
    return false;
  }
  if (!target) return false;
  flags[FLAG] = VERSION;
  try {
    await import(pathToFileURL(target).href);
    return true;
  } catch {
    flags[FLAG] = void 0;
    return false;
  }
}

// src/hooks/waiter.ts
import fs8 from "node:fs";
import path7 from "node:path";

// src/core/registry.ts
import fs7 from "node:fs/promises";
import os2 from "node:os";
import path6 from "node:path";

// src/core/fsAtomic.ts
import fs2 from "node:fs/promises";
import path3 from "node:path";
import crypto from "node:crypto";
var DIR_MODE = 448;
var FILE_MODE = 384;
async function ensureDir(dir) {
  await fs2.mkdir(dir, { recursive: true, mode: DIR_MODE });
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
  return withFsRetry(() => fs2.rm(file, { force: true }));
}
async function writeJsonAtomic(file, data) {
  await ensureDir(path3.dirname(file));
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs2.writeFile(tmp, JSON.stringify(data, null, 2), { encoding: "utf8", mode: FILE_MODE });
    await withFsRetry(() => fs2.rename(tmp, file));
  } catch (e) {
    await fs2.rm(tmp, { force: true });
    throw e;
  }
}
async function readJson(file) {
  try {
    return JSON.parse(await fs2.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

// src/core/inbox.ts
import fs5 from "node:fs/promises";
import path5 from "node:path";
import crypto4 from "node:crypto";

// src/core/secret.ts
import fs3 from "node:fs/promises";
import crypto2 from "node:crypto";
var SECRET_RE = /^[0-9a-f]{64}$/;
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function readOnce() {
  try {
    const s = (await fs3.readFile(paths().secret, "utf8")).trim();
    return SECRET_RE.test(s) ? { ok: true, secret: s } : { ok: false, reason: "malformed" };
  } catch (e) {
    return { ok: false, reason: e.code === "ENOENT" ? "missing" : "unreadable" };
  }
}
async function loadSecret(opts = {}) {
  const tries = opts.tries ?? 5;
  const delayMs = opts.delayMs ?? 250;
  let r = { ok: false, reason: "unreadable" };
  for (let i = 0; i < tries; i++) {
    r = await readOnce();
    if (r.ok || r.reason === "missing") return r;
    if (i < tries - 1) await sleep(delayMs);
  }
  return r;
}
var mac = (secret, sid, m) => crypto2.createHmac("sha256", secret).update(`v2|${sid}|${m.id}|${m.createdAt}|${m.text}`).digest("hex");
var separatorFree = (m) => typeof m.id === "string" && typeof m.createdAt === "string" && !m.id.includes("|") && !m.createdAt.includes("|");
function verifyMessage(m, sid, secret) {
  if (!m || typeof m.text !== "string" || typeof m.sig !== "string" || !separatorFree(m)) return false;
  const want = Buffer.from(mac(secret, sid, m));
  const got = Buffer.from(m.sig);
  return want.length === got.length && crypto2.timingSafeEqual(want, got);
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
  const content = JSON.stringify({ pid: process.pid, ts: (/* @__PURE__ */ new Date()).toISOString() });
  try {
    await fs4.writeFile(tmp, content, { flag: "wx" });
    await fs4.link(tmp, file);
    return content;
  } catch (e) {
    if (["EEXIST", "EPERM", "EBUSY"].includes(code(e) ?? "")) return null;
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
async function reclaim(file, seen) {
  const guard = `${file}.reclaim`;
  if (await publish(guard) === null) {
    try {
      const st = await fs4.stat(guard);
      if (Date.now() - st.mtimeMs > GUARD_STALE_MS) await fs4.rm(guard, { force: true });
    } catch {
    }
    return null;
  }
  try {
    if (await staleContent(file) !== seen) return null;
    try {
      await fs4.unlink(file);
    } catch (e) {
      if (code(e) !== "ENOENT") {
        if (contention(e)) return null;
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

// src/core/inbox.ts
var isRace = (e) => ["ENOENT", "EPERM", "EBUSY"].includes(e.code ?? "");
async function list(sid) {
  const dir = paths().inboxDir(sid);
  try {
    return (await fs5.readdir(dir)).filter((n) => n.endsWith(".msg")).sort().map((n) => path5.join(dir, n));
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}
var READ_RETRIES = 3;
var sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
var CLAIMED_RE = /\.msg\.claimed-(?:(\d{13,})-)?/;
async function readClaimed(file) {
  for (let attempt = 0; ; attempt++) {
    try {
      return JSON.parse(await fs5.readFile(file, "utf8"));
    } catch (e) {
      if (e instanceof SyntaxError) return "malformed";
      if (attempt >= READ_RETRIES) return "unreadable";
      await sleep2(20 + Math.floor(Math.random() * 31));
    }
  }
}
var CLAIM_MARK = ".claim";
var MARKER_STALE_MS = 6e4;
async function removeMarker(marker) {
  try {
    await withFsRetry(() => fs5.rm(marker, { force: true }));
  } catch {
  }
}
var UNSIGNED = ".unsigned";
async function drain(sid, judge = () => "deliver", record) {
  const out = [];
  const toDelete = [];
  for (const f of await list(sid)) {
    const claimed = `${f}.claimed-${Date.now()}-${crypto4.randomUUID()}`;
    const marker = `${f}${CLAIM_MARK}`;
    try {
      await fs5.writeFile(marker, String(process.pid), { flag: "wx", mode: FILE_MODE });
    } catch (e) {
      if (e.code === "EEXIST") {
        if (!await markerOwnerAlive(marker)) await removeMarker(marker);
        continue;
      }
      if (isRace(e) || e.code === "EACCES") continue;
      if (out.length > 0 || toDelete.length > 0) break;
      throw e;
    }
    try {
      await withFsRetry(() => fs5.rename(f, claimed));
    } catch (e) {
      await removeMarker(marker);
      if (isRace(e)) continue;
      if (out.length > 0 || toDelete.length > 0) break;
      throw e;
    }
    await removeMarker(marker);
    const m = await readClaimed(claimed);
    if (m === "unreadable") {
      try {
        await withFsRetry(() => fs5.rename(claimed, f));
      } catch {
      }
      continue;
    }
    const verdict = m === "malformed" ? "drop" : await judge(m);
    if (verdict === "unsigned") {
      try {
        await withFsRetry(() => fs5.rename(claimed, `${f}${UNSIGNED}`));
      } catch {
      }
      continue;
    }
    if (verdict === "deliver") out.push(m);
    toDelete.push(claimed);
  }
  if (record && out.length > 0) await record(out).catch(() => {
  });
  for (const claimed of toDelete) {
    try {
      await withFsRetry(() => fs5.rm(claimed, { force: true }));
    } catch {
    }
  }
  return out;
}
async function markerOwnerAlive(marker) {
  try {
    const t = (await fs5.readFile(marker, "utf8")).trim();
    return !/^\d+$/.test(t) || isAlive(Number(t));
  } catch {
    return true;
  }
}
async function sweepClaimed(sid, maxAgeMs, delivered = /* @__PURE__ */ new Set(), current = async () => null) {
  const dir = paths().inboxDir(sid);
  let names;
  try {
    names = await fs5.readdir(dir);
  } catch {
    return 0;
  }
  let swept = 0;
  const now = Date.now();
  let judge;
  for (const n of names) {
    if (n.endsWith(`.msg${CLAIM_MARK}`)) {
      const marker = path5.join(dir, n);
      try {
        const stale = !await markerOwnerAlive(marker) || now - (await fs5.stat(marker)).mtimeMs > Math.min(maxAgeMs, MARKER_STALE_MS);
        if (!stale) continue;
        await withFsRetry(() => fs5.rm(marker, { force: true }));
        swept++;
      } catch {
      }
      continue;
    }
    const m = CLAIMED_RE.exec(n);
    if (!m) continue;
    const file = path5.join(dir, n);
    try {
      const at = m[1] ? Number(m[1]) : (await fs5.stat(file)).mtimeMs;
      if (now - at <= maxAgeMs) continue;
      if (judge === void 0) judge = await current().catch(() => null);
      if (judge === null) continue;
      let msg;
      try {
        msg = JSON.parse(await fs5.readFile(file, "utf8"));
      } catch (e) {
        if (!(e instanceof SyntaxError)) continue;
        msg = null;
      }
      const putBack = m[1] !== void 0 && msg !== null && typeof msg === "object" && typeof msg.id === "string" && !delivered.has(msg.id) && judge(msg);
      if (putBack) await withFsRetry(() => fs5.rename(file, path5.join(dir, n.slice(0, m.index + ".msg".length))));
      else await withFsRetry(() => fs5.rm(file, { force: true }));
      swept++;
    } catch {
    }
  }
  return swept;
}
async function clearInbox(sid) {
  const dir = paths().inboxDir(sid);
  let names;
  try {
    names = await fs5.readdir(dir);
  } catch (e) {
    if (e.code === "ENOENT") return;
    throw e;
  }
  for (const n of names) {
    if (!n.endsWith(".msg") && !n.endsWith(".tmp") && !n.includes(".msg.claimed-") && !n.endsWith(`.msg${CLAIM_MARK}`) && !n.endsWith(`.msg${UNSIGNED}`)) continue;
    try {
      await withFsRetry(() => fs5.rm(path5.join(dir, n), { force: true }));
    } catch (e) {
      if (!isRace(e)) throw e;
    }
  }
}

// src/core/busy.ts
import fs6 from "node:fs/promises";
async function clearBusy(sid) {
  await removeFile(paths().busyFile(sid));
}
async function clearBusyIfOlder(sid, before) {
  let mtimeMs;
  try {
    mtimeMs = (await fs6.stat(paths().busyFile(sid))).mtimeMs;
  } catch {
    return true;
  }
  if (Math.floor(mtimeMs) > before) return false;
  await removeFile(paths().busyFile(sid));
  return true;
}
async function isBusy(sid) {
  try {
    await fs6.access(paths().busyFile(sid));
    return true;
  } catch {
    return false;
  }
}
async function busyAge(sid, now = Date.now()) {
  try {
    return now - (await fs6.stat(paths().busyFile(sid))).mtimeMs;
  } catch {
    return null;
  }
}

// src/core/waiting.ts
async function clearWaiting(sid) {
  await removeFile(paths().waitingFile(sid));
}

// src/core/delivered.ts
var DELIVERED_KEEP = 500;
async function readDelivered(sid) {
  const ids = await readJson(paths().deliveredFile(sid));
  return new Set(Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : []);
}
async function recordDelivered(sid, ids) {
  const prev = [...await readDelivered(sid)];
  const next = [...prev.filter((x) => !ids.includes(x)), ...ids].slice(-DELIVERED_KEEP);
  await writeJsonAtomic(paths().deliveredFile(sid), next);
}

// src/shared/background.ts
var BACKGROUND_IMAGE_MAX = 5 * 1024 * 1024;

// src/core/attachments.ts
var ATTACHMENT_MAX_AGE_MS = 30 * 864e5;

// src/core/registry.ts
var SESSION_LOCK_WAIT_MS = 2e3;
var locked = (sid, fn) => withLock(paths().sessionLock(sid), SESSION_LOCK_WAIT_MS, fn);
function regFile(sid) {
  assertSessionId(sid);
  return path6.join(paths().sessionsDir, `${sid}.json`);
}
var isActive = (r) => !r.disconnectedAt;
function claudeConfigDir() {
  const raw = process.env.CLAUDE_CONFIG_DIR;
  return path6.resolve(raw && raw.trim() ? raw : path6.join(os2.homedir(), ".claude"));
}
function sameConfigDir(r, mine = claudeConfigDir()) {
  if (!r.configDir) return true;
  const a = path6.resolve(r.configDir);
  return process.platform === "win32" ? a.toLowerCase() === mine.toLowerCase() : a === mine;
}
var codeStamp = () => ({ version: VERSION, protocol: PROTOCOL });
var stampedByThisCode = (r) => r.version === VERSION && r.protocol === PROTOCOL;
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
    names = await fs7.readdir(paths().sessionsDir);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const out = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    const r = await readJson(path6.join(paths().sessionsDir, n));
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
import os3 from "node:os";
function runClaudeAgentsJson(platform = process.platform, all = false) {
  const win = platform === "win32";
  const argv = all ? ["agents", "--json", "--all"] : ["agents", "--json"];
  return new Promise((resolve, reject) => {
    execFile(
      win ? `claude ${argv.join(" ")}` : "claude",
      win ? [] : argv,
      {
        cwd: os3.homedir(),
        // Windows: never a claude.cmd from the current folder, the PATH only (see bgSessions.runClaude).
        ...win ? { env: { ...process.env, NoDefaultCurrentDirectoryInExePath: "1" } } : {},
        shell: win,
        windowsHide: true,
        timeout: 5e3,
        maxBuffer: 10 * 1024 * 1024
      },
      (err, stdout) => err ? reject(err) : resolve(String(stdout))
    );
  });
}

// src/hooks/claudePid.ts
async function lookupClaudePid(sessionId, opts = {}) {
  try {
    const list2 = JSON.parse(await (opts.run ?? runClaudeAgentsJson)());
    if (!Array.isArray(list2)) return { ok: false };
    let known = 0;
    for (const a of list2) {
      if (!a || typeof a.sessionId !== "string" || !a.sessionId) continue;
      if (a.kind === "interactive" || a.kind === "background" || typeof a.pid === "number") known++;
      if (a.sessionId === sessionId && typeof a.pid === "number") return { ok: true, pid: a.pid };
    }
    if (list2.length > 0 && known === 0) return { ok: false };
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
  const arg = m[1].toLowerCase().split(/\s+/).join(" ");
  if (arg === "off") return "off";
  if (arg === "answers on") return "answers-on";
  if (arg === "answers off") return "answers-off";
  if (arg === "window on") return "window-on";
  if (arg === "window off") return "window-off";
  if (arg === "usage on") return "usage-on";
  if (arg === "usage off") return "usage-off";
  return "unknown";
}

// src/hub/bgSessions.ts
var BG_ID_RE = /^[0-9a-f]{8}$/;
var isBgId = (id) => typeof id === "string" && BG_ID_RE.test(id);

// src/hub/status.ts
function toLive(x) {
  if (!x || typeof x !== "object") return null;
  const o = x;
  if (typeof o.sessionId !== "string" || !o.sessionId) return null;
  if (typeof o.pid !== "number" || typeof o.cwd !== "string") return null;
  if (o.kind !== "interactive" && o.kind !== "background") return null;
  const live = {
    pid: o.pid,
    cwd: o.cwd,
    kind: o.kind,
    sessionId: o.sessionId,
    name: typeof o.name === "string" ? o.name : "",
    // Presence never depends on status: unknown values degrade to idle.
    status: o.status === "busy" || o.status === "waiting" ? o.status : "idle"
  };
  if (o.kind === "background" && isBgId(o.id)) live.bgId = o.id;
  return live;
}
function knownItem(x) {
  if (!x || typeof x !== "object") return false;
  const o = x;
  return typeof o.sessionId === "string" && !!o.sessionId && (o.kind === "interactive" || o.kind === "background");
}
function commandFailure(e) {
  const { code: code2, signal } = e ?? {};
  if (typeof code2 === "string" && /^E[A-Z0-9_]{1,30}$/.test(code2)) return `command failed (${code2})`;
  if (typeof code2 === "number" && Number.isInteger(code2)) return `command failed (exit ${code2})`;
  if (typeof signal === "string" && /^SIG[A-Z0-9]{1,10}$/.test(signal)) return `command failed (${signal})`;
  return "command failed";
}
async function queryLiveSessions(run = runClaudeAgentsJson, onFail) {
  let out;
  try {
    out = await run();
  } catch (e) {
    onFail?.(commandFailure(e));
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    onFail?.("not JSON");
    return null;
  }
  if (!Array.isArray(parsed)) {
    onFail?.("not a list");
    return null;
  }
  const live = parsed.map(toLive).filter((s) => s !== null);
  if (parsed.length > 0 && !parsed.some(knownItem)) {
    onFail?.("unknown item shape");
    return null;
  }
  return live;
}
var FAILED_LOOKUP_LOG_MS = 5 * 6e4;

// src/core/meta.ts
var MODE_RE = /^[a-zA-Z]{1,24}$/;
async function readMeta(sid) {
  const d = await readJson(paths().metaFile(sid));
  return d && typeof d === "object" && !Array.isArray(d) ? d : {};
}
async function setField(sid, key, value, re) {
  paths().metaFile(sid);
  if (typeof value === "string" && re.test(value)) await writeField(sid, key, value);
}
async function writeField(sid, key, value) {
  const file = paths().metaFile(sid);
  const meta = await readMeta(sid);
  if (meta[key] === value) return;
  await writeJsonAtomic(file, { ...meta, [key]: value });
}
async function setMode(sid, mode) {
  await setField(sid, "mode", mode, MODE_RE);
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
var MAX_CLOCK_SKEW_MS = 2 * 6e4;
var PINNED_LOCK_WAIT_MS = 3e3;
var SWITCH_SOURCES = /* @__PURE__ */ new Set(["startup", "resume", "clear", "fork"]);
var NOTHING = { exitCode: 0, stderr: "" };
var sleep3 = (ms) => new Promise((r) => setTimeout(r, ms));
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
    return (await fs8.promises.readdir(paths().inboxDir(sid))).some((n) => n.endsWith(".msg"));
  } catch {
    return false;
  }
}
async function inboxHasMessages(sid) {
  try {
    return (await fs8.promises.readdir(paths().inboxDir(sid))).some((n) => n.endsWith(".msg"));
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}
async function sessionSwitch(sid, input, lookup, lookupOther) {
  const source = input.source ?? "";
  if (!SWITCH_SOURCES.has(source)) return;
  const active = (await listRegistrations()).filter((r2) => isActive(r2) && (r2.sessionId === sid || sameConfigDir(r2)));
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
    await updateRegistration(sid, { pid, ...tp, ...codeStamp() }, { ifConnectedAt: own.connectedAt });
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
  const resumedAt = now();
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
  if (!stampedByThisCode(first)) {
    try {
      await updateRegistration(sid, codeStamp(), { ifConnectedAt: first.connectedAt });
    } catch (e) {
      logError(e);
    }
  }
  if (event === "stop" && typeof input.permission_mode === "string") {
    try {
      await setMode(sid, input.permission_mode);
    } catch (e) {
      logError(e);
    }
  }
  if (event === "stop") {
    try {
      if (!await clearBusyIfOlder(sid, opts.spawnedAt ?? startedAt)) logError(`stop of session ${sid}: the busy marker is newer than this waiter (the next turn started): kept`);
      await clear(sid);
    } catch (e) {
      logError(e);
    }
  }
  const adopt = async (found) => {
    await updateRegistration(sid, { pid: found, ...codeStamp() }, { ifConnectedAt: first.connectedAt });
  };
  let pid = first.pid ?? null;
  if (pid === null && lookups === 0) {
    const r = await lookup();
    if (r.ok && r.pid !== null) {
      pid = r.pid;
      await adopt(pid);
    }
  }
  const parent = opts.parentPid ?? null;
  const parentWatched = parent !== null && parent > 1 && isAlive2(parent);
  let pinned = parentWatched && pid === parent;
  if (parentWatched && !pinned && pid !== null && !isAlive2(pid)) {
    const r = await lookup();
    if (r.ok && r.pid === parent) {
      pinned = true;
      pid = parent;
      await adopt(parent);
    }
  }
  const lock = paths().waiterLock(sid);
  let mine = await acquireLockContent(lock);
  if (mine === null && pinned) {
    const until = Date.now() + (opts.pinnedLockWaitMs ?? PINNED_LOCK_WAIT_MS);
    while (mine === null && Date.now() < until) {
      await sleep3(Math.min(pollMs, 100));
      mine = await acquireLockContent(lock);
    }
  }
  if (mine === null) return NOTHING;
  let lastBeat = Date.now();
  let deadChecked = false;
  let parentConfirmed = !(pinned && (opts.platform ?? process.platform) === "win32");
  let lastStatusAt = -Infinity;
  let secretWarned = false;
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
      await sweepClaimed(sid, CLAIMED_SWEEP_MS, await readDelivered(sid), async () => {
        const sec = await loadSecret();
        return sec.ok ? (m) => verifyMessage(m, sid, sec.secret) : null;
      });
    } catch (e) {
      logError(e);
    }
    for (; ; ) {
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
        if (parentWatched && (!isAlive2(parent) || opts.currentParentPid && opts.currentParentPid() !== parent)) {
          logError(`waiter for session ${sid}: its claude process ${parent} is gone: exiting without draining`);
          return NOTHING;
        }
        if (pid !== null && reg.pid !== null && reg.pid !== pid) {
          logError(`waiter for session ${sid}: the session now runs in claude process ${reg.pid}, not ${pid}: exiting without draining`);
          return NOTHING;
        }
        const regPid = reg.pid ?? pid;
        if (pinned) {
        } else if (regPid === null) {
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
          const queued = await inboxHasMessages(sid);
          if (queued && !parentConfirmed) {
            const r = await lookup();
            if (r.ok && r.pid !== parent) {
              logError(`waiter for session ${sid}: claude agents lists it ${r.pid === null ? "nowhere" : `in process ${r.pid}`}, not in this waiter's parent ${parent}: exiting without draining`);
              return NOTHING;
            }
            if (r.ok) parentConfirmed = true;
          }
          const sec = queued ? await loadSecret() : null;
          let drained = [];
          if (sec && !sec.ok) {
            if (!secretWarned) logError(`the install secret is ${sec.reason}: nothing is taken from the inbox of session ${sid} until it can be read`);
            secretWarned = true;
          } else if (sec?.ok) {
            secretWarned = false;
            const delivered = await readDelivered(sid);
            const t = Date.now();
            const since = Date.parse(reg.connectedAt);
            let unsigned = 0;
            const dropped = [];
            drained = await drain(
              sid,
              (m) => {
                if (!verifyMessage(m, sid, sec.secret)) return unsigned++, "unsigned";
                const at = Date.parse(m.createdAt);
                if (delivered.has(m.id)) return dropped.push(`${m.id} (already delivered)`), "drop";
                if (!(at <= t + MAX_CLOCK_SKEW_MS)) return dropped.push(`${m.id} (dated in the future)`), "drop";
                if (Number.isFinite(since) && at < since) return dropped.push(`${m.id} (older than this connection)`), "drop";
                return "deliver";
              },
              async (ms) => {
                try {
                  await recordDelivered(sid, ms.map((m) => m.id));
                } catch (e) {
                  logError(e);
                }
              }
            );
            if (unsigned > 0) {
              logError(`kept ${unsigned} unsigned or invalid message(s) aside (not delivered) in the inbox of session ${sid}`);
            }
            if (dropped.length > 0) logError(`dropped signed message(s) in the inbox of session ${sid}: ${dropped.join(", ")}`);
          }
          let msgs = drained;
          if (discardOld) {
            const cutoff = now() - MAX_MESSAGE_AGE_MS;
            msgs = drained.filter((m) => {
              const at = Date.parse(m.createdAt);
              return !(at < cutoff && at < resumedAt);
            });
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
      if (Date.now() - startedAt >= deadlineMs) return NOTHING;
      await sleep3(pollMs);
    }
  } finally {
    if (await readLock(lock) === mine) await releaseLock(lock);
  }
}
async function readLock(file) {
  try {
    return await fs8.promises.readFile(file, "utf8");
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
    fs8.mkdirSync(dir, { recursive: true, mode: 448 });
    fs8.appendFileSync(
      path7.join(dir, "waiter.log"),
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
    if (lockPid(fs8.readFileSync(lock, "utf8")) === process.pid) fs8.rmSync(lock, { force: true });
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
    result = await runWaiter(event, input, {
      spawnedAt: Date.now() - process.uptime() * 1e3,
      parentPid: process.ppid,
      currentParentPid: () => process.ppid
    });
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
if (!await delegateToNewer("waiter.mjs", import.meta.url)) void main();
