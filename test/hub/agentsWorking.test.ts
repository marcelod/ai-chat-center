import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AGENTS_TTL_MS, ClaudeCodeProvider } from '../../src/hub/provider.js';
import { PROTOCOL, VERSION } from '../../src/core/version.js';
import type { LiveSession } from '../../src/shared/types.js';
import { register, markDisconnected } from '../../src/core/registry.js';
import { STALE_MS } from '../../src/hub/subagents.js';
import { tmpDir } from '../helpers/tmp.js';

// Spec 2026-11-26-side-panel: "agents working (N)" while the turn ended but background subagents still run.

let dir: string;
let transcript: string;
let subDir: string;
beforeEach(async () => {
  dir = tmpDir('acc-agents-');
  process.env.AI_CHAT_CENTER_HOME = dir;
  transcript = path.join(dir, 's1.jsonl');
  fs.writeFileSync(transcript, '');
  subDir = path.join(dir, 's1', 'subagents');
  fs.mkdirSync(subDir, { recursive: true });
  await register({ sessionId: 's1', transcriptPath: transcript, cwd: '/home/u/proj', pid: 1, version: VERSION, protocol: PROTOCOL });
});

const live = (o: Partial<LiveSession> = {}): LiveSession => ({ pid: 1, cwd: '/home/u/proj', kind: 'background', sessionId: 's1', name: 'nm', status: 'idle', ...o });

function agent(id: string, meta: Record<string, unknown> = {}) {
  fs.writeFileSync(path.join(subDir, `agent-${id}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description: id, requestShape: 'background', ...meta }));
  fs.writeFileSync(path.join(subDir, `agent-${id}.jsonl`), JSON.stringify({ type: 'user', isSidechain: true, uuid: 'u', timestamp: new Date().toISOString(), message: { content: 'go' } }) + '\n');
}

describe('provider: subagents still working after the turn', () => {
  it('an idle session counts its subagents that are not finished and wrote lately', async () => {
    agent('a1');
    agent('a2');
    agent('a3', { finished: true });
    const p = new ClaudeCodeProvider(async () => [live()]);
    const s = (await p.listSessions()).connected[0];
    expect(s.state).toBe('idle');
    expect(s.agentsWorking).toBe(2);
  });

  it('none: no field', async () => {
    const p = new ClaudeCodeProvider(async () => [live()]);
    expect((await p.listSessions()).connected[0].agentsWorking).toBeUndefined();
  });

  it('an orphan (no new line for STALE_MS) does not count: the state never sticks', async () => {
    agent('a1');
    const p = new ClaudeCodeProvider(async () => [live()], { now: () => Date.now() + STALE_MS + 1000 });
    expect((await p.listSessions()).connected[0].agentsWorking).toBeUndefined();
  });

  it('a disconnected session never counts', async () => {
    agent('a1');
    await markDisconnected('s1', 'exited');
    const p = new ClaudeCodeProvider(async () => []);
    expect((await p.listSessions()).connected[0].agentsWorking).toBeUndefined();
  });

  it('the count is looked up at most every AGENTS_TTL_MS per session', async () => {
    let t = Date.now();
    agent('a1');
    const p = new ClaudeCodeProvider(async () => [live()], { now: () => t });
    expect((await p.listSessions()).connected[0].agentsWorking).toBe(1);
    agent('a2');
    t += 1000;
    expect((await p.listSessions()).connected[0].agentsWorking).toBe(1);
    t += AGENTS_TTL_MS;
    expect((await p.listSessions()).connected[0].agentsWorking).toBe(2);
  });
});
