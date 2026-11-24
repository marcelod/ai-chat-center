import { createRequire as __acc_createRequire } from 'node:module';
const require = __acc_createRequire(import.meta.url);

// src/hub/main.ts
import fs12 from "node:fs/promises";
import fsSync from "node:fs";
import path10 from "node:path";
import crypto8 from "node:crypto";
import { fileURLToPath } from "node:url";

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
    metaFile: (sid) => (assertSessionId(sid), path.join(home, "meta", `${sid}.json`)),
    presenceFile: path.join(home, "app-presence.json"),
    logDir: path.join(home, "logs")
  };
}

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

// src/core/healthProof.ts
import crypto2 from "node:crypto";
var CHALLENGE_RE = /^[0-9a-f]{32}$/;
var newChallenge = () => crypto2.randomBytes(16).toString("hex");
function healthProof(token, challenge, port, pid, version) {
  return crypto2.createHmac("sha256", token).update(`${challenge}|${port}|${pid}|${version}`).digest("hex");
}
function proofMatches(token, challenge, port, answer) {
  const want = Buffer.from(healthProof(token, challenge, port, answer.pid, answer.version));
  const got = Buffer.from(String(answer.proof));
  return want.length === got.length && crypto2.timingSafeEqual(want, got);
}

// src/core/names.ts
var MAX_DISPLAY_NAME = 80;
function validDisplayName(v) {
  if (typeof v !== "string") return null;
  if (v === "") return "";
  if (v !== v.trim() || v.length > MAX_DISPLAY_NAME) return null;
  return v;
}
async function getDisplayName(sid) {
  const d = await readJson(paths().namesFile(sid));
  return d && typeof d.name === "string" && validDisplayName(d.name) ? d.name : null;
}
async function setDisplayName(sid, name) {
  const file = paths().namesFile(sid);
  if (name === "") await removeFile(file);
  else await writeJsonAtomic(file, { name });
}

// src/core/gitBranch.ts
import fs2 from "node:fs/promises";
import path3 from "node:path";
var HASH_RE = /^[0-9a-f]{40,64}$/i;
function parseHead(head) {
  const text = head.trim();
  const ref = /^ref:\s*(\S+)$/.exec(text)?.[1];
  if (ref) return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) || null : ref;
  return HASH_RE.test(text) ? text.slice(0, 7) : null;
}
async function readGitBranch(cwd) {
  try {
    if (typeof cwd !== "string" || !path3.isAbsolute(cwd)) return null;
    let dir = path3.resolve(cwd);
    for (; ; ) {
      const dotGit = path3.join(dir, ".git");
      let st;
      try {
        st = await fs2.stat(dotGit);
      } catch {
        st = null;
      }
      if (st) {
        let gitDir = dotGit;
        if (st.isFile()) {
          const target = /^gitdir:\s*(.+?)\s*$/m.exec(await fs2.readFile(dotGit, "utf8"))?.[1];
          if (!target) return null;
          gitDir = path3.resolve(dir, target);
        }
        return parseHead(await fs2.readFile(path3.join(gitDir, "HEAD"), "utf8"));
      }
      const parent = path3.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  } catch {
    return null;
  }
}

// src/core/meta.ts
var EFFORT_RE = /^[a-z]{1,16}$/;
async function getEffort(sid) {
  const d = await readJson(paths().metaFile(sid));
  return d && typeof d.effort === "string" && EFFORT_RE.test(d.effort) ? d.effort : null;
}
var MODEL_RE = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/;
function shortModel(id) {
  const m = MODEL_RE.exec(id);
  if (!m) return id;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

// src/hub/provider.ts
import fs10 from "node:fs/promises";
import path8 from "node:path";

// src/core/registry.ts
import fs7 from "node:fs/promises";
import os2 from "node:os";
import path6 from "node:path";

// src/core/inbox.ts
import fs5 from "node:fs/promises";
import path5 from "node:path";
import crypto5 from "node:crypto";

// src/core/secret.ts
import fs3 from "node:fs/promises";
import crypto3 from "node:crypto";
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
async function installSecret() {
  const have = await loadSecret({ tries: 5, delayMs: 40 });
  if (have.ok) return have.secret;
  if (have.reason === "unreadable") throw new Error("the install secret cannot be read right now");
  const file = paths().secret;
  await ensureDir(paths().home);
  const fresh = crypto3.randomBytes(32).toString("hex");
  if (have.reason === "missing") {
    try {
      await fs3.writeFile(file, fresh, { flag: "wx", mode: FILE_MODE });
      return fresh;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    for (let i = 0; i < 20; i++) {
      const s = await readOnce();
      if (s.ok) return s.secret;
      if (s.reason === "unreadable") throw new Error("the install secret cannot be read right now");
      await sleep(10);
    }
  }
  const tmp = `${file}.${crypto3.randomUUID()}.tmp`;
  await fs3.writeFile(tmp, fresh, { mode: FILE_MODE });
  await withFsRetry(() => fs3.rename(tmp, file));
  const after = await readOnce();
  return after.ok ? after.secret : fresh;
}
var mac = (secret, sid, m) => crypto3.createHmac("sha256", secret).update(`v2|${sid}|${m.id}|${m.createdAt}|${m.text}`).digest("hex");
var separatorFree = (m) => typeof m.id === "string" && typeof m.createdAt === "string" && !m.id.includes("|") && !m.createdAt.includes("|");
async function signMessage(sid, m) {
  if (!separatorFree(m) || sid.includes("|")) throw new Error("invalid message id or time");
  return { ...m, sig: mac(await installSecret(), sid, m) };
}

// src/core/lock.ts
import fs4 from "node:fs/promises";
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
var counter = 0;
var isRace = (e) => ["ENOENT", "EPERM", "EBUSY"].includes(e.code ?? "");
async function enqueue(sid, text) {
  const dir = paths().inboxDir(sid);
  await ensureDir(dir);
  const now = Date.now();
  const msg = await signMessage(sid, { id: crypto5.randomUUID(), text, createdAt: new Date(now).toISOString() });
  counter = (counter + 1) % 1e6;
  const name = `${String(now).padStart(15, "0")}-${String(counter).padStart(6, "0")}-${msg.id}.msg`;
  const tmp = path5.join(dir, `.${msg.id}.tmp`);
  try {
    await fs5.writeFile(tmp, JSON.stringify(msg), { encoding: "utf8", mode: FILE_MODE });
    await withFsRetry(() => fs5.rename(tmp, path5.join(dir, name)));
  } catch (e) {
    await fs5.rm(tmp, { force: true });
    throw e;
  }
  return msg;
}
async function list(sid) {
  const dir = paths().inboxDir(sid);
  try {
    return (await fs5.readdir(dir)).filter((n) => n.endsWith(".msg")).sort().map((n) => path5.join(dir, n));
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}
async function readMsg(file) {
  try {
    return JSON.parse(await fs5.readFile(file, "utf8"));
  } catch (e) {
    if (isRace(e)) return null;
    if (e instanceof SyntaxError) return null;
    throw e;
  }
}
async function peek(sid) {
  const out = [];
  for (const f of await list(sid)) {
    const m = await readMsg(f);
    if (m) out.push(m);
  }
  return out;
}
var CLAIM_MARK = ".claim";
var UNSIGNED = ".unsigned";
async function countUnsigned(sid) {
  try {
    return (await fs5.readdir(paths().inboxDir(sid))).filter((n) => n.endsWith(`.msg${UNSIGNED}`)).length;
  } catch {
    return 0;
  }
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
async function getWaiting(sid) {
  return readJson(paths().waitingFile(sid));
}

// src/core/delivered.ts
async function clearDelivered(sid) {
  await removeFile(paths().deliveredFile(sid));
}

// src/core/version.ts
var VERSION = "0.4.4";
var PROTOCOL = 2;

// src/core/registry.ts
var SESSION_LOCK_WAIT_MS = 2e3;
var locked = (sid, fn) => withLock(paths().sessionLock(sid), SESSION_LOCK_WAIT_MS, fn);
function regFile(sid) {
  assertSessionId(sid);
  return path6.join(paths().sessionsDir, `${sid}.json`);
}
var isActive = (r) => !r.disconnectedAt;
var isRemoved = (r) => !!r.removedAt;
function claudeConfigDir() {
  const raw = process.env.CLAUDE_CONFIG_DIR;
  return path6.resolve(raw && raw.trim() ? raw : path6.join(os2.homedir(), ".claude"));
}
function sameConfigDir(r, mine = claudeConfigDir()) {
  if (!r.configDir) return true;
  const a = path6.resolve(r.configDir);
  return process.platform === "win32" ? a.toLowerCase() === mine.toLowerCase() : a === mine;
}
var trustedKeys = (r) => [...r.previousKeys ?? [], ...r.key ? [r.key] : []];
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
async function markRemoved(sid) {
  const done = await locked(sid, async () => {
    const r = await getRegistration(sid);
    if (!r) return false;
    const at = (/* @__PURE__ */ new Date()).toISOString();
    const next = isActive(r) ? { ...r, disconnectedAt: at, disconnectReason: "removed" } : { ...r };
    next.removedAt = r.removedAt ?? at;
    await writeJsonAtomic(regFile(sid), next);
    return true;
  });
  if (!done) return false;
  await clearInbox(sid);
  await clearBusy(sid);
  return true;
}
async function pruneRegistrations(maxAgeMs, now = Date.now()) {
  const pruned = [];
  for (const r of await listRegistrations()) {
    if (isActive(r)) continue;
    const at = Date.parse(r.disconnectedAt ?? "");
    if (Number.isNaN(at) || now - at <= maxAgeMs) continue;
    const sid = r.sessionId;
    try {
      assertSessionId(sid);
    } catch {
      continue;
    }
    await locked(sid, async () => {
      const cur = await getRegistration(sid);
      if (!cur || isActive(cur) || cur.disconnectedAt !== r.disconnectedAt) return;
      await removeFile(regFile(sid));
      pruned.push(sid);
    });
    if (!pruned.includes(sid)) continue;
    await clearInbox(sid);
    await fs7.rm(paths().inboxDir(sid), { recursive: true, force: true }).catch(() => {
    });
    await clearBusy(sid);
    await clearWaiting(sid);
    await clearDelivered(sid);
  }
  return pruned;
}

// src/core/questions.ts
import fs8 from "node:fs/promises";
import path7 from "node:path";
var TOOL_USE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
function assertToolUseId(id) {
  if (typeof id !== "string" || !TOOL_USE_ID_RE.test(id)) {
    throw new Error(`Invalid tool use id: ${JSON.stringify(id)}`);
  }
}
var isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var nonEmpty = (v) => typeof v === "string" && v.length > 0;
function parseQuestions(input) {
  if (!isObj(input) || !Array.isArray(input.questions)) return null;
  const raw = input.questions;
  if (raw.length < 1 || raw.length > 4) return null;
  const out = [];
  for (const q of raw) {
    if (!isObj(q) || !nonEmpty(q.question) || !Array.isArray(q.options)) return null;
    if (q.options.length < 2 || q.options.length > 4) return null;
    const options = [];
    for (const o of q.options) {
      if (!isObj(o) || !nonEmpty(o.label)) return null;
      options.push(typeof o.description === "string" ? { label: o.label, description: o.description } : { label: o.label });
    }
    const question = { question: q.question, options };
    if (typeof q.header === "string") question.header = q.header;
    if (typeof q.multiSelect === "boolean") question.multiSelect = q.multiSelect;
    out.push(question);
  }
  return out;
}
var pendingFile = (sid, id) => (assertToolUseId(id), path7.join(paths().questionsDir(sid), `${id}.json`));
var answerFile = (sid, id) => (assertToolUseId(id), path7.join(paths().questionsDir(sid), `${id}.answer.json`));
async function getPending(sid) {
  let names;
  try {
    names = await fs8.readdir(paths().questionsDir(sid));
  } catch {
    return null;
  }
  let best = null;
  for (const n of names) {
    if (!n.endsWith(".json") || n.endsWith(".answer.json")) continue;
    const p = await readJson(path7.join(paths().questionsDir(sid), n));
    if (p && typeof p.pid === "number" && !isAlive(p.pid)) {
      if (typeof p.toolUseId === "string" && `${p.toolUseId}.json` === n) await removePending(sid, p.toolUseId);
      else await removeFile(path7.join(paths().questionsDir(sid), n));
      continue;
    }
    if (p && typeof p.createdAt === "string" && (!best || p.createdAt > best.createdAt)) best = p;
  }
  return best;
}
async function removePending(sid, toolUseId) {
  await removeFile(pendingFile(sid, toolUseId));
  await removeFile(answerFile(sid, toolUseId));
}
async function writeAnswer(sid, toolUseId, a) {
  if (await readJson(pendingFile(sid, toolUseId)) === null) return "not-found";
  await ensureDir(paths().questionsDir(sid));
  try {
    await fs8.writeFile(answerFile(sid, toolUseId), JSON.stringify(a, null, 2), { encoding: "utf8", flag: "wx", mode: FILE_MODE });
    return "ok";
  } catch (e) {
    if (e.code === "EEXIST") return "conflict";
    throw e;
  }
}
function validAnswers(questions, answers) {
  if (!isObj(answers)) return null;
  const keys = Object.keys(answers);
  const want = questions.map((q) => q.question);
  if (keys.length !== want.length || !want.every((k) => Object.hasOwn(answers, k))) return null;
  const out = {};
  for (const k of want) {
    const v = answers[k];
    if (typeof v !== "string" || v.length < 1 || v.length > 2e3 || v !== v.trim()) return null;
    out[k] = v;
  }
  return out;
}

// src/hub/transcript/reader.ts
import { open } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";

// src/core/protocol.ts
var unescapeBody = (t) => t.replace(/\[(\\*)\\\/AI Chat Center message\]/g, "[$1/AI Chat Center message]");
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
  return "unknown";
}

// src/hub/transcript/parse.ts
var RESULT_MAX = 2e3;
var QUEUED_DEDUP_MS = 30 * 6e4;
var INTERRUPTED = "[Request interrupted by user";
var tag = (content, name) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(content)?.[1];
var SUMMARY_MAX = 120;
var truncate = (s, max) => s.length > max ? s.slice(0, max) : s;
var WRAPPER_TAGS = /<\/?(?:pasted_content|teammate-message)(?:\s+[\w-]+="[^"]*")*\s*>/g;
var unwrapPrompt = (text) => text.replace(WRAPPER_TAGS, "");
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function summarize(name, input) {
  if (!isRecord(input)) return "";
  let value;
  if (name === "Bash") value = input.command;
  else if (name === "Read" || name === "Edit" || name === "Write") value = input.file_path;
  else value = Object.values(input).find((v) => typeof v === "string");
  return typeof value === "string" ? truncate(value, SUMMARY_MAX) : "";
}
function resultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b) => isRecord(b) && typeof b.text === "string" ? b.text : "").filter(Boolean).join("\n");
  }
  return "";
}
function promptParts(prompt) {
  if (typeof prompt === "string") return { text: prompt, images: 0 };
  if (!Array.isArray(prompt)) return { text: "", images: 0 };
  const texts = [];
  let images = 0;
  for (const b of prompt) {
    if (!isRecord(b)) continue;
    if (b.type === "text" && typeof b.text === "string") texts.push(b.text);
    else if (b.type === "image") images++;
  }
  return { text: texts.join("\n"), images };
}
function snapshot(ev) {
  return { ...ev, items: ev.items.map((i) => ({ ...i })) };
}
function withIndex(events, uuid) {
  if (events.length > 1) events.forEach((e, i) => e.id = `${uuid}#${i}`);
  return events;
}
var TranscriptParser = class {
  /** @param keys trusted marker keys of the session; when given, other app-message blocks are ignored. */
  constructor(keys) {
    this.keys = keys;
  }
  keys;
  open = null;
  byToolUse = /* @__PURE__ */ new Map();
  questions = /* @__PURE__ */ new Map();
  /** Queued prompts already shown, to skip a later identical user entry. */
  queued = [];
  /** The last `!` command, for the output entry that follows it. */
  lastShell = null;
  /** `message.model` of the latest main-thread assistant entry (synthetic ones ignored). */
  model;
  /** Returns new or updated events (same id = replace). */
  push(entry) {
    if (!isRecord(entry)) return [];
    const uuid = entry.uuid;
    const ts = entry.timestamp;
    if (typeof uuid !== "string" || typeof ts !== "string") return [];
    if (entry.isSidechain === true) return [];
    if (entry.type === "attachment") return this.attachment(uuid, ts, entry.attachment);
    const message = isRecord(entry.message) ? entry.message : void 0;
    if (!message) return [];
    if (entry.type === "assistant") {
      const model = message.model;
      if (typeof model === "string" && model && model !== "<synthetic>") this.model = model;
      return this.assistant(uuid, ts, message.content);
    }
    if (entry.type === "user" && entry.isMeta !== true) {
      if (entry.isCompactSummary === true) return [{ kind: "notice", id: uuid, ts, code: "compacted" }];
      return this.user(uuid, ts, message.content, entry.toolUseResult);
    }
    return [];
  }
  /** A prompt the user typed while Claude was busy is recorded only as a queued_command attachment. */
  attachment(uuid, ts, a) {
    if (!isRecord(a) || a.type !== "queued_command" || a.commandMode !== "prompt") return [];
    if (a.isMeta === true || a.humanTurn !== true) return [];
    const parts = promptParts(a.prompt);
    const text = unwrapPrompt(parts.text);
    const images = parts.images;
    const pasted = Array.isArray(a.imagePasteIds) ? a.imagePasteIds.length : 0;
    if (!text.trim() && !images && !pasted) return [];
    this.open = null;
    this.queued.push({ text: text.trim(), at: Date.parse(ts) || 0 });
    const n = Math.max(images, pasted);
    return [{ kind: "user", id: uuid, ts, text, origin: "terminal", ...n ? { images: n } : {} }];
  }
  takeQueued(text, ts) {
    const at = Date.parse(ts) || 0;
    this.queued = this.queued.filter((q) => at - q.at <= QUEUED_DEDUP_MS);
    const want = text.trim();
    const i = this.queued.findIndex((q) => q.text === want);
    if (i < 0) return false;
    this.queued.splice(i, 1);
    return true;
  }
  assistant(uuid, ts, content) {
    if (!Array.isArray(content)) return [];
    const created = [];
    const updated = [];
    let assistantEv;
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === "text" && typeof block.text === "string") {
        if (!block.text.trim()) continue;
        this.open = null;
        if (assistantEv) assistantEv.text += block.text;
        else {
          assistantEv = { kind: "assistant", id: uuid, ts, text: block.text };
          created.push(assistantEv);
        }
      } else if (block.type === "tool_use" && typeof block.id === "string") {
        const name = typeof block.name === "string" ? block.name : "";
        const questions = name === "AskUserQuestion" ? parseQuestions(block.input) : null;
        if (questions) {
          this.open = null;
          const q = { kind: "question", id: uuid, ts, toolUseId: block.id, questions };
          this.questions.set(block.id, q);
          created.push(q);
          continue;
        }
        const action = { toolUseId: block.id, name, summary: summarize(name, block.input) };
        if (!this.open) {
          this.open = { kind: "actions", id: uuid, ts, items: [] };
          created.push(this.open);
        } else if (!created.includes(this.open) && !updated.includes(this.open)) {
          updated.push(this.open);
        }
        this.open.items.push(action);
        this.byToolUse.set(block.id, this.open);
      }
    }
    if (created.length > 1) created.forEach((e, i) => e.id = `${uuid}#${i}`);
    return [...updated, ...created].map((e) => e.kind === "actions" ? snapshot(e) : e);
  }
  user(uuid, ts, content, toolUseResult) {
    if (Array.isArray(content)) {
      const out = this.toolResults(content, toolUseResult);
      const parts = promptParts(content);
      const text2 = unwrapPrompt(parts.text);
      const images = parts.images;
      if ((text2.trim() || images) && !text2.startsWith(INTERRUPTED) && !this.takeQueued(text2, ts)) {
        this.open = null;
        out.push({ kind: "user", id: uuid, ts, text: text2, origin: "terminal", ...images ? { images } : {} });
      }
      return out;
    }
    if (typeof content !== "string") return [];
    const msgs = unwrapMessages(content, this.keys);
    if (msgs.length > 0) {
      this.open = null;
      return withIndex(
        msgs.map((m) => ({
          kind: "user",
          id: uuid,
          ts,
          text: m.text,
          origin: "app",
          appMessageId: m.id
        })),
        uuid
      );
    }
    const cmd = /<command-name>\s*(\/[^<\s]+)\s*<\/command-name>/.exec(content)?.[1];
    if (cmd) {
      const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(content)?.[1]?.trim();
      const cc = isCcCommand(args ? `${cmd} ${args}` : cmd);
      if (cc === "on" || cc === "off") return [{ kind: "notice", id: uuid, ts, code: cc === "on" ? "connected" : "disconnected" }];
      if (cc === "unknown" || cc === "answers-on" || cc === "answers-off" || cc === "window-on" || cc === "window-off") return [];
    }
    const shellIn = tag(content, "bash-input");
    if (shellIn !== void 0) {
      this.open = null;
      this.lastShell = shellIn;
      return [{ kind: "user", id: uuid, ts, text: shellIn, origin: "terminal", shell: true }];
    }
    const stdout = tag(content, "bash-stdout");
    const stderr = tag(content, "bash-stderr");
    if (stdout !== void 0 || stderr !== void 0) {
      const err = (stderr ?? "").trim();
      const result = [stdout ?? "", stderr ?? ""].filter((x) => x.trim()).join("\n");
      const item = { toolUseId: uuid, name: "Shell", summary: truncate(this.lastShell ?? "", SUMMARY_MAX), result: truncate(result, RESULT_MAX) };
      if (err) item.isError = true;
      this.lastShell = null;
      this.open = null;
      return [{ kind: "actions", id: uuid, ts, items: [item] }];
    }
    const t = content.trimStart();
    if (t.startsWith("<command-") || t.startsWith("<local-command-") || t.startsWith("<task-notification>") || t.startsWith("<system-reminder>") || // A teammate's or subagent's message (agent teams, SendMessage): Claude Code stores it as a user
    // entry, but nobody typed it.
    t.startsWith("Another Claude session sent a message:")) {
      return [];
    }
    const text = unwrapPrompt(content);
    if (!text.trim()) return [];
    if (this.takeQueued(text, ts)) return [];
    this.open = null;
    return [{ kind: "user", id: uuid, ts, text, origin: "terminal" }];
  }
  toolResults(blocks, toolUseResult) {
    const out = /* @__PURE__ */ new Map();
    for (const block of blocks) {
      if (!isRecord(block) || block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
      const q = this.questions.get(block.tool_use_id);
      if (q) {
        const a = isRecord(toolUseResult) && isRecord(toolUseResult.answers) ? toolUseResult.answers : void 0;
        const values = a ? Object.values(a) : [];
        if (block.is_error === true) {
          q.error = true;
          q.answerText = truncate(resultText(block.content), RESULT_MAX);
        } else if (a && values.length > 0 && values.every((v) => typeof v === "string")) q.answers = { ...a };
        else q.answerText = truncate(resultText(block.content), RESULT_MAX);
        this.questions.delete(block.tool_use_id);
        out.set(q.id, { ...q });
        continue;
      }
      const ev = this.byToolUse.get(block.tool_use_id);
      const item = ev?.items.find((i) => i.toolUseId === block.tool_use_id);
      if (!ev || !item) continue;
      item.result = truncate(resultText(block.content), RESULT_MAX);
      if (block.is_error === true) item.isError = true;
      this.byToolUse.delete(block.tool_use_id);
      out.set(ev.id, snapshot(ev));
    }
    return [...out.values()];
  }
};

// src/hub/transcript/reader.ts
var CHUNK = 64 * 1024;
var TranscriptReader = class {
  constructor(path11, keys) {
    this.path = path11;
    this.keys = keys;
    this.parser = new TranscriptParser(keys);
  }
  path;
  keys;
  offset = 0;
  /** Pieces of the current incomplete line (joined only once its newline arrives: linear time). */
  partial = [];
  decoder = new StringDecoder("utf8");
  parser;
  events = /* @__PURE__ */ new Map();
  // insertion order = first appearance
  chain = Promise.resolve();
  /** Number of non-empty lines that were not valid JSON. */
  skipped = 0;
  /** Events produced since the last call (updated events keep their id). */
  readNew() {
    const run = this.chain.then(() => this.doRead());
    this.chain = run.catch(() => void 0);
    return run;
  }
  /** Consolidated list: first-appearance order, latest version of each id. */
  all() {
    return [...this.events.values()];
  }
  /** Raw model id of the latest assistant reply, if any. */
  model() {
    return this.parser.model;
  }
  reset() {
    this.offset = 0;
    this.partial = [];
    this.decoder = new StringDecoder("utf8");
    this.parser = new TranscriptParser(this.keys);
    this.events.clear();
  }
  async doRead() {
    let handle;
    try {
      handle = await open(this.path, "r");
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
    const out = /* @__PURE__ */ new Map();
    try {
      const { size } = await handle.stat();
      if (size < this.offset) this.reset();
      const buf = Buffer.allocUnsafe(CHUNK);
      while (this.offset < size) {
        const { bytesRead } = await handle.read(buf, 0, Math.min(CHUNK, size - this.offset), this.offset);
        if (bytesRead === 0) break;
        this.offset += bytesRead;
        const text = this.decoder.write(buf.subarray(0, bytesRead));
        let start = 0;
        for (let nl = text.indexOf("\n"); nl !== -1; nl = text.indexOf("\n", start)) {
          this.partial.push(text.slice(start, nl));
          const raw = this.partial.join("");
          this.partial = [];
          this.consume(raw, out);
          start = nl + 1;
        }
        if (start < text.length) this.partial.push(text.slice(start));
      }
    } finally {
      await handle.close();
    }
    return [...out.values()];
  }
  consume(raw, out) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!line.trim()) return;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      this.skipped++;
      return;
    }
    for (const ev of this.parser.push(entry)) {
      this.events.set(ev.id, ev);
      out.delete(ev.id);
      out.set(ev.id, ev);
    }
  }
};

// src/core/claudeAgents.ts
import { execFile } from "node:child_process";
import os3 from "node:os";
function runClaudeAgentsJson(platform = process.platform) {
  const win = platform === "win32";
  return new Promise((resolve, reject) => {
    execFile(
      win ? "claude agents --json" : "claude",
      win ? [] : ["agents", "--json"],
      { cwd: os3.homedir(), shell: win, windowsHide: true, timeout: 5e3, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => err ? reject(err) : resolve(String(stdout))
    );
  });
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

// src/hooks/parentClaude.ts
import fs9 from "node:fs";
import { execFileSync } from "node:child_process";
function isClaudeArgv(argv) {
  const base = (s) => s.split(/[\\/]/).pop() ?? "";
  if (/^claude(\.exe)?$/i.test(base(argv[0] ?? ""))) return true;
  return /^node(\.exe)?$/i.test(base(argv[0] ?? "")) && /[\\/]@anthropic-ai[\\/]claude-code[\\/]/.test(argv[1] ?? "");
}
function readProcessArgv(pid, platform) {
  try {
    if (platform === "linux") {
      return fs9.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
    }
    const out = execFileSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf8", timeout: 2e3, stdio: ["ignore", "pipe", "ignore"] });
    return out.trim().split(/\s+/).filter(Boolean);
  } catch {
    return null;
  }
}
function createClaudeProcessCheck(platform = process.platform, readArgv = (p) => readProcessArgv(p, platform), now = Date.now, ttlMs = 1e4) {
  const cache = /* @__PURE__ */ new Map();
  return (pid) => {
    if (!Number.isInteger(pid) || pid <= 1 || platform === "win32") return false;
    const t = now();
    const hit = cache.get(pid);
    if (hit && t - hit.at < ttlMs) return hit.ok;
    const argv = readArgv(pid);
    const ok = argv !== null && isClaudeArgv(argv);
    if (cache.size > 256) cache.clear();
    cache.set(pid, { at: t, ok });
    return ok;
  };
}

// src/hub/provider.ts
var SessionDisconnectedError = class extends Error {
  constructor(sessionId) {
    super(`Session ${sessionId} is disconnected`);
    this.sessionId = sessionId;
    this.name = "SessionDisconnectedError";
  }
  sessionId;
};
var SessionProtocolError = class extends Error {
  constructor(sessionId, direction) {
    super(`Session ${sessionId} runs a ${direction} version of AI Chat Center`);
    this.sessionId = sessionId;
    this.direction = direction;
    this.name = "SessionProtocolError";
  }
  sessionId;
  direction;
};
var LIVE_TTL_MS = 5e3;
var LIVE_IDLE_TTL_MS = 3e4;
var STALE_BUSY_MS = 1e4;
var GRACE_MS = 15e3;
var WAITER_HEARTBEAT_STALE_MS = 3e4;
var STALLED_AFTER_MS = 15e3;
var TRANSCRIPT_MISSING_AFTER_MS = 15e3;
var MISSES_TO_EXIT = 3;
var ClaudeCodeProvider = class {
  constructor(listLive = queryLiveSessions, opts = {}) {
    this.listLive = listLive;
    this.now = opts.now ?? Date.now;
    this.alive = opts.isAlive ?? createClaudeProcessCheck();
  }
  listLive;
  readers = /* @__PURE__ */ new Map();
  // active sessions only
  pending = /* @__PURE__ */ new Map();
  // read but not yet emitted by poll
  lastEvents = /* @__PURE__ */ new Map();
  // disconnected sessions
  lastModels = /* @__PURE__ */ new Map();
  // disconnected sessions
  misses = /* @__PURE__ */ new Map();
  liveCache = null;
  lastGood = null;
  lastSignature = null;
  now;
  alive;
  async live(force = false, ttl = LIVE_TTL_MS) {
    const t = this.now();
    if (!force && this.liveCache && t >= this.liveCache.at && t - this.liveCache.at < ttl) {
      return { list: this.liveCache.value, ok: true, fresh: false };
    }
    const value = await this.listLive();
    if (value === null) return { list: this.lastGood ?? [], ok: false, fresh: false };
    this.liveCache = { at: t, value };
    this.lastGood = value;
    return { list: value, ok: true, fresh: true };
  }
  /** Cached reader of an active session; replaced when its transcript (resume) or keys change. */
  entry(reg) {
    const sid = reg.sessionId;
    const keys = trustedKeys(reg);
    let e = this.readers.get(sid);
    if (e && (e.reader.path !== reg.transcriptPath || (e.reader.keys ?? []).join() !== keys.join())) {
      this.readers.delete(sid);
      this.pending.delete(sid);
      e = void 0;
    }
    if (!e) {
      e = { reader: new TranscriptReader(reg.transcriptPath, keys), read: false };
      this.readers.set(sid, e);
    }
    return e;
  }
  /** Read new events, buffering them for the next poll so no consumer steals them. */
  async refresh(sid, e) {
    const evs = await e.reader.readNew();
    e.read = true;
    if (evs.length) this.pending.set(sid, [...this.pending.get(sid) ?? [], ...evs]);
  }
  async lastEventOf(reg) {
    const sid = reg.sessionId;
    if (this.lastEvents.has(sid)) return this.lastEvents.get(sid);
    const existing = this.readers.get(sid);
    if (existing) {
      await this.refresh(sid, existing);
      return existing.reader.all().at(-1);
    }
    const tmp = new TranscriptReader(reg.transcriptPath, trustedKeys(reg));
    await tmp.readNew();
    const last = tmp.all().at(-1);
    this.lastEvents.set(sid, last);
    this.lastModels.set(sid, tmp.model());
    return last;
  }
  shouldMarkExited(reg, live) {
    const { sessionId: sid, connectedAt } = reg;
    if (!sameConfigDir(reg)) return false;
    let m = this.misses.get(sid);
    if (!m || m.connectedAt !== connectedAt) {
      m = { connectedAt, count: 0 };
      this.misses.set(sid, m);
    }
    if (!live.ok) return false;
    if (reg.pid !== null && this.alive(reg.pid) && !live.list.some((l) => l.pid === reg.pid)) {
      m.count = 0;
      return false;
    }
    if (live.fresh) m.count++;
    const age = this.now() - (Date.parse(connectedAt) || 0);
    return m.count >= MISSES_TO_EXIT && age > GRACE_MS;
  }
  /**
   * Messages have waited a while for an idle session and no waiter holds a fresh lock: nothing will
   * deliver them until the next turn (a waiter that hit its 24 h budget, or one that died). The app then
   * tells the user to send any prompt in the terminal.
   */
  async deliveryStalled(sid, queued) {
    const oldest = Math.min(...queued.map((m) => Date.parse(m.createdAt)).filter((n) => !Number.isNaN(n)));
    if (!Number.isFinite(oldest) || this.now() - oldest < STALLED_AFTER_MS) return false;
    try {
      return this.now() - (await fs10.stat(paths().waiterLock(sid))).mtimeMs > WAITER_HEARTBEAT_STALE_MS;
    } catch {
      return true;
    }
  }
  /**
   * The session's transcript does not exist some time after it connected: Claude Code is not writing it
   * (a claude started from a terminal that inherited another session's CLAUDE_CODE_* variables runs as a
   * child session and keeps no transcript). Messages are still delivered, but the app sees neither them nor
   * the replies, so it says why instead of showing them as not delivered.
   */
  async transcriptMissing(transcriptPath, connectedAt) {
    if (this.now() - (Date.parse(connectedAt) || 0) < TRANSCRIPT_MISSING_AFTER_MS) return false;
    try {
      await fs10.stat(transcriptPath);
      return false;
    } catch (err) {
      return err.code === "ENOENT";
    }
  }
  async dropStaleBusy(sid) {
    const age = await busyAge(sid, this.now());
    if (age !== null && age > STALE_BUSY_MS) await clearBusy(sid);
  }
  /**
   * Exit detection on its own, for the hub's background check (no browser needed). Same rules as
   * listSessions: a failed lookup marks nothing; a session is marked exited only after the grace period
   * and 3 fresh lookups in a row that do not list it. Always a fresh lookup (it runs every few minutes).
   * Returns the sessions marked exited.
   */
  async detectExits() {
    const live = await this.live(true);
    if (!live.ok) return [];
    const listed = new Set(live.list.map((l) => l.sessionId));
    const gone = [];
    for (const reg of await listRegistrations()) {
      const sid = reg.sessionId;
      if (!isActive(reg)) continue;
      if (listed.has(sid)) {
        this.misses.delete(sid);
      } else if (this.shouldMarkExited(reg, live)) {
        await markDisconnected(sid, "exited");
        this.misses.delete(sid);
        gone.push(sid);
      }
    }
    return gone;
  }
  /** The lookup age to accept now: short while anything may change soon, long when all is idle (see LIVE_IDLE_TTL_MS). */
  async liveTtl(regs) {
    const last = this.liveCache?.value;
    if (!last) return LIVE_TTL_MS;
    const byId = new Map(last.map((l) => [l.sessionId, l]));
    for (const reg of regs) {
      if (!isActive(reg)) continue;
      const sid = reg.sessionId;
      const l = byId.get(sid);
      if ((Date.parse(reg.connectedAt) || 0) > this.liveCache.at) return LIVE_TTL_MS;
      if (l) {
        if (l.status !== "idle" || reg.pid !== null && !this.alive(reg.pid)) return LIVE_TTL_MS;
      } else if (sameConfigDir(reg) && !(reg.pid !== null && this.alive(reg.pid) && !last.some((x) => x.pid === reg.pid))) {
        return LIVE_TTL_MS;
      }
      if (await busyAge(sid, this.now()) !== null || await getWaiting(sid) || await getPending(sid)) return LIVE_TTL_MS;
    }
    return LIVE_IDLE_TTL_MS;
  }
  async listSessions() {
    const regs = await listRegistrations();
    const live = await this.live(false, await this.liveTtl(regs));
    const liveById = new Map(live.list.map((l) => [l.sessionId, l]));
    const connected = [];
    const activeIds = /* @__PURE__ */ new Set();
    for (const reg of regs) {
      if (isRemoved(reg)) continue;
      const sid = reg.sessionId;
      const l = liveById.get(sid);
      let disconnected = !isActive(reg);
      if (!disconnected) {
        if (l) this.misses.delete(sid);
        else if (this.shouldMarkExited(reg, live)) {
          await markDisconnected(sid, "exited");
          this.misses.delete(sid);
          disconnected = true;
        }
      }
      if (!disconnected) activeIds.add(sid);
      let lastEvent;
      let rawModel;
      if (disconnected) {
        lastEvent = await this.lastEventOf(reg);
        rawModel = this.lastModels.get(sid) ?? this.readers.get(sid)?.reader.model();
      } else {
        const e = this.entry(reg);
        if (!e.read) await this.refresh(sid, e);
        lastEvent = e.reader.all().at(-1);
        rawModel = e.reader.model();
      }
      const waiting = disconnected ? null : await getWaiting(sid);
      const pendingQuestion = disconnected ? null : await getPending(sid);
      let state;
      let waitingKind;
      if (disconnected) state = "disconnected";
      else if (live.ok && l) {
        state = l.status === "busy" && !await isBusy(sid) ? "idle" : l.status;
        if (l.status === "waiting") waitingKind = waiting?.kind ?? "permission";
      } else if (waiting) {
        state = "waiting";
        waitingKind = waiting.kind;
      } else state = l?.status ?? "idle";
      if (pendingQuestion) {
        state = "waiting";
        waitingKind = "question";
      }
      if (!disconnected && live.ok && l?.status === "idle") await this.dropStaleBusy(sid);
      const cwd = l?.cwd ?? reg.cwd;
      const queued = disconnected ? [] : await peek(sid);
      const originalName = l?.name || path8.basename(cwd);
      const custom = await getDisplayName(sid);
      const view = {
        sessionId: sid,
        name: custom ?? originalName,
        cwd,
        state,
        pendingAppMessageIds: queued.map((m) => m.id),
        pendingAppMessages: queued.map(({ id, text, createdAt }) => ({ id, text, createdAt })),
        _sort: Date.parse(reg.connectedAt) || 0
      };
      if (custom) view.originalName = originalName;
      if (waitingKind) view.waitingKind = waitingKind;
      if (pendingQuestion) view.pendingQuestion = pendingQuestion;
      if (state === "idle" && await this.deliveryStalled(sid, queued)) view.deliveryStalled = true;
      if (!disconnected && await this.transcriptMissing(reg.transcriptPath, reg.connectedAt)) view.transcriptMissing = true;
      const unsigned = disconnected ? 0 : await countUnsigned(sid);
      if (unsigned > 0) view.undeliveredUnsigned = unsigned;
      if (lastEvent) view.lastEvent = lastEvent;
      const branch = await readGitBranch(cwd);
      if (branch) view.branch = branch;
      if (rawModel) view.model = shortModel(rawModel);
      const effort = await getEffort(sid);
      if (effort) view.effort = effort;
      connected.push(view);
    }
    connected.sort((a, b) => {
      const ta = a.lastEvent ? Date.parse(a.lastEvent.ts) : NaN;
      const tb = b.lastEvent ? Date.parse(b.lastEvent.ts) : NaN;
      const ha = !Number.isNaN(ta);
      const hb = !Number.isNaN(tb);
      if (ha && hb) return tb - ta;
      if (ha) return -1;
      if (hb) return 1;
      return b._sort - a._sort;
    });
    const others = live.list.filter((l) => l.kind === "interactive" && !activeIds.has(l.sessionId));
    return { connected: connected.map(({ _sort, ...v }) => v), others };
  }
  async events(sid) {
    const reg = await getRegistration(sid);
    if (!reg) return [];
    if (!isActive(reg)) {
      const tmp = new TranscriptReader(reg.transcriptPath, trustedKeys(reg));
      await tmp.readNew();
      return tmp.all();
    }
    const e = this.entry(reg);
    await this.refresh(sid, e);
    return e.reader.all();
  }
  async poll() {
    const changes = [];
    const regs = await listRegistrations();
    const known = new Set(regs.map((r) => r.sessionId));
    for (const reg of regs) {
      const sid = reg.sessionId;
      if (isActive(reg)) {
        await this.refresh(sid, this.entry(reg));
      } else if (this.readers.has(sid)) {
        const e = this.readers.get(sid);
        await this.refresh(sid, e);
        this.lastEvents.set(sid, e.reader.all().at(-1));
        this.lastModels.set(sid, e.reader.model());
        this.readers.delete(sid);
      } else {
        this.pending.delete(sid);
        continue;
      }
      const events = this.pending.get(sid);
      this.pending.delete(sid);
      if (events?.length) changes.push({ type: "events", sessionId: sid, events });
    }
    for (const m of [this.readers, this.pending, this.lastEvents, this.lastModels, this.misses]) {
      for (const sid of [...m.keys()]) if (!known.has(sid)) m.delete(sid);
    }
    const { connected, others } = await this.listSessions();
    const signature = JSON.stringify({
      others,
      connected: connected.map((s) => [
        s.sessionId,
        s.state,
        s.waitingKind ?? null,
        s.pendingQuestion?.toolUseId ?? null,
        s.name,
        s.originalName ?? null,
        s.lastEvent?.id ?? null,
        s.pendingAppMessageIds,
        s.deliveryStalled ?? false,
        s.transcriptMissing ?? false,
        s.undeliveredUnsigned ?? 0,
        s.branch ?? null,
        s.model ?? null,
        s.effort ?? null
      ])
    });
    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      changes.push({ type: "sessions" });
    }
    return changes;
  }
  async send(sid, text) {
    const reg = await getRegistration(sid);
    if (!reg || !isActive(reg)) throw new SessionDisconnectedError(sid);
    if (reg.protocol !== PROTOCOL) {
      throw new SessionProtocolError(sid, typeof reg.protocol === "number" && reg.protocol > PROTOCOL ? "newer" : "older");
    }
    const msg = await enqueue(sid, text);
    const again = await getRegistration(sid);
    if (!again || !isActive(again)) {
      const dir = paths().inboxDir(sid);
      try {
        for (const n of await fs10.readdir(dir)) if (n.endsWith(`-${msg.id}.msg`)) await fs10.rm(path8.join(dir, n), { force: true });
      } catch {
      }
      throw new SessionDisconnectedError(sid);
    }
    return { id: msg.id };
  }
};

// src/hub/server.ts
import http from "node:http";
import fs11 from "node:fs/promises";
import path9 from "node:path";
import crypto7 from "node:crypto";

// src/core/config.ts
var LANGS = ["en", "pt-BR"];
async function loadConfig() {
  const c = await readJson(paths().config);
  const language = LANGS.includes(c?.language) ? c.language : "en";
  return { language, answersFromApp: c?.answersFromApp === true, openWindow: c?.openWindow === true };
}
async function saveConfig(patch) {
  const next = { ...await loadConfig(), ...patch };
  await writeJsonAtomic(paths().config, next);
  return next;
}

// src/core/presence.ts
async function writePresence(clients) {
  await writeJsonAtomic(paths().presenceFile, { clients, pid: process.pid, at: Date.now() });
}

// src/hub/pairing.ts
import crypto6 from "node:crypto";
var PAIR_TTL_MS = 6e4;
var MAX_PENDING = 5;
var CODE_RE = /^[0-9a-f]{64}$/;
function createPairing(now = Date.now) {
  const pending = /* @__PURE__ */ new Map();
  const prune2 = () => {
    const t = now();
    for (const [c, exp] of pending) if (exp <= t) pending.delete(c);
  };
  return {
    issue() {
      prune2();
      while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value);
      const code2 = crypto6.randomBytes(32).toString("hex");
      pending.set(code2, now() + PAIR_TTL_MS);
      return code2;
    },
    redeem(code2) {
      prune2();
      if (typeof code2 !== "string" || !CODE_RE.test(code2)) return false;
      const given = Buffer.from(code2);
      let match = null;
      for (const c of pending.keys()) {
        if (crypto6.timingSafeEqual(given, Buffer.from(c))) match = c;
      }
      if (match === null) return false;
      pending.delete(match);
      return true;
    }
  };
}

// src/hub/server.ts
var MAX_BODY = 64 * 1024;
var MAX_TEXT = 32e3;
var HEARTBEAT_MS = 15e3;
var WINDOW_FRESH_MS = 15e4;
var MAX_WINDOWS = 20;
var WINDOW_ID_RE = /^[0-9a-f]{32}$/;
var LANGS2 = ["en", "pt-BR"];
var CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'";
var MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8"
};
var FALLBACK_PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>AI Chat Center</title></head><body><h1>UI not built</h1><p>Run the build to generate the web UI.</p></body></html>';
var HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
  status;
};
function tokenOk(given, expected) {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto7.timingSafeEqual(a, b);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > MAX_BODY) {
      req.resume();
      return reject(new HttpError(413, "body too large"));
    }
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on("data", (c) => {
      if (tooBig) return;
      size += c.length;
      if (size > MAX_BODY) {
        tooBig = true;
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => tooBig ? reject(new HttpError(413, "body too large")) : resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
async function readJsonBody(req) {
  const ct = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (ct !== "application/json") {
    req.resume();
    throw new HttpError(415, "content-type must be application/json");
  }
  const raw = await readBody(req);
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}
async function createHub(opts) {
  const { provider, token, staticDir } = opts;
  const pollMs = opts.pollMs ?? 500;
  const log = opts.log ?? (() => {
  });
  let port = opts.port;
  const pairing = createPairing();
  const now = opts.now ?? Date.now;
  const windows = /* @__PURE__ */ new Map();
  let focus = null;
  const liveWindows = () => {
    const t = now();
    for (const [id, at] of windows) if (t - at >= WINDOW_FRESH_MS) windows.delete(id);
    return windows.size;
  };
  const clients = /* @__PURE__ */ new Set();
  let pollTimer = null;
  let heartbeat = null;
  let closed = false;
  const publishPresence = () => {
    writePresence(clients.size).catch((e) => log(`presence write failed: ${e.message}`));
  };
  const fanOut = (c) => {
    const frame = `event: ${c.type}
data: ${JSON.stringify(c)}

`;
    for (const r of clients) r.write(frame);
  };
  let pollGen = 0;
  let inFlight = null;
  const POLL_TIMEOUT_MS = 1e4;
  const schedulePoll = (gen) => {
    pollTimer = setTimeout(async () => {
      if (gen !== pollGen) return;
      while (inFlight) {
        await inFlight;
        if (gen !== pollGen) return;
      }
      let changes = [];
      let timer;
      try {
        const real = Promise.resolve().then(() => provider.poll());
        const tracked = real.then(
          () => {
          },
          () => {
          }
        ).finally(() => {
          if (inFlight === tracked) inFlight = null;
        });
        inFlight = tracked;
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), POLL_TIMEOUT_MS);
        });
        const r = await Promise.race([real, timeout]);
        if (r === null) log("poll timed out");
        else changes = r;
      } catch (e) {
        log(`poll failed: ${e.message}`);
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (gen !== pollGen) return;
      for (const c of changes) fanOut(c);
      if (clients.size > 0 && !closed) schedulePoll(gen);
      else pollTimer = null;
    }, pollMs);
  };
  const startTimers = () => {
    if (pollTimer || heartbeat) return;
    schedulePoll(++pollGen);
    heartbeat = setInterval(() => {
      for (const r of clients) r.write(": heartbeat\n\n");
      publishPresence();
    }, HEARTBEAT_MS);
  };
  const stopTimers = () => {
    pollGen++;
    if (pollTimer) clearTimeout(pollTimer);
    if (heartbeat) clearInterval(heartbeat);
    pollTimer = heartbeat = null;
  };
  const sendJson = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  };
  const serveStatic = async (req, res, pathname) => {
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 404, { error: "not found" });
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return sendJson(res, 404, { error: "not found" });
    }
    if (rel.includes("\0")) return sendJson(res, 404, { error: "not found" });
    const root = path9.resolve(staticDir);
    const target = path9.resolve(root, "." + path9.sep + rel);
    if (target !== root && !target.startsWith(root + path9.sep)) return sendJson(res, 404, { error: "not found" });
    const send = async (file) => {
      try {
        const st = await fs11.stat(file);
        if (!st.isFile()) return false;
        const data = await fs11.readFile(file);
        const ext = path9.extname(file).toLowerCase();
        const type = MIME[ext] ?? "application/octet-stream";
        const headers = { "Content-Type": type, "Content-Length": data.length };
        if (ext === ".html") headers["Content-Security-Policy"] = CSP;
        res.writeHead(200, headers);
        res.end(req.method === "HEAD" ? void 0 : data);
        return true;
      } catch {
        return false;
      }
    };
    let rootExists = true;
    try {
      rootExists = (await fs11.stat(root)).isDirectory();
    } catch {
      rootExists = false;
    }
    const accepts = String(req.headers.accept ?? "").includes("text/html");
    const spaEligible = req.method === "GET" && accepts && path9.extname(pathname) === "";
    const isRoot = pathname === "/";
    if (!rootExists) {
      if (isRoot || spaEligible) {
        res.writeHead(200, { "Content-Type": MIME[".html"], "Content-Security-Policy": CSP });
        return void res.end(FALLBACK_PAGE);
      }
      return sendJson(res, 404, { error: "not found" });
    }
    if (target !== root && await send(target)) return;
    if (isRoot || spaEligible) {
      if (await send(path9.join(root, "index.html"))) return;
    }
    sendJson(res, 404, { error: "not found" });
  };
  const handleApi = async (req, res, url) => {
    const p = url.pathname;
    const method = req.method ?? "GET";
    if (p === "/api/health" && method === "GET") {
      const challenge = url.searchParams.get("challenge");
      if (challenge === null) return sendJson(res, 200, { ok: true, version: VERSION });
      if (!CHALLENGE_RE.test(challenge)) throw new HttpError(400, "invalid challenge");
      const proof = healthProof(token, challenge, port, process.pid, VERSION);
      return sendJson(res, 200, { ok: true, version: VERSION, pid: process.pid, proof });
    }
    if (p === "/api/pair" && method === "POST") {
      const body = await readJsonBody(req);
      const code2 = body && typeof body === "object" && !Array.isArray(body) ? body.code : void 0;
      if (typeof code2 !== "string" || !pairing.redeem(code2)) throw new HttpError(400, "invalid code");
      return sendJson(res, 200, { token });
    }
    const bearer = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ""))?.[1];
    const given = p === "/api/stream" ? bearer ?? url.searchParams.get("token") : bearer;
    if (!tokenOk(given, token)) return sendJson(res, 401, { error: "unauthorized" });
    if (p === "/api/stream" && method === "GET") {
      res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
      res.write("retry: 3000\n\n");
      clients.add(res);
      startTimers();
      publishPresence();
      res.on("close", () => {
        clients.delete(res);
        if (!closed) publishPresence();
        if (clients.size === 0) stopTimers();
      });
      return;
    }
    if (p === "/api/pair-code" && method === "POST") {
      const json = String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json");
      const body = json ? await readJsonBody(req) : (req.resume(), null);
      const sid = body && typeof body === "object" && !Array.isArray(body) ? body.sessionId : void 0;
      if (liveWindows() > 0) {
        if (typeof sid === "string") {
          try {
            assertSessionId(sid);
            focus = { seq: (focus?.seq ?? 0) + 1, sessionId: sid };
            for (const r of clients) r.write("event: focus\ndata: {}\n\n");
          } catch {
          }
        }
        return sendJson(res, 200, { live: true });
      }
      return sendJson(res, 200, { code: pairing.issue() });
    }
    if (p === "/api/window" && method === "POST") {
      const body = await readJsonBody(req);
      const id = body && typeof body === "object" && !Array.isArray(body) ? body.id : void 0;
      if (typeof id !== "string" || !WINDOW_ID_RE.test(id)) throw new HttpError(400, "invalid window id");
      windows.delete(id);
      if (body.closing !== true) {
        liveWindows();
        while (windows.size >= MAX_WINDOWS) windows.delete(windows.keys().next().value);
        windows.set(id, now());
      }
      return sendJson(res, 200, { focus });
    }
    if (p === "/api/sessions" && method === "GET") return sendJson(res, 200, await provider.listSessions());
    if (p === "/api/config" && method === "GET") return sendJson(res, 200, await loadConfig());
    if (p === "/api/config" && method === "PUT") {
      const body = await readJsonBody(req);
      if (!body || typeof body !== "object" || !LANGS2.includes(body.language)) throw new HttpError(400, "invalid language");
      await saveConfig({ language: body.language });
      return sendJson(res, 200, { language: body.language });
    }
    const m = /^\/api\/sessions\/([^/]+)\/(events|messages|name|remove|questions\/([^/]+))$/.exec(p);
    if (m) {
      let sid;
      try {
        sid = decodeURIComponent(m[1]);
      } catch {
        throw new HttpError(404, "not found");
      }
      try {
        assertSessionId(sid);
      } catch {
        throw new HttpError(404, "not found");
      }
      if (m[3] !== void 0 && method === "POST") {
        let toolUseId;
        try {
          toolUseId = decodeURIComponent(m[3]);
          assertToolUseId(toolUseId);
        } catch {
          req.resume();
          throw new HttpError(400, "invalid tool use id");
        }
        if (!(await loadConfig()).answersFromApp) {
          req.resume();
          throw new HttpError(403, "answers from the app are off");
        }
        const body = await readJsonBody(req);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "invalid body");
        const hasRelease = Object.hasOwn(body, "release");
        const hasAnswers = Object.hasOwn(body, "answers");
        if (hasRelease === hasAnswers) throw new HttpError(400, "invalid body");
        const reg = await getRegistration(sid);
        if (!reg || !isActive(reg)) throw new HttpError(404, "no such pending question");
        const pending = await getPending(sid);
        let answer;
        if (hasRelease) {
          if (body.release !== true) throw new HttpError(400, "invalid body");
          if (!pending || pending.toolUseId !== toolUseId) throw new HttpError(404, "no such pending question");
          answer = { release: true };
        } else {
          if (!pending || pending.toolUseId !== toolUseId) throw new HttpError(404, "no such pending question");
          const answers = validAnswers(pending.questions, body.answers);
          if (!answers) throw new HttpError(400, "invalid answers");
          answer = { answers };
        }
        const r = await writeAnswer(sid, toolUseId, answer);
        if (r === "not-found") throw new HttpError(404, "no such pending question");
        if (r === "conflict") throw new HttpError(409, "already answered");
        return sendJson(res, 202, { ok: true });
      }
      if (m[2] === "name" && method === "PUT") {
        const body = await readJsonBody(req);
        const name = body && typeof body === "object" && !Array.isArray(body) ? validDisplayName(body.name) : null;
        if (name === null) throw new HttpError(400, "invalid name");
        const reg = await getRegistration(sid);
        if (!reg) throw new HttpError(404, "no such session");
        await setDisplayName(sid, name);
        let shown = name;
        if (!shown) shown = (await provider.listSessions()).connected.find((s) => s.sessionId === sid)?.name ?? path9.basename(reg.cwd);
        return sendJson(res, 200, { name: shown });
      }
      if (m[2] === "remove" && method === "POST") {
        req.resume();
        if (!await markRemoved(sid)) throw new HttpError(404, "no such session");
        fanOut({ type: "sessions" });
        return sendJson(res, 200, { ok: true });
      }
      if (m[2] === "events" && method === "GET") return sendJson(res, 200, await provider.events(sid));
      if (m[2] === "messages" && method === "POST") {
        const body = await readJsonBody(req);
        const text = body && typeof body === "object" ? body.text : void 0;
        if (typeof text !== "string" || text.trim() === "" || text.length > MAX_TEXT) throw new HttpError(400, "invalid text");
        const { id } = await provider.send(sid, text);
        return sendJson(res, 202, { id });
      }
    }
    sendJson(res, 404, { error: "not found" });
  };
  const server = http.createServer(async (req, res) => {
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    const allowedOrigins = allowedHosts.map((h) => `http://${h}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    try {
      const rawUrl = req.url ?? "";
      let url;
      try {
        if (!rawUrl.startsWith("/")) throw new Error("bad url");
        url = new URL(rawUrl, `http://127.0.0.1:${port}`);
      } catch {
        return sendJson(res, 400, { error: "bad request" });
      }
      const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/");
      if (isApi) res.setHeader("Cache-Control", "no-store");
      const origin = req.headers.origin;
      if (!allowedHosts.includes(String(req.headers.host ?? "")) || origin !== void 0 && !allowedOrigins.includes(origin)) {
        return sendJson(res, 403, { error: "forbidden" });
      }
      if (isApi) await handleApi(req, res, url);
      else await serveStatic(req, res, url.pathname);
    } catch (e) {
      if (res.headersSent) return void res.end();
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
      if (e instanceof SessionDisconnectedError) return sendJson(res, 409, { error: "session disconnected", code: "session-disconnected" });
      if (e instanceof SessionProtocolError) {
        return sendJson(res, 409, { error: `session runs ${e.direction === "older" ? "an older" : "a newer"} version`, code: `session-${e.direction}-version` });
      }
      log(`request failed: ${e.stack ?? e.message}`.split(token).join("[redacted]"));
      sendJson(res, 500, { error: "internal error" });
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  port = server.address().port;
  server.on("error", (e) => log(`server error: ${e.code ?? ""} ${e.message}`));
  return {
    url: `http://127.0.0.1:${port}`,
    clients: () => clients.size,
    windows: () => liveWindows(),
    server,
    close: () => new Promise((resolve) => {
      closed = true;
      stopTimers();
      for (const r of clients) r.end();
      clients.clear();
      writePresence(0).catch(() => {
      }).finally(() => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    })
  };
}

// src/hub/main.ts
var TOKEN_RE = /^[0-9a-f]{64}$/;
var PRUNE_AGE_MS = 30 * 864e5;
var PRUNE_EVERY_MS = 10 * 6e4;
var IDLE_EXIT_MS = 2 * 36e5;
var EXIT_CHECK_MS = 5 * 6e4;
var UNKNOWN_PID_HOLD_MS = 24 * 36e5;
async function holdsHub(r, now = Date.now()) {
  if (!isActive(r)) return false;
  if (r.pid !== null) return isAlive(r.pid);
  let last = Date.parse(r.connectedAt) || 0;
  try {
    last = Math.max(last, (await fs12.stat(r.transcriptPath)).mtimeMs);
  } catch {
  }
  return now - last < UNKNOWN_PID_HOLD_MS;
}
async function prune(log) {
  try {
    const gone = await pruneRegistrations(PRUNE_AGE_MS);
    if (gone.length) log(`pruned ${gone.length} old registration(s)`);
  } catch (e) {
    log(`prune failed: ${e.message}`);
  }
}
async function rotateToken() {
  const file = paths().token;
  await ensureDir(path10.dirname(file));
  const t = crypto8.randomBytes(32).toString("hex");
  await writeFileAtomic600(file, t);
  await fs12.chmod(file, 384).catch(() => {
  });
  return t;
}
async function writeFileAtomic600(file, data) {
  const tmp = `${file}.${process.pid}.${crypto8.randomUUID()}.tmp`;
  try {
    await fs12.writeFile(tmp, data, { mode: 384 });
    await withFsRetry(() => fs12.rename(tmp, file));
  } catch (e) {
    await fs12.rm(tmp, { force: true });
    throw e;
  }
}
async function liveHubExists(self) {
  const info = await readJson(paths().hubJson);
  if (!info || typeof info.port !== "number") return false;
  if (self && info.port === self.port) return false;
  let token;
  try {
    token = (await fs12.readFile(paths().token, "utf8")).trim();
  } catch {
    return false;
  }
  if (!TOKEN_RE.test(token)) return false;
  const challenge = newChallenge();
  try {
    const r = await fetch(`http://127.0.0.1:${info.port}/api/health?challenge=${challenge}`, { signal: AbortSignal.timeout(1e3) });
    if (!r.ok) return false;
    const j = await r.json();
    return j.ok === true && typeof j.pid === "number" && typeof j.version === "string" && typeof j.proof === "string" && proofMatches(token, challenge, info.port, { pid: j.pid, version: j.version, proof: j.proof });
  } catch {
    return false;
  }
}
function pickPort() {
  const raw = process.env.AI_CHAT_CENTER_PORT;
  if (raw === void 0 || raw === "") return 7777;
  const n = Number(raw);
  if (n === 0 && raw.trim() === "0") return 0;
  return Number.isInteger(n) && n >= 1 && n <= 65525 ? n : 7777;
}
async function acquireHubLock(lock) {
  const deadline = Date.now() + 5e3;
  for (; ; ) {
    if (await acquireLock(lock)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
}
async function startHub(opts = {}) {
  const logDir = paths().logDir;
  await ensureDir(logDir);
  const logFile = path10.join(logDir, "hub.log");
  let secret = "";
  const log = (msg) => {
    try {
      const line = secret ? msg.split(secret).join("[redacted]") : msg;
      fsSync.appendFileSync(logFile, `${(/* @__PURE__ */ new Date()).toISOString()} ${line}
`);
    } catch {
    }
  };
  const deferred = (when) => {
    log(`another live hub answers on the port in hub.json (${when}): not starting (pid ${process.pid})`);
    return null;
  };
  if (await liveHubExists()) return deferred("before the lock");
  const lock = path10.join(paths().home, "hub.lock");
  const locked2 = await acquireHubLock(lock);
  let hub;
  try {
    if (await liveHubExists()) return deferred("under the lock");
    const token = await rotateToken();
    secret = token;
    const base = pickPort();
    const tries = base === 0 ? 1 : 11;
    const staticDir = path10.join(path10.dirname(fileURLToPath(import.meta.url)), "ui");
    const provider = opts.listLive ? new ClaudeCodeProvider(opts.listLive) : new ClaudeCodeProvider();
    let lastErr;
    for (let i = 0; i < tries && !hub; i++) {
      try {
        hub = await createHub({ provider, token, port: base + i, staticDir, log });
      } catch (e) {
        lastErr = e;
        if (e.code !== "EADDRINUSE") throw e;
      }
    }
    if (!hub) throw lastErr;
    const port = Number(new URL(hub.url).port);
    if (await liveHubExists({ port })) {
      await hub.close();
      return deferred(`after binding port ${port}`);
    }
    try {
      await installSecret();
    } catch (e) {
      log(`the install secret could not be prepared: ${e.message}`);
    }
    await writeJsonAtomic(paths().hubJson, { pid: process.pid, port });
    log(`hub listening on ${hub.url}`);
    await prune(log);
    const pruneTimer = setInterval(() => void prune(log), PRUNE_EVERY_MS);
    let exitCheckRunning = false;
    const exitTimer = setInterval(async () => {
      if (exitCheckRunning) return;
      exitCheckRunning = true;
      try {
        const gone = await provider.detectExits();
        if (gone.length) log(`marked ${gone.length} exited session(s)`);
      } catch (e) {
        log(`exit check failed: ${e.message}`);
      } finally {
        exitCheckRunning = false;
      }
    }, opts.exitCheckMs ?? EXIT_CHECK_MS);
    const started = hub;
    const idleMs = opts.idleMs ?? IDLE_EXIT_MS;
    let lastUsed = Date.now();
    let idleFired = false;
    const idleTimer = setInterval(async () => {
      try {
        let held = started.clients() > 0 || (started.windows?.() ?? 0) > 0;
        for (const r of held ? [] : await listRegistrations()) if (held = await holdsHub(r)) break;
        if (held) {
          lastUsed = Date.now();
          return;
        }
      } catch {
        lastUsed = Date.now();
        return;
      }
      if (!idleFired && Date.now() - lastUsed >= idleMs) {
        idleFired = true;
        log(`idle for ${Math.round(idleMs / 6e4)} min with no browser and no connected session: exiting`);
        opts.onIdle?.();
      }
    }, opts.idleCheckMs ?? 6e4);
    let replacedFired = false;
    let ownChecking = false;
    const ownTimer = setInterval(async () => {
      if (replacedFired || ownChecking) return;
      ownChecking = true;
      let cur;
      try {
        cur = await readJson(paths().hubJson);
      } finally {
        ownChecking = false;
      }
      if (replacedFired) return;
      if (cur?.pid === process.pid && cur?.port === port) return;
      if (!cur && fsSync.existsSync(paths().hubJson)) return;
      replacedFired = true;
      log(cur ? `hub.json now names pid ${cur.pid} port ${cur.port}: exiting` : "hub.json is gone: exiting");
      opts.onReplaced?.();
    }, opts.ownershipCheckMs ?? 6e4);
    let done = false;
    return {
      port,
      close: async () => {
        if (done) return;
        done = true;
        clearInterval(pruneTimer);
        clearInterval(exitTimer);
        clearInterval(idleTimer);
        clearInterval(ownTimer);
        await started.close();
        const cur = await readJson(paths().hubJson);
        if (cur?.pid === process.pid && cur?.port === port) await fs12.rm(paths().hubJson, { force: true });
        log("hub stopped");
      }
    };
  } finally {
    if (locked2) await releaseLock(lock);
  }
}
async function main() {
  let hub = null;
  const stop = () => void (hub ? hub.close() : Promise.resolve()).finally(() => process.exit(0));
  hub = await startHub({ onIdle: stop, onReplaced: stop });
  if (!hub) process.exit(0);
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

// src/bin/hub.ts
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
