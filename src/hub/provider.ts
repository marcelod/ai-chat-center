import { getDisplayName } from '../core/names.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChatEvent, LiveSession, ProviderChange, SessionView } from '../shared/types.js';
import { getRegistration, isActive, listRegistrations, markDisconnected, sameConfigDir, trustedKeys, type Registration } from '../core/registry.js';
import { busyAge, clearBusy } from '../core/busy.js';
import { countUnsigned, enqueue, peek } from '../core/inbox.js';
import { getPending } from '../core/questions.js';
import { getWaiting } from '../core/waiting.js';
import { paths } from '../core/paths.js';
import { TranscriptReader } from './transcript/reader.js';
import { queryLiveSessions } from './status.js';
import { PROTOCOL } from '../core/version.js';

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

const LIVE_TTL_MS = 5000;
/** A busy marker this old while the session is idle was left by a turn that ended without Stop (interrupt). */
const STALE_BUSY_MS = 10_000;
const GRACE_MS = 15_000;
/** A waiter refreshes its lock every 10 s: a lock older than this has no live waiter behind it. */
const WAITER_HEARTBEAT_STALE_MS = 30_000;
/** Queued this long for an idle session with no live waiter: delivery is stalled (see deliveryStalled). */
const STALLED_AFTER_MS = 15_000;
const MISSES_TO_EXIT = 3;

export type ProviderOptions = { now?: () => number };

type Entry = { reader: TranscriptReader; read: boolean };
type Live = { list: LiveSession[]; ok: boolean; fresh: boolean };

export class ClaudeCodeProvider implements Provider {
  private readers = new Map<string, Entry>(); // active sessions only
  private pending = new Map<string, ChatEvent[]>(); // read but not yet emitted by poll
  private lastEvents = new Map<string, ChatEvent | undefined>(); // disconnected sessions
  private misses = new Map<string, { connectedAt: string; count: number }>();
  private liveCache: { at: number; value: LiveSession[] } | null = null;
  private lastGood: LiveSession[] | null = null;
  private lastSignature: string | null = null;
  private readonly now: () => number;

  constructor(
    private readonly listLive: () => Promise<LiveSession[] | null> = queryLiveSessions,
    opts: ProviderOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
  }

  private async live(force = false): Promise<Live> {
    const t = this.now();
    if (!force && this.liveCache && t >= this.liveCache.at && t - this.liveCache.at < LIVE_TTL_MS) {
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

  async listSessions(): Promise<{ connected: SessionView[]; others: LiveSession[] }> {
    const live = await this.live();
    const liveById = new Map(live.list.map((l) => [l.sessionId, l]));
    const regs = await listRegistrations();
    const connected: (SessionView & { _sort: number })[] = [];
    const activeIds = new Set<string>();

    for (const reg of regs) {
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
      if (disconnected) {
        lastEvent = await this.lastEventOf(reg);
      } else {
        const e = this.entry(reg);
        if (!e.read) await this.refresh(sid, e);
        lastEvent = e.reader.all().at(-1);
      }

      const waiting = disconnected ? null : await getWaiting(sid);
      const pendingQuestion = disconnected ? null : await getPending(sid);
      // Live status is the source of truth when the lookup succeeded; the waiting file only
      // decides when there is no live data for this session (failed lookup).
      let state: SessionView['state'];
      let waitingKind: SessionView['waitingKind'];
      if (disconnected) state = 'disconnected';
      else if (live.ok && l) {
        state = l.status;
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
      if (waitingKind) view.waitingKind = waitingKind;
      if (pendingQuestion) view.pendingQuestion = pendingQuestion;
      if (state === 'idle' && (await this.deliveryStalled(sid, queued))) view.deliveryStalled = true;
      const unsigned = disconnected ? 0 : await countUnsigned(sid);
      if (unsigned > 0) view.undeliveredUnsigned = unsigned;
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

    const others = live.list.filter((l) => l.kind === 'interactive' && !activeIds.has(l.sessionId));
    return { connected: connected.map(({ _sort, ...v }) => v), others };
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
        this.readers.delete(sid);
      } else {
        this.pending.delete(sid);
        continue;
      }
      const events = this.pending.get(sid);
      this.pending.delete(sid);
      if (events?.length) changes.push({ type: 'events', sessionId: sid, events });
    }
    for (const m of [this.readers, this.pending, this.lastEvents, this.misses] as Map<string, unknown>[]) {
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
        s.undeliveredUnsigned ?? 0,
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
    if (reg.protocol !== PROTOCOL) {
      throw new SessionProtocolError(sid, typeof reg.protocol === 'number' && reg.protocol > PROTOCOL ? 'newer' : 'older');
    }
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
