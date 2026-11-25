import { isPinned } from '../core/pins.js';
import { getDisplayName } from '../core/names.js';
import { readGitBranch } from '../core/gitBranch.js';
import { getEffort, getMode, shortModel } from '../core/meta.js';
import { readUsage } from '../core/usage.js';
import { getBackground } from '../core/background.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChatEvent, LiveSession, ProviderChange, SessionsResponse, SessionView } from '../shared/types.js';
import { getRegistration, isActive, isRemoved, listRegistrations, markDisconnected, sameConfigDir, trustedKeys, type Registration } from '../core/registry.js';
import { busyAge, clearBusy, isBusy } from '../core/busy.js';
import { countUnsigned, enqueue, peek } from '../core/inbox.js';
import { getPending } from '../core/questions.js';
import { getWaiting } from '../core/waiting.js';
import { paths } from '../core/paths.js';
import { TranscriptReader } from './transcript/reader.js';
import { queryLiveSessions } from './status.js';
import { PROTOCOL, VERSION } from '../core/version.js';
import { createClaudeProcessCheck } from '../hooks/parentClaude.js';
import { resumeView } from './resumeState.js';

export type { LiveSession, SessionView, ProviderChange };

export interface Provider {
  listSessions(): Promise<{ connected: SessionView[]; others: LiveSession[] }>;
  events(sid: string): Promise<ChatEvent[]>;
  poll(): Promise<ProviderChange[]>;
  send(sid: string, text: string): Promise<{ id: string }>;
}

export class SessionDisconnectedError extends Error {
  constructor(public readonly sessionId: string) {
    super(`Session ${sessionId} is disconnected`);
    this.name = 'SessionDisconnectedError';
  }
}

/**
 * The session's registration carries another message protocol (or none, before 0.2.4): it runs another copy
 * of the plugin (left open across `plugin update`), whose waiter would drop the message (audit R5-M1).
 * `direction`: the session's code is older or newer than this hub.
 */
export class SessionProtocolError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly direction: 'older' | 'newer',
  ) {
    super(`Session ${sessionId} runs a ${direction} version of AI Chat Center`);
    this.name = 'SessionProtocolError';
  }
}

/** Throws SessionProtocolError when the session's plugin speaks another protocol than this hub. */
export function assertSameProtocol(reg: Registration): void {
  if (reg.protocol !== PROTOCOL) {
    throw new SessionProtocolError(reg.sessionId, typeof reg.protocol === 'number' && reg.protocol > PROTOCOL ? 'newer' : 'older');
  }
}

/**
 * How old the `claude agents` answer may be. The lookup spawns a claude process (~0.2 s of CPU), so it
 * runs every 5 s only while something can change soon: a session is busy, waiting or has a busy marker
 * (a prompt was just sent), or a connected session is missing from the list (exit detection). With
 * every session idle and listed, every 30 s.
 */
const LIVE_TTL_MS = 5000;
const LIVE_IDLE_TTL_MS = 30_000;
/** A busy marker this old while the session is idle was left by a turn that ended without Stop (interrupt). */
const STALE_BUSY_MS = 10_000;
const GRACE_MS = 15_000;
/** A waiter refreshes its lock every 10 s: a lock older than this has no live waiter behind it. */
const WAITER_HEARTBEAT_STALE_MS = 30_000;
/** Queued this long for an idle session with no live waiter: delivery is stalled (see deliveryStalled). */
const STALLED_AFTER_MS = 15_000;
/** Claude Code creates the transcript with the /cc prompt: still missing this long after connecting, it is not written. */
const TRANSCRIPT_MISSING_AFTER_MS = 15_000;
const MISSES_TO_EXIT = 3;

export type ProviderOptions = {
  now?: () => number;
  /** For tests: whether a pid runs and is still claude. Default: createClaudeProcessCheck (src/hooks/parentClaude.ts). */
  isAlive?: (pid: number) => boolean;
};

type Entry = { reader: TranscriptReader; read: boolean };
type Live = { list: LiveSession[]; ok: boolean; fresh: boolean };

export class ClaudeCodeProvider implements Provider {
  private readers = new Map<string, Entry>(); // active sessions only
  private pending = new Map<string, ChatEvent[]>(); // read but not yet emitted by poll
  private lastEvents = new Map<string, ChatEvent | undefined>(); // disconnected sessions
  private lastModels = new Map<string, string | undefined>(); // disconnected sessions
  private misses = new Map<string, { connectedAt: string; count: number }>();
  private liveCache: { at: number; value: LiveSession[] } | null = null;
  private lastGood: LiveSession[] | null = null;
  private lastSignature: string | null = null;
  private readonly now: () => number;
  private readonly alive: (pid: number) => boolean;

  constructor(
    private readonly listLive: () => Promise<LiveSession[] | null> = queryLiveSessions,
    opts: ProviderOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.alive = opts.isAlive ?? createClaudeProcessCheck();
  }

  private async live(force = false, ttl = LIVE_TTL_MS): Promise<Live> {
    const t = this.now();
    if (!force && this.liveCache && t >= this.liveCache.at && t - this.liveCache.at < ttl) {
      return { list: this.liveCache.value, ok: true, fresh: false };
    }
    const value = await this.listLive();
    if (value === null) return { list: this.lastGood ?? [], ok: false, fresh: false }; // never cache a failure
    this.liveCache = { at: t, value };
    this.lastGood = value;
    return { list: value, ok: true, fresh: true };
  }

  /** Cached reader of an active session; replaced when its transcript (resume) or keys change. */
  private entry(reg: Registration): Entry {
    const sid = reg.sessionId;
    const keys = trustedKeys(reg);
    let e = this.readers.get(sid);
    if (e && (e.reader.path !== reg.transcriptPath || (e.reader.keys ?? []).join() !== keys.join())) {
      this.readers.delete(sid);
      this.pending.delete(sid);
      e = undefined;
    }
    if (!e) {
      e = { reader: new TranscriptReader(reg.transcriptPath, keys), read: false };
      this.readers.set(sid, e);
    }
    return e;
  }

  /** Read new events, buffering them for the next poll so no consumer steals them. */
  private async refresh(sid: string, e: Entry): Promise<void> {
    const evs = await e.reader.readNew();
    e.read = true;
    if (evs.length) this.pending.set(sid, [...(this.pending.get(sid) ?? []), ...evs]);
  }

  private async lastEventOf(reg: Registration): Promise<ChatEvent | undefined> {
    const sid = reg.sessionId;
    if (this.lastEvents.has(sid)) return this.lastEvents.get(sid);
    const existing = this.readers.get(sid);
    if (existing) {
      await this.refresh(sid, existing);
      return existing.reader.all().at(-1); // poll evicts and caches it
    }
    const tmp = new TranscriptReader(reg.transcriptPath, trustedKeys(reg));
    await tmp.readNew();
    const last = tmp.all().at(-1);
    this.lastEvents.set(sid, last);
    this.lastModels.set(sid, tmp.model());
    return last;
  }

  private shouldMarkExited(reg: Registration, live: Live): boolean {
    const { sessionId: sid, connectedAt } = reg;
    // `claude agents` only lists sessions of the hub's own Claude config dir (audit S4-U3).
    if (!sameConfigDir(reg)) return false;
    let m = this.misses.get(sid);
    if (!m || m.connectedAt !== connectedAt) {
      m = { connectedAt, count: 0 };
      this.misses.set(sid, m);
    }
    if (!live.ok) return false;
    // Claude Code sometimes leaves a session out of `claude agents` for its whole life (its entry in
    // ~/.claude/sessions was never written). Its claude process, known from the hook's parent, still
    // runs and is listed under no other session: it is alive, not exited. Listed under another session
    // id, it was replaced (/clear) and the usual rule applies.
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
  private async deliveryStalled(sid: string, queued: { createdAt: string }[]): Promise<boolean> {
    const oldest = Math.min(...queued.map((m) => Date.parse(m.createdAt)).filter((n) => !Number.isNaN(n)));
    if (!Number.isFinite(oldest) || this.now() - oldest < STALLED_AFTER_MS) return false;
    try {
      return this.now() - (await fs.stat(paths().waiterLock(sid))).mtimeMs > WAITER_HEARTBEAT_STALE_MS;
    } catch {
      return true; // no lock: no waiter
    }
  }

  /**
   * The session's transcript does not exist some time after it connected: Claude Code is not writing it
   * (a claude started from a terminal that inherited another session's CLAUDE_CODE_* variables runs as a
   * child session and keeps no transcript). Messages are still delivered, but the app sees neither them nor
   * the replies, so it says why instead of showing them as not delivered.
   */
  private async transcriptMissing(transcriptPath: string, connectedAt: string): Promise<boolean> {
    if (this.now() - (Date.parse(connectedAt) || 0) < TRANSCRIPT_MISSING_AFTER_MS) return false;
    try {
      await fs.stat(transcriptPath);
      return false;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'ENOENT';
    }
  }

  private async dropStaleBusy(sid: string): Promise<void> {
    const age = await busyAge(sid, this.now());
    if (age !== null && age > STALE_BUSY_MS) await clearBusy(sid);
  }

  /**
   * Exit detection on its own, for the hub's background check (no browser needed). Same rules as
   * listSessions: a failed lookup marks nothing; a session is marked exited only after the grace period
   * and 3 fresh lookups in a row that do not list it. Always a fresh lookup (it runs every few minutes).
   * Returns the sessions marked exited.
   */
  async detectExits(): Promise<string[]> {
    const live = await this.live(true);
    if (!live.ok) return [];
    const listed = new Set(live.list.map((l) => l.sessionId));
    const gone: string[] = [];
    for (const reg of await listRegistrations()) {
      const sid = reg.sessionId;
      if (!isActive(reg)) continue;
      if (listed.has(sid)) {
        this.misses.delete(sid);
      } else if (this.shouldMarkExited(reg, live)) {
        await markDisconnected(sid, 'exited');
        this.misses.delete(sid);
        gone.push(sid);
      }
    }
    return gone;
  }

  /** The lookup age to accept now: short while anything may change soon, long when all is idle (see LIVE_IDLE_TTL_MS). */
  private async liveTtl(regs: Registration[]): Promise<number> {
    const last = this.liveCache?.value;
    if (!last) return LIVE_TTL_MS;
    const byId = new Map(last.map((l) => [l.sessionId, l]));
    for (const reg of regs) {
      if (!isActive(reg)) continue;
      const sid = reg.sessionId;
      const l = byId.get(sid);
      // Connected after the last lookup: its first status should not wait for the long TTL.
      if ((Date.parse(reg.connectedAt) || 0) > this.liveCache!.at) return LIVE_TTL_MS;
      if (l) {
        // Busy or waiting, or its claude just exited (Ctrl-D): exit detection needs fresh lookups.
        if (l.status !== 'idle' || (reg.pid !== null && !this.alive(reg.pid))) return LIVE_TTL_MS;
      } else if (sameConfigDir(reg) && !(reg.pid !== null && this.alive(reg.pid) && !last.some((x) => x.pid === reg.pid))) {
        return LIVE_TTL_MS;
      }
      if ((await busyAge(sid, this.now())) !== null || (await getWaiting(sid)) || (await getPending(sid))) return LIVE_TTL_MS;
    }
    return LIVE_IDLE_TTL_MS;
  }

  async listSessions(): Promise<SessionsResponse> {
    const regs = await listRegistrations();
    const live = await this.live(false, await this.liveTtl(regs));
    const liveById = new Map(live.list.map((l) => [l.sessionId, l]));
    const connected: (SessionView & { _sort: number })[] = [];
    const activeIds = new Set<string>();

    for (const reg of regs) {
      // Removed from the app by the user: hidden until a new /cc registers it again.
      if (isRemoved(reg)) continue;
      const sid = reg.sessionId;
      const l = liveById.get(sid);
      let disconnected = !isActive(reg);
      if (!disconnected) {
        if (l) this.misses.delete(sid);
        else if (this.shouldMarkExited(reg, live)) {
          await markDisconnected(sid, 'exited');
          this.misses.delete(sid);
          disconnected = true;
        }
      }
      if (!disconnected) activeIds.add(sid);

      let lastEvent: ChatEvent | undefined;
      let rawModel: string | undefined;
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
      // Live status is the source of truth when the lookup succeeded; the waiting file only
      // decides when there is no live data for this session (failed lookup).
      let state: SessionView['state'];
      let waitingKind: SessionView['waitingKind'];
      if (disconnected) state = 'disconnected';
      else if (live.ok && l) {
        // `claude agents` says busy while a background task (shell, monitor) runs after the turn ended: busy
        // needs the hub's turn marker too, otherwise the session is idle.
        state = l.status === 'busy' && !(await isBusy(sid)) ? 'idle' : l.status;
        if (l.status === 'waiting') waitingKind = waiting?.kind ?? 'permission';
      } else if (waiting) {
        state = 'waiting';
        waitingKind = waiting.kind;
      } else state = l?.status ?? 'idle';
      if (pendingQuestion) {
        state = 'waiting';
        waitingKind = 'question';
      }
      if (!disconnected && live.ok && l?.status === 'idle') await this.dropStaleBusy(sid);
      const cwd = l?.cwd ?? reg.cwd;
      const queued = disconnected ? [] : await peek(sid);
      const originalName = l?.name || path.basename(cwd);
      const custom = await getDisplayName(sid);
      const view: SessionView & { _sort: number } = {
        sessionId: sid,
        name: custom ?? originalName,
        cwd,
        state,
        pendingAppMessageIds: queued.map((m) => m.id),
        pendingAppMessages: queued.map(({ id, text, createdAt }) => ({ id, text, createdAt })),
        _sort: Date.parse(reg.connectedAt) || 0,
      };
      if (custom) view.originalName = originalName;
      if (await isPinned(sid)) view.pinned = true;
      if (waitingKind) view.waitingKind = waitingKind;
      if (pendingQuestion) view.pendingQuestion = pendingQuestion;
      if (state === 'idle' && (await this.deliveryStalled(sid, queued))) view.deliveryStalled = true;
      if (!disconnected && (await this.transcriptMissing(reg.transcriptPath, reg.connectedAt))) view.transcriptMissing = true;
      const unsigned = disconnected ? 0 : await countUnsigned(sid);
      if (unsigned > 0) view.undeliveredUnsigned = unsigned;
      if (lastEvent) view.lastEvent = lastEvent;
      const branch = await readGitBranch(cwd);
      if (branch) view.branch = branch;
      if (rawModel) view.model = shortModel(rawModel);
      const effort = await getEffort(sid);
      if (effort) view.effort = effort;
      const mode = await getMode(sid);
      if (mode && !disconnected) view.mode = mode; // a stale mode would mislead
      const background = await getBackground(sid);
      if (background) view.background = background;
      if (!disconnected && reg.version) view.pluginVersion = reg.version;
      const claudeVersion = disconnected ? undefined : this.readers.get(sid)?.reader.claudeVersion();
      if (claudeVersion) view.claudeVersion = claudeVersion;
      if (!disconnected && l?.bgId) view.bgId = l.bgId;
      Object.assign(view, resumeView(sid, disconnected ? null : reg.connectedAt, this.now()));
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

    const others = live.list.filter((l) => l.kind === 'interactive' && !activeIds.has(l.sessionId));
    const usage = await readUsage();
    return { connected: connected.map(({ _sort, ...v }) => v), others, hubVersion: VERSION, ...(usage ? { usage } : {}) };
  }

  async events(sid: string): Promise<ChatEvent[]> {
    const reg = await getRegistration(sid);
    if (!reg) return [];
    if (!isActive(reg)) {
      const tmp = new TranscriptReader(reg.transcriptPath, trustedKeys(reg)); // not cached: bounded memory
      await tmp.readNew();
      return tmp.all();
    }
    const e = this.entry(reg);
    await this.refresh(sid, e);
    return e.reader.all();
  }

  async poll(): Promise<ProviderChange[]> {
    const changes: ProviderChange[] = [];
    const regs = await listRegistrations();
    const known = new Set(regs.map((r) => r.sessionId));
    for (const reg of regs) {
      const sid = reg.sessionId;
      if (isActive(reg)) {
        await this.refresh(sid, this.entry(reg));
      } else if (this.readers.has(sid)) {
        // final read of a just-disconnected session, then evict its reader
        const e = this.readers.get(sid)!;
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
      if (events?.length) changes.push({ type: 'events', sessionId: sid, events });
    }
    for (const m of [this.readers, this.pending, this.lastEvents, this.lastModels, this.misses] as Map<string, unknown>[]) {
      for (const sid of [...m.keys()]) if (!known.has(sid)) m.delete(sid);
    }

    const { connected, others, usage } = await this.listSessions();
    const signature = JSON.stringify({
      others,
      // updatedAt left out: an unchanged value refreshed every minute is not a change worth a refetch.
      usage: usage ? [usage.fiveHour ?? null, usage.sevenDay ?? null] : null,
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
        s.effort ?? null,
        s.mode ?? null,
        s.background ?? null,
        s.pinned ?? false,
        s.bgId ?? null,
        s.resuming ?? false,
        s.resumeError ?? null,
      ]),
    });
    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      changes.push({ type: 'sessions' });
    }
    return changes;
  }

  async send(sid: string, text: string): Promise<{ id: string }> {
    const reg = await getRegistration(sid);
    if (!reg || !isActive(reg)) throw new SessionDisconnectedError(sid);
    assertSameProtocol(reg);
    const msg = await enqueue(sid, text);
    const again = await getRegistration(sid);
    if (!again || !isActive(again)) {
      // Disconnected while enqueuing: take the message back so it is not delivered to a later session.
      const dir = paths().inboxDir(sid);
      try {
        for (const n of await fs.readdir(dir)) if (n.endsWith(`-${msg.id}.msg`)) await fs.rm(path.join(dir, n), { force: true });
      } catch {
        /* inbox already gone */
      }
      throw new SessionDisconnectedError(sid);
    }
    return { id: msg.id };
  }
}
