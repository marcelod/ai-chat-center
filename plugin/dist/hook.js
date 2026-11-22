import { createRequire as __acc_createRequire } from 'node:module';
const require = __acc_createRequire(import.meta.url);

// src/hooks/hook.ts
import fs7 from "node:fs";
import path6 from "node:path";
import crypto from "node:crypto";

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
    waiterLock: (sid) => (assertSessionId(sid), path.join(home, "waiters", `${sid}.lock`)),
    waitingFile: (sid) => (assertSessionId(sid), path.join(home, "waiting", `${sid}.json`)),
    busyFile: (sid) => (assertSessionId(sid), path.join(home, "busy", sid)),
    logDir: path.join(home, "logs")
  };
}

// src/core/fsAtomic.ts
import fs from "node:fs/promises";
import path2 from "node:path";
var DIR_MODE = 448;
var FILE_MODE = 384;
async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true, mode: DIR_MODE });
}
async function writeJsonAtomic(file, data) {
  await ensureDir(path2.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), { encoding: "utf8", mode: FILE_MODE });
    await fs.rename(tmp, file);
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
import fs4 from "node:fs/promises";
import path4 from "node:path";

// src/core/inbox.ts
import fs2 from "node:fs/promises";
import path3 from "node:path";
var isRace = (e) => ["ENOENT", "EPERM", "EBUSY"].includes(e.code ?? "");
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
    if (!n.endsWith(".msg") && !n.endsWith(".tmp")) continue;
    try {
      await fs2.rm(path3.join(dir, n), { force: true });
    } catch (e) {
      if (!isRace(e)) throw e;
    }
  }
}

// src/core/busy.ts
import fs3 from "node:fs/promises";
async function setBusy(sid) {
  await writeJsonAtomic(paths().busyFile(sid), { at: (/* @__PURE__ */ new Date()).toISOString() });
}
async function clearBusy(sid) {
  await fs3.rm(paths().busyFile(sid), { force: true });
}

// src/core/registry.ts
function regFile(sid) {
  assertSessionId(sid);
  return path4.join(paths().sessionsDir, `${sid}.json`);
}
var isActive = (r) => !r.disconnectedAt;
async function register(r) {
  const prev = await getRegistration(r.sessionId);
  if (!prev || !isActive(prev)) await clearInbox(r.sessionId);
  const full = { ...r, connectedAt: r.connectedAt ?? (/* @__PURE__ */ new Date()).toISOString() };
  await writeJsonAtomic(regFile(r.sessionId), full);
  return full;
}
async function updateRegistration(sid, patch) {
  const r = await getRegistration(sid);
  if (!r) return null;
  const next = { ...r, ...patch };
  await writeJsonAtomic(regFile(sid), next);
  return next;
}
async function getRegistration(sid) {
  return readJson(regFile(sid));
}
async function listRegistrations() {
  let names;
  try {
    names = await fs4.readdir(paths().sessionsDir);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const out = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    const r = await readJson(path4.join(paths().sessionsDir, n));
    if (r) out.push(r);
  }
  return out;
}
async function markDisconnected(sid, reason) {
  const r = await getRegistration(sid);
  if (!r) return;
  await writeJsonAtomic(regFile(sid), { ...r, disconnectedAt: (/* @__PURE__ */ new Date()).toISOString(), disconnectReason: reason });
  await clearInbox(sid);
  await clearBusy(sid);
}

// src/core/waiting.ts
import fs5 from "node:fs/promises";
async function setWaiting(sid, kind) {
  await writeJsonAtomic(paths().waitingFile(sid), { kind, at: (/* @__PURE__ */ new Date()).toISOString() });
}
async function clearWaiting(sid) {
  await fs5.rm(paths().waitingFile(sid), { force: true });
}

// src/hooks/ensureHub.ts
import fs6 from "node:fs";
import http from "node:http";
import os2 from "node:os";
import path5 from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

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
var VERSION = "0.1.0";

// src/hooks/ensureHub.ts
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function checkHealth(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: 500 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => {
        if (body.length < 4096) body += c;
      });
      res.on("end", () => {
        try {
          const j = JSON.parse(body);
          const ok = res.statusCode === 200 && j.ok === true && typeof j.pid === "number" && typeof j.version === "string";
          resolve(ok ? { ok: true, pid: j.pid, version: j.version } : null);
        } catch {
          resolve(null);
        }
      });
      res.on("error", () => resolve(null));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}
function hubSpawnOptions() {
  return { detached: true, stdio: "ignore", windowsHide: true, cwd: os2.homedir() };
}
function defaultSpawnHub() {
  const hubPath = path5.join(path5.dirname(fileURLToPath(import.meta.url)), "hub.js");
  spawn(process.execPath, [hubPath], hubSpawnOptions()).unref();
}
function readHub() {
  try {
    const { port, pid } = JSON.parse(fs6.readFileSync(paths().hubJson, "utf8"));
    const token = fs6.readFileSync(paths().token, "utf8").trim();
    if (typeof port !== "number" || !token) return null;
    return { port, pid: typeof pid === "number" ? pid : void 0, token };
  } catch {
    return null;
  }
}
var urlOf = (h) => `http://127.0.0.1:${h.port}/?token=${h.token}`;
async function ensureHub(opts = {}) {
  const health = opts.health ?? checkHealth;
  const isAlive2 = opts.isAlive ?? isAlive;
  const kill = opts.kill ?? ((pid) => {
    try {
      process.kill(pid);
    } catch {
    }
  });
  const pollMs = opts.pollMs ?? 100;
  const timeoutMs = opts.timeoutMs ?? 5e3;
  const hub = readHub();
  if (hub) {
    const h = await health(hub.port);
    if (h && h.pid === hub.pid) {
      if (h.version === VERSION) return urlOf(hub);
      kill(h.pid);
      const until = Date.now() + 3e3;
      while (isAlive2(h.pid) && Date.now() < until) await sleep(50);
    }
  }
  (opts.spawnHub ?? defaultSpawnHub)();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const cur = readHub();
    if (!cur) continue;
    const h = await health(cur.port);
    if (h && h.pid === cur.pid && h.version === VERSION) return urlOf(cur);
  }
  throw new Error("AI Chat Center hub did not start in time");
}

// src/core/claudeAgents.ts
import { execFile } from "node:child_process";
function runClaudeAgentsJson() {
  return new Promise((resolve, reject) => {
    execFile(
      "claude",
      ["agents", "--json"],
      { shell: process.platform === "win32", windowsHide: true, timeout: 5e3, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => err ? reject(err) : resolve(String(stdout))
    );
  });
}

// src/hooks/claudePid.ts
async function resolveClaudePid(sessionId, opts = {}) {
  try {
    const list = JSON.parse(await (opts.run ?? runClaudeAgentsJson)());
    if (Array.isArray(list)) {
      for (const a of list) {
        if (a?.sessionId === sessionId && typeof a.pid === "number") return a.pid;
      }
    }
  } catch {
  }
  return null;
}

// src/hooks/hook.ts
var CC_RE = /^\s*\/(?:ai-chat-center:)?cc(?:\s+(\S[\s\S]*?))?\s*$/i;
var MAX_PREVIOUS_KEYS = 20;
var UNKNOWN_ARG = "AI Chat Center: unknown argument. Use /cc or /cc off.";
var PID_UNKNOWN = "AI Chat Center: could not identify the Claude process; closing the terminal will be detected by the hub.";
function isCcCommand(prompt) {
  if (typeof prompt !== "string") return null;
  const m = CC_RE.exec(prompt);
  if (!m) return null;
  if (m[1] === void 0) return "on";
  return m[1].toLowerCase() === "off" ? "off" : "unknown";
}
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
    await fs7.promises.chmod(paths().home, DIR_MODE);
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
    // The key stays while the connection is active; a reactivation gets a new one.
    key: keep && prev.key ? prev.key : crypto.randomBytes(16).toString("hex"),
    ...previousKeys.length ? { previousKeys } : {},
    // Re-running /cc on an active session keeps its original connectedAt.
    ...keep ? { connectedAt: prev.connectedAt } : {}
  });
  await clearBusy(sid);
  await clearWaiting(sid);
  let first;
  try {
    first = `AI Chat Center URL: ${await ctx.ensureHub()}`;
  } catch (e) {
    logError(e);
    first = `AI Chat Center: the hub failed to start. See ${path6.join(paths().logDir, "hook.log")}`;
  }
  const lines = [first, `AI Chat Center key: ${reg.key}`];
  if (pid === null) lines.push(PID_UNKNOWN);
  return output(lines.join("\n"), first);
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
  if (event === "session-start") {
    if (input.source === "clear") {
      const active = (await listRegistrations()).filter(isActive);
      if (active.length === 0) return nothing;
      const pid = await resolve(sid);
      if (pid === null) return nothing;
      for (const r of active) {
        if (r.pid === pid && r.sessionId !== sid) await markDisconnected(r.sessionId, "clear");
      }
      return nothing;
    }
    if (input.source === "resume" || input.source === "startup") {
      const reg = await getRegistration(sid);
      if (!reg || !isActive(reg)) return nothing;
      const pid = await resolve(sid);
      await updateRegistration(sid, {
        pid,
        ...typeof input.transcript_path === "string" && input.transcript_path ? { transcriptPath: input.transcript_path } : {}
      });
    }
    return nothing;
  }
  if (event === "prompt-submit") {
    const cmd = isCcCommand(input.prompt);
    if (cmd === "unknown") return output(UNKNOWN_ARG);
    if (cmd === "on") return connect(input, resolve, ctx);
    const reg = await getRegistration(sid);
    if (!reg) return nothing;
    if (cmd === "off") await markDisconnected(sid, "off");
    else if (isActive(reg)) {
      await clearWaiting(sid);
      await setBusy(sid);
    }
    return nothing;
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
    fs7.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    fs7.appendFileSync(
      path6.join(dir, "hook.log"),
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
    if (event !== "session-start" && event !== "prompt-submit" && event !== "notification") return;
    const input = JSON.parse(await readStdin());
    result = await handleHook(event, input, { ensureHub: () => ensureHub() });
  } catch (e) {
    logError(e);
  }
  if (result.stdout) process.stdout.write(result.stdout, () => process.exit(0));
  else process.exitCode = 0;
}

// src/bin/hook.ts
void main();
