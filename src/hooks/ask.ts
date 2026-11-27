import fs from 'node:fs';
import path from 'node:path';
import { assertSessionId, paths } from '../core/paths.js';
import { DIR_MODE } from '../core/fsAtomic.js';
import { getRegistration, isActive } from '../core/registry.js';
import { isAlive as pidAlive } from '../core/lock.js';
import { loadConfig } from '../core/config.js';
import { getTurnOrigin } from '../core/turn.js';
import { appPresent } from '../core/presence.js';
import { clearWaiting, setWaiting } from '../core/waiting.js';
import { assertToolUseId, parseQuestions, putPending, readAnswer, removeAnswer, removePending, removePendingSync, validAnswers, verifyAnswer, type SignedAnswer } from '../core/questions.js';
import { loadSecret } from '../core/secret.js';

// PreToolUse hook on AskUserQuestion. Returns the decision JSON (allow + the answers given in the app) or
// null: no decision, and Claude Code shows its own dialog in the terminal.

export type AskInput = { session_id: string; tool_name: string; tool_use_id: string; tool_input: unknown };
export type AskOptions = {
  pollMs?: number;
  deadlineMs?: number;
  /** The claude process (exec-form hooks: our parent). The wait ends when it dies. Null: not watched. */
  parentPid?: number | null;
  isAlive?: (pid: number) => boolean;
  present?: () => Promise<boolean>;
};

const valid = (check: (v: string) => void, v: string): boolean => {
  try {
    check(v);
    return true;
  } catch {
    return false;
  }
};
/**
 * The wait in progress, for the signal handlers: Esc in Claude Code or a closed terminal kills the hook
 * before `finally` can run. `waiting` is true while the waiting state is the 'question' this hook set.
 */
let active: { sid: string; id: string; waiting: boolean } | null = null;

/** Synchronous cleanup of what the current wait wrote (pending + answer files, its waiting state). */
export function abortActiveSync(): void {
  const a = active;
  active = null;
  if (!a) return;
  try {
    removePendingSync(a.sid, a.id);
  } catch (e) {
    logError(e);
  }
  if (!a.waiting) return;
  try {
    fs.rmSync(paths().waitingFile(a.sid), { force: true });
  } catch (e) {
    logError(e);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runAsk(input: AskInput, opts: AskOptions = {}): Promise<string | null> {
  try {
    return await ask(input, opts);
  } catch (e) {
    logError(e);
    return null;
  }
}

async function ask(input: AskInput, opts: AskOptions): Promise<string | null> {
  const { pollMs = 500, deadlineMs = 86_000_000, parentPid = process.ppid, isAlive = pidAlive, present = appPresent } = opts;
  const sid = input.session_id;
  const id = input.tool_use_id;

  if (input.tool_name !== 'AskUserQuestion' || !valid(assertSessionId, sid)) return null;
  const reg = await getRegistration(sid);
  if (!reg || !isActive(reg)) return null;
  const questions = parseQuestions(input.tool_input);
  if (!questions || !valid(assertToolUseId, id)) return null;
  // Answered in the terminal dialog: the app still says a question waits (and, for a background session
  // that has no terminal, how to open one). The next prompt clears it, like the other waiting states.
  const toTerminal = async () => {
    await setWaiting(sid, 'question');
    return null;
  };
  if ((await loadConfig()).answersFromApp !== true) return toTerminal();
  if ((await getTurnOrigin(sid)) !== 'app') return toTerminal();
  if (!(await present())) return toTerminal();

  const start = Date.now();
  let released = false;
  const mine = { sid, id, waiting: false };
  active = mine;
  try {
    await putPending(sid, { toolUseId: id, questions, createdAt: new Date(start).toISOString(), pid: process.pid });
    mine.waiting = true;
    await setWaiting(sid, 'question');
    for (;;) {
      // Checked before the answer: an answer written after /cc off or a reconnection must not be used.
      const r = await getRegistration(sid);
      if (!r || !isActive(r) || r.connectedAt !== reg.connectedAt) return null;
      if (parentPid != null && !isAlive(parentPid)) return null;
      // null is also a file still being written: not yet.
      const a = await readAnswer(sid, id);
      // Only an answer the hub signed for this question counts (review 0.6.11). Anything else (an old hub
      // during an upgrade, a forged file) gives no decision: Claude Code shows its own dialog, and the app
      // shows the question as waiting in the terminal. Fails closed: the dialog, never an "allow".
      if (a && !(await signedByHub(a, sid, id, start))) {
        logError(`ignored an answer for ${sid}/${id}: not signed by the hub for this question; the terminal dialog answers it`);
        released = true;
        mine.waiting = false;
        await removeAnswer(sid, id);
        await setWaiting(sid, 'question');
        return null;
      }
      if (a && 'release' in a && a.release === true) {
        released = true;
        mine.waiting = false;
        await setWaiting(sid, 'input');
        return null;
      }
      if (a) {
        const answers = 'answers' in a ? validAnswers(questions, a.answers) : null;
        if (answers) {
          return JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'allow',
              permissionDecisionReason: 'Answered in AI Chat Center',
              updatedInput: { ...(input.tool_input as object), answers },
            },
          });
        }
        await removeAnswer(sid, id);
      }
      if (Date.now() - start >= deadlineMs) return null;
      await sleep(pollMs);
    }
  } finally {
    if (active === mine) active = null;
    await cleanup(sid, id, released);
  }
}

/**
 * The answer carries the hub's signature for this session and tool use, made after the question was published
 * (its pending file is written at `start`; one second of slack for clock rounding). No secret: not signed.
 */
async function signedByHub(a: SignedAnswer, sid: string, id: string, start: number): Promise<boolean> {
  const at = typeof a.createdAt === 'string' ? Date.parse(a.createdAt) : NaN;
  if (!Number.isFinite(at) || at < start - 1000) return false;
  const secret = await loadSecret();
  return secret.ok && verifyAnswer(a, sid, id, secret.secret);
}

async function cleanup(sid: string, id: string, released: boolean): Promise<void> {
  try {
    await removePending(sid, id);
  } catch (e) {
    logError(e);
  }
  if (released) return;
  try {
    await clearWaiting(sid);
  } catch (e) {
    logError(e);
  }
}

function logError(e: unknown): void {
  try {
    const dir = paths().logDir;
    fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    fs.appendFileSync(path.join(dir, 'ask.log'), `${new Date().toISOString()} ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  } catch {
    /* never break the session */
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** `node ask.mjs pre-tool`: stdin is the PreToolUse input; stdout is only the decision JSON, if any. */
export async function main(): Promise<void> {
  let out: string | null = null;
  // Esc cancels the hook by killing it; a closed terminal sends SIGHUP (absent on Windows). Without a
  // handler Node exits at once and the question would stay pending in the app. No stdout on this path.
  const onSignal = () => {
    abortActiveSync();
    process.exit(0);
  };
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    try {
      process.on(sig, onSignal);
    } catch {
      /* not supported on this platform */
    }
  }
  try {
    if (process.argv[2] === 'pre-tool') out = await runAsk(JSON.parse(await readStdin()) as AskInput);
  } catch (e) {
    logError(e);
  }
  if (out) process.stdout.write(out, () => process.exit(0));
  else process.exit(0);
}
