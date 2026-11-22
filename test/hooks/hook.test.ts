import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { handleHook, isCcCommand, type HookInput } from '../../src/hooks/hook.js';
import { ensureHub, checkHealth, hubSpawnOptions } from '../../src/hooks/ensureHub.js';
import { VERSION } from '../../src/core/version.js';
import { register, getRegistration, markDisconnected } from '../../src/core/registry.js';
import { isBusy, setBusy } from '../../src/core/busy.js';
import { getWaiting } from '../../src/core/waiting.js';
import { paths } from '../../src/core/paths.js';
import { saveConfig } from '../../src/core/config.js';

const URL_ = 'http://127.0.0.1:7777/?token=t';
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
  process.env.AI_CHAT_CENTER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-'));
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
    expect(out(u).systemMessage).toBe('AI Chat Center: argumento desconhecido. Use /cc ou /cc off.');
    expect(out(u).hookSpecificOutput.additionalContext).toBe('AI Chat Center: unknown argument. Use /cc or /cc off.');
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
    const msg = 'AI Chat Center: unknown argument. Use /cc or /cc off.';
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
      expect(await checkHealth(legacy.port, c)).toBeNull();
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
    expect(url).toBe(`http://127.0.0.1:${port}/?token=tok`);
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
        ensureHub({ spawnHub: () => void spawned++, health: impostor, kill: (p) => void killed.push(p), pollMs: 5, timeoutMs: 30 }),
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
    expect(url).toBe('http://127.0.0.1:7778/?token=tok2');
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
    expect(url).toBe('http://127.0.0.1:7777/?token=tok');
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
    expect(url).toBe('http://127.0.0.1:7777/?token=tok');
  });

  it('rejects when hub never comes up', async () => {
    await expect(
      ensureHub({ spawnHub: () => {}, health: async () => null, pollMs: 5, timeoutMs: 50 }),
    ).rejects.toThrow();
  });

  it('starts the hub detached, hidden, from the home directory (not the session folder)', () => {
    expect(hubSpawnOptions()).toMatchObject({ detached: true, stdio: 'ignore', windowsHide: true, cwd: os.homedir() });
  });
});
