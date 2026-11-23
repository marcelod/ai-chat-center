import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { register } from '../../src/core/registry.js';
import { saveConfig } from '../../src/core/config.js';
import { setTurnOrigin } from '../../src/core/turn.js';
import { writePresence } from '../../src/core/presence.js';
import { getPending, writeAnswer } from '../../src/core/questions.js';
import { getWaiting } from '../../src/core/waiting.js';
import { paths } from '../../src/core/paths.js';
import { tmpDir } from '../helpers/tmp.js';

// Esc in Claude Code kills the hook; closing the terminal sends SIGHUP. Either way the question must not
// stay pending in the app. Runs the real entry point, bundled like the plugin's.

const SID = 's1';
const ID = 'toolu_sig';
const Q = 'Qual cor você prefere?';
const input = JSON.stringify({
  session_id: SID, tool_name: 'AskUserQuestion', tool_use_id: ID,
  tool_input: { questions: [{ question: Q, options: [{ label: 'Red' }, { label: 'Blue' }] }] },
});

let bundle: string;
beforeAll(async () => {
  // Not tmpDir(): that one is removed after each test, and the bundle serves every test here.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-askbin-'));
  bundle = path.join(dir, 'ask.mjs');
  await build({
    entryPoints: [path.resolve('src/bin/ask.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    banner: { js: "import { createRequire as __r } from 'node:module';\nconst require = __r(import.meta.url);" },
  });
  return () => fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  process.env.AI_CHAT_CENTER_HOME = tmpDir('acc-');
  await register({ sessionId: SID, transcriptPath: '/t.jsonl', cwd: '/x', pid: 42 });
  await saveConfig({ answersFromApp: true });
  await setTurnOrigin(SID, 'app');
  await writePresence(1); // this (alive) process plays the hub
});

async function until(cond: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 1000; i++) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timed out');
}

function start() {
  const child = spawn(process.execPath, [bundle, 'pre-tool'], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr += d));
  const exit = new Promise<number | null>((r) => child.on('exit', (code) => r(code)));
  child.stdin.end(input);
  return { child, exit, out: () => ({ stdout, stderr }) };
}

const signals: NodeJS.Signals[] = process.platform === 'win32' ? ['SIGTERM'] : ['SIGTERM', 'SIGINT', 'SIGHUP'];

describe('ask entry point on a signal', () => {
  for (const sig of signals) {
    it(`${sig} during the wait removes the pending question and the waiting state, with no stdout`, async () => {
      const h = start();
      await until(async () => (await getPending(SID)) !== null && (await getWaiting(SID))?.kind === 'question');
      h.child.kill(sig);
      const code = await h.exit;
      if (process.platform !== 'win32') expect(code).toBe(0);
      expect(h.out()).toEqual({ stdout: '', stderr: '' });
      expect(await getPending(SID)).toBeNull();
      expect(fs.readdirSync(paths().questionsDir(SID))).toEqual([]);
      expect(await getWaiting(SID)).toBeNull();
      expect(await writeAnswer(SID, ID, { answers: { [Q]: 'Blue' } })).toBe('not-found');
    });
  }

  it('a release through the entry point exits 0 with no stdout and leaves the session waiting for input', async () => {
    const h = start();
    await until(async () => (await getPending(SID)) !== null);
    await writeAnswer(SID, ID, { release: true });
    const code = await h.exit; // release returns at once; no signal needed for it to end
    expect(code).toBe(0);
    expect(h.out().stdout).toBe('');
    expect((await getWaiting(SID))?.kind).toBe('input');
  });
});
