import { createRequire as __acc_createRequire } from 'node:module';
const require = __acc_createRequire(import.meta.url);

// src/bin/statusline.ts
import { spawn } from "node:child_process";

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

// src/core/usage.ts
function toIso(v) {
  let ms;
  if (typeof v === "number") ms = v < 1e12 ? v * 1e3 : v;
  else if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v)) ms = Number(v) * 1e3;
  else if (typeof v === "string") ms = Date.parse(v);
  else return null;
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}
function toWindow(raw) {
  if (!raw || typeof raw !== "object") return void 0;
  const r = raw;
  const pct = typeof r.used_percentage === "string" ? Number(r.used_percentage) : r.used_percentage;
  const resetsAt = toIso(r.resets_at);
  if (typeof pct !== "number" || !Number.isFinite(pct) || resetsAt === null) return void 0;
  return { usedPercentage: Math.min(100, Math.max(0, Math.round(pct * 10) / 10)), resetsAt };
}
function usageFromStatusInput(input, now = /* @__PURE__ */ new Date()) {
  const limits = input?.rate_limits;
  if (!limits || typeof limits !== "object") return null;
  const fiveHour = toWindow(limits.five_hour);
  const sevenDay = toWindow(limits.seven_day);
  if (!fiveHour && !sevenDay) return null;
  return { ...fiveHour ? { fiveHour } : {}, ...sevenDay ? { sevenDay } : {}, updatedAt: now.toISOString() };
}
var sameWindow = (a, b) => a?.usedPercentage === b?.usedPercentage && a?.resetsAt === b?.resetsAt;
var REWRITE_AFTER_MS = 6e4;
async function recordUsage(u) {
  const prev = await readUsage();
  if (prev && sameWindow(prev.fiveHour, u.fiveHour) && sameWindow(prev.sevenDay, u.sevenDay) && Date.parse(u.updatedAt) - Date.parse(prev.updatedAt) < REWRITE_AFTER_MS)
    return false;
  await writeJsonAtomic(paths().usageFile, u);
  return true;
}
async function readUsage() {
  const d = await readJson(paths().usageFile);
  if (!d || typeof d !== "object" || typeof d.updatedAt !== "string" || Number.isNaN(Date.parse(d.updatedAt))) return null;
  const valid = (w) => {
    if (!w || typeof w !== "object") return void 0;
    const { usedPercentage, resetsAt } = w;
    if (typeof usedPercentage !== "number" || !Number.isFinite(usedPercentage) || usedPercentage < 0 || usedPercentage > 100) return void 0;
    if (typeof resetsAt !== "string" || Number.isNaN(Date.parse(resetsAt))) return void 0;
    return { usedPercentage, resetsAt: new Date(resetsAt).toISOString() };
  };
  const fiveHour = valid(d.fiveHour);
  const sevenDay = valid(d.sevenDay);
  if (!fiveHour && !sevenDay) return null;
  return { ...fiveHour ? { fiveHour } : {}, ...sevenDay ? { sevenDay } : {}, updatedAt: new Date(d.updatedAt).toISOString() };
}

// src/core/statuslineState.ts
async function readStatuslineState() {
  const d = await readJson(paths().statuslineFile);
  if (!d || typeof d !== "object" || !("original" in d)) return null;
  const o = d.original;
  return { original: o && typeof o === "object" && !Array.isArray(o) ? o : null };
}

// src/bin/statusline.ts
async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks);
}
async function main() {
  const input = await readStdin();
  try {
    const usage = usageFromStatusInput(JSON.parse(input.toString("utf8")));
    if (usage) await recordUsage(usage);
  } catch {
  }
  let command = null;
  try {
    command = (await readStatuslineState())?.original?.command;
  } catch {
  }
  if (typeof command !== "string" || !command.trim()) return;
  const child = spawn(command, { shell: true, stdio: ["pipe", "inherit", "inherit"] });
  child.on("error", () => process.exit(0));
  child.stdin.on("error", () => {
  });
  child.stdin.end(input);
  child.on("exit", (code) => process.exit(code ?? 0));
}
main().catch(() => process.exit(0));
