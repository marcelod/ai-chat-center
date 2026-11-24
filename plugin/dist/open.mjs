import { createRequire as __acc_createRequire } from 'node:module';
const require = __acc_createRequire(import.meta.url);

// src/hooks/open.ts
import fs3 from "node:fs";
import path4 from "node:path";

// src/hooks/ensureHub.ts
import crypto2 from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os2 from "node:os";
import path2 from "node:path";
import { spawn } from "node:child_process";
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

// src/core/lock.ts
function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

// src/core/version.ts
var VERSION = "0.4.5";

// src/core/healthProof.ts
import crypto from "node:crypto";
var newChallenge = () => crypto.randomBytes(16).toString("hex");
function healthProof(token, challenge, port, pid, version) {
  return crypto.createHmac("sha256", token).update(`${challenge}|${port}|${pid}|${version}`).digest("hex");
}
function proofMatches(token, challenge, port, answer) {
  const want = Buffer.from(healthProof(token, challenge, port, answer.pid, answer.version));
  const got = Buffer.from(String(answer.proof));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
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
  return { detached: true, stdio: "ignore", windowsHide: true, cwd: os2.homedir() };
}
function defaultSpawnHub() {
  const hubPath = path2.join(path2.dirname(fileURLToPath(import.meta.url)), "hub.mjs");
  spawn(process.execPath, [hubPath], hubSpawnOptions()).unref();
}
function readHub() {
  try {
    const { port, pid } = JSON.parse(fs.readFileSync(paths().hubJson, "utf8"));
    const token = fs.readFileSync(paths().token, "utf8").trim();
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
        const ours = reported !== void 0 && reported === hub.pid && !await tokenAccepted(hub.port, crypto2.randomBytes(32).toString("hex")) && await tokenAccepted(hub.port, hub.token);
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

// src/hooks/openWindow.ts
import fs2 from "node:fs";
import path3 from "node:path";
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
function isExecutableFile(p, platform = process.platform, checks = {}) {
  const stat = checks.stat ?? fs2.statSync;
  const access = checks.access ?? fs2.accessSync;
  try {
    if (!stat(p).isFile()) return false;
    if (platform !== "win32") access(p, fs2.constants.X_OK);
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
  if (platform === "darwin") candidates = MAC_APPS;
  else if (platform === "win32") {
    const bases = WIN_BASES.map((k) => env[k]).filter((b) => !!b && path3.win32.isAbsolute(b));
    candidates = WIN_EXES.flatMap((exe) => bases.map((b) => path3.win32.join(b, ...exe)));
  } else {
    const dirs = (env.PATH ?? "").split(path3.posix.delimiter).filter((d) => path3.posix.isAbsolute(d));
    candidates = LINUX_NAMES.flatMap((n) => dirs.map((d) => path3.posix.join(d, n)));
  }
  return candidates.find(ok) ?? null;
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
var CODE_RE = /^[0-9a-f]{64}$/;
async function launchAppWindow(hubUrl, deps = {}, sessionId) {
  const browser = (deps.findBrowser ?? (() => findBrowser()))();
  if (!browser) return false;
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
  const code = answer?.code;
  if (typeof code !== "string" || !CODE_RE.test(code)) throw new Error("app window: pair-code answer has no valid code");
  if (!openAppWindow(browser, `${u.origin}/#pair=${code}`, deps)) throw new Error(`app window: could not start ${browser}`);
  return "opened";
}

// src/hooks/open.ts
async function openApp(deps = {}) {
  const log = deps.log ?? logLine;
  try {
    const url = await (deps.ensureHub ?? ((notice) => ensureHub({ notice })))(log);
    const r = await (deps.launch ?? launchAppWindow)(url, { onError: log });
    if (r === false) {
      log("launcher: no Chrome, Chromium or Edge found");
      return "no-browser";
    }
    return r;
  } catch (e) {
    log(`launcher: ${e instanceof Error ? e.message : String(e)}`);
    return "failed";
  }
}
function logLine(msg) {
  try {
    const dir = paths().logDir;
    fs3.mkdirSync(dir, { recursive: true, mode: 448 });
    fs3.appendFileSync(path4.join(dir, "launcher.log"), `${(/* @__PURE__ */ new Date()).toISOString()} ${msg}
`);
  } catch {
  }
}

// src/bin/open.ts
process.noDeprecation = true;
void openApp().then(() => process.exit(0));
