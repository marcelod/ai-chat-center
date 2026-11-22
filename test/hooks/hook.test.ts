import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { handleHook, isCcCommand, type HookInput } from '../../src/hooks/hook.js';
import { ensureHub, checkHealth, hubSpawnOptions } from '../../src/hooks/ensureHub.js';
import { VERSION } from '../../src/core/version.js';
import { register, getRegistration, markDisconnected } from '../../src/core/registry.js';
import { isBusy, setBusy } from '../../src/core/busy.js';
import { getWaiting } from '../../src/core/waiting.js';
import { paths } from '../../src/core/paths.js';

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
  it('ignores unregistered session', async () => {
    let lookups = 0;
    const c = { ...ctx(), resolvePid: async () => (lookups++, 42) };
    for (const source of ['startup', 'resume', 'clear', 'compact']) {
      expect(await handleHook('session-start', inp({ source }), c)).toEqual({ exitCode: 0 });
    }
    for (const ev of ['prompt-submit', 'notification'] as const) {
      const r = await handleHook(ev, inp({ prompt: 'hello', notification_type: 'permission_prompt' }), c);
      expect(r).toEqual({ exitCode: 0 });
    }
    expect(await handleHook('prompt-submit', inp({ session_id: '../x', prompt: '/cc' }), c)).toEqual({ exitCode: 0 });
    expect(fs.readdirSync(paths().home)).toEqual([]);
    expect(lookups).toBe(0);
  });

  it('/cc registers with a fresh key and returns url, key and a user-visible systemMessage', async () => {
    const r = await handleHook('prompt-submit', inp({ prompt: '/cc' }), ctx());
    const reg = await getRegistration('s1');
    expect(reg).toMatchObject({ sessionId: 's1', pid: 42, cwd: '/x', transcriptPath: '/t.jsonl' });
    expect(reg!.key).toMatch(/^[0-9a-f]{32}$/);
    expect(out(r)).toEqual({
      systemMessage: `AI Chat Center URL: ${URL_}`,
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: `AI Chat Center URL: ${URL_}\nAI Chat Center key: ${reg!.key}`,
      },
    });
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
      `AI Chat Center URL: ${URL_}\nAI Chat Center key: ${reg.key}\n` +
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

  it('clear disconnects previous session of same terminal', async () => {
    await register({ sessionId: 'A', transcriptPath: '/a', cwd: '/x', pid: 42 });
    await register({ sessionId: 'C', transcriptPath: '/c', cwd: '/x', pid: 43 });
    const r = await handleHook('session-start', inp({ session_id: 'B', source: 'clear' }), ctx(42));
    expect(r).toEqual({ exitCode: 0 });
    expect((await getRegistration('A'))?.disconnectReason).toBe('clear');
    expect((await getRegistration('C'))?.disconnectedAt).toBeUndefined();
    expect(await getRegistration('B')).toBeNull();
  });

  it('clear with an unresolvable pid disconnects nothing (null never matches)', async () => {
    await register({ sessionId: 'A', transcriptPath: '/a', cwd: '/x', pid: null });
    await handleHook('session-start', inp({ session_id: 'B', source: 'clear' }), { ...ctx(), resolvePid: async () => null });
    expect((await getRegistration('A'))?.disconnectedAt).toBeUndefined();
  });

  it('resume of an active registration refreshes pid and transcriptPath', async () => {
    await register({ sessionId: 's1', transcriptPath: '/old.jsonl', cwd: '/x', pid: 7, key: 'k' });
    for (const source of ['resume', 'startup']) {
      await handleHook('session-start', inp({ source, transcript_path: `/${source}.jsonl` }), { ...ctx(), resolvePid: async () => 99 });
      expect(await getRegistration('s1')).toMatchObject({ pid: 99, transcriptPath: `/${source}.jsonl`, key: 'k' });
    }
  });

  it('resume of an inactive registration does nothing and skips the lookup', async () => {
    await register({ sessionId: 's1', transcriptPath: '/old.jsonl', cwd: '/x', pid: 7 });
    await markDisconnected('s1', 'off');
    let lookups = 0;
    await handleHook('session-start', inp({ source: 'resume' }), { ...ctx(), resolvePid: async () => (lookups++, 99) });
    expect(lookups).toBe(0);
    expect(await getRegistration('s1')).toMatchObject({ pid: 7, transcriptPath: '/old.jsonl' });
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

  it('clear matches by resolved pid and skips the lookup when nothing is registered', async () => {
    let calls = 0;
    const c = { ...ctx(7), resolvePid: async () => (calls++, 42) };
    await handleHook('session-start', inp({ session_id: 'B', source: 'clear' }), c);
    expect(calls).toBe(0);
    await register({ sessionId: 'A', transcriptPath: '/a', cwd: '/x', pid: 42 });
    await handleHook('session-start', inp({ session_id: 'B', source: 'clear' }), c);
    expect(calls).toBe(1);
    expect((await getRegistration('A'))?.disconnectReason).toBe('clear');
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
  const serve = async (body: string) => {
    const srv = http.createServer((q, s) => s.end(body));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    return { srv, port: (srv.address() as { port: number }).port };
  };

  it('checkHealth requires a JSON body with ok === true', async () => {
    const bad = await serve('{}');
    const good = await serve(JSON.stringify({ ok: true, pid: 5, version: 'v' }));
    try {
      expect(await checkHealth(bad.port)).toBeNull();
      expect(await checkHealth(good.port)).toEqual({ ok: true, pid: 5, version: 'v' });
    } finally {
      bad.srv.close();
      good.srv.close();
    }
  });

  it('returns url without spawning when health matches pid and version', async () => {
    const { srv, port } = await serve(JSON.stringify({ ok: true, pid: 1, version: VERSION }));
    writeHub(port);
    let spawned = 0;
    const url = await ensureHub({ spawnHub: () => void spawned++ });
    srv.close();
    expect(url).toBe(`http://127.0.0.1:${port}/?token=tok`);
    expect(spawned).toBe(0);
  });

  it('spawns when the answering pid is not the one in hub.json', async () => {
    writeHub(7777, 'tok', 1);
    let spawned = 0;
    await expect(
      ensureHub({ spawnHub: () => void spawned++, health: async () => ({ ok: true, pid: 999, version: VERSION }), pollMs: 5, timeoutMs: 30 }),
    ).rejects.toThrow();
    expect(spawned).toBe(1);
  });

  it('a hub of another version is killed and replaced', async () => {
    writeHub(7777, 'tok', 1234);
    const killed: number[] = [];
    let current = { ok: true as const, pid: 1234, version: '0.0.1' };
    const url = await ensureHub({
      health: async () => current,
      kill: (pid) => void killed.push(pid),
      isAlive: () => false,
      spawnHub: () => {
        writeHub(7777, 'tok', 4321);
        current = { ok: true, pid: 4321, version: VERSION };
      },
      pollMs: 5,
    });
    expect(killed).toEqual([1234]);
    expect(url).toBe('http://127.0.0.1:7777/?token=tok');
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
      health: async () => (up ? { ok: true, pid: 1, version: VERSION } : null),
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
