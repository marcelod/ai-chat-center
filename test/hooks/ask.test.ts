import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { runAsk, type AskInput, type AskOptions } from '../../src/hooks/ask.js';
import { register, markDisconnected, updateRegistration } from '../../src/core/registry.js';
import { saveConfig } from '../../src/core/config.js';
import { setTurnOrigin } from '../../src/core/turn.js';
import { getPending, writeAnswer } from '../../src/core/questions.js';
import { getWaiting } from '../../src/core/waiting.js';
import { paths } from '../../src/core/paths.js';
import { tmpDir } from '../helpers/tmp.js';

const SID = 's1';
const ID = 'toolu_01';
const Q = 'Qual cor você prefere?';
const toolInput = {
  questions: [{
    question: Q, header: 'Cor', multiSelect: false,
    options: [{ label: 'Red', description: 'r' }, { label: 'Blue' }, { label: 'Yellow' }],
  }],
};
const inp = (o: Partial<AskInput> = {}): AskInput => ({ session_id: SID, tool_name: 'AskUserQuestion', tool_use_id: ID, tool_input: toolInput, ...o });
const opts = (o: Partial<AskOptions> = {}): AskOptions => ({ pollMs: 10, parentPid: null, present: async () => true, ...o });

beforeEach(async () => {
  process.env.AI_CHAT_CENTER_HOME = tmpDir('acc-');
  await register({ sessionId: SID, transcriptPath: '/t.jsonl', cwd: '/x', pid: 42 });
  await saveConfig({ answersFromApp: true });
  await setTurnOrigin(SID, 'app');
});

/** Resolves once the hook has published its pending question. */
async function pendingSeen(): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (await getPending(SID)) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('no pending question');
}

type Out = { hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string; updatedInput: { questions: unknown; answers: Record<string, string> } } };

describe('runAsk: no decision, no wait', () => {
  const noWait = async (i: AskInput = inp(), o: Partial<AskOptions> = {}) => {
    const t0 = Date.now();
    expect(await runAsk(i, opts({ deadlineMs: 5_000, ...o }))).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(await getPending(SID)).toBeNull();
    expect(await getWaiting(SID)).toBeNull();
  };

  it('another tool', async () => noWait(inp({ tool_name: 'Bash' })));
  it('no registration', async () => noWait(inp({ session_id: 'other' })));
  it('an inactive registration', async () => {
    await markDisconnected(SID, 'off');
    await noWait();
  });
  it('an invalid session id', async () => noWait(inp({ session_id: '../x' })));
  it('answers from the app are off', async () => {
    await saveConfig({ answersFromApp: false });
    await noWait();
  });
  it('the turn came from the terminal', async () => {
    await setTurnOrigin(SID, 'terminal');
    await noWait();
  });
  it('the turn origin is unknown', async () => {
    fs.rmSync(paths().turnFile(SID));
    await noWait();
  });
  it('no app tab is open', async () => noWait(inp(), { present: async () => false }));
  it('invalid questions', async () => noWait(inp({ tool_input: { questions: [{ question: Q, options: [{ label: 'only' }] }] } })));
  it('an invalid tool_use_id', async () => noWait(inp({ tool_use_id: '../evil' })));
});

describe('runAsk: waits for the app', () => {
  it('returns allow with the answers, then removes the pending question and the waiting state', async () => {
    const run = runAsk(inp(), opts());
    await pendingSeen();
    expect((await getWaiting(SID))?.kind).toBe('question');
    expect(await writeAnswer(SID, ID, { answers: { [Q]: 'Blue' } })).toBe('ok');
    const out = JSON.parse((await run)!) as Out;
    expect(out.hookSpecificOutput).toEqual({
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'Answered in AI Chat Center',
      updatedInput: { ...toolInput, answers: { [Q]: 'Blue' } },
    });
    expect(await getPending(SID)).toBeNull();
    expect(await getWaiting(SID)).toBeNull();
    expect(fs.readdirSync(paths().questionsDir(SID))).toEqual([]);
  });

  it('accepts free text', async () => {
    const run = runAsk(inp(), opts());
    await pendingSeen();
    await writeAnswer(SID, ID, { answers: { [Q]: 'Verde-limão' } });
    expect((JSON.parse((await run)!) as Out).hookSpecificOutput.updatedInput.answers).toEqual({ [Q]: 'Verde-limão' });
  });

  it('deletes an invalid answer file and uses the valid one written after it', async () => {
    const run = runAsk(inp(), opts());
    await pendingSeen();
    expect(await writeAnswer(SID, ID, { answers: { 'wrong key': 'Blue' } })).toBe('ok');
    const answer = path.join(paths().questionsDir(SID), `${ID}.answer.json`);
    for (let i = 0; i < 500 && fs.existsSync(answer); i++) await new Promise((r) => setTimeout(r, 5));
    expect(fs.existsSync(answer)).toBe(false);
    expect(await getPending(SID)).not.toBeNull(); // the question is still pending
    expect(await writeAnswer(SID, ID, { answers: { [Q]: 'Red' } })).toBe('ok');
    expect((JSON.parse((await run)!) as Out).hookSpecificOutput.updatedInput.answers).toEqual({ [Q]: 'Red' });
  });

  it('keeps waiting while the answer file is still being written', async () => {
    const run = runAsk(inp(), opts());
    await pendingSeen();
    const answer = path.join(paths().questionsDir(SID), `${ID}.answer.json`);
    fs.writeFileSync(answer, '{"answers":{');
    await new Promise((r) => setTimeout(r, 50));
    expect(await getPending(SID)).not.toBeNull();
    fs.writeFileSync(answer, JSON.stringify({ answers: { [Q]: 'Yellow' } }));
    expect((JSON.parse((await run)!) as Out).hookSpecificOutput.updatedInput.answers).toEqual({ [Q]: 'Yellow' });
  });

  it('release returns no decision and leaves the session waiting for input', async () => {
    const run = runAsk(inp(), opts());
    await pendingSeen();
    await writeAnswer(SID, ID, { release: true });
    expect(await run).toBeNull();
    expect((await getWaiting(SID))?.kind).toBe('input');
    expect(await getPending(SID)).toBeNull();
  });

  it('/cc off during the wait returns no decision and removes the pending question', async () => {
    const run = runAsk(inp(), opts());
    await pendingSeen();
    await markDisconnected(SID, 'off');
    expect(await run).toBeNull();
    expect(await getPending(SID)).toBeNull();
    expect(await getWaiting(SID)).toBeNull();
  });

  it('an answer present after /cc off is not returned as allow (registration checked first)', async () => {
    const run = runAsk(inp(), opts({ pollMs: 300 }));
    await pendingSeen();
    await markDisconnected(SID, 'off');
    await writeAnswer(SID, ID, { answers: { [Q]: 'Blue' } });
    expect(await run).toBeNull();
    expect(await getPending(SID)).toBeNull();
  });

  it('records the hook pid in the pending question', async () => {
    const run = runAsk(inp(), opts());
    await pendingSeen();
    expect((await getPending(SID))!.pid).toBe(process.pid);
    await writeAnswer(SID, ID, { release: true });
    await run;
  });

  it('a new connection (connectedAt changed) returns no decision', async () => {
    const run = runAsk(inp(), opts());
    await pendingSeen();
    await updateRegistration(SID, { connectedAt: new Date(Date.now() + 1000).toISOString() });
    expect(await run).toBeNull();
    expect(await getPending(SID)).toBeNull();
  });

  it('a dead parent process returns no decision', async () => {
    let alive = true;
    const run = runAsk(inp(), opts({ parentPid: 4242, isAlive: (pid) => pid === 4242 && alive }));
    await pendingSeen();
    alive = false;
    expect(await run).toBeNull();
    expect(await getPending(SID)).toBeNull();
    expect(await getWaiting(SID)).toBeNull();
  });

  it('gives up at the deadline', async () => {
    expect(await runAsk(inp(), opts({ deadlineMs: 50 }))).toBeNull();
    expect(await getPending(SID)).toBeNull();
    expect(await getWaiting(SID)).toBeNull();
  });
});
