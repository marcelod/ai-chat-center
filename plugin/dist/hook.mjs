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
var VERSION = "0.6.6";
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

// src/hooks/hook.ts
import fs13 from "node:fs";
import { fileURLToPath as fileURLToPath4 } from "node:url";
import path14 from "node:path";
import crypto5 from "node:crypto";

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

// src/core/registry.ts
import os2 from "node:os";
import path6 from "node:path";

// src/core/inbox.ts
import fs4 from "node:fs/promises";
import path5 from "node:path";

// src/core/lock.ts
import fs3 from "node:fs/promises";
import path4 from "node:path";
import crypto2 from "node:crypto";
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
  const t2 = content.trim();
  let pid = null;
  if (/^\d+$/.test(t2)) pid = parseInt(t2, 10);
  else {
    try {
      pid = JSON.parse(t2)?.pid;
    } catch {
    }
  }
  return typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : null;
}
async function publish(file) {
  const tmp = `${file}.${crypto2.randomUUID()}.tmp`;
  const content = JSON.stringify({ pid: process.pid, ts: (/* @__PURE__ */ new Date()).toISOString() });
  try {
    await fs3.writeFile(tmp, content, { flag: "wx" });
    await fs3.link(tmp, file);
    return content;
  } catch (e) {
    if (["EEXIST", "EPERM", "EBUSY"].includes(code(e) ?? "")) return null;
    throw e;
  } finally {
    await fs3.rm(tmp, { force: true });
  }
}
async function staleContent(file) {
  let content;
  let mtimeMs;
  try {
    content = await fs3.readFile(file, "utf8");
  } catch (e) {
    if (code(e) === "ENOENT") return null;
    content = "";
  }
  try {
    mtimeMs = (await fs3.stat(file)).mtimeMs;
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
      const st = await fs3.stat(guard);
      if (Date.now() - st.mtimeMs > GUARD_STALE_MS) await fs3.rm(guard, { force: true });
    } catch {
    }
    return null;
  }
  try {
    if (await staleContent(file) !== seen) return null;
    try {
      await fs3.unlink(file);
    } catch (e) {
      if (code(e) !== "ENOENT") {
        if (contention(e)) return null;
        throw e;
      }
    }
    return await publish(file);
  } finally {
    try {
      if (lockPid(await fs3.readFile(guard, "utf8")) === process.pid) await fs3.rm(guard, { force: true });
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
async function releaseLock(file) {
  try {
    if (lockPid(await fs3.readFile(file, "utf8")) !== process.pid) return;
  } catch {
    return;
  }
  await fs3.rm(file, { force: true });
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
var CLAIM_MARK = ".claim";
var UNSIGNED = ".unsigned";
async function clearInbox(sid) {
  const dir = paths().inboxDir(sid);
  let names;
  try {
    names = await fs4.readdir(dir);
  } catch (e) {
    if (e.code === "ENOENT") return;
    throw e;
  }
  for (const n of names) {
    if (!n.endsWith(".msg") && !n.endsWith(".tmp") && !n.includes(".msg.claimed-") && !n.endsWith(`.msg${CLAIM_MARK}`) && !n.endsWith(`.msg${UNSIGNED}`)) continue;
    try {
      await withFsRetry(() => fs4.rm(path5.join(dir, n), { force: true }));
    } catch (e) {
      if (!isRace(e)) throw e;
    }
  }
}

// src/core/busy.ts
async function setBusy(sid) {
  await writeJsonAtomic(paths().busyFile(sid), { at: (/* @__PURE__ */ new Date()).toISOString() });
}
async function clearBusy(sid) {
  await removeFile(paths().busyFile(sid));
}

// src/core/waiting.ts
async function setWaiting(sid, kind) {
  await writeJsonAtomic(paths().waitingFile(sid), { kind, at: (/* @__PURE__ */ new Date()).toISOString() });
}
async function clearWaiting(sid) {
  await removeFile(paths().waitingFile(sid));
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
var codeStamp = () => ({ version: VERSION, protocol: PROTOCOL });
var stampedByThisCode = (r) => r.version === VERSION && r.protocol === PROTOCOL;
async function register(r) {
  return locked(r.sessionId, async () => {
    const prev = await getRegistration(r.sessionId);
    if (!prev || !isActive(prev)) await clearInbox(r.sessionId);
    const full = { ...r, connectedAt: r.connectedAt ?? (/* @__PURE__ */ new Date()).toISOString() };
    await writeJsonAtomic(regFile(r.sessionId), full);
    return full;
  });
}
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

// src/core/meta.ts
var EFFORT_RE = /^[a-z]{1,16}$/;
var MODE_RE = /^[a-zA-Z]{1,24}$/;
async function readMeta(sid) {
  const d = await readJson(paths().metaFile(sid));
  return d && typeof d === "object" && !Array.isArray(d) ? d : {};
}
async function setField(sid, key, value2, re) {
  const file = paths().metaFile(sid);
  if (typeof value2 !== "string" || !re.test(value2)) return;
  const meta = await readMeta(sid);
  if (meta[key] === value2) return;
  await writeJsonAtomic(file, { ...meta, [key]: value2 });
}
async function setEffort(sid, level) {
  await setField(sid, "effort", level, EFFORT_RE);
}
async function setMode(sid, mode) {
  await setField(sid, "mode", mode, MODE_RE);
}

// src/hooks/statusline.ts
import fs5 from "node:fs";
import path7 from "node:path";

// src/core/statuslineState.ts
async function readStatuslineState() {
  const d = await readJson(paths().statuslineFile);
  if (!d || typeof d !== "object" || !("original" in d)) return null;
  const o = d.original;
  return { original: o && typeof o === "object" && !Array.isArray(o) ? o : null };
}

// src/hooks/statusline.ts
var settingsPath = (o) => o.settingsFile ?? path7.join(claudeConfigDir(), "settings.json");
var quote = (a) => `"${a.replace(/\\/g, "/").replace(/(["`$])/g, "\\$1")}"`;
function wrapperCommand(o) {
  return `${quote(o.nodePath ?? process.execPath)} ${quote(paths().statuslineScript)}`;
}
function isOurs(sl) {
  return !!sl && typeof sl === "object" && typeof sl.command === "string" && sl.command.includes(paths().statuslineScript.replace(/\\/g, "/"));
}
async function readSettings(file) {
  let text;
  try {
    text = await fs5.promises.readFile(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
  const d = JSON.parse(text);
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error(`${file} is not a JSON object`);
  return d;
}
async function writeSettings(file, data) {
  let mode = null;
  try {
    mode = (await fs5.promises.stat(file)).mode & 511;
  } catch {
  }
  await writeJsonAtomic(file, data);
  if (mode !== null) await fs5.promises.chmod(file, mode).catch(() => {
  });
}
async function refreshWrapper(o) {
  const dest = paths().statuslineScript;
  const src = await fs5.promises.readFile(o.source);
  const cur = await fs5.promises.readFile(dest).catch(() => null);
  if (cur && cur.equals(src)) return;
  await fs5.promises.mkdir(path7.dirname(dest), { recursive: true, mode: 448 });
  const tmp = `${dest}.${process.pid}.tmp`;
  await fs5.promises.writeFile(tmp, src, { mode: 384 });
  await fs5.promises.rename(tmp, dest);
}
async function installStatusline(o) {
  const file = settingsPath(o);
  const settings = await readSettings(file);
  if (settings === null) return "failed";
  await refreshWrapper(o);
  const current = settings.statusLine;
  if (isOurs(current)) {
    const command = wrapperCommand(o);
    if (current.command !== command) await writeSettings(file, { ...settings, statusLine: { ...current, command } });
    return "refreshed";
  }
  const original = current && typeof current === "object" ? current : null;
  await writeJsonAtomic(paths().statuslineFile, { original });
  const statusLine = { type: "command", command: wrapperCommand(o) };
  if (original && original.padding !== void 0) statusLine.padding = original.padding;
  await writeSettings(file, { ...settings, statusLine });
  return "installed";
}
async function removeStatusline(o) {
  const file = settingsPath(o);
  const settings = await readSettings(file);
  const state = await readStatuslineState();
  const current = settings?.statusLine;
  if (!isOurs(current)) {
    await fs5.promises.rm(paths().statuslineFile, { force: true });
    return state ? "changed-since" : "not-installed";
  }
  const { statusLine: _ours, ...rest } = settings;
  await writeSettings(file, state?.original ? { ...rest, statusLine: state.original } : rest);
  await fs5.promises.rm(paths().statuslineFile, { force: true });
  return "restored";
}

// src/core/protocol.ts
var unescapeBody = (t2) => t2.replace(/\[(\\*)\\\/AI Chat Center message\]/g, "[$1/AI Chat Center message]");
function unwrapMessages(text, keys) {
  const trusted = keys === void 0 ? null : new Set((Array.isArray(keys) ? keys : [keys]).filter(Boolean));
  const re = /\[AI Chat Center message id=([^\]\s]+)(?: key=([^\]\s]+))?\]\n([\s\S]*?)\n\[\/AI Chat Center message\]/g;
  const out = [];
  for (const m of text.matchAll(re)) {
    if (trusted && trusted.size > 0 && !(m[2] && trusted.has(m[2]))) continue;
    out.push({ id: m[1], text: unescapeBody(m[3]) });
  }
  return out;
}

// src/core/turn.ts
async function setTurnOrigin(sid, origin) {
  await writeJsonAtomic(paths().turnFile(sid), { origin, at: (/* @__PURE__ */ new Date()).toISOString() });
}
async function clearTurnOrigin(sid) {
  await removeFile(paths().turnFile(sid));
}
function promptOrigin(prompt, key) {
  if (typeof prompt !== "string" || !key) return "terminal";
  return unwrapMessages(prompt, key).length > 0 ? "app" : "terminal";
}

// src/hooks/ensureHub.ts
import crypto4 from "node:crypto";
import fs6 from "node:fs";
import http from "node:http";
import os3 from "node:os";
import path8 from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/core/healthProof.ts
import crypto3 from "node:crypto";
var newChallenge = () => crypto3.randomBytes(16).toString("hex");
function healthProof(token, challenge, port, pid, version) {
  return crypto3.createHmac("sha256", token).update(`${challenge}|${port}|${pid}|${version}`).digest("hex");
}
function proofMatches(token, challenge, port, answer) {
  const want = Buffer.from(healthProof(token, challenge, port, answer.pid, answer.version));
  const got = Buffer.from(String(answer.proof));
  return want.length === got.length && crypto3.timingSafeEqual(want, got);
}

// src/hooks/ensureHub.ts
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function get(port, p, headers = {}) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: p, headers, timeout: 500 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => {
        if (body.length < 4096) body += c;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      res.on("error", () => resolve(null));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", (e) => resolve(e.code === "ECONNREFUSED" ? "refused" : null));
  });
}
var parse = (body) => {
  try {
    const j = JSON.parse(body);
    return j && typeof j === "object" ? j : null;
  } catch {
    return null;
  }
};
async function checkHealth(port, challenge) {
  const r = await get(port, `/api/health?challenge=${challenge}`);
  if (r === "refused" || r === null) return r;
  const j = parse(r.body);
  if (r.status !== 200 || !j || j.ok !== true || typeof j.version !== "string") return null;
  if (typeof j.pid === "number" && typeof j.proof === "string") return { ok: true, version: j.version, pid: j.pid, proof: j.proof };
  return "unproven";
}
async function identifyHub(port) {
  const r = await get(port, "/api/health");
  if (r === "refused" || r === null || r.status !== 200) return null;
  const j = parse(r.body);
  if (!j || j.ok !== true || typeof j.version !== "string") return null;
  return typeof j.pid === "number" ? { ok: true, version: j.version, pid: j.pid } : { ok: true, version: j.version };
}
async function hubAcceptsToken(port, token) {
  const r = await get(port, "/api/config", { authorization: `Bearer ${token}` });
  return r !== "refused" && r !== null && r.status === 200;
}
function hubSpawnOptions() {
  return { detached: true, stdio: "ignore", windowsHide: true, cwd: os3.homedir() };
}
function defaultSpawnHub() {
  const hubPath = path8.join(path8.dirname(fileURLToPath2(import.meta.url)), "hub.mjs");
  spawn(process.execPath, [hubPath], hubSpawnOptions()).unref();
}
function readHub() {
  try {
    const { port, pid } = JSON.parse(fs6.readFileSync(paths().hubJson, "utf8"));
    const token = fs6.readFileSync(paths().token, "utf8").trim();
    if (typeof port !== "number" || !token) return null;
    return { port, token, pid: typeof pid === "number" ? pid : null };
  } catch {
    return null;
  }
}
var urlOf = (h) => `http://127.0.0.1:${h.port}/#token=${h.token}`;
function compareVersions2(a, b) {
  const parse2 = (v) => /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
  const x = parse2(a);
  const y = parse2(b);
  if (!x || !y) return NaN;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d !== 0) return Math.sign(d);
  }
  if (x[4] === y[4]) return 0;
  if (x[4] === void 0) return 1;
  if (y[4] === void 0) return -1;
  return x[4] < y[4] ? -1 : 1;
}
async function ensureHub(opts = {}) {
  const health = opts.health ?? checkHealth;
  const identify = opts.identify ?? identifyHub;
  const tokenAccepted = opts.tokenAccepted ?? hubAcceptsToken;
  const isAlive2 = opts.isAlive ?? isAlive;
  const kill = opts.kill ?? ((pid) => {
    try {
      process.kill(pid);
    } catch {
    }
  });
  const pollMs = opts.pollMs ?? 100;
  const timeoutMs = opts.timeoutMs ?? 5e3;
  const stalledWaitMs = opts.stalledWaitMs ?? 5e3;
  let foreignPid;
  const check = async (h) => {
    const challenge = newChallenge();
    const r = await health(h.port, challenge);
    foreignPid = void 0;
    if (r === null) return "silent";
    if (r === "refused" || r === "unproven") return r;
    if (proofMatches(h.token, challenge, h.port, r)) return r;
    foreignPid = r.pid;
    return "foreign";
  };
  const proven = async (h) => {
    const r = await check(h);
    return typeof r === "string" ? null : r;
  };
  const stop = async (pid) => {
    kill(pid);
    const until = Date.now() + 3e3;
    while (isAlive2(pid) && Date.now() < until) await sleep(50);
  };
  const hub = readHub();
  if (hub) {
    let r = await check(hub);
    const until = Date.now() + stalledWaitMs;
    while (r === "silent" && hub.pid !== null && isAlive2(hub.pid) && Date.now() < until) {
      await sleep(Math.max(pollMs, 50));
      r = await check(hub);
    }
    const unverified = (version) => opts.notice?.(
      `AI Chat Center: an older AI Chat Center hub (version ${version.slice(0, 32)}) seems to still run on port ${hub.port}, but it could not be verified, so it was not stopped. Restart the computer (or stop that process) so that app messages are not sent through it: they would not be delivered.`
    );
    if (typeof r !== "string") {
      if (!(compareVersions2(r.version, VERSION) < 0)) return urlOf(hub);
      if (hub.pid !== null && r.pid === hub.pid) await stop(hub.pid);
      else unverified(r.version);
    } else if ((r === "unproven" || r === "foreign") && hub.pid !== null && isAlive2(hub.pid)) {
      const challengedPid = r === "foreign" ? foreignPid : void 0;
      const id = await identify(hub.port);
      if (id && compareVersions2(id.version, VERSION) < 0) {
        const reported = id.pid ?? challengedPid;
        const ours = reported !== void 0 && reported === hub.pid && !await tokenAccepted(hub.port, crypto4.randomBytes(32).toString("hex")) && await tokenAccepted(hub.port, hub.token);
        if (ours) await stop(hub.pid);
        else unverified(id.version);
      }
    }
  }
  (opts.spawnHub ?? defaultSpawnHub)();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const cur = readHub();
    if (!cur) continue;
    const h = await proven(cur);
    if (h && compareVersions2(h.version, VERSION) >= 0) return urlOf(cur);
  }
  throw new Error("AI Chat Center hub did not start in time");
}

// src/core/config.ts
var LANGS = ["en", "pt-BR"];
async function loadConfig() {
  const c = await readJson(paths().config);
  const language = LANGS.includes(c?.language) ? c.language : "en";
  return { language, answersFromApp: c?.answersFromApp === true, openWindow: c?.openWindow !== false };
}
async function saveConfig(patch) {
  const next = { ...await loadConfig(), ...patch };
  await writeJsonAtomic(paths().config, next);
  return next;
}

// src/core/locales/en.json
var en_default = {
  hook: {
    ready: "AI Chat Center is ready: {url}",
    hubFailed: "AI Chat Center: the hub failed to start. See {log}",
    unknownArg: "AI Chat Center: unknown argument. Use /cc, /ai-chat-center:cc off, /ai-chat-center:cc answers on, /ai-chat-center:cc answers off, /ai-chat-center:cc window on, /ai-chat-center:cc window off, /ai-chat-center:cc usage on or /ai-chat-center:cc usage off.",
    answersOn: "AI Chat Center: you can now answer multiple-choice questions from the app, including confirmations. To turn off: /ai-chat-center:cc answers off",
    answersOff: "AI Chat Center: multiple-choice questions are answered only in the terminal again.",
    windowOn: "AI Chat Center: the app will open in its own window when you connect. To turn off: /ai-chat-center:cc window off",
    windowOff: "AI Chat Center: the app will no longer open in its own window.",
    windowNoBrowser: "No Chrome, Chromium or Edge found: the link is still shown.",
    windowDefaultBrowser: "No Chrome, Chromium or Edge found: the app will open in a tab of your default browser.",
    tabMacTip: "Opened in a browser tab. In Safari (macOS Sonoma or newer), File > Add to Dock gives the app its own window.",
    windowLauncher: "The \u201CAI Chat Center\u201D shortcut was added to your apps (the app menu on Linux, the Start menu on Windows, Applications in your home folder on macOS): it opens the app (and starts the hub if needed).",
    launcherComment: "Follow and answer your Claude Code sessions",
    usageOn: "AI Chat Center: the app now shows the 5-hour usage. Your status line stays the same (it runs through a small AI Chat Center wrapper). To undo: /ai-chat-center:cc usage off",
    usageOff: "AI Chat Center: your status line is back as it was; the app no longer receives the 5-hour usage.",
    usageOffChanged: "AI Chat Center: your status line was changed since usage on, so it was left as it is; the app no longer receives the 5-hour usage.",
    usageFailed: "AI Chat Center: could not change the status line in settings.json. See {log}"
  },
  ui: {
    rename: {
      label: "Rename session",
      failed: "Couldn't rename"
    },
    pinned: "Pinned",
    chatMenu: { label: "Conversation actions", rename: "Rename", remove: "Remove from app", confirmRemove: "Remove? Confirm", removeFailed: "Couldn't remove", pin: "Pin to top", unpin: "Unpin", disconnect: "Disconnect", confirmDisconnect: "Disconnect? Confirm", pinFailed: "Couldn't change the pin", disconnectFailed: "Couldn't disconnect", resume: "Resume in the background", openTerminal: "Open in a terminal" },
    background: {
      menu: "Background",
      title: "Conversation background",
      colors: "Colors",
      gradients: "Gradients",
      image: "Image\u2026",
      none: "No background",
      close: "Close",
      failed: "Couldn't change the background",
      tooBig: "The image is larger than 5 MB",
      badType: "Use a PNG, JPEG, WebP or GIF image",
      color: { rose: "Rose", peach: "Peach", sand: "Sand", mint: "Mint", teal: "Teal", sky: "Sky", lavender: "Lavender", slate: "Slate" },
      gradient: { sunrise: "Sunrise", ocean: "Ocean", meadow: "Meadow", dusk: "Dusk", aurora: "Aurora", ember: "Ember" }
    },
    title: "AI Chat Center",
    version: "AI Chat Center {v}",
    collapseList: "Collapse list",
    expandList: "Expand list",
    search: "Search conversations and messages",
    searchMessages: "Messages",
    searchYou: "You",
    selectConversation: "Select a conversation",
    selectConversationHint: "Pick a session on the left to follow it here.",
    others: "Other open sessions ({n})",
    othersHint: "To chat with them here, type /cc in the session's terminal.",
    waiting: "Waiting for you in the terminal",
    disconnected: "Disconnected \u2014 type /cc again",
    noMessages: "No messages yet",
    noResults: "No conversations found",
    empty: "No connected sessions yet. Type /cc in a terminal session to connect it.",
    you: "You",
    yesterday: "yesterday",
    settings: "Settings",
    commands: {
      label: "Commands that run from the app",
      arg: { instructions: "[instructions]", name: "<name>", model: "<opus | sonnet | haiku | fable>", effort: "<low | medium | high | xhigh | max>", cc: "[answers on|off \xB7 usage on|off \xB7 window on|off]" },
      desc: {
        compact: "Summarizes the conversation to free up context",
        rename: "Renames the session",
        model: "Switches the model (also the default for new sessions)",
        effort: "Switches the reasoning effort (also the default for new sessions)",
        reloadPlugins: "Reloads the plugins",
        cc: "AI Chat Center settings of this session",
        status: "Status of the session",
        cost: "Cost of the session",
        context: "Context in use",
        usage: "Plan usage",
        help: "Help",
        doctor: "Checks the installation",
        resume: "Picks a conversation to resume",
        clear: "Starts a new conversation",
        config: "Settings",
        agents: "Agents",
        permissions: "Permissions",
        mcp: "MCP servers",
        plugin: "Plugins",
        hooks: "Hooks",
        memory: "Memory",
        theme: "Theme",
        login: "Log in",
        logout: "Log out",
        exit: "Ends the session"
      }
    },
    newSession: { open: "New session", title: "New session", body: "Starts Claude Code in the background in a folder of your computer. It connects to the app at once, with no terminal.", folder: "Folder", noFolders: "No recent folder yet: browse to one below.", foldersFailed: "Couldn't list the folders.", name: "Name (optional)", namePlaceholder: "e.g. billing fixes", nameInvalid: "Letters, numbers, spaces and . _ - only.", model: "Model", effort: "Effort", chosenApply: "Model and effort chosen here apply from the first message.", default: "Default", start: "Start", starting: "Starting\u2026", cancel: "Cancel", failed: "Couldn't start the session.", failedWith: "Couldn't start the session: {error}", waiting: "Starting the new session\u2026", recent: "Recent folders", browse: "Browse folders\u2026", browseHide: "Hide the folder browser", browser: "Folder browser", current: "Current folder", up: "Up one folder", showHidden: "Show hidden folders", use: "Use this folder", pathField: "Or type or paste a full path", pathPlaceholder: "/home/you/project", go: "Go", empty: "No subfolders here.", truncated: "Only the first {count} folders are shown.", loading: "Loading\u2026", browseFailed: "Couldn't open this folder.", folderInvalid: "Type a full path (starting with / or a drive letter).", folderOutside: "Only folders inside your home folder can be used.", folderNotFound: "This folder doesn't exist.", folderDenied: "No permission to open this folder.", untrusted: `Claude Code doesn't trust this folder yet. Open a terminal in {folder}, run claude once and accept "Yes, I trust this folder", then try again.` },
    theme: { label: "Theme", system: "System", light: "Light", dark: "Dark" },
    language: "Language",
    showDiffs: "Show file changes",
    back: "Back",
    unread: "{n} unread",
    loadError: "Could not reach the hub. Retrying\u2026",
    noToken: {
      title: "Open the link shown by /cc",
      body: "This page needs the access link printed by /cc in your terminal session. Open that link to continue."
    },
    notice: {
      connected: "Connected",
      disconnected: "Disconnected",
      compacted: "Conversation compacted"
    },
    question: {
      answerInTerminal: "Answer in the terminal",
      answerInTerminalNotice: "Answer in the terminal",
      other: "Other answer",
      send: "Send",
      alreadyAnswered: "Already answered",
      answered: "Answered",
      notAnswered: "Not answered",
      banner: "Claude is asking you a question \u2014 answer below",
      statusAria: "Status: waiting for your answer",
      waiting: "waiting for your answer",
      enableHint: "To answer here, type /ai-chat-center:cc answers on in the terminal",
      terminalTitle: "Question waiting for an answer",
      terminalBody: "Answer it in the session's terminal.",
      bgBody: "Open it in a terminal (button below) or turn on answers from the app with /ai-chat-center:cc answers on.",
      bgBodyOn: "Open it in a terminal (button below) to answer."
    },
    status: {
      busy: "working\u2026",
      idle: "idle",
      waiting: "waiting for you in the terminal",
      disconnected: "disconnected \u2014 type /cc again"
    },
    chat: {
      origin: {
        terminal: "Sent from the terminal",
        app: "Sent from the app"
      },
      originWord: {
        terminal: "terminal",
        app: "app"
      },
      actionsOne: "{n} action",
      actionsMany: "{n} actions",
      running: "running\u2026",
      error: "error",
      done: "done",
      notDelivered: "not delivered",
      queued: "queued \u2014 delivered when Claude finishes",
      connectedAt: "Connected to AI Chat Center \xB7 {time}",
      disconnectedAt: "Disconnected \xB7 {time}",
      typing: "Claude is working",
      agent: "Agent",
      agentFrom: "Agent {name}",
      toAgent: "Claude \u2192",
      code: { copy: "Copy", copied: "Copied", copyFailed: "Could not copy", wrap: "Wrap lines", noWrap: "Don't wrap lines" },
      showAll: "Show all",
      recap: "Recap",
      diffShow: "Show changes (+{added} -{removed})",
      diffHide: "Hide changes",
      diffMore: "Show more ({n} lines)",
      diffCut: "Diff cut for size",
      showLess: "Show less",
      branch: "Branch",
      model: "Model",
      effort: "Reasoning level",
      search: "Search in this conversation",
      searchPlaceholder: "Search messages\u2026",
      searchCount: "{n} found",
      searchNone: "No message found",
      controlsTerminal: "Available in background sessions: resume the session from the app",
      controlsTerminalShort: "background sessions only",
      pluginVersion: "Plugin version in this session",
      pluginVersionValue: "plugin {v}",
      versionOld: "old version: run /reload-plugins and /ai-chat-center:cc",
      claudeVersion: "Claude Code version",
      claudeVersionValue: "Claude Code {v}",
      switchModel: "Switch model",
      switchEffort: "Switch effort",
      switchSavesDefault: "also becomes the default for new sessions",
      switchWhenIdle: "will be applied when the session finishes",
      mode: "Permission mode",
      modes: {
        default: "default",
        acceptEdits: "accept edits",
        plan: "plan mode",
        auto: "auto mode",
        bypassPermissions: "bypass permissions",
        dontAsk: "don't ask"
      },
      loading: "Loading messages\u2026",
      waitingBanner: "Claude is waiting for you to approve an action in the terminal",
      waitingInputBanner: "Claude is waiting for your answer in the terminal",
      waitingBannerHint: "Approving from the app comes in a later version.",
      deliveryStalled: "Messages are waiting, but delivery to this session is paused: send any prompt in the terminal to resume delivery.",
      transcriptMissing: {
        title: "This session does not save its history",
        body: "Claude Code is not writing this session's transcript, so the app cannot show your messages or the replies (messages sent from here still reach the terminal). This happens when claude is started in a terminal opened by another Claude Code session, which passes its CLAUDE_CODE_* variables on. Open a new terminal, start claude there and type /cc."
      },
      undeliveredUnsigned: "A message from an older version of AI Chat Center was not delivered. Send it again from here.",
      messages: "Messages",
      image: "[image]",
      images: "[{n} images]",
      compacted: "Conversation compacted \xB7 {time}",
      commandRunning: "{cmd} is running\u2026",
      commandDone: "{cmd} finished \xB7 {time}",
      attachments: "Attached files",
      resume: { title: "Session ended", body: "Resume it in the background: it comes back connected to the app, with no terminal.", button: "Resume in the background", resuming: "Resuming\u2026", failed: "Could not resume: {error}", running: "This session is still open in a terminal. Type /cc there to reconnect.", error: "Could not resume the session." },
      attach: "Open in a terminal",
      attachCopy: "Copy {cmd}",
      attachCopied: "Copied",
      waitingBgHint: "This session runs in the background: answer in a terminal with {cmd}.",
      terminal: {
        opened: "Terminal opened. Closing it does not end the session.",
        noTerminal: "No terminal program found. Run in a terminal: {cmd}",
        failed: "Could not open a terminal. Run in a terminal: {cmd}",
        notBackground: "This session no longer runs in the background.",
        folderMissing: "The folder of this session no longer exists, so no terminal was opened."
      }
    },
    composer: {
      placeholder: "Message {name}\u2026",
      answerPlaceholder: "Answer the question above",
      disconnectedPlaceholder: "Session disconnected",
      hint: "Enter sends \xB7 Shift+Enter adds a line \xB7 while Claude is busy, messages are queued",
      disconnectedHint: "This session is disconnected. Type /cc in its terminal to reconnect.",
      send: "Send",
      sendDisconnected: "This session is disconnected",
      sendOlderVersion: "This session runs an older version of AI Chat Center. Restart it (exit and `claude --resume`) to send messages from the app.",
      sendNewerVersion: "This session runs a newer version of AI Chat Center than this app. Type /cc in that session to update the app, then send again.",
      sendFailed: "Could not send the message.",
      retry: "Retry",
      attach: "Attach files",
      attachments: "Files to send",
      removeAttachment: "Remove {name}",
      attachTooLarge: "{name} is larger than 20 MB and was not attached.",
      attachTooMany: "At most {max} files per message.",
      attachFailed: "Could not upload the attachments. Try again.",
      uploading: "Uploading attachments\u2026",
      dropHere: "Drop files to attach them",
      commandSent: "Command {cmd} sent.",
      commandBusy: "The session is busy. Send the command when it is done.",
      commandWindows: "Commands from the app do not work on Windows yet.",
      commandFailed: "Could not send the command.",
      slashInteractive: "Claude Code commands only run from the app in background sessions. In this session, {cmd} would arrive as text.",
      commandScreen: "{cmd} only shows its result on the session's screen, so the app would show nothing. Use it in a terminal: {attach}",
      commandTerminal: "{cmd} opens a menu or needs the terminal, so it does not run from the app. Use it in a terminal: {attach}",
      sendAsText: "Send as text",
      cancel: "Cancel"
    },
    usage: {
      label: "5-hour usage",
      fiveHour: "5-hour window",
      sevenDay: "7-day window",
      summary: "{pct}% \xB7 resets in {left}",
      used: "{pct}% used",
      resetsAt: "Resets at {time} (in {left})",
      resetsOn: "Resets {time}",
      restarted: "Window restarted",
      updated: "Updated at {time} (from a session's status line)",
      hours: "{h}h{m}",
      minutes: "{m} min",
      hint: "5-hour usage: turn it on with /ai-chat-center:cc usage on"
    },
    notifications: {
      label: "Browser notifications",
      enable: "Enable notifications",
      denied: "Blocked by the browser"
    },
    state: {
      busy: "Status: working",
      idle: "Status: idle",
      waiting: "Status: waiting for you in the terminal",
      disconnected: "Status: disconnected"
    }
  }
};

// src/core/locales/pt-BR.json
var pt_BR_default = {
  hook: {
    ready: "AI Chat Center pronto: {url}",
    hubFailed: "AI Chat Center: o hub n\xE3o iniciou. Veja {log}",
    unknownArg: "AI Chat Center: argumento desconhecido. Use /cc, /ai-chat-center:cc off, /ai-chat-center:cc answers on, /ai-chat-center:cc answers off, /ai-chat-center:cc window on, /ai-chat-center:cc window off, /ai-chat-center:cc usage on ou /ai-chat-center:cc usage off.",
    answersOn: "AI Chat Center: agora voc\xEA pode responder pelo app as perguntas de m\xFAltipla escolha, inclusive confirma\xE7\xF5es. Para desligar: /ai-chat-center:cc answers off",
    answersOff: "AI Chat Center: perguntas de m\xFAltipla escolha voltam a ser respondidas s\xF3 no terminal.",
    windowOn: "AI Chat Center: o app vai abrir em janela pr\xF3pria ao conectar. Para desligar: /ai-chat-center:cc window off",
    windowOff: "AI Chat Center: o app n\xE3o abre mais em janela pr\xF3pria.",
    windowNoBrowser: "Nenhum Chrome, Chromium ou Edge encontrado: o link continua sendo mostrado.",
    windowDefaultBrowser: "Nenhum Chrome, Chromium ou Edge encontrado: o app vai abrir numa aba do navegador padr\xE3o.",
    tabMacTip: "O app abriu numa aba do navegador. No Safari (macOS Sonoma ou mais novo), Arquivo > Adicionar ao Dock deixa o app em janela pr\xF3pria.",
    windowLauncher: "O atalho \u201CAI Chat Center\u201D foi adicionado aos seus aplicativos (menu de aplicativos no Linux, menu Iniciar no Windows, Aplicativos da sua pasta pessoal no macOS): ele abre o app (e inicia o hub, se preciso).",
    launcherComment: "Acompanhe e responda suas sess\xF5es do Claude Code",
    usageOn: "AI Chat Center: o app agora mostra o uso do per\xEDodo de 5 horas. Sua status line continua igual (ela passa por um pequeno wrapper do AI Chat Center). Para desfazer: /ai-chat-center:cc usage off",
    usageOff: "AI Chat Center: sua status line voltou a ser a de antes; o app n\xE3o recebe mais o uso do per\xEDodo de 5 horas.",
    usageOffChanged: "AI Chat Center: sua status line foi alterada depois do usage on, ent\xE3o ficou como est\xE1; o app n\xE3o recebe mais o uso do per\xEDodo de 5 horas.",
    usageFailed: "AI Chat Center: n\xE3o foi poss\xEDvel alterar a status line no settings.json. Veja {log}"
  },
  ui: {
    rename: {
      label: "Renomear sess\xE3o",
      failed: "N\xE3o foi poss\xEDvel renomear"
    },
    pinned: "Fixada",
    chatMenu: { label: "A\xE7\xF5es da conversa", rename: "Renomear", remove: "Remover do app", confirmRemove: "Remover? Confirmar", removeFailed: "N\xE3o foi poss\xEDvel remover", pin: "Fixar no topo", unpin: "Desafixar", disconnect: "Desconectar", confirmDisconnect: "Desconectar? Confirmar", pinFailed: "N\xE3o foi poss\xEDvel alterar a fixa\xE7\xE3o", disconnectFailed: "N\xE3o foi poss\xEDvel desconectar", resume: "Retomar em segundo plano", openTerminal: "Abrir no terminal" },
    background: {
      menu: "Fundo",
      title: "Fundo da conversa",
      colors: "Cores",
      gradients: "Gradientes",
      image: "Imagem\u2026",
      none: "Sem fundo",
      close: "Fechar",
      failed: "N\xE3o foi poss\xEDvel mudar o fundo",
      tooBig: "A imagem passa de 5 MB",
      badType: "Use uma imagem PNG, JPEG, WebP ou GIF",
      color: { rose: "Rosa", peach: "P\xEAssego", sand: "Areia", mint: "Menta", teal: "Verde-\xE1gua", sky: "C\xE9u", lavender: "Lavanda", slate: "Ard\xF3sia" },
      gradient: { sunrise: "Nascer do sol", ocean: "Oceano", meadow: "Campo", dusk: "Crep\xFAsculo", aurora: "Aurora", ember: "Brasa" }
    },
    title: "AI Chat Center",
    version: "AI Chat Center {v}",
    collapseList: "Recolher lista",
    expandList: "Expandir lista",
    search: "Buscar conversas e mensagens",
    searchMessages: "Mensagens",
    searchYou: "Voc\xEA",
    selectConversation: "Selecione uma conversa",
    selectConversationHint: "Escolha uma sess\xE3o \xE0 esquerda para acompanh\xE1-la aqui.",
    others: "Outras sess\xF5es abertas ({n})",
    othersHint: "Para conversar com elas aqui, digite /cc no terminal da sess\xE3o.",
    waiting: "Esperando por voc\xEA no terminal",
    disconnected: "Desconectada \u2014 digite /cc de novo",
    noMessages: "Nenhuma mensagem ainda",
    noResults: "Nenhuma conversa encontrada",
    empty: "Nenhuma sess\xE3o conectada ainda. Digite /cc em uma sess\xE3o do terminal para conect\xE1-la.",
    you: "Voc\xEA",
    yesterday: "ontem",
    settings: "Configura\xE7\xF5es",
    commands: {
      label: "Comandos que rodam pelo app",
      arg: { instructions: "[instru\xE7\xF5es]", name: "<nome>", model: "<opus | sonnet | haiku | fable>", effort: "<low | medium | high | xhigh | max>", cc: "[answers on|off \xB7 usage on|off \xB7 window on|off]" },
      desc: {
        compact: "Resume a conversa para liberar contexto",
        rename: "Renomeia a sess\xE3o",
        model: "Troca o modelo (tamb\xE9m vira o padr\xE3o das novas sess\xF5es)",
        effort: "Troca o esfor\xE7o de racioc\xEDnio (tamb\xE9m vira o padr\xE3o das novas sess\xF5es)",
        reloadPlugins: "Recarrega os plugins",
        cc: "Configura\xE7\xF5es do AI Chat Center nesta sess\xE3o",
        status: "Estado da sess\xE3o",
        cost: "Custo da sess\xE3o",
        context: "Contexto em uso",
        usage: "Uso do plano",
        help: "Ajuda",
        doctor: "Verifica a instala\xE7\xE3o",
        resume: "Escolhe uma conversa para retomar",
        clear: "Come\xE7a uma conversa nova",
        config: "Configura\xE7\xF5es",
        agents: "Agentes",
        permissions: "Permiss\xF5es",
        mcp: "Servidores MCP",
        plugin: "Plugins",
        hooks: "Hooks",
        memory: "Mem\xF3ria",
        theme: "Tema",
        login: "Entrar",
        logout: "Sair",
        exit: "Encerra a sess\xE3o"
      }
    },
    newSession: { open: "Nova sess\xE3o", title: "Nova sess\xE3o", body: "Inicia o Claude Code em segundo plano numa pasta do seu computador. Ela j\xE1 entra conectada ao app, sem terminal.", folder: "Pasta", noFolders: "Nenhuma pasta recente ainda: navegue at\xE9 uma abaixo.", foldersFailed: "N\xE3o foi poss\xEDvel listar as pastas.", name: "Nome (opcional)", namePlaceholder: "ex.: corre\xE7\xF5es do faturamento", nameInvalid: "S\xF3 letras, n\xFAmeros, espa\xE7os e . _ -", model: "Modelo", effort: "Esfor\xE7o", chosenApply: "O modelo e o esfor\xE7o escolhidos aqui j\xE1 valem desde a primeira mensagem.", default: "Padr\xE3o", start: "Iniciar", starting: "Iniciando\u2026", cancel: "Cancelar", failed: "N\xE3o foi poss\xEDvel iniciar a sess\xE3o.", failedWith: "N\xE3o foi poss\xEDvel iniciar a sess\xE3o: {error}", waiting: "Iniciando a nova sess\xE3o\u2026", recent: "Pastas recentes", browse: "Procurar pastas\u2026", browseHide: "Fechar o navegador de pastas", browser: "Navegador de pastas", current: "Pasta atual", up: "Subir uma pasta", showHidden: "Mostrar pastas ocultas", use: "Usar esta pasta", pathField: "Ou digite ou cole um caminho completo", pathPlaceholder: "/home/voce/projeto", go: "Ir", empty: "Nenhuma subpasta aqui.", truncated: "S\xF3 as primeiras {count} pastas aparecem.", loading: "Carregando\u2026", browseFailed: "N\xE3o foi poss\xEDvel abrir esta pasta.", folderInvalid: "Digite um caminho completo (come\xE7ando com / ou com a letra do disco).", folderOutside: "S\xF3 d\xE1 para usar pastas dentro da sua pasta pessoal.", folderNotFound: "Esta pasta n\xE3o existe.", folderDenied: "Sem permiss\xE3o para abrir esta pasta.", untrusted: 'O Claude Code ainda n\xE3o confia nesta pasta. Abra um terminal em {folder}, rode claude uma vez e aceite "Yes, I trust this folder"; depois tente de novo.' },
    theme: { label: "Tema", system: "Sistema", light: "Claro", dark: "Escuro" },
    language: "Idioma",
    showDiffs: "Mostrar altera\xE7\xF5es dos arquivos",
    back: "Voltar",
    unread: "{n} n\xE3o lidas",
    loadError: "N\xE3o foi poss\xEDvel falar com o hub. Tentando de novo\u2026",
    noToken: {
      title: "Abra o link mostrado pelo /cc",
      body: "Esta p\xE1gina precisa do link de acesso exibido pelo /cc na sess\xE3o do terminal. Abra esse link para continuar."
    },
    notice: {
      connected: "Conectada",
      disconnected: "Desconectada",
      compacted: "Conversa compactada"
    },
    question: {
      answerInTerminal: "Responder no terminal",
      answerInTerminalNotice: "Responda no terminal",
      other: "Outra resposta",
      send: "Enviar",
      alreadyAnswered: "J\xE1 respondida",
      answered: "Respondida",
      notAnswered: "N\xE3o respondida",
      banner: "O Claude est\xE1 fazendo uma pergunta \u2014 responda abaixo",
      statusAria: "Status: aguardando sua resposta",
      waiting: "aguardando sua resposta",
      enableHint: "Para responder por aqui, digite /ai-chat-center:cc answers on no terminal",
      terminalTitle: "Pergunta esperando resposta",
      terminalBody: "Responda no terminal da sess\xE3o.",
      bgBody: "Abra no terminal (bot\xE3o abaixo) ou ligue as respostas pelo app com /ai-chat-center:cc answers on.",
      bgBodyOn: "Abra no terminal (bot\xE3o abaixo) para responder."
    },
    status: {
      busy: "trabalhando\u2026",
      idle: "parada",
      waiting: "aguardando voc\xEA no terminal",
      disconnected: "desconectada \u2014 digite /cc de novo"
    },
    chat: {
      origin: {
        terminal: "Enviada pelo terminal",
        app: "Enviada pelo app"
      },
      originWord: {
        terminal: "terminal",
        app: "app"
      },
      actionsOne: "{n} a\xE7\xE3o",
      actionsMany: "{n} a\xE7\xF5es",
      running: "executando\u2026",
      error: "erro",
      done: "conclu\xEDda",
      notDelivered: "n\xE3o entregue",
      queued: "na fila \u2014 entregue quando o Claude terminar",
      connectedAt: "Conectada ao AI Chat Center \xB7 {time}",
      disconnectedAt: "Desconectada \xB7 {time}",
      typing: "Claude est\xE1 trabalhando",
      agent: "Agente",
      agentFrom: "Agente {name}",
      toAgent: "Claude \u2192",
      code: { copy: "Copiar", copied: "Copiado", copyFailed: "N\xE3o deu para copiar", wrap: "Quebrar linhas", noWrap: "N\xE3o quebrar linhas" },
      showAll: "Ver tudo",
      recap: "Resumo",
      diffShow: "Ver altera\xE7\xF5es (+{added} -{removed})",
      diffHide: "Ocultar altera\xE7\xF5es",
      diffMore: "Ver mais ({n} linhas)",
      diffCut: "Diff cortado por tamanho",
      showLess: "Ver menos",
      branch: "Branch",
      model: "Modelo",
      effort: "N\xEDvel de racioc\xEDnio",
      search: "Buscar nesta conversa",
      searchPlaceholder: "Buscar mensagens\u2026",
      searchCount: "{n} encontradas",
      searchNone: "Nenhuma mensagem encontrada",
      controlsTerminal: "Dispon\xEDvel em sess\xF5es em segundo plano: retome a sess\xE3o pelo app",
      controlsTerminalShort: "s\xF3 em sess\xF5es em segundo plano",
      pluginVersion: "Vers\xE3o do plugin nesta sess\xE3o",
      pluginVersionValue: "plugin {v}",
      versionOld: "vers\xE3o antiga: rode /reload-plugins e /ai-chat-center:cc",
      claudeVersion: "Vers\xE3o do Claude Code",
      claudeVersionValue: "Claude Code {v}",
      switchModel: "Trocar modelo",
      switchEffort: "Trocar esfor\xE7o",
      switchSavesDefault: "tamb\xE9m vira o padr\xE3o das novas sess\xF5es",
      switchWhenIdle: "ser\xE1 aplicado quando a sess\xE3o terminar",
      mode: "Modo de permiss\xE3o",
      modes: {
        default: "padr\xE3o",
        acceptEdits: "aceitar edi\xE7\xF5es",
        plan: "planejamento",
        auto: "auto mode",
        bypassPermissions: "sem permiss\xF5es",
        dontAsk: "n\xE3o perguntar"
      },
      loading: "Carregando mensagens\u2026",
      waitingBanner: "O Claude est\xE1 esperando voc\xEA aprovar uma a\xE7\xE3o no terminal",
      waitingInputBanner: "O Claude est\xE1 esperando sua resposta no terminal",
      waitingBannerHint: "Aprovar pelo app chega em uma vers\xE3o futura.",
      deliveryStalled: "H\xE1 mensagens esperando, mas a entrega para esta sess\xE3o est\xE1 pausada: envie qualquer mensagem no terminal para retomar a entrega.",
      transcriptMissing: {
        title: "Esta sess\xE3o n\xE3o salva o hist\xF3rico",
        body: "O Claude Code n\xE3o est\xE1 gravando o transcript desta sess\xE3o, ent\xE3o o app n\xE3o consegue mostrar suas mensagens nem as respostas (as mensagens enviadas daqui ainda chegam ao terminal). Isso acontece quando o claude \xE9 iniciado num terminal aberto por outra sess\xE3o do Claude Code, que repassa as vari\xE1veis CLAUDE_CODE_*. Abra um terminal novo, inicie o claude nele e digite /cc."
      },
      undeliveredUnsigned: "Uma mensagem de uma vers\xE3o anterior do AI Chat Center n\xE3o foi entregue. Envie-a de novo por aqui.",
      messages: "Mensagens",
      image: "[imagem]",
      images: "[{n} imagens]",
      compacted: "Conversa compactada \xB7 {time}",
      commandRunning: "{cmd} rodando\u2026",
      commandDone: "{cmd} terminou \xB7 {time}",
      attachments: "Arquivos anexados",
      resume: { title: "Sess\xE3o encerrada", body: "Retome-a em segundo plano: ela volta conectada ao app, sem abrir terminal.", button: "Retomar em segundo plano", resuming: "Retomando\u2026", failed: "N\xE3o foi poss\xEDvel retomar: {error}", running: "Esta sess\xE3o ainda est\xE1 aberta num terminal. Digite /cc nela para reconectar.", error: "N\xE3o foi poss\xEDvel retomar a sess\xE3o." },
      attach: "Abrir no terminal",
      attachCopy: "Copiar {cmd}",
      attachCopied: "Copiado",
      waitingBgHint: "Esta sess\xE3o roda em segundo plano: responda no terminal com {cmd}.",
      terminal: {
        opened: "Terminal aberto. Fech\xE1-lo n\xE3o encerra a sess\xE3o.",
        noTerminal: "Nenhum programa de terminal encontrado. Rode num terminal: {cmd}",
        failed: "N\xE3o foi poss\xEDvel abrir o terminal. Rode num terminal: {cmd}",
        notBackground: "Esta sess\xE3o n\xE3o roda mais em segundo plano.",
        folderMissing: "A pasta desta sess\xE3o n\xE3o existe mais, ent\xE3o nenhum terminal foi aberto."
      }
    },
    composer: {
      placeholder: "Mensagem para {name}\u2026",
      answerPlaceholder: "Responda a pergunta acima",
      disconnectedPlaceholder: "Sess\xE3o desconectada",
      hint: "Enter envia \xB7 Shift+Enter quebra a linha \xB7 enquanto o Claude trabalha, as mensagens ficam na fila",
      disconnectedHint: "Esta sess\xE3o est\xE1 desconectada. Digite /cc no terminal dela para reconectar.",
      send: "Enviar",
      sendDisconnected: "Esta sess\xE3o est\xE1 desconectada",
      sendOlderVersion: "Esta sess\xE3o roda uma vers\xE3o mais antiga do AI Chat Center. Reinicie-a (saia e rode `claude --resume`) para enviar mensagens pelo app.",
      sendNewerVersion: "Esta sess\xE3o roda uma vers\xE3o do AI Chat Center mais nova que a deste app. Digite /cc nessa sess\xE3o para atualizar o app e envie de novo.",
      sendFailed: "N\xE3o foi poss\xEDvel enviar a mensagem.",
      retry: "Tentar de novo",
      attach: "Anexar arquivos",
      attachments: "Arquivos a enviar",
      removeAttachment: "Remover {name}",
      attachTooLarge: "{name} tem mais de 20 MB e n\xE3o foi anexado.",
      attachTooMany: "No m\xE1ximo {max} arquivos por mensagem.",
      attachFailed: "N\xE3o foi poss\xEDvel enviar os anexos. Tente de novo.",
      uploading: "Enviando anexos\u2026",
      dropHere: "Solte os arquivos para anex\xE1-los",
      commandSent: "Comando {cmd} enviado.",
      commandBusy: "A sess\xE3o est\xE1 ocupada. Envie o comando quando ela terminar.",
      commandWindows: "Comandos pelo app ainda n\xE3o funcionam no Windows.",
      commandFailed: "N\xE3o foi poss\xEDvel enviar o comando.",
      slashInteractive: "Comandos do Claude Code s\xF3 rodam pelo app em sess\xF5es em segundo plano. Nesta sess\xE3o, {cmd} chegaria como texto.",
      commandScreen: "{cmd} s\xF3 mostra o resultado na tela da sess\xE3o, ent\xE3o o app n\xE3o mostraria nada. Use no terminal: {attach}",
      commandTerminal: "{cmd} abre um menu ou precisa do terminal, ent\xE3o n\xE3o roda pelo app. Use no terminal: {attach}",
      sendAsText: "Enviar como texto",
      cancel: "Cancelar"
    },
    usage: {
      label: "Uso de 5 horas",
      fiveHour: "Per\xEDodo de 5 horas",
      sevenDay: "Per\xEDodo de 7 dias",
      summary: "{pct}% \xB7 reinicia em {left}",
      used: "{pct}% usado",
      resetsAt: "Reinicia \xE0s {time} (em {left})",
      resetsOn: "Reinicia {time}",
      restarted: "Per\xEDodo reiniciado",
      updated: "Atualizado \xE0s {time} (pela status line de uma sess\xE3o)",
      hours: "{h}h{m}",
      minutes: "{m} min",
      hint: "Uso de 5 horas: ative com /ai-chat-center:cc usage on"
    },
    notifications: {
      label: "Notifica\xE7\xF5es do navegador",
      enable: "Ativar notifica\xE7\xF5es",
      denied: "Bloqueadas pelo navegador"
    },
    state: {
      busy: "Status: trabalhando",
      idle: "Status: ociosa",
      waiting: "Status: esperando voc\xEA no terminal",
      disconnected: "Status: desconectada"
    }
  }
};

// src/core/i18n.ts
var locales = { en: en_default, "pt-BR": pt_BR_default };
function lookup(tree, key) {
  let cur = tree;
  for (const part of key.split(".")) {
    if (typeof cur !== "object" || cur === null || !Object.hasOwn(cur, part)) return void 0;
    cur = cur[part];
  }
  return typeof cur === "string" ? cur : void 0;
}
function t(lang, key, vars) {
  const text = lookup(locales[lang], key) ?? lookup(locales.en, key) ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, n) => n in vars ? vars[n] : m) : text;
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

// src/core/claudeAgents.ts
import { execFile } from "node:child_process";
import os4 from "node:os";
function runClaudeAgentsJson(platform = process.platform) {
  const win = platform === "win32";
  return new Promise((resolve, reject) => {
    execFile(
      win ? "claude agents --json" : "claude",
      win ? [] : ["agents", "--json"],
      { cwd: os4.homedir(), shell: win, windowsHide: true, timeout: 5e3, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => err ? reject(err) : resolve(String(stdout))
    );
  });
}

// src/hooks/claudePid.ts
async function lookupClaudePid(sessionId, opts = {}) {
  try {
    const list = JSON.parse(await (opts.run ?? runClaudeAgentsJson)());
    if (!Array.isArray(list)) return { ok: false };
    for (const a of list) {
      if (a?.sessionId === sessionId && typeof a.pid === "number") return { ok: true, pid: a.pid };
    }
    return { ok: true, pid: null };
  } catch {
    return { ok: false };
  }
}
async function resolveClaudePid(sessionId, opts = {}) {
  const r = await lookupClaudePid(sessionId, opts);
  return r.ok ? r.pid : null;
}

// src/hooks/parentClaude.ts
import fs7 from "node:fs";
import { execFileSync } from "node:child_process";
function isClaudeArgv(argv) {
  const base = (s) => s.split(/[\\/]/).pop() ?? "";
  if (/^claude(\.exe)?$/i.test(base(argv[0] ?? ""))) return true;
  return /^node(\.exe)?$/i.test(base(argv[0] ?? "")) && /[\\/]@anthropic-ai[\\/]claude-code[\\/]/.test(argv[1] ?? "");
}
function parentClaudePid(ppid = process.ppid, platform = process.platform, readArgv = (p) => readProcessArgv(p, platform)) {
  if (!Number.isInteger(ppid) || ppid <= 1 || platform === "win32") return null;
  const argv = readArgv(ppid);
  return argv && isClaudeArgv(argv) ? ppid : null;
}
function readProcessArgv(pid, platform) {
  try {
    if (platform === "linux") {
      return fs7.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
    }
    const out = execFileSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf8", timeout: 2e3, stdio: ["ignore", "pipe", "ignore"] });
    return out.trim().split(/\s+/).filter(Boolean);
  } catch {
    return null;
  }
}

// src/hooks/openWindow.ts
import fs8 from "node:fs";
import path9 from "node:path";
import { spawn as nodeSpawn } from "node:child_process";
var LINUX_NAMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable"];
var MAC_APPS = [
  "Google Chrome.app/Contents/MacOS/Google Chrome",
  "Chromium.app/Contents/MacOS/Chromium",
  "Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
];
var WIN_EXES = [
  ["Google", "Chrome", "Application", "chrome.exe"],
  ["Microsoft", "Edge", "Application", "msedge.exe"]
];
var WIN_BASES = ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"];
function isExecutableFile(p, platform = process.platform, checks = {}) {
  const stat = checks.stat ?? fs8.statSync;
  const access = checks.access ?? fs8.accessSync;
  try {
    if (!stat(p).isFile()) return false;
    if (platform !== "win32") access(p, fs8.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
function findBrowser(env = process.env, platform = process.platform, exists = (p) => isExecutableFile(p, platform)) {
  const ok = (p) => {
    try {
      return exists(p);
    } catch {
      return false;
    }
  };
  let candidates;
  if (platform === "darwin") {
    const roots = ["/Applications", ...env.HOME && path9.posix.isAbsolute(env.HOME) ? [path9.posix.join(env.HOME, "Applications")] : []];
    candidates = MAC_APPS.flatMap((app) => roots.map((r) => path9.posix.join(r, app)));
  } else if (platform === "win32") {
    const bases = WIN_BASES.map((k) => env[k]).filter((b) => !!b && path9.win32.isAbsolute(b));
    candidates = WIN_EXES.flatMap((exe) => bases.map((b) => path9.win32.join(b, ...exe)));
  } else {
    const dirs = (env.PATH ?? "").split(path9.posix.delimiter).filter((d) => path9.posix.isAbsolute(d));
    candidates = LINUX_NAMES.flatMap((n) => dirs.map((d) => path9.posix.join(d, n)));
  }
  return candidates.find(ok) ?? null;
}
function findDefaultOpener(env = process.env, platform = process.platform, exists = (p) => isExecutableFile(p, platform)) {
  const ok = (p) => {
    try {
      return exists(p);
    } catch {
      return false;
    }
  };
  if (platform === "darwin") return ok("/usr/bin/open") ? { cmd: "/usr/bin/open", args: [] } : null;
  if (platform === "win32") {
    const root = env.SystemRoot ?? env.SYSTEMROOT ?? env.windir;
    if (!root || !path9.win32.isAbsolute(root)) return null;
    const exe2 = path9.win32.join(root, "System32", "rundll32.exe");
    return ok(exe2) ? { cmd: exe2, args: ["url.dll,FileProtocolHandler"] } : null;
  }
  const dirs = (env.PATH ?? "").split(path9.posix.delimiter).filter((d) => path9.posix.isAbsolute(d));
  const exe = dirs.map((d) => path9.posix.join(d, "xdg-open")).find(ok);
  return exe ? { cmd: exe, args: [] } : null;
}
function openAppWindow(browser, url, deps = {}) {
  const spawn2 = deps.spawn ?? nodeSpawn;
  try {
    const child = spawn2(browser, [`--app=${url}`, "--new-window"], { detached: true, stdio: "ignore", shell: false });
    child.on?.("error", (e) => {
      try {
        deps.onError?.(`app window: could not start ${browser}: ${String(e?.message ?? e).split(url).join("<url>")}`);
      } catch {
      }
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
function openDefaultBrowser(opener, url, deps = {}) {
  const spawn2 = deps.spawn ?? nodeSpawn;
  try {
    const child = spawn2(opener.cmd, [...opener.args, url], { detached: true, stdio: "ignore", shell: false, windowsHide: true });
    child.on?.("error", (e) => {
      try {
        deps.onError?.(`app tab: could not start ${opener.cmd}: ${String(e?.message ?? e).split(url).join("<url>")}`);
      } catch {
      }
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
var CODE_RE = /^[0-9a-f]{64}$/;
async function launchAppWindow(hubUrl, deps = {}, sessionId) {
  const browser = (deps.findBrowser ?? (() => findBrowser()))();
  const opener = browser ? null : (deps.findDefaultOpener ?? (() => findDefaultOpener()))();
  if (!browser && !opener) return false;
  const u = new URL(hubUrl);
  const token = new URLSearchParams(u.hash.slice(1)).get("token");
  if (u.protocol !== "http:" || u.hostname !== "127.0.0.1" || !token) throw new Error("app window: unexpected hub url");
  const doFetch = deps.fetch ?? fetch;
  const res = await doFetch(`${u.origin}/api/pair-code`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(sessionId ? { sessionId } : {}),
    signal: AbortSignal.timeout(deps.timeoutMs ?? 2e3)
  });
  if (!res.ok) throw new Error(`app window: pair-code answered ${res.status}`);
  let answer;
  try {
    answer = await res.json();
  } catch {
    throw new Error("app window: pair-code answer is not JSON");
  }
  if (answer?.live === true) return "reused";
  const code2 = answer?.code;
  if (typeof code2 !== "string" || !CODE_RE.test(code2)) throw new Error("app window: pair-code answer has no valid code");
  const appUrl = `${u.origin}/#pair=${code2}`;
  if (browser) {
    if (!openAppWindow(browser, appUrl, deps)) throw new Error(`app window: could not start ${browser}`);
    return "opened";
  }
  if (!openDefaultBrowser(opener, appUrl, deps)) throw new Error(`app tab: could not start ${opener.cmd}`);
  return "tab";
}

// src/hooks/launcher.ts
import fs12 from "node:fs";
import os5 from "node:os";
import path13 from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";

// src/hooks/launcherFiles.ts
import fs9 from "node:fs";
import path10 from "node:path";
var PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function writeIfChanged(file, data, mode = 420) {
  try {
    if (fs9.readFileSync(file).equals(data)) {
      if (process.platform !== "win32" && (fs9.statSync(file).mode & 511) !== mode) fs9.chmodSync(file, mode);
      return;
    }
  } catch {
  }
  fs9.mkdirSync(path10.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs9.writeFileSync(tmp, data, { mode });
  if (process.platform !== "win32") fs9.chmodSync(tmp, mode);
  fs9.renameSync(tmp, file);
}
function pngSize(png) {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE) || png.toString("latin1", 12, 16) !== "IHDR") {
    throw new Error("icon: not a PNG");
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
function pngToIco(png) {
  const { width, height } = pngSize(png);
  if (width > 256 || height > 256) throw new Error("icon: an ICO image is at most 256x256");
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(1, 4);
  head[6] = width === 256 ? 0 : width;
  head[7] = height === 256 ? 0 : height;
  head[8] = 0;
  head[9] = 0;
  head.writeUInt16LE(1, 10);
  head.writeUInt16LE(32, 12);
  head.writeUInt32LE(png.length, 14);
  head.writeUInt32LE(22, 18);
  return Buffer.concat([head, png]);
}
function pngToIcns(png) {
  const { width, height } = pngSize(png);
  if (width !== 512 || height !== 512) throw new Error("icon: the ic09 element must be 512x512");
  const head = Buffer.alloc(16);
  head.write("icns", 0, "latin1");
  head.writeUInt32BE(16 + png.length, 4);
  head.write("ic09", 8, "latin1");
  head.writeUInt32BE(8 + png.length, 12);
  return Buffer.concat([head, png]);
}

// src/hooks/launcherMac.ts
import fs10 from "node:fs";
import path11 from "node:path";
var BUNDLE_ID = "com.ai-chat-center.launcher";
var EXECUTABLE = "ai-chat-center";
function macLauncherPaths(home) {
  const app = path11.join(home, "Applications", "AI Chat Center.app");
  return {
    app,
    plist: path11.join(app, "Contents", "Info.plist"),
    exec: path11.join(app, "Contents", "MacOS", EXECUTABLE),
    icon: path11.join(app, "Contents", "Resources", "icon.icns")
  };
}
var shQuote = (s) => `'${s.replace(/'/g, "'\\''")}'`;
function launchScript(node, openScript) {
  return `#!/bin/sh
exec ${shQuote(node)} ${shQuote(openScript)}
`;
}
function infoPlist() {
  const str = (k, v) => `  <key>${k}</key>
  <string>${v}</string>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    str("CFBundleName", "AI Chat Center"),
    str("CFBundleDisplayName", "AI Chat Center"),
    str("CFBundleIdentifier", BUNDLE_ID),
    str("CFBundleExecutable", EXECUTABLE),
    str("CFBundleIconFile", "icon"),
    str("CFBundlePackageType", "APPL"),
    str("CFBundleInfoDictionaryVersion", "6.0"),
    // The script gets no Dock icon of its own: the Chrome window it opens is what shows in the Dock.
    "  <key>LSUIElement</key>\n  <true/>",
    "</dict>",
    "</plist>",
    ""
  ].join("\n");
}
var OUR_DIRS = /* @__PURE__ */ new Set(["Contents", path11.join("Contents", "MacOS"), path11.join("Contents", "Resources")]);
var OUR_EXEC = path11.join("Contents", "MacOS", EXECUTABLE);
var OUR_ICON = path11.join("Contents", "Resources", "icon.icns");
function onlyOurFiles(app) {
  const walk = (rel) => {
    for (const e of fs10.readdirSync(path11.join(app, rel), { withFileTypes: true })) {
      const r = rel ? path11.join(rel, e.name) : e.name;
      if (e.isDirectory()) {
        if (!OUR_DIRS.has(r) || !walk(r)) return false;
      } else if (!e.isFile()) {
        return false;
      } else if (r === OUR_EXEC) {
        const st = fs10.statSync(path11.join(app, r));
        if (st.size > 64 * 1024 || !fs10.readFileSync(path11.join(app, r), "utf8").startsWith("#!/bin/sh\nexec ")) return false;
      } else if (r !== OUR_ICON) {
        return false;
      }
    }
    return true;
  };
  try {
    return fs10.lstatSync(app).isDirectory() && walk("");
  } catch {
    return false;
  }
}
function ownership(p) {
  if (!fs10.existsSync(p.app)) return "none";
  let plist;
  try {
    plist = fs10.readFileSync(p.plist, "utf8");
  } catch (e) {
    const missing = e.code === "ENOENT" && !lexists(p.plist);
    return missing && onlyOurFiles(p.app) ? "partial" : "foreign";
  }
  return /<key>CFBundleIdentifier<\/key>\s*<string>com\.ai-chat-center\.launcher<\/string>/.test(plist) ? "ours" : "foreign";
}
function lexists(f) {
  try {
    fs10.lstatSync(f);
    return true;
  } catch {
    return false;
  }
}
function installMacLauncher(o) {
  const p = macLauncherPaths(o.home);
  if (ownership(p) === "foreign") throw new Error(`launcher: ${p.app} exists and is not ours; left alone`);
  writeIfChanged(p.plist, Buffer.from(infoPlist(), "utf8"));
  writeIfChanged(p.exec, Buffer.from(launchScript(o.node, path11.join(o.distDir, "open.mjs")), "utf8"), 493);
  writeIfChanged(p.icon, pngToIcns(fs10.readFileSync(path11.join(o.distDir, "ui", "icons", "icon-512.png"))));
  return true;
}
function removeMacLauncher(home) {
  const p = macLauncherPaths(home);
  const owner = ownership(p);
  if (owner === "ours" || owner === "partial") fs10.rmSync(p.app, { recursive: true, force: true });
}

// src/hooks/launcherWin.ts
import { spawnSync } from "node:child_process";
import fs11 from "node:fs";
import path12 from "node:path";
function winLauncherPaths(env, home) {
  const roaming = env.APPDATA && path12.isAbsolute(env.APPDATA) ? env.APPDATA : path12.join(home, "AppData", "Roaming");
  const local = env.LOCALAPPDATA && path12.isAbsolute(env.LOCALAPPDATA) ? env.LOCALAPPDATA : path12.join(home, "AppData", "Local");
  const dir = path12.join(local, "ai-chat-center");
  return {
    shortcut: path12.join(roaming, "Microsoft", "Windows", "Start Menu", "Programs", "AI Chat Center.lnk"),
    dir,
    icon: path12.join(dir, "ai-chat-center.ico"),
    stamp: path12.join(dir, "launcher.json"),
    failStamp: path12.join(dir, "launcher-failed.json")
  };
}
var SHORTCUT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:ACC_LNK)",
  "$s.TargetPath = $env:ACC_TARGET",
  "$s.Arguments = $env:ACC_ARGS",
  "$s.WorkingDirectory = $env:ACC_WORKDIR",
  "$s.IconLocation = $env:ACC_ICON + ',0'",
  "$s.Description = $env:ACC_COMMENT",
  "$s.WindowStyle = 7",
  "$s.Save()"
].join("; ");
var RETRY_AFTER_FAILURE_MS = 24 * 36e5;
function lastFailure(file, stamp) {
  try {
    const f = JSON.parse(fs11.readFileSync(file, "utf8"));
    return f.stamp === stamp && typeof f.at === "number" ? f.at : null;
  } catch {
    return null;
  }
}
var defaultSpawn = (cmd, args, opts) => spawnSync(cmd, args, opts);
function powershell(env) {
  const root = env.SystemRoot ?? env.SYSTEMROOT;
  return root ? path12.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "powershell.exe";
}
function installWinLauncher(o) {
  const p = winLauncherPaths(o.env, o.home);
  writeIfChanged(p.icon, pngToIco(fs11.readFileSync(path12.join(o.distDir, "ui", "icons", "icon-256.png"))));
  const openScript = path12.join(o.distDir, "open.mjs");
  const stamp = JSON.stringify({ node: o.node, openScript, icon: p.icon, comment: o.comment });
  let same = false;
  try {
    same = fs11.existsSync(p.shortcut) && fs11.readFileSync(p.stamp, "utf8") === stamp;
  } catch {
  }
  if (same) return true;
  const now = (o.now ?? Date.now)();
  const failedAt = lastFailure(p.failStamp, stamp);
  if (failedAt !== null && now - failedAt >= 0 && now - failedAt < RETRY_AFTER_FAILURE_MS) {
    throw new Error(`launcher: Start menu shortcut skipped: PowerShell failed at ${new Date(failedAt).toISOString()}; next try 24 h later or when the plugin or Node path changes`);
  }
  fs11.mkdirSync(path12.dirname(p.shortcut), { recursive: true });
  const r = (o.spawn ?? defaultSpawn)(
    powershell(o.env),
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SHORTCUT_SCRIPT],
    {
      env: {
        ...o.env,
        ACC_LNK: p.shortcut,
        ACC_TARGET: o.node,
        ACC_ARGS: `"${openScript}"`,
        ACC_WORKDIR: o.distDir,
        ACC_ICON: p.icon,
        ACC_COMMENT: o.comment
      },
      shell: false,
      windowsHide: true,
      timeout: 1e4,
      stdio: "ignore"
    }
  );
  if (r.error || r.status !== 0) {
    writeIfChanged(p.failStamp, Buffer.from(JSON.stringify({ stamp, at: now }), "utf8"));
    throw new Error(`launcher: PowerShell could not create the Start menu shortcut (${r.error?.message ?? `exit ${r.status}`})`);
  }
  writeIfChanged(p.stamp, Buffer.from(stamp, "utf8"));
  fs11.rmSync(p.failStamp, { force: true });
  return true;
}
function removeWinLauncher(env, home) {
  const p = winLauncherPaths(env, home);
  for (const f of [p.shortcut, p.icon, p.stamp, p.failStamp]) fs11.rmSync(f, { force: true });
  try {
    fs11.rmdirSync(p.dir);
  } catch {
  }
}

// src/hooks/launcher.ts
var DESKTOP_ID = "ai-chat-center";
var APP_WM_CLASS = "chrome-127.0.0.1__-Default";
function launcherPaths(env = process.env, home = os5.homedir()) {
  const data = env.XDG_DATA_HOME && path13.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : path13.join(home, ".local", "share");
  return {
    desktopFile: path13.join(data, "applications", `${DESKTOP_ID}.desktop`),
    iconFile: path13.join(data, "icons", "hicolor", "512x512", "apps", `${DESKTOP_ID}.png`)
  };
}
function quoteExecArg(a) {
  return `"${a.replace(/[\\"`$]/g, (c) => `\\${c}`).replace(/%/g, "%%")}"`;
}
var value = (s) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/\r/g, "\\r");
function desktopEntry(o) {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.0",
    "Name=AI Chat Center",
    `Comment=${value(o.comment)}`,
    `Exec=${quoteExecArg(o.node)} ${quoteExecArg(o.openScript)}`,
    `Icon=${value(o.icon)}`,
    "Terminal=false",
    "Categories=Development;Utility;",
    `StartupWMClass=${APP_WM_CLASS}`,
    "StartupNotify=false",
    ""
  ].join("\n");
}
var defaultDist = () => path13.dirname(fileURLToPath3(import.meta.url));
var DEFAULT_COMMENT = "Follow and answer your Claude Code sessions";
function installLauncher(o = {}) {
  const platform = o.platform ?? process.platform;
  const env = o.env ?? process.env;
  const home = o.home ?? os5.homedir();
  const distDir = o.distDir ?? defaultDist();
  const node = o.node ?? process.execPath;
  const comment = o.comment ?? DEFAULT_COMMENT;
  if (platform === "win32") return installWinLauncher({ env, home, node, distDir, comment, ...o.spawn ? { spawn: o.spawn } : {}, ...o.now ? { now: o.now } : {} });
  if (platform === "darwin") return installMacLauncher({ home, node, distDir });
  if (platform !== "linux") return false;
  const p = launcherPaths(env, home);
  writeIfChanged(p.iconFile, fs12.readFileSync(path13.join(distDir, "ui", "icons", "icon-512.png")));
  const entry = desktopEntry({ node, openScript: path13.join(distDir, "open.mjs"), icon: p.iconFile, comment });
  writeIfChanged(p.desktopFile, Buffer.from(entry, "utf8"));
  return true;
}
function removeLauncher(o = {}) {
  const platform = o.platform ?? process.platform;
  const env = o.env ?? process.env;
  const home = o.home ?? os5.homedir();
  if (platform === "win32") return removeWinLauncher(env, home);
  if (platform === "darwin") return removeMacLauncher(home);
  if (platform !== "linux") return;
  const p = launcherPaths(env, home);
  for (const f of [p.desktopFile, p.iconFile]) fs12.rmSync(f, { force: true });
}

// src/hooks/hook.ts
var MAX_PREVIOUS_KEYS = 20;
var UNKNOWN_ARG = "AI Chat Center: unknown argument. Use /cc, /ai-chat-center:cc off, /ai-chat-center:cc answers on, /ai-chat-center:cc answers off, /ai-chat-center:cc window on, /ai-chat-center:cc window off, /ai-chat-center:cc usage on or /ai-chat-center:cc usage off.";
var WINDOW_ON = "AI Chat Center: opening the app in its own window is ON";
var WINDOW_OFF = "AI Chat Center: opening the app in its own window is OFF";
var USAGE_ON = "AI Chat Center: showing the 5-hour usage in the app is ON";
var USAGE_OFF = "AI Chat Center: showing the 5-hour usage in the app is OFF";
var USAGE_FAILED = "AI Chat Center: the status line could not be changed";
var ANSWERS_ON = "AI Chat Center: answering questions from the app is ON";
var ANSWERS_OFF = "AI Chat Center: answering questions from the app is OFF";
var CONNECTED = "AI Chat Center: connected";
var PID_UNKNOWN = "AI Chat Center: could not identify the Claude process; closing the terminal will be detected by the hub.";
var output = (context, systemMessage) => ({
  exitCode: 0,
  stdout: JSON.stringify({
    ...systemMessage ? { systemMessage } : {},
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context }
  })
});
async function tightenHome() {
  try {
    await ensureDir(paths().home);
    await fs13.promises.chmod(paths().home, DIR_MODE);
  } catch {
  }
}
async function connect(input, resolve, ctx) {
  const sid = input.session_id;
  const prev = await getRegistration(sid);
  const keep = prev && isActive(prev);
  await tightenHome();
  const pid = await resolve(sid) ?? (ctx.parentClaudePid ?? parentClaudePid)();
  const previousKeys = [...prev?.previousKeys ?? [], ...prev?.key && !keep ? [prev.key] : []].slice(-MAX_PREVIOUS_KEYS);
  const reg = await register({
    sessionId: sid,
    transcriptPath: input.transcript_path,
    cwd: input.cwd,
    pid,
    configDir: claudeConfigDir(),
    ...codeStamp(),
    // The key stays while the connection is active; a reactivation gets a new one.
    key: keep && prev.key ? prev.key : crypto5.randomBytes(16).toString("hex"),
    ...previousKeys.length ? { previousKeys } : {},
    // Re-running /cc on an active session keeps its original connectedAt.
    ...keep ? { connectedAt: prev.connectedAt } : {}
  });
  await setBusy(sid);
  await clearWaiting(sid);
  await clearTurnOrigin(sid);
  await fs13.promises.rm(paths().questionsDir(sid), { recursive: true, force: true });
  const { language, openWindow } = await loadConfig();
  await refreshStatusline(ctx);
  let status;
  let shown;
  const notices = [];
  const notice = (m) => {
    notices.push(m);
    logError(m);
  };
  try {
    const url = await ctx.ensureHub(notice);
    shown = t(language, "hook.ready", { url });
    status = CONNECTED;
    if (openWindow) {
      refreshLauncher(ctx, language);
      const opened = await openWindowQuietly(url, ctx, sid);
      if (opened === "tab" && (ctx.platform ?? process.platform) === "darwin") shown += `
${t(language, "hook.tabMacTip")}`;
    }
  } catch (e) {
    logError(e);
    const log = path14.join(paths().logDir, "hook.log");
    status = `AI Chat Center: the hub failed to start. See ${log}`;
    shown = t(language, "hook.hubFailed", { log });
  }
  const lines = [status, `AI Chat Center key: ${reg.key}`, ...notices];
  if (pid === null) lines.push(PID_UNKNOWN);
  return output(lines.join("\n"), [shown, ...notices].join("\n"));
}
async function usageCommand(on, ctx) {
  const { language } = await loadConfig();
  try {
    if (on) {
      const r2 = await (ctx.statusline?.install() ?? Promise.resolve("installed"));
      if (r2 === "failed") throw new Error("status line install failed");
      return output(USAGE_ON, t(language, "hook.usageOn"));
    }
    const r = await (ctx.statusline?.remove() ?? Promise.resolve("restored"));
    return output(USAGE_OFF, t(language, r === "changed-since" ? "hook.usageOffChanged" : "hook.usageOff"));
  } catch (e) {
    logError(e);
    const log = path14.join(paths().logDir, "hook.log");
    return output(`${USAGE_FAILED}. See ${log}`, t(language, "hook.usageFailed", { log }));
  }
}
async function refreshStatusline(ctx) {
  try {
    if (ctx.statusline && await readStatuslineState()) await ctx.statusline.refresh();
  } catch (e) {
    logError(e);
  }
}
function refreshLauncher(ctx, language) {
  try {
    return ctx.launcher?.install(t(language, "hook.launcherComment")) ?? false;
  } catch (e) {
    logError(e);
    return false;
  }
}
async function openWindowQuietly(url, ctx, sid) {
  try {
    return await launchAppWindow(url, {
      findBrowser: ctx.findBrowser ?? (() => findBrowser()),
      findDefaultOpener: ctx.findDefaultOpener ?? (() => findDefaultOpener()),
      ...ctx.fetch ? { fetch: ctx.fetch } : {},
      ...ctx.spawn ? { spawn: ctx.spawn } : {},
      onError: (msg) => logError(msg)
    }, sid);
  } catch (e) {
    logError(e instanceof Error ? e.message : String(e));
    return false;
  }
}
async function handleHook(event, input, ctx) {
  const nothing = { exitCode: 0 };
  const sid = input?.session_id;
  const resolve = ctx.resolvePid ?? ((id) => resolveClaudePid(id));
  try {
    assertSessionId(sid);
  } catch {
    return nothing;
  }
  if (event === "prompt-submit") {
    const cmd = isCcCommand(input.prompt);
    if (cmd === "unknown") return output(UNKNOWN_ARG, t((await loadConfig()).language, "hook.unknownArg"));
    let answersResult;
    if (cmd === "window-on" || cmd === "window-off") {
      const on = cmd === "window-on";
      const { language } = await saveConfig({ openWindow: on });
      const find = ctx.findBrowser ?? (() => findBrowser());
      const browser = on ? find() : null;
      const opener = on && browser === null ? (ctx.findDefaultOpener ?? (() => findDefaultOpener()))() : null;
      let note = "";
      if (on && browser === null) note = `
${t(language, opener ? "hook.windowDefaultBrowser" : "hook.windowNoBrowser")}`;
      if (on && (browser !== null || opener !== null) && refreshLauncher(ctx, language)) note += `
${t(language, "hook.windowLauncher")}`;
      if (!on) {
        try {
          ctx.launcher?.remove();
        } catch (e) {
          logError(e);
        }
      }
      answersResult = output(on ? WINDOW_ON : WINDOW_OFF, t(language, on ? "hook.windowOn" : "hook.windowOff") + note);
    }
    if (cmd === "answers-on" || cmd === "answers-off") {
      const on = cmd === "answers-on";
      const { language } = await saveConfig({ answersFromApp: on });
      answersResult = output(on ? ANSWERS_ON : ANSWERS_OFF, t(language, on ? "hook.answersOn" : "hook.answersOff"));
    }
    if (cmd === "usage-on" || cmd === "usage-off") answersResult = await usageCommand(cmd === "usage-on", ctx);
    if (cmd === "on") return connect(input, resolve, ctx);
    const reg = await getRegistration(sid);
    if (!reg) return answersResult ?? nothing;
    if (cmd === "off") await markDisconnected(sid, "off");
    else if (isActive(reg)) {
      if (!stampedByThisCode(reg)) await updateRegistration(sid, codeStamp(), { ifConnectedAt: reg.connectedAt });
      await clearWaiting(sid);
      await setBusy(sid);
      await setTurnOrigin(sid, promptOrigin(input.prompt, reg.key));
      const level = input.effort?.level;
      if (typeof level === "string") {
        try {
          await setEffort(sid, level);
        } catch (e) {
          logError(e);
        }
      }
      await recordMode(sid, input.permission_mode);
    }
    return answersResult ?? nothing;
  }
  if (event === "notification") {
    const reg = await getRegistration(sid);
    if (!reg || !isActive(reg)) return nothing;
    await recordMode(sid, input.permission_mode);
    const type = input.notification_type;
    if (type === "permission_prompt") await setWaiting(sid, "permission");
    else if (type === "elicitation_dialog" || type === "elicitation_url_dialog" || type === "agent_needs_input")
      await setWaiting(sid, "input");
  }
  return nothing;
}
async function recordMode(sid, mode) {
  if (typeof mode !== "string") return;
  try {
    await setMode(sid, mode);
  } catch (e) {
    logError(e);
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
    fs13.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    fs13.appendFileSync(
      path14.join(dir, "hook.log"),
      `${(/* @__PURE__ */ new Date()).toISOString()} ${e instanceof Error ? e.stack ?? e.message : String(e)}
`
    );
  } catch {
  }
}
var wrapperSource = () => path14.join(path14.dirname(fileURLToPath4(import.meta.url)), "statusline.mjs");
async function main() {
  let result = { exitCode: 0 };
  try {
    const event = process.argv[2];
    if (event !== "prompt-submit" && event !== "notification") return;
    const input = JSON.parse(await readStdin());
    result = await handleHook(event, input, {
      ensureHub: (notice) => ensureHub({ notice }),
      launcher: { install: (comment) => installLauncher({ comment }), remove: () => removeLauncher() },
      statusline: {
        install: () => installStatusline({ source: wrapperSource() }),
        remove: () => removeStatusline({}),
        refresh: () => refreshWrapper({ source: wrapperSource() })
      }
    });
  } catch (e) {
    logError(e);
  }
  if (result.stdout) process.stdout.write(result.stdout, () => process.exit(0));
  else process.exitCode = 0;
}

// src/bin/hook.ts
process.noDeprecation = true;
if (!await delegateToNewer("hook.mjs", import.meta.url)) void main();
