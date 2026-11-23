import { createRequire as __acc_createRequire } from 'node:module';
const require = __acc_createRequire(import.meta.url);

// src/hooks/hook.ts
import fs6 from "node:fs";
import path8 from "node:path";
import crypto5 from "node:crypto";

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

// src/core/registry.ts
import os2 from "node:os";
import path5 from "node:path";

// src/core/inbox.ts
import fs3 from "node:fs/promises";
import path4 from "node:path";

// src/core/lock.ts
import fs2 from "node:fs/promises";
import path3 from "node:path";
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
    await fs2.writeFile(tmp, content, { flag: "wx" });
    await fs2.link(tmp, file);
    return content;
  } catch (e) {
    if (["EEXIST", "EPERM", "EBUSY"].includes(code(e) ?? "")) return null;
    throw e;
  } finally {
    await fs2.rm(tmp, { force: true });
  }
}
async function staleContent(file) {
  let content;
  let mtimeMs;
  try {
    content = await fs2.readFile(file, "utf8");
  } catch (e) {
    if (code(e) === "ENOENT") return null;
    content = "";
  }
  try {
    mtimeMs = (await fs2.stat(file)).mtimeMs;
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
      const st = await fs2.stat(guard);
      if (Date.now() - st.mtimeMs > GUARD_STALE_MS) await fs2.rm(guard, { force: true });
    } catch {
    }
    return null;
  }
  try {
    if (await staleContent(file) !== seen) return null;
    try {
      await fs2.unlink(file);
    } catch (e) {
      if (code(e) !== "ENOENT") {
        if (contention(e)) return null;
        throw e;
      }
    }
    return await publish(file);
  } finally {
    try {
      if (lockPid(await fs2.readFile(guard, "utf8")) === process.pid) await fs2.rm(guard, { force: true });
    } catch {
    }
  }
}
async function acquireLock(file) {
  return await acquireLockContent(file) !== null;
}
async function acquireLockContent(file) {
  await ensureDir(path3.dirname(file));
  const mine = await publish(file);
  if (mine !== null) return mine;
  const seen = await staleContent(file);
  if (seen === null) return null;
  return reclaim(file, seen);
}
async function releaseLock(file) {
  try {
    if (lockPid(await fs2.readFile(file, "utf8")) !== process.pid) return;
  } catch {
    return;
  }
  await fs2.rm(file, { force: true });
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
    names = await fs3.readdir(dir);
  } catch (e) {
    if (e.code === "ENOENT") return;
    throw e;
  }
  for (const n of names) {
    if (!n.endsWith(".msg") && !n.endsWith(".tmp") && !n.includes(".msg.claimed-") && !n.endsWith(`.msg${CLAIM_MARK}`) && !n.endsWith(`.msg${UNSIGNED}`)) continue;
    try {
      await withFsRetry(() => fs3.rm(path4.join(dir, n), { force: true }));
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

// src/core/version.ts
var VERSION = "0.4.0";
var PROTOCOL = 2;

// src/core/registry.ts
var SESSION_LOCK_WAIT_MS = 2e3;
var locked = (sid, fn) => withLock(paths().sessionLock(sid), SESSION_LOCK_WAIT_MS, fn);
function regFile(sid) {
  assertSessionId(sid);
  return path5.join(paths().sessionsDir, `${sid}.json`);
}
var isActive = (r) => !r.disconnectedAt;
function claudeConfigDir() {
  const raw = process.env.CLAUDE_CONFIG_DIR;
  return path5.resolve(raw && raw.trim() ? raw : path5.join(os2.homedir(), ".claude"));
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
import fs4 from "node:fs";
import http from "node:http";
import os3 from "node:os";
import path6 from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

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
  const hubPath = path6.join(path6.dirname(fileURLToPath(import.meta.url)), "hub.mjs");
  spawn(process.execPath, [hubPath], hubSpawnOptions()).unref();
}
function readHub() {
  try {
    const { port, pid } = JSON.parse(fs4.readFileSync(paths().hubJson, "utf8"));
    const token = fs4.readFileSync(paths().token, "utf8").trim();
    if (typeof port !== "number" || !token) return null;
    return { port, token, pid: typeof pid === "number" ? pid : null };
  } catch {
    return null;
  }
}
var urlOf = (h) => `http://127.0.0.1:${h.port}/#token=${h.token}`;
function compareVersions(a, b) {
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
      if (!(compareVersions(r.version, VERSION) < 0)) return urlOf(hub);
      if (hub.pid !== null && r.pid === hub.pid) await stop(hub.pid);
      else unverified(r.version);
    } else if ((r === "unproven" || r === "foreign") && hub.pid !== null && isAlive2(hub.pid)) {
      const challengedPid = r === "foreign" ? foreignPid : void 0;
      const id = await identify(hub.port);
      if (id && compareVersions(id.version, VERSION) < 0) {
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
    if (h && compareVersions(h.version, VERSION) >= 0) return urlOf(cur);
  }
  throw new Error("AI Chat Center hub did not start in time");
}

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

// src/core/locales/en.json
var en_default = {
  hook: {
    ready: "AI Chat Center is ready: {url}",
    hubFailed: "AI Chat Center: the hub failed to start. See {log}",
    unknownArg: "AI Chat Center: unknown argument. Use /cc, /ai-chat-center:cc off, /ai-chat-center:cc answers on, /ai-chat-center:cc answers off, /ai-chat-center:cc window on or /ai-chat-center:cc window off.",
    answersOn: "AI Chat Center: you can now answer multiple-choice questions from the app, including confirmations. To turn off: /ai-chat-center:cc answers off",
    answersOff: "AI Chat Center: multiple-choice questions are answered only in the terminal again.",
    windowOn: "AI Chat Center: the app will open in its own window when you connect. To turn off: /ai-chat-center:cc window off",
    windowOff: "AI Chat Center: the app will no longer open in its own window.",
    windowNoBrowser: "No Chrome, Chromium or Edge found: the link is still shown."
  },
  ui: {
    rename: {
      label: "Rename session",
      failed: "Couldn't rename"
    },
    title: "AI Chat Center",
    collapseList: "Collapse list",
    expandList: "Expand list",
    search: "Search by name or folder",
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
    theme: { label: "Theme", system: "System", light: "Light", dark: "Dark" },
    language: "Language",
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
      enableHint: "To answer here, type /ai-chat-center:cc answers on in the terminal"
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
      loading: "Loading messages\u2026",
      waitingBanner: "Claude is waiting for you to approve an action in the terminal",
      waitingInputBanner: "Claude is waiting for your answer in the terminal",
      waitingBannerHint: "Approving from the app comes in a later version.",
      deliveryStalled: "Messages are waiting, but delivery to this session is paused: send any prompt in the terminal to resume delivery.",
      undeliveredUnsigned: "A message from an older version of AI Chat Center was not delivered. Send it again from here.",
      messages: "Messages",
      image: "[image]",
      images: "[{n} images]",
      compacted: "Conversation compacted \xB7 {time}"
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
      retry: "Retry"
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
    unknownArg: "AI Chat Center: argumento desconhecido. Use /cc, /ai-chat-center:cc off, /ai-chat-center:cc answers on, /ai-chat-center:cc answers off, /ai-chat-center:cc window on ou /ai-chat-center:cc window off.",
    answersOn: "AI Chat Center: agora voc\xEA pode responder pelo app as perguntas de m\xFAltipla escolha, inclusive confirma\xE7\xF5es. Para desligar: /ai-chat-center:cc answers off",
    answersOff: "AI Chat Center: perguntas de m\xFAltipla escolha voltam a ser respondidas s\xF3 no terminal.",
    windowOn: "AI Chat Center: o app vai abrir em janela pr\xF3pria ao conectar. Para desligar: /ai-chat-center:cc window off",
    windowOff: "AI Chat Center: o app n\xE3o abre mais em janela pr\xF3pria.",
    windowNoBrowser: "Nenhum Chrome, Chromium ou Edge encontrado: o link continua sendo mostrado."
  },
  ui: {
    rename: {
      label: "Renomear sess\xE3o",
      failed: "N\xE3o foi poss\xEDvel renomear"
    },
    title: "AI Chat Center",
    collapseList: "Recolher lista",
    expandList: "Expandir lista",
    search: "Buscar por nome ou pasta",
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
    theme: { label: "Tema", system: "Sistema", light: "Claro", dark: "Escuro" },
    language: "Idioma",
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
      enableHint: "Para responder por aqui, digite /ai-chat-center:cc answers on no terminal"
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
      loading: "Carregando mensagens\u2026",
      waitingBanner: "O Claude est\xE1 esperando voc\xEA aprovar uma a\xE7\xE3o no terminal",
      waitingInputBanner: "O Claude est\xE1 esperando sua resposta no terminal",
      waitingBannerHint: "Aprovar pelo app chega em uma vers\xE3o futura.",
      deliveryStalled: "H\xE1 mensagens esperando, mas a entrega para esta sess\xE3o est\xE1 pausada: envie qualquer mensagem no terminal para retomar a entrega.",
      undeliveredUnsigned: "Uma mensagem de uma vers\xE3o anterior do AI Chat Center n\xE3o foi entregue. Envie-a de novo por aqui.",
      messages: "Mensagens",
      image: "[imagem]",
      images: "[{n} imagens]",
      compacted: "Conversa compactada \xB7 {time}"
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
      retry: "Tentar de novo"
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

// src/hooks/openWindow.ts
import fs5 from "node:fs";
import path7 from "node:path";
import { spawn as nodeSpawn } from "node:child_process";
var LINUX_NAMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable"];
var MAC_APPS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
];
var WIN_EXES = [
  ["Google", "Chrome", "Application", "chrome.exe"],
  ["Microsoft", "Edge", "Application", "msedge.exe"]
];
var WIN_BASES = ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"];
function findBrowser(env = process.env, platform = process.platform, exists = fs5.existsSync) {
  const ok = (p) => {
    try {
      return exists(p);
    } catch {
      return false;
    }
  };
  let candidates;
  if (platform === "darwin") candidates = MAC_APPS;
  else if (platform === "win32") {
    const bases = WIN_BASES.map((k) => env[k]).filter((b) => !!b && path7.win32.isAbsolute(b));
    candidates = WIN_EXES.flatMap((exe) => bases.map((b) => path7.win32.join(b, ...exe)));
  } else {
    const dirs = (env.PATH ?? "").split(path7.posix.delimiter).filter((d) => path7.posix.isAbsolute(d));
    candidates = LINUX_NAMES.flatMap((n) => dirs.map((d) => path7.posix.join(d, n)));
  }
  return candidates.find(ok) ?? null;
}
function openAppWindow(browser, url, deps = {}) {
  const spawn2 = deps.spawn ?? nodeSpawn;
  const platform = deps.platform ?? process.platform;
  try {
    const child = spawn2(browser, [`--app=${url}`, "--new-window"], {
      detached: true,
      stdio: "ignore",
      shell: false,
      ...platform === "win32" ? { windowsHide: true } : {}
    });
    child.on?.("error", () => {
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
var CODE_RE = /^[0-9a-f]{64}$/;
async function launchAppWindow(hubUrl, deps = {}) {
  const browser = (deps.findBrowser ?? (() => findBrowser()))();
  if (!browser) return false;
  const u = new URL(hubUrl);
  const token = new URLSearchParams(u.hash.slice(1)).get("token");
  if (u.protocol !== "http:" || u.hostname !== "127.0.0.1" || !token) throw new Error("app window: unexpected hub url");
  const doFetch = deps.fetch ?? fetch;
  const res = await doFetch(`${u.origin}/api/pair-code`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(deps.timeoutMs ?? 2e3)
  });
  if (!res.ok) throw new Error(`app window: pair-code answered ${res.status}`);
  let code2;
  try {
    code2 = (await res.json())?.code;
  } catch {
    throw new Error("app window: pair-code answer is not JSON");
  }
  if (typeof code2 !== "string" || !CODE_RE.test(code2)) throw new Error("app window: pair-code answer has no valid code");
  if (!openAppWindow(browser, `${u.origin}/#pair=${code2}`, deps)) throw new Error(`app window: could not start ${browser}`);
  return true;
}

// src/hooks/hook.ts
var MAX_PREVIOUS_KEYS = 20;
var UNKNOWN_ARG = "AI Chat Center: unknown argument. Use /cc, /ai-chat-center:cc off, /ai-chat-center:cc answers on, /ai-chat-center:cc answers off, /ai-chat-center:cc window on or /ai-chat-center:cc window off.";
var WINDOW_ON = "AI Chat Center: opening the app in its own window is ON";
var WINDOW_OFF = "AI Chat Center: opening the app in its own window is OFF";
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
    await fs6.promises.chmod(paths().home, DIR_MODE);
  } catch {
  }
}
async function connect(input, resolve, ctx) {
  const sid = input.session_id;
  const prev = await getRegistration(sid);
  const keep = prev && isActive(prev);
  await tightenHome();
  const pid = await resolve(sid);
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
  await clearBusy(sid);
  await clearWaiting(sid);
  await clearTurnOrigin(sid);
  await fs6.promises.rm(paths().questionsDir(sid), { recursive: true, force: true });
  const { language, openWindow } = await loadConfig();
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
    if (openWindow) await openWindowQuietly(url, ctx);
  } catch (e) {
    logError(e);
    const log = path8.join(paths().logDir, "hook.log");
    status = `AI Chat Center: the hub failed to start. See ${log}`;
    shown = t(language, "hook.hubFailed", { log });
  }
  const lines = [status, `AI Chat Center key: ${reg.key}`, ...notices];
  if (pid === null) lines.push(PID_UNKNOWN);
  return output(lines.join("\n"), [shown, ...notices].join("\n"));
}
async function openWindowQuietly(url, ctx) {
  try {
    await launchAppWindow(url, {
      findBrowser: ctx.findBrowser ?? (() => findBrowser()),
      ...ctx.fetch ? { fetch: ctx.fetch } : {},
      ...ctx.spawn ? { spawn: ctx.spawn } : {}
    });
  } catch (e) {
    logError(e instanceof Error ? e.message : String(e));
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
      const note = on && find() === null ? `
${t(language, "hook.windowNoBrowser")}` : "";
      answersResult = output(on ? WINDOW_ON : WINDOW_OFF, t(language, on ? "hook.windowOn" : "hook.windowOff") + note);
    }
    if (cmd === "answers-on" || cmd === "answers-off") {
      const on = cmd === "answers-on";
      const { language } = await saveConfig({ answersFromApp: on });
      answersResult = output(on ? ANSWERS_ON : ANSWERS_OFF, t(language, on ? "hook.answersOn" : "hook.answersOff"));
    }
    if (cmd === "on") return connect(input, resolve, ctx);
    const reg = await getRegistration(sid);
    if (!reg) return answersResult ?? nothing;
    if (cmd === "off") await markDisconnected(sid, "off");
    else if (isActive(reg)) {
      if (!stampedByThisCode(reg)) await updateRegistration(sid, codeStamp(), { ifConnectedAt: reg.connectedAt });
      await clearWaiting(sid);
      await setBusy(sid);
      await setTurnOrigin(sid, promptOrigin(input.prompt, reg.key));
    }
    return answersResult ?? nothing;
  }
  if (event === "notification") {
    const reg = await getRegistration(sid);
    if (!reg || !isActive(reg)) return nothing;
    const type = input.notification_type;
    if (type === "permission_prompt") await setWaiting(sid, "permission");
    else if (type === "elicitation_dialog" || type === "elicitation_url_dialog" || type === "agent_needs_input")
      await setWaiting(sid, "input");
  }
  return nothing;
}
async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}
function logError(e) {
  try {
    const dir = paths().logDir;
    fs6.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    fs6.appendFileSync(
      path8.join(dir, "hook.log"),
      `${(/* @__PURE__ */ new Date()).toISOString()} ${e instanceof Error ? e.stack ?? e.message : String(e)}
`
    );
  } catch {
  }
}
async function main() {
  let result = { exitCode: 0 };
  try {
    const event = process.argv[2];
    if (event !== "prompt-submit" && event !== "notification") return;
    const input = JSON.parse(await readStdin());
    result = await handleHook(event, input, { ensureHub: (notice) => ensureHub({ notice }) });
  } catch (e) {
    logError(e);
  }
  if (result.stdout) process.stdout.write(result.stdout, () => process.exit(0));
  else process.exitCode = 0;
}

// src/bin/hook.ts
process.noDeprecation = true;
void main();
