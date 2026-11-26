import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from '../helpers/tmp.js';
import { clearSubagentCache, isAgentId, listSubagents, runningSubagents, STALE_MS, subagentEvents, subagentsDir } from '../../src/hub/subagents.js';

// Spec 2026-11-26-side-panel: the subagents of a session, read from
// <transcript folder>/<sessionId>/subagents/agent-<id>.meta.json and agent-<id>.jsonl.

const T0 = Date.parse('2026-11-26T10:00:00.000Z');
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();

let dir: string;
function agent(id: string, meta: Record<string, unknown>, lines: unknown[], mtimeMin?: number) {
  fs.writeFileSync(path.join(dir, `agent-${id}.meta.json`), JSON.stringify(meta));
  const f = path.join(dir, `agent-${id}.jsonl`);
  fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  if (mtimeMin !== undefined) fs.utimesSync(f, new Date(T0 + mtimeMin * 60_000), new Date(T0 + mtimeMin * 60_000));
}
const user = (min: number, text: string, uuid = `u${min}`) => ({ type: 'user', isSidechain: true, uuid, timestamp: iso(min), message: { role: 'user', content: text } });
const tool = (min: number, name: string, uuid = `a${min}`) => ({
  type: 'assistant',
  isSidechain: true,
  uuid,
  timestamp: iso(min),
  message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: `t${min}`, name, input: { command: 'ls' } }] },
});
const say = (min: number, text: string) => ({ type: 'assistant', isSidechain: true, uuid: `s${min}`, timestamp: iso(min), message: { role: 'assistant', content: [{ type: 'text', text }] } });

beforeEach(() => {
  clearSubagentCache();
  dir = path.join(tmpDir('acc-sub-'), 'subagents');
  fs.mkdirSync(dir);
});

describe('subagentsDir and isAgentId', () => {
  it('is the folder next to the transcript named after the session', () => {
    expect(subagentsDir('/p/proj/s1.jsonl', 's1')).toBe(path.join('/p/proj', 's1', 'subagents'));
    expect(() => subagentsDir('/p/x.jsonl', '../x')).toThrow();
  });
  it('accepts agent ids only', () => {
    expect(isAgentId('a029f892d169b7c29')).toBe(true);
    for (const bad of ['', '../x', 'a.b', 'a/b', 'x'.repeat(65), 5]) expect(isAgentId(bad)).toBe(false);
  });
});

describe('listSubagents', () => {
  it('lists description, type, model, start, last activity and last tool, newest first', async () => {
    agent('a1', { agentType: 'general-purpose', description: 'Front A', model: 'claude-opus-5-5', requestShape: 'background' }, [user(0, 'do A'), tool(1, 'Read'), tool(2, 'Bash')], 2);
    agent('a2', { agentType: 'Explore', description: 'Find B', finished: true }, [user(3, 'find B'), tool(4, 'Grep'), say(5, 'done')], 5);
    const list = await listSubagents(dir, { now: () => T0 + 6 * 60_000 });
    expect(list).toEqual([
      { id: 'a2', description: 'Find B', agentType: 'Explore', background: false, status: 'finished', startedAt: iso(3), lastActivityAt: iso(5), lastTool: 'Grep' },
      { id: 'a1', description: 'Front A', agentType: 'general-purpose', model: 'claude-opus-5-5', background: true, status: 'running', startedAt: iso(0), lastActivityAt: iso(2), lastTool: 'Bash' },
    ]);
  });

  it('an agent without news for STALE_MS is stale, not running; one stopped by the user is finished', async () => {
    agent('a1', { agentType: 't', description: 'old' }, [user(0, 'x'), tool(1, 'Bash')], 1);
    agent('a2', { agentType: 't', description: 'stopped', stoppedByUser: true }, [user(0, 'x')], 1);
    const list = await listSubagents(dir, { now: () => T0 + 60_000 + STALE_MS + 1 });
    expect(list.map((a) => [a.id, a.status])).toEqual([
      ['a1', 'stale'],
      ['a2', 'finished'],
    ]);
  });

  it('skips broken metas and caps the list', async () => {
    fs.writeFileSync(path.join(dir, 'agent-bad.meta.json'), '{oops');
    fs.writeFileSync(path.join(dir, 'agent-..x.meta.json'), '{}');
    for (let i = 0; i < 5; i++) agent(`b${i}`, { agentType: 't', description: `d${i}` }, [user(i, 'x')], i);
    const list = await listSubagents(dir, { now: () => T0, limit: 3 });
    expect(list.map((a) => a.id)).toEqual(['b4', 'b3', 'b2']);
  });

  it('answers an empty list when the folder does not exist', async () => {
    expect(await listSubagents(path.join(dir, 'nope'), { now: () => T0 })).toEqual([]);
  });

  it('reads only the end of a long transcript, and nothing again while it is unchanged', async () => {
    const big = 'x'.repeat(400 * 1024);
    agent('a1', { agentType: 't', description: 'long' }, [user(0, big), tool(1, 'Edit')], 1);
    const reads: string[] = [];
    const list = await listSubagents(dir, { now: () => T0 + 60_000, onRead: (f) => reads.push(f) });
    expect(list[0].lastTool).toBe('Edit');
    expect(list[0].startedAt).toBeDefined(); // the first line is past the head: the file's creation time
    expect(reads.length).toBeGreaterThan(0);
    reads.length = 0;
    await listSubagents(dir, { now: () => T0 + 60_000, onRead: (f) => reads.push(f) });
    expect(reads.filter((f) => f.endsWith('.jsonl'))).toEqual([]);
  });
});

describe('runningSubagents', () => {
  it('counts only agents not finished with news in the last STALE_MS', async () => {
    agent('a1', { agentType: 't', description: 'r1' }, [user(0, 'x')], 0);
    agent('a2', { agentType: 't', description: 'r2' }, [user(0, 'x')], 9);
    agent('a3', { agentType: 't', description: 'done', finished: true }, [user(0, 'x')], 9);
    expect(STALE_MS).toBe(10 * 60_000);
    expect(await runningSubagents(dir, () => T0 + 10 * 60_000)).toBe(1);
    expect(await runningSubagents(dir, () => T0 + 9 * 60_000 + STALE_MS + 1)).toBe(0);
    expect(await runningSubagents(path.join(dir, 'nope'), () => T0)).toBe(0);
  });
});

describe('subagentEvents', () => {
  it("parses the subagent's own transcript (side-chain lines)", async () => {
    agent('a1', { agentType: 't', description: 'x' }, [user(0, 'do A'), tool(1, 'Read'), say(2, 'All done')], 2);
    const ev = (await subagentEvents(dir, 'a1'))!;
    expect(ev.map((e) => e.kind)).toEqual(['user', 'actions', 'assistant']);
    expect(ev[2]).toMatchObject({ kind: 'assistant', text: 'All done' });
  });
  it('refuses a bad id and answers null for an unknown agent', async () => {
    await expect(subagentEvents(dir, '../x')).rejects.toThrow();
    expect(await subagentEvents(dir, 'nope')).toBeNull();
  });
});
