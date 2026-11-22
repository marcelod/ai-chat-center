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
    waiterLock: (sid) => (assertSessionId(sid), path.join(home, "waiters", `${sid}.lock`)),
    waitingFile: (sid) => (assertSessionId(sid), path.join(home, "waiting", `${sid}.json`)),
    busyFile: (sid) => (assertSessionId(sid), path.join(home, "busy", sid)),
    logDir: path.join(home, "logs")
  };
}

// src/core/registry.ts
import path4 from "node:path";

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

// src/core/inbox.ts
import fs2 from "node:fs/promises";
import path3 from "node:path";
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
async function readMsg(file) {
  try {
    return JSON.parse(await fs2.readFile(file, "utf8"));
  } catch (e) {
    if (isRace(e)) return null;
    if (e instanceof SyntaxError) return null;
    throw e;
  }
}
async function drain(sid) {
  const out = [];
  for (const f of await list(sid)) {
    const m = await readMsg(f);
    if (!m) continue;
    try {
      await fs2.unlink(f);
    } catch (e) {
      if (isRace(e)) continue;
      throw e;
    }
    out.push(m);
  }
  return out;
}

// src/core/busy.ts
import fs3 from "node:fs/promises";
async function clearBusy(sid) {
  await fs3.rm(paths().busyFile(sid), { force: true });
}
async function isBusy(sid) {
  try {
    await fs3.access(paths().busyFile(sid));
    return true;
  } catch {
    return false;
  }
}

// src/core/registry.ts
function regFile(sid) {
  assertSessionId(sid);
  return path4.join(paths().sessionsDir, `${sid}.json`);
}
var isActive = (r) => !r.disconnectedAt;
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
    const list2 = JSON.parse(await (opts.run ?? runClaudeAgentsJson)());
    if (Array.isArray(list2)) {
      for (const a of list2) {
        if (a?.sessionId === sessionId && typeof a.pid === "number") return a.pid;
      }
    }
  } catch {
  }
  return null;
}

// src/core/waiting.ts
import fs4 from "node:fs/promises";
async function clearWaiting(sid) {
  await fs4.rm(paths().waitingFile(sid), { force: true });
}

// src/core/lock.ts
import fs5 from "node:fs/promises";
import path5 from "node:path";
import crypto from "node:crypto";
var EMPTY_GRACE_MS = 1e4;
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
async function publish(file) {
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs5.writeFile(tmp, String(process.pid), { flag: "wx" });
    await fs5.link(tmp, file);
    return true;
  } catch (e) {
    if (["EEXIST", "EPERM", "EBUSY"].includes(code(e) ?? "")) return false;
    throw e;
  } finally {
    await fs5.rm(tmp, { force: true });
  }
}
async function staleContent(file) {
  let content;
  try {
    content = await fs5.readFile(file, "utf8");
  } catch (e) {
    if (code(e) === "ENOENT") return null;
    content = "";
  }
  const pid = parseInt(content, 10);
  if (Number.isInteger(pid) && pid > 0) return isAlive(pid) ? null : content;
  try {
    const st = await fs5.stat(file);
    return Date.now() - st.mtimeMs > EMPTY_GRACE_MS ? content : null;
  } catch {
    return null;
  }
}
var GUARD_STALE_MS = 1e4;
var contention = (e) => ["EEXIST", "EPERM", "EBUSY"].includes(code(e) ?? "");
async function reclaimStaleLock(file, seen) {
  const guard = `${file}.reclaim`;
  if (!await publish(guard)) {
    try {
      const st = await fs5.stat(guard);
      if (Date.now() - st.mtimeMs > GUARD_STALE_MS) await fs5.rm(guard, { force: true });
    } catch {
    }
    return false;
  }
  try {
    if (await staleContent(file) !== seen) return false;
    try {
      await fs5.unlink(file);
    } catch (e) {
      if (code(e) !== "ENOENT") {
        if (contention(e)) return false;
        throw e;
      }
    }
    return await publish(file);
  } finally {
    try {
      if (await fs5.readFile(guard, "utf8") === String(process.pid)) await fs5.rm(guard, { force: true });
    } catch {
    }
  }
}
async function acquireLock(file) {
  await ensureDir(path5.dirname(file));
  if (await publish(file)) return true;
  const seen = await staleContent(file);
  if (seen === null) return false;
  return reclaimStaleLock(file, seen);
}
async function releaseLock(file) {
  await fs5.rm(file, { force: true });
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
var NOTHING = { exitCode: 0, stderr: "" };
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function activeReg(sid) {
  const r = await getRegistration(sid);
  return r && isActive(r) ? r : null;
}
async function runWaiter(input, opts = {}) {
  const sid = input?.session_id;
  try {
    assertSessionId(sid);
  } catch {
    return NOTHING;
  }
  const pollMs = opts.pollMs ?? 1e3;
  const isAlive2 = opts.isAlive ?? isAlive;
  const clear = opts.clearWaiting ?? clearWaiting;
  const first = await activeReg(sid);
  if (!first) return NOTHING;
  try {
    await clearBusy(sid);
    await clear(sid);
  } catch (e) {
    logError(e);
  }
  const lookup = opts.resolvePid ?? resolveClaudePid;
  let resolved = false;
  const reresolve = async () => {
    resolved = true;
    const found = await lookup(sid);
    if (found !== null) {
      const cur = await activeReg(sid);
      if (cur && cur.connectedAt === first.connectedAt) await updateRegistration(sid, { pid: found });
    }
    return found;
  };
  let pid = first.pid ?? null;
  if (pid === null) pid = await reresolve();
  const lock = paths().waiterLock(sid);
  if (!await acquireLock(lock)) return NOTHING;
  try {
    for (; ; ) {
      const reg = await activeReg(sid);
      if (!reg) return NOTHING;
      const regPid = reg.pid ?? pid;
      if (regPid !== null && !isAlive2(regPid)) {
        const fresh = resolved ? null : await reresolve();
        if (fresh === null || fresh === regPid || !isAlive2(fresh)) return NOTHING;
        pid = fresh;
        continue;
      }
      if (!await isBusy(sid)) {
        const msgs = await drain(sid);
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
    if (fs6.readFileSync(lock, "utf8") === String(process.pid)) fs6.rmSync(lock, { force: true });
  } catch {
  }
}
async function main() {
  let result = NOTHING;
  try {
    const input = JSON.parse(await readStdin());
    const onSignal = () => {
      releaseOwnLockSync(input?.session_id);
      process.exit(0);
    };
    process.on("SIGTERM", onSignal);
    process.on("SIGINT", onSignal);
    result = await runWaiter(input);
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
