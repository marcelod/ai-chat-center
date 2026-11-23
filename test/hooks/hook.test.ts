import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { handleHook, isCcCommand, type HookInput } from '../../src/hooks/hook.js';
import { ensureHub, checkHealth, hubSpawnOptions } from '../../src/hooks/ensureHub.js';
import { PROTOCOL, VERSION } from '../../src/core/version.js';
import { register, getRegistration, markDisconnected } from '../../src/core/registry.js';
import { isBusy, setBusy } from '../../src/core/busy.js';
import { getWaiting, setWaiting } from '../../src/core/waiting.js';
import { paths } from '../../src/core/paths.js';
import { saveConfig, loadConfig } from '../../src/core/config.js';
import { getTurnOrigin, setTurnOrigin } from '../../src/core/turn.js';
import { ANSWERS_ON, ANSWERS_OFF, WINDOW_ON, WINDOW_OFF } from '../../src/hooks/hook.js';
import { tmpDir } from '../helpers/tmp.js';

const URL_ = 'http://127.0.0.1:7777/#token=t';
const ctx = (parentPid = 42) => ({
  ensureHub: async () => URL_,
  resolvePid: async (): Promise<number | null> => parentPid,
});
const inp = (o: Partial<HookInput> = {}): HookInput => ({
  session_id: 's1',
  transcript_path: '/t.jsonl',
  cwd: '/x',
  ...o,
});

beforeEach(() => {
  process.env.AI_CHAT_CENTER_HOME = tmpDir('acc-');
});

const out = (r: { stdout?: string }) => JSON.parse(r.stdout!) as {
  systemMessage?: string;
  hookSpecificOutput: { hookEventName: string; additionalContext: string };
};
const keyOf = async () => (await getRegistration('s1'))!.key!;

describe('hook', () => {
  // Audit RT7 / AI-F9: the sync session-start hook is gone; its work moved to the async start waiter.
  it('session-start is no longer handled synchronously: no lookup, no writes', async () => {
    await register({ sessionId: 'A', transcriptPath: '/a', cwd: '/x', pid: 42 });
    let lookups = 0;
    const c = { ...ctx(), resolvePid: async () => (lookups++, 42) };
    for (const source of ['startup', 'resume', 'clear', 'compact']) {
      // @ts-expect-error removed event
      expect(await handleHook('session-start', inp({ session_id: 'B', source }), c)).toEqual({ exitCode: 0 });
    }
    expect(lookups).toBe(0);
    expect((await getRegistration('A'))?.disconnectedAt).toBeUndefined();
  });

  it('ignores unregistered session', async () => {
    let lookups = 0;
    const c = { ...ctx(), resolvePid: async () => (lookups++, 42) };
    for (const ev of ['prompt-submit', 'notification'] as const) {
      const r = await handleHook(ev, inp({ prompt: 'hello', notification_type: 'permission_prompt' }), c);
      expect(r).toEqual({ exitCode: 0 });
    }
    expect(await handleHook('prompt-submit', inp({ session_id: '../x', prompt: '/cc' }), c)).toEqual({ exitCode: 0 });
    expect(fs.readdirSync(paths().home)).toEqual([]);
    expect(lookups).toBe(0);
  });

  // Audit SEC-F3 / AI-F6: the token URL goes only to the user (systemMessage), never to the model.
  it('/cc registers with a fresh key; the url is only in the user-visible systemMessage', async () => {
    const r = await handleHook('prompt-submit', inp({ prompt: '/cc' }), ctx());
    const reg = await getRegistration('s1');
    expect(reg).toMatchObject({ sessionId: 's1', pid: 42, cwd: '/x', transcriptPath: '/t.jsonl' });
    expect(reg!.key).toMatch(/^[0-9a-f]{32}$/);
    expect(out(r)).toEqual({
      systemMessage: `AI Chat Center is ready: ${URL_}`,
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: `AI Chat Center: connected\nAI Chat Center key: ${reg!.key}`,
      },
    });
    expect(out(r).hookSpecificOutput.additionalContext).not.toContain('token');
    expect(out(r).hookSpecificOutput.additionalContext).not.toContain('http');
  });

  // D7: user-visible lines follow the configured language; protocol lines stay English.
  it('systemMessage lines are localized with the configured language', async () => {
    await saveConfig({ language: 'pt-BR' });
    const r = await handleHook('prompt-submit', inp({ prompt: '/cc' }), ctx());
    expect(out(r).systemMessage).toBe(`AI Chat Center pronto: ${URL_}`);
    expect(out(r).hookSpecificOutput.additionalContext).toMatch(/^AI Chat Center: connected\n/);
    const f = await handleHook('prompt-submit', inp({ prompt: '/cc' }), { ...ctx(), ensureHub: async () => { throw new Error('x'); } });
    expect(out(f).systemMessage).toBe(`AI Chat Center: o hub não iniciou. Veja ${path.join(paths().logDir, 'hook.log')}`);
    const u = await handleHook('prompt-submit', inp({ prompt: '/cc foo' }), ctx());
    expect(out(u).systemMessage).toBe('AI Chat Center: argumento desconhecido. Use /cc, /ai-chat-center:cc off, /ai-chat-center:cc answers on, /ai-chat-center:cc answers off, /ai-chat-center:cc window on ou /ai-chat-center:cc window off.');
    expect(out(u).hookSpecificOutput.additionalContext).toBe('AI Chat Center: unknown argument. Use /cc, /ai-chat-center:cc off, /ai-chat-center:cc answers on, /ai-chat-center:cc answers off, /ai-chat-center:cc window on or /ai-chat-center:cc window off.');
  });

  // Audit S4-U3: the registration records the Claude config dir of the session.
  // Audit R5-M1: the hub refuses sends to a session running another protocol; /cc stamps the registration.
  it('/cc records the plugin version and the protocol in the registration', async () => {
    await handleHook('prompt-submit', inp({ prompt: '/cc' }), ctx());
    expect(await getRegistration('s1')).toMatchObject({ version: VERSION, protocol: PROTOCOL });
  });
  it('a prompt in an active session stamped by another version re-stamps it; a current stamp is not rewritten', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t.jsonl', cwd: '/x', pid: 42, key: 'k', version: '0.0.1', protocol: 1 });
    await handleHook('prompt-submit', inp({ prompt: 'hello' }), ctx());
    const r = (await getRegistration('s1'))!;
    expect(r).toMatchObject({ version: VERSION, protocol: PROTOCOL, key: 'k', pid: 42 });
    const file = path.join(paths().sessionsDir, 's1.json');
    const before = fs.statSync(file).mtimeMs;
    await new Promise((res) => setTimeout(res, 20));
    await handleHook('prompt-submit', inp({ prompt: 'again' }), ctx());
    expect(fs.statSync(file).mtimeMs).toBe(before);
  });
  it('/cc records the Claude config dir (CLAUDE_CONFIG_DIR, else ~/.claude)', async () => {
    const prev = process.env.CLAUDE_CONFIG_DIR;
    try {
      delete process.env.CLAUDE_CONFIG_DIR;
      await handleHook('prompt-submit', inp({ prompt: '/cc' }), ctx());
      expect((await getRegistration('s1'))!.configDir).toBe(path.join(os.homedir(), '.claude'));
      process.env.CLAUDE_CONFIG_DIR = path.join(os.tmpdir(), 'cfg-x');
      await handleHook('prompt-submit', inp({ session_id: 's2', prompt: '/cc' }), ctx());
      expect((await getRegistration('s2'))!.configDir).toBe(path.join(os.tmpdir(), 'cfg-x'));
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = prev;
    }
  });
  it('/cc keeps the key while active and makes a new one on reactivation', async () => {
    await handleHook('prompt-submit', inp({ prompt: '/cc' }), ctx());
    const k1 = await keyOf();
    await handleHook('prompt-submit', inp({ prompt: '/cc' }), ctx());
    expect(await keyOf()).toBe(k1);
    await handleHook('prompt-submit', inp({ prompt: '/cc off' }), ctx());
    await handleHook('prompt-submit', inp({ prompt: '/cc' }), ctx());
    const reg = (await getRegistration('s1'))!;
    expect(reg.key).not.toBe(k1);
    expect(reg.previousKeys).toEqual([k1]);
  });

  it('/cc when the claude pid cannot be resolved: registers with pid null and says so', async () => {
    const r = await handleHook('prompt-submit', inp({ prompt: '/cc' }), { ...ctx(), resolvePid: async () => null });
    const reg = (await getRegistration('s1'))!;
    expect(reg.pid).toBeNull();
    expect(reg.disconnectedAt).toBeUndefined();
    expect(out(r).hookSpecificOutput.additionalContext).toBe(
      `AI Chat Center: connected\nAI Chat Center key: ${reg.key}\n` +
        'AI Chat Center: could not identify the Claude process; closing the terminal will be detected by the hub.',
    );
  });

  it('/cc with an unknown argument changes nothing', async () => {
    const msg = 'AI Chat Center: unknown argument. Use /cc, /ai-chat-center:cc off, /ai-chat-center:cc answers on, /ai-chat-center:cc answers off, /ai-chat-center:cc window on or /ai-chat-center:cc window off.';
    const r = await handleHook('prompt-submit', inp({ prompt: '/cc foo' }), ctx());
    expect(out(r).hookSpecificOutput.additionalContext).toBe(msg);
    expect(fs.readdirSync(paths().home)).toEqual([]);
    await handleHook('prompt-submit', inp({ prompt: '/cc' }), ctx());
    const before = await getRegistration('s1');
    const r2 = await handleHook('prompt-submit', inp({ prompt: '/CC Offline' }), ctx());
    expect(out(r2).hookSpecificOutput.additionalContext).toBe(msg);
    expect(await getRegistration('s1')).toEqual(before);
    expect(await isBusy('s1')).toBe(false);
  });

  it('/ai-chat-center:cc off marks disconnected', async () => {
    await handleHook('prompt-submit', inp({ prompt: '/cc' }), ctx());
    const r = await handleHook('prompt-submit', inp({ prompt: '/ai-chat-center:cc off' }), ctx());
    expect(r.stdout).toBeUndefined();
    expect((await getRegistration('s1'))?.disconnectReason).toBe('off');
  });

  it('isCcCommand table', () => {
    expect(isCcCommand('/cc')).toBe('on');
    expect(isCcCommand('/CC')).toBe('on');
    expect(isCcCommand(' /cc off ')).toBe('off');
    expect(isCcCommand('/cc OFF')).toBe('off');
    expect(isCcCommand('/AI-Chat-Center:cc')).toBe('on');
    expect(isCcCommand('/ai-chat-center:cc')).toBe('on');
    expect(isCcCommand('/cc foo')).toBe('unknown');
    expect(isCcCommand('/cc off now')).toBe('unknown');
    expect(isCcCommand('/control-center:cc')).toBe(null);
    expect(isCcCommand('/ccx')).toBe(null);
    expect(isCcCommand('please /cc')).toBe(null);
    expect(isCcCommand(undefined)).toBe(null);
  });

  it('prompt-submit writes the busy marker only for active registrations', async () => {
    await handleHook('prompt-submit', inp({ prompt: 'hello' }), ctx());
    expect(fs.readdirSync(paths().home)).toEqual([]);
    await register({ sessionId: 's1', transcriptPath: '/t', cwd: '/x', pid: 42 });
    await handleHook('prompt-submit', inp({ prompt: 'hello' }), ctx());
    expect(await isBusy('s1')).toBe(true);
    await handleHook('prompt-submit', inp({ prompt: '/cc off' }), ctx());
    expect(await isBusy('s1')).toBe(false);
    await handleHook('prompt-submit', inp({ prompt: 'hello again' }), ctx());
    expect(await isBusy('s1')).toBe(false);
  });

  it('/cc clears the busy marker and the waiting state', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t', cwd: '/x', pid: 42 });
    await setBusy('s1');
    await handleHook('notification', inp({ notification_type: 'permission_prompt' }), ctx());
    await handleHook('prompt-submit', inp({ prompt: '/cc' }), ctx());
    expect(await isBusy('s1')).toBe(false);
    expect(await getWaiting('s1')).toBeNull();
  });

  it.skipIf(process.platform === 'win32')('/cc tightens an existing state home to 0700', async () => {
    fs.chmodSync(paths().home, 0o755);
    await handleHook('prompt-submit', inp({ prompt: '/cc' }), ctx());
    expect((fs.statSync(paths().home).mode & 0o777).toString(8)).toBe('700');
  });

  it('there is no stop event any more', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t', cwd: '/x', pid: 42 });
    await handleHook('notification', inp({ notification_type: 'permission_prompt' }), ctx());
    // @ts-expect-error removed event
    expect(await handleHook('stop', inp(), ctx())).toEqual({ exitCode: 0 });
    expect(await getWaiting('s1')).not.toBeNull();
  });

  it('notifications: permission and input kinds; idle_prompt is ignored; next prompt clears', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t', cwd: '/x', pid: 42 });
    await handleHook('notification', inp({ notification_type: 'idle_prompt' }), ctx());
    expect(await getWaiting('s1')).toBeNull();
    await handleHook('notification', inp({ notification_type: 'permission_prompt' }), ctx());
    expect((await getWaiting('s1'))?.kind).toBe('permission');
    await handleHook('notification', inp({ notification_type: 'idle_prompt' }), ctx());
    expect((await getWaiting('s1'))?.kind).toBe('permission');
    await handleHook('notification', inp({ notification_type: 'elicitation_url_dialog' }), ctx());
    expect((await getWaiting('s1'))?.kind).toBe('input');
    await handleHook('notification', inp({ notification_type: 'auth_success' }), ctx());
    expect((await getWaiting('s1'))?.kind).toBe('input');
    await handleHook('prompt-submit', inp({ prompt: 'hello' }), ctx());
    expect(await getWaiting('s1')).toBeNull();
    await handleHook('notification', inp({ notification_type: 'agent_needs_input' }), ctx());
    expect((await getWaiting('s1'))?.kind).toBe('input');
  });

  it('stores the resolved claude pid, not the parent pid', async () => {
    await handleHook('prompt-submit', inp({ prompt: '/cc' }), { ...ctx(42), resolvePid: async () => 999 });
    expect((await getRegistration('s1'))?.pid).toBe(999);
  });

  it('hub failure: keeps registration and tells the user where to look, without leaking a url', async () => {
    const r = await handleHook('prompt-submit', inp({ prompt: '/cc' }), {
      ...ctx(),
      ensureHub: async () => {
        throw new Error('hub did not start');
      },
    });
    expect((await getRegistration('s1'))?.disconnectedAt).toBeUndefined();
    const fail = `AI Chat Center: the hub failed to start. See ${path.join(paths().logDir, 'hook.log')}`;
    expect(out(r).hookSpecificOutput.additionalContext).toBe(`${fail}\nAI Chat Center key: ${await keyOf()}`);
    expect(out(r).systemMessage).toBe(fail);
    expect(r.stdout).not.toContain('token');
    expect(fs.readFileSync(path.join(paths().logDir, 'hook.log'), 'utf8')).toContain('hub did not start');
  });

  it('/cc re-run keeps connectedAt; after /cc off it starts fresh', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t', cwd: '/x', pid: 42, connectedAt: '2020-01-01T00:00:00.000Z' });
    await handleHook('prompt-submit', inp({ prompt: '/cc' }), ctx());
    expect((await getRegistration('s1'))?.connectedAt).toBe('2020-01-01T00:00:00.000Z');
    await handleHook('prompt-submit', inp({ prompt: '/cc off' }), ctx());
    await handleHook('prompt-submit', inp({ prompt: '/cc' }), ctx());
    const r = await getRegistration('s1');
    expect(r?.connectedAt).not.toBe('2020-01-01T00:00:00.000Z');
    expect(r?.disconnectedAt).toBeUndefined();
    expect(r?.disconnectReason).toBeUndefined();
  });

  // Audit R4-M2: an older hub that could not be verified is not stopped; /cc says so to the user.
  it('a notice from ensureHub is shown to the user and added to the status lines', async () => {
    const r = await handleHook('prompt-submit', inp({ prompt: '/cc' }), {
      ensureHub: async (notice?: (m: string) => void) => (notice?.('AI Chat Center: an older AI Chat Center hub could not be verified'), URL_),
      resolvePid: async () => 42,
    });
    const o = out(r);
    expect(o.hookSpecificOutput.additionalContext.split('\n')).toContain('AI Chat Center: an older AI Chat Center hub could not be verified');
    expect(o.systemMessage).toContain('could not be verified');
    expect(fs.readFileSync(path.join(paths().logDir, 'hook.log'), 'utf8')).toContain('could not be verified');
  });
  it('notification ignored for disconnected session', async () => {
    await register({ sessionId: 's1', transcriptPath: '/t', cwd: '/x', pid: 42 });
    await handleHook('prompt-submit', inp({ prompt: '/cc off' }), ctx());
    await handleHook('notification', inp({ notification_type: 'permission_prompt' }), ctx());
    expect(await getWaiting('s1')).toBeNull();
  });
});

describe('ensureHub', () => {
  const writeHub = (port: number, token = 'tok', pid = 1) => {
    fs.mkdirSync(paths().home, { recursive: true });
    fs.writeFileSync(paths().hubJson, JSON.stringify({ pid, port }));
    fs.writeFileSync(paths().token, token);
  };
  const serve = async (handler: (url: URL) => string) => {
    const srv = http.createServer((q, s) => s.end(handler(new URL(q.url!, 'http://x'))));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    return { srv, port: (srv.address() as { port: number }).port };
  };
  const proofOf = (token: string, challenge: string, port: number, pid: number, version: string) =>
    crypto.createHmac('sha256', token).update(`${challenge}|${port}|${pid}|${version}`).digest('hex');
  /** A health() that answers like a real hub holding `token` and listening on the dialed port. */
  const realHub = (token: string, pid: number, version = VERSION) => async (port: number, challenge: string) => ({
    ok: true as const, version, pid, proof: proofOf(token, challenge, port, pid, version),
  });

  it('checkHealth sends a challenge and returns the proven answer, or null', async () => {
    let seen = '';
    const good = await serve((u) => {
      seen = u.searchParams.get('challenge') ?? '';
      return JSON.stringify({ ok: true, version: 'v', pid: 5, proof: 'p' });
    });
    const legacy = await serve(() => JSON.stringify({ ok: true, pid: 5, version: 'v' }));
    try {
      const c = 'c'.repeat(32);
      expect(await checkHealth(good.port, c)).toEqual({ ok: true, version: 'v', pid: 5, proof: 'p' });
      expect(seen).toBe(c);
      expect(await checkHealth(legacy.port, c)).toBe('unproven');
    } finally {
      good.srv.close();
      legacy.srv.close();
    }
  });

  it('returns the url without spawning when the hub proves the token on disk and has this version', async () => {
    const { srv, port } = await serve((u) => {
      const c = u.searchParams.get('challenge')!;
      return JSON.stringify({ ok: true, version: VERSION, pid: 1, proof: proofOf('tok', c, port, 1, VERSION) });
    });
    writeHub(port);
    let spawned = 0;
    const url = await ensureHub({ spawnHub: () => void spawned++ });
    srv.close();
    expect(url).toBe(`http://127.0.0.1:${port}/#token=tok`);
    expect(spawned).toBe(0);
  });

  // Audit SEC-F1: an impostor on the recorded port (even one echoing the right pid) gets nothing.
  it('a hub that cannot prove the token is foreign: never trusted, its url never returned, a hub is spawned', async () => {
    writeHub(7777, 'tok', 1);
    for (const impostor of [
      async () => ({ ok: true as const, version: VERSION, pid: 1, proof: 'f'.repeat(64) }),
      realHub('other-token', 1),
    ]) {
      let spawned = 0;
      const killed: number[] = [];
      await expect(
        ensureHub({ spawnHub: () => void spawned++, health: impostor, identify: async () => null, kill: (p) => void killed.push(p), pollMs: 5, timeoutMs: 30 }),
      ).rejects.toThrow();
      expect(spawned).toBe(1);
      expect(killed).toEqual([]);
    }
  });

  // Audit S2-N1: a squatter on the recorded port relays the challenge to the real hub on another port.
  // The genuine proof it returns is bound to the real hub's port, so it fails on the port we dialed.
  it('a relayed proof (genuine, but for another port) is rejected: no url for the squatter port', async () => {
    writeHub(7777, 'tok', 1);
    const relay = (realPort: number) => async (_port: number, challenge: string) => realHub('tok', 1)(realPort, challenge);
    let spawned = 0;
    await expect(
      ensureHub({ spawnHub: () => void spawned++, health: relay(7778), pollMs: 5, timeoutMs: 30 }),
    ).rejects.toThrow();
    expect(spawned).toBe(1);
  });

  it('a proven hub of an older version is killed and replaced', async () => {
    writeHub(7777, 'tok', 1234);
    const killed: number[] = [];
    let current = realHub('tok', 1234, '0.0.1');
    const url = await ensureHub({
      health: (p, c) => current(p, c),
      kill: (pid) => void killed.push(pid),
      isAlive: () => false,
      spawnHub: () => {
        writeHub(7778, 'tok2', 4321);
        current = realHub('tok2', 4321);
      },
      pollMs: 5,
    });
    expect(killed).toEqual([1234]);
    expect(url).toBe('http://127.0.0.1:7778/#token=tok2');
  });

  // Audit S2-N4: two installed plugin versions must not keep replacing each other's hub.
  it('a proven hub of a newer version is used as is: never killed, nothing spawned', async () => {
    writeHub(7777, 'tok', 1234);
    const killed: number[] = [];
    let spawned = 0;
    const url = await ensureHub({
      health: realHub('tok', 1234, '99.0.0'),
      kill: (pid) => void killed.push(pid),
      spawnHub: () => void spawned++,
      pollMs: 5,
    });
    expect(url).toBe('http://127.0.0.1:7777/#token=tok');
    expect(killed).toEqual([]);
    expect(spawned).toBe(0);
  });
  it('compares versions as semver, not as strings', async () => {
    const { compareVersions } = await import('../../src/hooks/ensureHub.js');
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.2.0', '0.2.1')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(Number.isNaN(compareVersions('garbage', '1.0.0'))).toBe(true);
  });

  it('spawns when hub is down and polls until healthy', async () => {
    let spawned = 0;
    let up = false;
    const url = await ensureHub({
      spawnHub: () => {
        spawned++;
        writeHub(7777);
        setTimeout(() => (up = true), 30);
      },
      health: async (p, c) => (up ? realHub('tok', 1)(p, c) : null),
      pollMs: 5,
    });
    expect(spawned).toBe(1);
    expect(url).toBe('http://127.0.0.1:7777/#token=tok');
  });

  // Audit R3-F4: a hub stalled for a moment (load, antivirus, resume from sleep) got a twin that rotated
  // the token while the first kept running with the old one. While the recorded pid is alive and the
  // hub does not answer, keep asking (about 5 s) before starting another.
  it('a recorded hub that is alive but slow to answer is waited for, not replaced', async () => {
    writeHub(7777, 'tok', 777);
    let calls = 0;
    const ok = realHub('tok', 777);
    let spawned = 0;
    const url = await ensureHub({
      health: async (p, c) => (++calls <= 3 ? null : ok(p, c)),
      isAlive: (pid) => pid === 777,
      spawnHub: () => void spawned++,
      pollMs: 5,
      stalledWaitMs: 2000,
    });
    expect(spawned).toBe(0);
    expect(calls).toBe(4);
    expect(url).toContain('127.0.0.1:7777/');
  });
  it('a recorded hub whose pid is dead is not waited for', async () => {
    writeHub(7777, 'tok', 777);
    let calls = 0;
    let spawned = 0;
    await expect(
      ensureHub({ health: async () => (calls++, null), isAlive: () => false, spawnHub: () => void spawned++, pollMs: 5, timeoutMs: 30, stalledWaitMs: 2000 }),
    ).rejects.toThrow();
    expect(spawned).toBe(1);
    // one check of the recorded hub, then only the post-spawn polls (bounded by timeoutMs)
    expect(calls).toBeLessThan(12);
  });
  it('a foreign answer (bad proof) is not waited for', async () => {
    writeHub(7777, 'tok', 777);
    let calls = 0;
    let spawned = 0;
    const t = Date.now();
    await expect(
      ensureHub({
        health: async () => (calls++, { ok: true as const, version: VERSION, pid: 777, proof: 'f'.repeat(64) }),
        identify: async () => null,
        isAlive: () => true,
        spawnHub: () => void spawned++,
        pollMs: 5,
        timeoutMs: 30,
        stalledWaitMs: 5000,
      }),
    ).rejects.toThrow();
    expect(spawned).toBe(1);
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it('rejects when hub never comes up', async () => {
    await expect(
      ensureHub({ spawnHub: () => {}, health: async () => null, pollMs: 5, timeoutMs: 50 }),
    ).rejects.toThrow();
  });

  // Audit R4-M2 / R4-L2: older hubs of our own that cannot prove the token (0.1.0 answers a version-only
  // health), a proven 0.2.1 hub, and the refused case. Real HTTP servers, the default checkHealth.
  describe('older hubs and the upgrade path', () => {
    const TOK = 'a'.repeat(64);
    /** Every Authorization header any fake hub received (the token on disk must never reach a foreign one). */
    const bearers: string[] = [];
    /**
     * A fake hub: `/api/health` as `version` answers it, and `/api/config` behind the bearer `token`.
     * `proofs`: true = the current proof format; false = 0.1.0 (`{ ok, pid, version }`, no proof); '0.2.0' =
     * no pid unchallenged, a proof WITHOUT the port when challenged. `pidInHealth: false` leaves the pid out
     * of every answer; `anyBearer` accepts any bearer (a foreign server answering 200 to everything).
     */
    const fakeHub = async (
      version: string,
      pid: number,
      token: string,
      proofs: boolean | '0.2.0',
      extra: { pidInHealth?: boolean; anyBearer?: boolean } = {},
    ) => {
      const srv = http.createServer((q, s) => {
        const u = new URL(q.url!, 'http://x');
        if (q.headers.authorization) bearers.push(q.headers.authorization);
        if (u.pathname === '/api/health') {
          const c = u.searchParams.get('challenge');
          const port = (srv.address() as { port: number }).port;
          let body: Record<string, unknown>;
          if (proofs === '0.2.0') {
            body = c
              ? { ok: true, version, pid, proof: crypto.createHmac('sha256', token).update(`${c}|${pid}|${version}`).digest('hex') }
              : { ok: true, version };
          } else body = proofs && c ? { ok: true, version, pid, proof: proofOf(token, c, port, pid, version) } : proofs ? { ok: true, version } : { ok: true, pid, version };
          if (extra.pidInHealth === false) delete body.pid;
          return void s.end(JSON.stringify(body));
        }
        if (!extra.anyBearer && q.headers.authorization !== `Bearer ${token}`) {
          s.writeHead(401);
          return void s.end('{"error":"unauthorized"}');
        }
        s.end('{"language":"en"}');
      });
      await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
      return { srv, port: (srv.address() as { port: number }).port };
    };
    /** spawnHub: starts a current hub (tok2, pid 9999) and records it in hub.json. */
    const spawnCurrent = (servers: http.Server[]) => async () => {
      const h = await fakeHub(VERSION, 9999, 'b'.repeat(64), true);
      servers.push(h.srv);
      writeHub(h.port, 'b'.repeat(64), 9999);
    };
    const run = async (o: {
      version: string;
      pid: number;
      token?: string;
      proofs: boolean | '0.2.0';
      alive?: (pid: number) => boolean;
      pidInHealth?: boolean;
      anyBearer?: boolean;
    }) => {
      bearers.length = 0;
      const old = await fakeHub(o.version, o.pid, o.token ?? TOK, o.proofs, { pidInHealth: o.pidInHealth, anyBearer: o.anyBearer });
      const servers = [old.srv];
      writeHub(old.port, TOK, 4242);
      const killed: number[] = [];
      const notices: string[] = [];
      let spawned = 0;
      const spawn = spawnCurrent(servers);
      const t = Date.now();
      try {
        const url = await ensureHub({
          kill: (pid) => void killed.push(pid),
          isAlive: o.alive ?? ((pid) => pid === 4242 && killed.length === 0),
          spawnHub: () => void (spawned++, spawn()),
          notice: (m) => void notices.push(m),
          pollMs: 10,
          timeoutMs: 3000,
          stalledWaitMs: 5000,
        });
        return { url, killed, notices, spawned, ms: Date.now() - t, oldPort: old.port };
      } finally {
        for (const s of servers) s.close();
      }
    };

    it('checkHealth tells a refused connection and a version-only answer apart from a timeout', async () => {
      const legacy = await serve(() => JSON.stringify({ ok: true, pid: 5, version: '0.1.0' }));
      const free = await serve(() => '');
      const freePort = free.port;
      free.srv.close();
      try {
        const c = 'c'.repeat(32);
        expect(await checkHealth(legacy.port, c)).toBe('unproven');
        expect(await checkHealth(freePort, c)).toBe('refused');
      } finally {
        legacy.srv.close();
      }
    });
    it('0.1.0 (version-only health, pid and token match): killed, then replaced at once', async () => {
      const r = await run({ version: '0.1.0', pid: 4242, proofs: false });
      expect(r.killed).toEqual([4242]);
      expect(r.spawned).toBe(1);
      expect(r.notices).toEqual([]);
      expect(r.url).toMatch(/#token=b{64}$/);
      expect(r.ms).toBeLessThan(2500); // no 5 s "stalled hub" wait for an answer that has no proof
    });
    it('0.2.1 (the same proof format, older version): killed and replaced', async () => {
      const r = await run({ version: '0.2.1', pid: 4242, proofs: true });
      expect(r.killed).toEqual([4242]);
      expect(r.url).toMatch(/#token=b{64}$/);
    });
    it('an older-looking hub that does not accept the token on disk is never killed: the user is told', async () => {
      const r = await run({ version: '0.1.0', pid: 4242, token: 'c'.repeat(64), proofs: false });
      expect(r.killed).toEqual([]);
      expect(r.spawned).toBe(1);
      expect(r.notices).toHaveLength(1);
      expect(r.notices[0]).toMatch(/older AI Chat Center hub/);
      expect(r.notices[0]).toMatch(/restart/i);
    });
    it('an older-looking hub whose pid is not the one in hub.json is never killed: the user is told', async () => {
      const r = await run({ version: '0.1.0', pid: 5555, proofs: false });
      expect(r.killed).toEqual([]);
      expect(r.notices).toHaveLength(1);
    });
    // Audit S5-M1: a listener on a stale hub.json's port that leaves out the pid and answers 200 to anything
    // (r5/repro-kill-foreign.mjs) made /cc SIGTERM whatever process now has hub.json's pid, and sent it the token.
    it('a version-only answer WITHOUT a pid, 200 to any bearer: nothing is killed, the token is never sent', async () => {
      const r = await run({ version: '0.1.0', pid: 4242, proofs: false, pidInHealth: false, anyBearer: true });
      expect(r.killed).toEqual([]);
      expect(bearers.some((b) => b.includes(TOK))).toBe(false);
      expect(r.spawned).toBe(1);
      expect(r.notices).toHaveLength(1);
    });
    it('a version-only answer without a pid (token accepted): a missing pid is never accepted', async () => {
      const r = await run({ version: '0.1.0', pid: 4242, proofs: false, pidInHealth: false });
      expect(r.killed).toEqual([]);
      expect(bearers.some((b) => b.includes(TOK))).toBe(false);
      expect(r.notices).toHaveLength(1);
    });
    it('a 0.1.0-looking answer with the right pid that accepts a random bearer is foreign: no token, no kill', async () => {
      const r = await run({ version: '0.1.0', pid: 4242, proofs: false, anyBearer: true });
      expect(r.killed).toEqual([]);
      expect(bearers.some((b) => b.includes(TOK))).toBe(false);
      expect(bearers.length).toBeGreaterThan(0); // only the random probe was sent
    });
    it('0.2.0 (pid only in the challenged answer, proof without the port), pid and token match: killed and replaced', async () => {
      const r = await run({ version: '0.2.0', pid: 4242, proofs: '0.2.0' });
      expect(r.killed).toEqual([4242]);
      expect(r.notices).toEqual([]);
      expect(r.url).toMatch(/#token=b{64}$/);
    });
    it('0.2.0-format foreign: its pid is not the one in hub.json: never killed, no token sent', async () => {
      const r = await run({ version: '0.2.0', pid: 5555, proofs: '0.2.0' });
      expect(r.killed).toEqual([]);
      expect(bearers.some((b) => b.includes(TOK))).toBe(false);
      expect(r.notices).toHaveLength(1);
    });
    it('0.2.0-format foreign: right pid but 200 to a random bearer: never killed, no token sent', async () => {
      const r = await run({ version: '0.2.0', pid: 4242, proofs: '0.2.0', anyBearer: true });
      expect(r.killed).toEqual([]);
      expect(bearers.some((b) => b.includes(TOK))).toBe(false);
    });
    it('0.2.0-format without any pid: never killed, no token sent', async () => {
      const r = await run({ version: '0.2.0', pid: 4242, proofs: '0.2.0', pidInHealth: false });
      expect(r.killed).toEqual([]);
      expect(bearers.some((b) => b.includes(TOK))).toBe(false);
    });
    // The namespace variant: a proven hub reports its own pid, which may name another process outside its
    // pid namespace (a container with host networking). Only hub.json's pid, when the two agree, is stopped.
    it('a proven older hub whose reported pid differs from hub.json is not killed: the user is told', async () => {
      const r = await run({ version: '0.2.1', pid: 5555, proofs: true });
      expect(r.killed).toEqual([]);
      expect(r.spawned).toBe(1);
      expect(r.notices).toHaveLength(1);
    });
    it('a recorded pid that is dead: nothing is killed, no notice', async () => {
      const r = await run({ version: '0.1.0', pid: 4242, proofs: false, alive: () => false });
      expect(r.killed).toEqual([]);
      expect(r.notices).toEqual([]);
      expect(r.spawned).toBe(1);
    });
    it('a foreign answer (not an AI Chat Center version): nothing is killed, no notice', async () => {
      const r = await run({ version: 'nginx', pid: 4242, proofs: false });
      expect(r.killed).toEqual([]);
      expect(r.notices).toEqual([]);
    });
    it('a refused connection is not waited for, even when the recorded pid is alive (pid reuse)', async () => {
      const free = await serve(() => '');
      const port = free.port;
      free.srv.close();
      writeHub(port, TOK, 4242);
      const servers: http.Server[] = [];
      const spawn = spawnCurrent(servers);
      const t = Date.now();
      try {
        await ensureHub({ isAlive: () => true, kill: () => {}, spawnHub: () => void spawn(), pollMs: 10, timeoutMs: 3000, stalledWaitMs: 5000 });
        expect(Date.now() - t).toBeLessThan(2500);
      } finally {
        for (const s of servers) s.close();
      }
    });
  });

  it('starts the hub detached, hidden, from the home directory (not the session folder)', () => {
    expect(hubSpawnOptions()).toMatchObject({ detached: true, stdio: 'ignore', windowsHide: true, cwd: os.homedir() });
  });
});

describe('answers command and turn origin', () => {
  const block = (key: string) => `[AI Chat Center message id=x key=${key}]\ntexto\n[/AI Chat Center message]`;

  it('isCcCommand parses answers on/off', () => {
    expect(isCcCommand('/cc answers on')).toBe('answers-on');
    expect(isCcCommand('/ai-chat-center:cc  ANSWERS  off ')).toBe('answers-off');
    expect(isCcCommand('/cc answers')).toBe('unknown');
  });

  it('/cc answers on|off saves the flag, works without a session', async () => {
    const on = await handleHook('prompt-submit', inp({ prompt: '/cc answers on' }), ctx());
    expect(out(on).hookSpecificOutput.additionalContext).toContain(ANSWERS_ON);
    expect(out(on).systemMessage).toBeTruthy();
    expect((await loadConfig()).answersFromApp).toBe(true);
    const off = await handleHook('prompt-submit', inp({ prompt: '/cc answers off' }), ctx());
    expect(out(off).hookSpecificOutput.additionalContext).toContain(ANSWERS_OFF);
    expect((await loadConfig()).answersFromApp).toBe(false);
  });

  it('isCcCommand parses window on/off', () => {
    expect(isCcCommand('/cc window on')).toBe('window-on');
    expect(isCcCommand('/ai-chat-center:cc  WINDOW  off ')).toBe('window-off');
    expect(isCcCommand('/cc window')).toBe('unknown');
    expect(isCcCommand('/cc window maybe')).toBe('unknown');
  });

  it('/cc window on|off saves the flag, works without a session', async () => {
    const on = await handleHook('prompt-submit', inp({ prompt: '/cc window on' }), { ...ctx(), findBrowser: () => '/usr/bin/chromium' });
    expect(out(on).hookSpecificOutput.additionalContext).toContain(WINDOW_ON);
    expect(out(on).systemMessage).toBeTruthy();
    expect(out(on).systemMessage).not.toMatch(/Chrome, Chromium/);
    expect((await loadConfig()).openWindow).toBe(true);
    expect((await loadConfig()).answersFromApp).toBe(false);
    const off = await handleHook('prompt-submit', inp({ prompt: '/cc window off' }), ctx());
    expect(out(off).hookSpecificOutput.additionalContext).toContain(WINDOW_OFF);
    expect((await loadConfig()).openWindow).toBe(false);
  });

  it('/cc window on adds a localized note when no browser is found', async () => {
    const none = { ...ctx(), findBrowser: () => null };
    expect(out(await handleHook('prompt-submit', inp({ prompt: '/cc window on' }), none)).systemMessage).toMatch(/No Chrome, Chromium or Edge found/);
    await saveConfig({ language: 'pt-BR' });
    expect(out(await handleHook('prompt-submit', inp({ prompt: '/cc window on' }), none)).systemMessage).toMatch(/Nenhum Chrome, Chromium ou Edge encontrado/);
  });

  it('/cc window on|off in an active session records the typed turn like answers', async () => {
    await handleHook('prompt-submit', inp({ prompt: '/cc' }), ctx());
    await setTurnOrigin('s1', 'app');
    await setWaiting('s1', 'input');
    const r = await handleHook('prompt-submit', inp({ prompt: '/cc window on' }), ctx());
    expect(out(r).hookSpecificOutput.additionalContext).toContain(WINDOW_ON);
    expect((await loadConfig()).openWindow).toBe(true);
    expect(await getTurnOrigin('s1')).toBe('terminal');
    expect(await isBusy('s1')).toBe(true);
    expect(await getWaiting('s1')).toBeNull();
  });

  it('records the turn origin on an active session', async () => {
    await handleHook('prompt-submit', inp({ prompt: '/cc' }), ctx());
    const key = await keyOf();
    await handleHook('prompt-submit', inp({ prompt: `wake\n${block(key)}` }), ctx());
    expect(await getTurnOrigin('s1')).toBe('app');
    await handleHook('prompt-submit', inp({ prompt: block('other') }), ctx());
    expect(await getTurnOrigin('s1')).toBe('terminal');
    await handleHook('prompt-submit', inp({ prompt: block(key) }), ctx());
    await handleHook('prompt-submit', inp({ prompt: 'oi' }), ctx());
    expect(await getTurnOrigin('s1')).toBe('terminal');
  });

  it('/cc answers on|off in an active session still records the typed turn (busy, waiting cleared, origin terminal)', async () => {
    await handleHook('prompt-submit', inp({ prompt: '/cc' }), ctx());
    await setTurnOrigin('s1', 'app');
    await setWaiting('s1', 'input');
    expect(await getWaiting('s1')).not.toBeNull();
    const r = await handleHook('prompt-submit', inp({ prompt: '/cc answers on' }), ctx());
    expect(out(r).hookSpecificOutput.additionalContext).toContain(ANSWERS_ON);
    expect((await loadConfig()).answersFromApp).toBe(true);
    expect(await getTurnOrigin('s1')).toBe('terminal');
    expect(await isBusy('s1')).toBe(true);
    expect(await getWaiting('s1')).toBeNull();
  });

  it('/cc removes the pending questions of the session (left by a killed hook)', async () => {
    const dir = paths().questionsDir('s1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tu1.json'), JSON.stringify({ toolUseId: 'tu1', questions: [], createdAt: '2026-01-01T00:00:00.000Z' }));
    await handleHook('prompt-submit', inp({ prompt: '/cc' }), ctx());
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('/cc clears the turn origin', async () => {
    await setTurnOrigin('s1', 'app');
    await handleHook('prompt-submit', inp({ prompt: '/cc' }), ctx());
    expect(await getTurnOrigin('s1')).toBeNull();
  });
});
