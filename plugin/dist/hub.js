import { createRequire as __acc_createRequire } from 'node:module';
const require = __acc_createRequire(import.meta.url);

// src/hub/main.ts
import fs8 from "node:fs/promises";
import fsSync from "node:fs";
import path8 from "node:path";
import crypto4 from "node:crypto";
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

// src/hub/provider.ts
import fs5 from "node:fs/promises";
import path5 from "node:path";

// src/core/registry.ts
import fs4 from "node:fs/promises";
import path4 from "node:path";

// src/core/inbox.ts
import fs2 from "node:fs/promises";
import path3 from "node:path";
import crypto from "node:crypto";
var counter = 0;
var isRace = (e) => ["ENOENT", "EPERM", "EBUSY"].includes(e.code ?? "");
async function enqueue(sid, text) {
  const dir = paths().inboxDir(sid);
  await ensureDir(dir);
  const now = Date.now();
  const msg = { id: crypto.randomUUID(), text, createdAt: new Date(now).toISOString() };
  counter = (counter + 1) % 1e6;
  const name = `${String(now).padStart(15, "0")}-${String(counter).padStart(6, "0")}-${msg.id}.msg`;
  const tmp = path3.join(dir, `.${msg.id}.tmp`);
  try {
    await fs2.writeFile(tmp, JSON.stringify(msg), { encoding: "utf8", mode: FILE_MODE });
    await fs2.rename(tmp, path3.join(dir, name));
  } catch (e) {
    await fs2.rm(tmp, { force: true });
    throw e;
  }
  return msg;
}
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
async function peek(sid) {
  const out = [];
  for (const f of await list(sid)) {
    const m = await readMsg(f);
    if (m) out.push(m);
  }
  return out;
}
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
async function clearBusy(sid) {
  await fs3.rm(paths().busyFile(sid), { force: true });
}
async function busyAge(sid, now = Date.now()) {
  try {
    return now - (await fs3.stat(paths().busyFile(sid))).mtimeMs;
  } catch {
    return null;
  }
}

// src/core/registry.ts
function regFile(sid) {
  assertSessionId(sid);
  return path4.join(paths().sessionsDir, `${sid}.json`);
}
var isActive = (r) => !r.disconnectedAt;
var trustedKeys = (r) => [...r.previousKeys ?? [], ...r.key ? [r.key] : []];
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
async function getWaiting(sid) {
  return readJson(paths().waitingFile(sid));
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

// src/hub/transcript/parse.ts
var RESULT_MAX = 2e3;
var SUMMARY_MAX = 120;
var truncate = (s, max) => s.length > max ? s.slice(0, max) : s;
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
  /** Returns new or updated events (same id = replace). */
  push(entry) {
    if (!isRecord(entry)) return [];
    const uuid = entry.uuid;
    const ts = entry.timestamp;
    if (typeof uuid !== "string" || typeof ts !== "string") return [];
    const message = isRecord(entry.message) ? entry.message : void 0;
    if (!message) return [];
    if (entry.type === "assistant") return this.assistant(uuid, ts, message.content);
    if (entry.type === "user" && entry.isMeta !== true) return this.user(uuid, ts, message.content);
    return [];
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
  user(uuid, ts, content) {
    if (Array.isArray(content)) return this.toolResults(content);
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
    if (cmd === "/cc" || cmd === "/ai-chat-center:cc") {
      const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(content)?.[1]?.trim();
      return [{ kind: "notice", id: uuid, ts, code: args === "off" ? "disconnected" : "connected" }];
    }
    const t = content.trimStart();
    if (t.startsWith("<command-") || t.startsWith("<local-command-") || t.startsWith("<task-notification>") || t.startsWith("<system-reminder>")) {
      return [];
    }
    if (!content.trim()) return [];
    this.open = null;
    return [{ kind: "user", id: uuid, ts, text: content, origin: "terminal" }];
  }
  toolResults(blocks) {
    const out = /* @__PURE__ */ new Map();
    for (const block of blocks) {
      if (!isRecord(block) || block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
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
  constructor(path9, keys) {
    this.path = path9;
    this.keys = keys;
    this.parser = new TranscriptParser(keys);
  }
  path;
  keys;
  offset = 0;
  partial = "";
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
  reset() {
    this.offset = 0;
    this.partial = "";
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
        this.partial += this.decoder.write(buf.subarray(0, bytesRead));
        const lines = this.partial.split("\n");
        this.partial = lines.pop() ?? "";
        for (const raw of lines) this.consume(raw, out);
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

// src/hub/provider.ts
var SessionDisconnectedError = class extends Error {
  constructor(sessionId) {
    super(`Session ${sessionId} is disconnected`);
    this.sessionId = sessionId;
    this.name = "SessionDisconnectedError";
  }
  sessionId;
};
var LIVE_TTL_MS = 5e3;
var STALE_BUSY_MS = 1e4;
var GRACE_MS = 15e3;
var MISSES_TO_EXIT = 3;
var ClaudeCodeProvider = class {
  constructor(listLive = queryLiveSessions, opts = {}) {
    this.listLive = listLive;
    this.now = opts.now ?? Date.now;
  }
  listLive;
  readers = /* @__PURE__ */ new Map();
  // active sessions only
  pending = /* @__PURE__ */ new Map();
  // read but not yet emitted by poll
  lastEvents = /* @__PURE__ */ new Map();
  // disconnected sessions
  misses = /* @__PURE__ */ new Map();
  liveCache = null;
  lastGood = null;
  lastSignature = null;
  now;
  async live() {
    const t = this.now();
    if (this.liveCache && t >= this.liveCache.at && t - this.liveCache.at < LIVE_TTL_MS) {
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
    return last;
  }
  shouldMarkExited(sid, connectedAt, live) {
    let m = this.misses.get(sid);
    if (!m || m.connectedAt !== connectedAt) {
      m = { connectedAt, count: 0 };
      this.misses.set(sid, m);
    }
    if (!live.ok) return false;
    if (live.fresh) m.count++;
    const age = this.now() - (Date.parse(connectedAt) || 0);
    return m.count >= MISSES_TO_EXIT && age > GRACE_MS;
  }
  async dropStaleBusy(sid) {
    const age = await busyAge(sid, this.now());
    if (age !== null && age > STALE_BUSY_MS) await clearBusy(sid);
  }
  async listSessions() {
    const live = await this.live();
    const liveById = new Map(live.list.map((l) => [l.sessionId, l]));
    const regs = await listRegistrations();
    const connected = [];
    const activeIds = /* @__PURE__ */ new Set();
    for (const reg of regs) {
      const sid = reg.sessionId;
      const l = liveById.get(sid);
      let disconnected = !isActive(reg);
      if (!disconnected) {
        if (l) this.misses.delete(sid);
        else if (this.shouldMarkExited(sid, reg.connectedAt, live)) {
          await markDisconnected(sid, "exited");
          this.misses.delete(sid);
          disconnected = true;
        }
      }
      if (!disconnected) activeIds.add(sid);
      let lastEvent;
      if (disconnected) {
        lastEvent = await this.lastEventOf(reg);
      } else {
        const e = this.entry(reg);
        if (!e.read) await this.refresh(sid, e);
        lastEvent = e.reader.all().at(-1);
      }
      const waiting = disconnected ? null : await getWaiting(sid);
      let state;
      let waitingKind;
      if (disconnected) state = "disconnected";
      else if (live.ok && l) {
        state = l.status;
        if (l.status === "waiting") waitingKind = waiting?.kind ?? "permission";
      } else if (waiting) {
        state = "waiting";
        waitingKind = waiting.kind;
      } else state = l?.status ?? "idle";
      if (!disconnected && live.ok && l?.status === "idle") await this.dropStaleBusy(sid);
      const cwd = l?.cwd ?? reg.cwd;
      const view = {
        sessionId: sid,
        name: l?.name || path5.basename(cwd),
        cwd,
        state,
        pendingAppMessageIds: disconnected ? [] : (await peek(sid)).map((m) => m.id),
        _sort: Date.parse(reg.connectedAt) || 0
      };
      if (waitingKind) view.waitingKind = waitingKind;
      if (lastEvent) view.lastEvent = lastEvent;
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
        this.readers.delete(sid);
      } else {
        this.pending.delete(sid);
        continue;
      }
      const events = this.pending.get(sid);
      this.pending.delete(sid);
      if (events?.length) changes.push({ type: "events", sessionId: sid, events });
    }
    for (const m of [this.readers, this.pending, this.lastEvents, this.misses]) {
      for (const sid of [...m.keys()]) if (!known.has(sid)) m.delete(sid);
    }
    const { connected, others } = await this.listSessions();
    const signature = JSON.stringify({
      others,
      connected: connected.map((s) => [
        s.sessionId,
        s.state,
        s.waitingKind ?? null,
        s.name,
        s.lastEvent?.id ?? null,
        s.pendingAppMessageIds
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
    const msg = await enqueue(sid, text);
    const again = await getRegistration(sid);
    if (!again || !isActive(again)) {
      const dir = paths().inboxDir(sid);
      try {
        for (const n of await fs5.readdir(dir)) if (n.endsWith(`-${msg.id}.msg`)) await fs5.rm(path5.join(dir, n), { force: true });
      } catch {
      }
      throw new SessionDisconnectedError(sid);
    }
    return { id: msg.id };
  }
};

// src/core/lock.ts
import fs6 from "node:fs/promises";
import path6 from "node:path";
import crypto2 from "node:crypto";
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
  const tmp = `${file}.${crypto2.randomUUID()}.tmp`;
  try {
    await fs6.writeFile(tmp, String(process.pid), { flag: "wx" });
    await fs6.link(tmp, file);
    return true;
  } catch (e) {
    if (["EEXIST", "EPERM", "EBUSY"].includes(code(e) ?? "")) return false;
    throw e;
  } finally {
    await fs6.rm(tmp, { force: true });
  }
}
async function staleContent(file) {
  let content;
  try {
    content = await fs6.readFile(file, "utf8");
  } catch (e) {
    if (code(e) === "ENOENT") return null;
    content = "";
  }
  const pid = parseInt(content, 10);
  if (Number.isInteger(pid) && pid > 0) return isAlive(pid) ? null : content;
  try {
    const st = await fs6.stat(file);
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
      const st = await fs6.stat(guard);
      if (Date.now() - st.mtimeMs > GUARD_STALE_MS) await fs6.rm(guard, { force: true });
    } catch {
    }
    return false;
  }
  try {
    if (await staleContent(file) !== seen) return false;
    try {
      await fs6.unlink(file);
    } catch (e) {
      if (code(e) !== "ENOENT") {
        if (contention(e)) return false;
        throw e;
      }
    }
    return await publish(file);
  } finally {
    try {
      if (await fs6.readFile(guard, "utf8") === String(process.pid)) await fs6.rm(guard, { force: true });
    } catch {
    }
  }
}
async function acquireLock(file) {
  await ensureDir(path6.dirname(file));
  if (await publish(file)) return true;
  const seen = await staleContent(file);
  if (seen === null) return false;
  return reclaimStaleLock(file, seen);
}
async function releaseLock(file) {
  await fs6.rm(file, { force: true });
}

// src/hub/server.ts
import http from "node:http";
import fs7 from "node:fs/promises";
import path7 from "node:path";
import crypto3 from "node:crypto";

// src/core/config.ts
var LANGS = ["en", "pt-BR"];
async function loadConfig() {
  const c = await readJson(paths().config);
  const language = LANGS.includes(c?.language) ? c.language : "en";
  return { language };
}
async function saveConfig(c) {
  await writeJsonAtomic(paths().config, c);
}

// src/core/version.ts
var VERSION = "0.1.0";

// src/hub/server.ts
var MAX_BODY = 64 * 1024;
var MAX_TEXT = 32e3;
var HEARTBEAT_MS = 15e3;
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
  return crypto3.timingSafeEqual(a, b);
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
  const clients = /* @__PURE__ */ new Set();
  let pollTimer = null;
  let heartbeat = null;
  let closed = false;
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
    const root = path7.resolve(staticDir);
    const target = path7.resolve(root, "." + path7.sep + rel);
    if (target !== root && !target.startsWith(root + path7.sep)) return sendJson(res, 404, { error: "not found" });
    const send = async (file) => {
      try {
        const st = await fs7.stat(file);
        if (!st.isFile()) return false;
        const data = await fs7.readFile(file);
        const ext = path7.extname(file).toLowerCase();
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
      rootExists = (await fs7.stat(root)).isDirectory();
    } catch {
      rootExists = false;
    }
    const accepts = String(req.headers.accept ?? "").includes("text/html");
    const spaEligible = req.method === "GET" && accepts && path7.extname(pathname) === "";
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
      if (await send(path7.join(root, "index.html"))) return;
    }
    sendJson(res, 404, { error: "not found" });
  };
  const handleApi = async (req, res, url) => {
    const p = url.pathname;
    const method = req.method ?? "GET";
    if (p === "/api/health" && method === "GET") return sendJson(res, 200, { ok: true, pid: process.pid, version: VERSION });
    const bearer = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ""))?.[1];
    const given = p === "/api/stream" ? bearer ?? url.searchParams.get("token") : bearer;
    if (!tokenOk(given, token)) return sendJson(res, 401, { error: "unauthorized" });
    if (p === "/api/stream" && method === "GET") {
      res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
      res.write("retry: 3000\n\n");
      clients.add(res);
      startTimers();
      res.on("close", () => {
        clients.delete(res);
        if (clients.size === 0) stopTimers();
      });
      return;
    }
    if (p === "/api/sessions" && method === "GET") return sendJson(res, 200, await provider.listSessions());
    if (p === "/api/config" && method === "GET") return sendJson(res, 200, await loadConfig());
    if (p === "/api/config" && method === "PUT") {
      const body = await readJsonBody(req);
      if (!body || typeof body !== "object" || !LANGS2.includes(body.language)) throw new HttpError(400, "invalid language");
      await saveConfig({ language: body.language });
      return sendJson(res, 200, { language: body.language });
    }
    const m = /^\/api\/sessions\/([^/]+)\/(events|messages)$/.exec(p);
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
      if (e instanceof SessionDisconnectedError) return sendJson(res, 409, { error: "session disconnected" });
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
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => {
      closed = true;
      stopTimers();
      for (const r of clients) r.end();
      clients.clear();
      server.close(() => resolve());
      server.closeAllConnections();
    })
  };
}

// src/hub/main.ts
var TOKEN_RE = /^[0-9a-f]{64}$/;
async function ensureToken(log = () => {
}) {
  const file = paths().token;
  await ensureDir(path8.dirname(file));
  for (let attempt = 0; attempt < 3; attempt++) {
    const t = crypto4.randomBytes(32).toString("hex");
    try {
      await fs8.writeFile(file, t, { flag: "wx", mode: 384 });
      return t;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    let existing = "";
    try {
      existing = (await fs8.readFile(file, "utf8")).trim();
    } catch {
      continue;
    }
    if (TOKEN_RE.test(existing)) {
      await fs8.chmod(file, 384).catch(() => {
      });
      return existing;
    }
    await writeFileAtomic600(file, t);
    log("token file was invalid; regenerated");
    return t;
  }
  throw new Error("could not create token file");
}
async function writeFileAtomic600(file, data) {
  const tmp = `${file}.${process.pid}.${crypto4.randomUUID()}.tmp`;
  try {
    await fs8.writeFile(tmp, data, { mode: 384 });
    await fs8.rename(tmp, file);
  } catch (e) {
    await fs8.rm(tmp, { force: true });
    throw e;
  }
}
async function liveHubExists() {
  const info = await readJson(paths().hubJson);
  if (!info || typeof info.port !== "number") return false;
  try {
    const r = await fetch(`http://127.0.0.1:${info.port}/api/health`, { signal: AbortSignal.timeout(1e3) });
    return r.ok && (await r.json()).ok === true;
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
async function startHub() {
  if (await liveHubExists()) return null;
  const logDir = paths().logDir;
  await ensureDir(logDir);
  const logFile = path8.join(logDir, "hub.log");
  let secret = "";
  const log = (msg) => {
    try {
      const line = secret ? msg.split(secret).join("[redacted]") : msg;
      fsSync.appendFileSync(logFile, `${(/* @__PURE__ */ new Date()).toISOString()} ${line}
`);
    } catch {
    }
  };
  const lock = path8.join(paths().home, "hub.lock");
  const locked = await acquireHubLock(lock);
  let hub;
  try {
    if (await liveHubExists()) return null;
    const token = await ensureToken(log);
    secret = token;
    const base = pickPort();
    const tries = base === 0 ? 1 : 11;
    const staticDir = path8.join(path8.dirname(fileURLToPath(import.meta.url)), "ui");
    const provider = new ClaudeCodeProvider();
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
    if (await liveHubExists()) {
      await hub.close();
      return null;
    }
    const port = Number(new URL(hub.url).port);
    await writeJsonAtomic(paths().hubJson, { pid: process.pid, port });
    log(`hub listening on ${hub.url}`);
    const started = hub;
    let done = false;
    return {
      port,
      close: async () => {
        if (done) return;
        done = true;
        await started.close();
        const cur = await readJson(paths().hubJson);
        if (cur?.pid === process.pid && cur?.port === port) await fs8.rm(paths().hubJson, { force: true });
        log("hub stopped");
      }
    };
  } finally {
    if (locked) await releaseLock(lock);
  }
}
async function main() {
  const hub = await startHub();
  if (!hub) process.exit(0);
  const stop = () => void hub.close().finally(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

// src/bin/hub.ts
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
