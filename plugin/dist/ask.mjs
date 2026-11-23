import { createRequire as __acc_createRequire } from 'node:module';
const require = __acc_createRequire(import.meta.url);

// src/hooks/ask.ts
import fs2 from "node:fs";
import path5 from "node:path";

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

// src/core/registry.ts
import path3 from "node:path";

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

// src/core/waiting.ts
async function setWaiting(sid, kind) {
  await writeJsonAtomic(paths().waitingFile(sid), { kind, at: (/* @__PURE__ */ new Date()).toISOString() });
}
async function clearWaiting(sid) {
  await removeFile(paths().waitingFile(sid));
}

// src/core/registry.ts
function regFile(sid) {
  assertSessionId(sid);
  return path3.join(paths().sessionsDir, `${sid}.json`);
}
var isActive = (r) => !r.disconnectedAt;
async function getRegistration(sid) {
  return readJson(regFile(sid));
}

// src/core/config.ts
var LANGS = ["en", "pt-BR"];
async function loadConfig() {
  const c = await readJson(paths().config);
  const language = LANGS.includes(c?.language) ? c.language : "en";
  return { language, answersFromApp: c?.answersFromApp === true, openWindow: c?.openWindow === true };
}

// src/core/turn.ts
async function getTurnOrigin(sid) {
  const t = await readJson(paths().turnFile(sid));
  return t?.origin === "app" || t?.origin === "terminal" ? t.origin : null;
}

// src/core/presence.ts
var FRESH_MS = 45e3;
async function appPresent(now = Date.now()) {
  const p = await readJson(paths().presenceFile);
  if (!p || typeof p.clients !== "number" || typeof p.pid !== "number" || typeof p.at !== "number") return false;
  return p.clients > 0 && now - p.at < FRESH_MS && isAlive(p.pid);
}

// src/core/questions.ts
import { rmSync } from "node:fs";
import path4 from "node:path";
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
var pendingFile = (sid, id) => (assertToolUseId(id), path4.join(paths().questionsDir(sid), `${id}.json`));
var answerFile = (sid, id) => (assertToolUseId(id), path4.join(paths().questionsDir(sid), `${id}.answer.json`));
async function putPending(sid, q) {
  await writeJsonAtomic(pendingFile(sid, q.toolUseId), q);
}
async function removePending(sid, toolUseId) {
  await removeFile(pendingFile(sid, toolUseId));
  await removeFile(answerFile(sid, toolUseId));
}
function removePendingSync(sid, toolUseId) {
  rmSync(pendingFile(sid, toolUseId), { force: true });
  rmSync(answerFile(sid, toolUseId), { force: true });
}
async function removeAnswer(sid, toolUseId) {
  await removeFile(answerFile(sid, toolUseId));
}
async function readAnswer(sid, toolUseId) {
  return readJson(answerFile(sid, toolUseId));
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

// src/hooks/ask.ts
var valid = (check, v) => {
  try {
    check(v);
    return true;
  } catch {
    return false;
  }
};
var active = null;
function abortActiveSync() {
  const a = active;
  active = null;
  if (!a) return;
  try {
    removePendingSync(a.sid, a.id);
  } catch (e) {
    logError(e);
  }
  if (!a.waiting) return;
  try {
    fs2.rmSync(paths().waitingFile(a.sid), { force: true });
  } catch (e) {
    logError(e);
  }
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function runAsk(input, opts = {}) {
  try {
    return await ask(input, opts);
  } catch (e) {
    logError(e);
    return null;
  }
}
async function ask(input, opts) {
  const { pollMs = 500, deadlineMs = 86e6, parentPid = process.ppid, isAlive: isAlive2 = isAlive, present = appPresent } = opts;
  const sid = input.session_id;
  const id = input.tool_use_id;
  if (input.tool_name !== "AskUserQuestion" || !valid(assertSessionId, sid)) return null;
  const reg = await getRegistration(sid);
  if (!reg || !isActive(reg)) return null;
  if ((await loadConfig()).answersFromApp !== true) return null;
  if (await getTurnOrigin(sid) !== "app") return null;
  const questions = parseQuestions(input.tool_input);
  if (!questions || !valid(assertToolUseId, id)) return null;
  if (!await present()) return null;
  const start = Date.now();
  let released = false;
  const mine = { sid, id, waiting: false };
  active = mine;
  try {
    await putPending(sid, { toolUseId: id, questions, createdAt: new Date(start).toISOString(), pid: process.pid });
    mine.waiting = true;
    await setWaiting(sid, "question");
    for (; ; ) {
      const r = await getRegistration(sid);
      if (!r || !isActive(r) || r.connectedAt !== reg.connectedAt) return null;
      if (parentPid != null && !isAlive2(parentPid)) return null;
      const a = await readAnswer(sid, id);
      if (a && "release" in a && a.release === true) {
        released = true;
        mine.waiting = false;
        await setWaiting(sid, "input");
        return null;
      }
      if (a) {
        const answers = "answers" in a ? validAnswers(questions, a.answers) : null;
        if (answers) {
          return JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "allow",
              permissionDecisionReason: "Answered in AI Chat Center",
              updatedInput: { ...input.tool_input, answers }
            }
          });
        }
        await removeAnswer(sid, id);
      }
      if (Date.now() - start >= deadlineMs) return null;
      await sleep(pollMs);
    }
  } finally {
    if (active === mine) active = null;
    await cleanup(sid, id, released);
  }
}
async function cleanup(sid, id, released) {
  try {
    await removePending(sid, id);
  } catch (e) {
    logError(e);
  }
  if (released) return;
  try {
    await clearWaiting(sid);
  } catch (e) {
    logError(e);
  }
}
function logError(e) {
  try {
    const dir = paths().logDir;
    fs2.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    fs2.appendFileSync(path5.join(dir, "ask.log"), `${(/* @__PURE__ */ new Date()).toISOString()} ${e instanceof Error ? e.stack ?? e.message : String(e)}
`);
  } catch {
  }
}
async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}
async function main() {
  let out = null;
  const onSignal = () => {
    abortActiveSync();
    process.exit(0);
  };
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    try {
      process.on(sig, onSignal);
    } catch {
    }
  }
  try {
    if (process.argv[2] === "pre-tool") out = await runAsk(JSON.parse(await readStdin()));
  } catch (e) {
    logError(e);
  }
  if (out) process.stdout.write(out, () => process.exit(0));
  else process.exit(0);
}

// src/bin/ask.ts
process.noDeprecation = true;
void main();
