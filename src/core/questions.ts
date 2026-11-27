import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';
import { isAlive } from './lock.js';
import { clearWaiting, getWaiting } from './waiting.js';
import { ensureDir, FILE_MODE, readJson, removeFile, writeJsonAtomic } from './fsAtomic.js';
import { installSecret } from './secret.js';
import type { PendingQuestion, Question } from '../shared/types.js';

const TOOL_USE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** tool_use ids become file names: reject anything that could traverse directories. */
export function assertToolUseId(id: string): void {
  if (typeof id !== 'string' || !TOOL_USE_ID_RE.test(id)) {
    throw new Error(`Invalid tool use id: ${JSON.stringify(id)}`);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** The AskUserQuestion tool_input: 1-4 questions, each with text and 2-4 labelled options. Anything else is null. */
export function parseQuestions(input: unknown): Question[] | null {
  if (!isObj(input) || !Array.isArray(input.questions)) return null;
  const raw = input.questions;
  if (raw.length < 1 || raw.length > 4) return null;
  const out: Question[] = [];
  for (const q of raw) {
    if (!isObj(q) || !nonEmpty(q.question) || !Array.isArray(q.options)) return null;
    if (q.options.length < 2 || q.options.length > 4) return null;
    const options = [];
    for (const o of q.options) {
      if (!isObj(o) || !nonEmpty(o.label)) return null;
      options.push(typeof o.description === 'string' ? { label: o.label, description: o.description } : { label: o.label });
    }
    const question: Question = { question: q.question, options };
    if (typeof q.header === 'string') question.header = q.header;
    if (typeof q.multiSelect === 'boolean') question.multiSelect = q.multiSelect;
    out.push(question);
  }
  return out;
}

const pendingFile = (sid: string, id: string) => (assertToolUseId(id), path.join(paths().questionsDir(sid), `${id}.json`));
const answerFile = (sid: string, id: string) => (assertToolUseId(id), path.join(paths().questionsDir(sid), `${id}.answer.json`));

export async function putPending(sid: string, q: PendingQuestion): Promise<void> {
  await writeJsonAtomic(pendingFile(sid, q.toolUseId), q);
}

/**
 * The most recent pending question of a session, or null. A question whose hook process is dead (killed
 * without running its cleanup: TerminateProcess on Windows, SIGKILL, a crash) is deleted and skipped.
 */
export async function getPending(sid: string): Promise<PendingQuestion | null> {
  let names: string[];
  try {
    names = await fs.readdir(paths().questionsDir(sid));
  } catch {
    return null;
  }
  let best: PendingQuestion | null = null;
  let removedStale = false;
  for (const n of names) {
    if (!n.endsWith('.json') || n.endsWith('.answer.json')) continue;
    const p = await readJson<PendingQuestion>(path.join(paths().questionsDir(sid), n));
    if (p && typeof p.pid === 'number' && !isAlive(p.pid)) {
      if (typeof p.toolUseId === 'string' && `${p.toolUseId}.json` === n) await removePending(sid, p.toolUseId);
      else await removeFile(path.join(paths().questionsDir(sid), n));
      removedStale = true;
      continue;
    }
    if (p && typeof p.createdAt === 'string' && (!best || p.createdAt > best.createdAt)) best = p;
  }
  // A hook killed without cleanup (Windows has no catchable signal) leaves its 'question' waiting state too.
  if (removedStale && !best && (await getWaiting(sid))?.kind === 'question') await clearWaiting(sid);
  return best;
}

export async function removePending(sid: string, toolUseId: string): Promise<void> {
  await removeFile(pendingFile(sid, toolUseId));
  await removeFile(answerFile(sid, toolUseId));
}

/** removePending for a signal handler, which cannot await. */
export function removePendingSync(sid: string, toolUseId: string): void {
  rmSync(pendingFile(sid, toolUseId), { force: true });
  rmSync(answerFile(sid, toolUseId), { force: true });
}

/** Deletes only the answer file (an invalid answer), so the question stays pending for a new one. */
export async function removeAnswer(sid: string, toolUseId: string): Promise<void> {
  await removeFile(answerFile(sid, toolUseId));
}

export type AnswerFile = { answers: Record<string, string> } | { release: true };
/** An answer file as written by the hub: the answer, when it was signed and its signature (see signAnswer). */
export type SignedAnswer = AnswerFile & { createdAt?: string; sig?: string };

// An answer file approves the AskUserQuestion tool call (the hook returns permissionDecision "allow"), so,
// like an inbox message, it is signed with the install secret: a file merely written into questions/<sid>/
// (by another program, or by an action Claude was tricked into) is not an answer from the app (review 0.6.11).
// v1: `ask1|sid|toolUseId|createdAt|payload`. Only the payload may contain `|`: session and tool use ids are
// [A-Za-z0-9_-], and createdAt is checked. The payload is `release`, or `answers:` + the JSON of the
// [question, answer] pairs sorted by question, so the signature does not depend on the key order in the file.
const payloadOf = (a: AnswerFile): string =>
  'release' in a ? 'release' : `answers:${JSON.stringify(Object.keys(a.answers).sort().map((k) => [k, a.answers[k]]))}`;
const answerMac = (secret: string, sid: string, toolUseId: string, createdAt: string, a: AnswerFile) =>
  crypto.createHmac('sha256', secret).update(`ask1|${sid}|${toolUseId}|${createdAt}|${payloadOf(a)}`).digest('hex');

/** The answer with `createdAt` and `sig = HMAC-SHA256(secret, ask1|sid|toolUseId|createdAt|payload)`. */
export function signAnswer(sid: string, toolUseId: string, a: AnswerFile, secret: string, createdAt = new Date().toISOString()): SignedAnswer {
  if (sid.includes('|') || toolUseId.includes('|') || createdAt.includes('|')) throw new Error('invalid answer id or time');
  const answer: AnswerFile = 'release' in a ? { release: true } : { answers: a.answers };
  return { ...answer, createdAt, sig: answerMac(secret, sid, toolUseId, createdAt, answer) };
}

/**
 * True only for an answer signed with `secret` for tool use `toolUseId` of session `sid`: exactly one of
 * `answers` (an object of strings) or `release: true`, a createdAt and a matching signature (constant time).
 */
export function verifyAnswer(a: SignedAnswer, sid: string, toolUseId: string, secret: string): boolean {
  if (!isObj(a) || typeof a.sig !== 'string' || typeof a.createdAt !== 'string' || a.createdAt.includes('|')) return false;
  const hasRelease = Object.hasOwn(a, 'release');
  if (hasRelease === Object.hasOwn(a, 'answers')) return false;
  let answer: AnswerFile;
  if (hasRelease) {
    if ((a as { release?: unknown }).release !== true) return false;
    answer = { release: true };
  } else {
    const ans = (a as { answers?: unknown }).answers;
    if (!isObj(ans) || !Object.values(ans).every((v) => typeof v === 'string')) return false;
    answer = { answers: ans as Record<string, string> };
  }
  const want = Buffer.from(answerMac(secret, sid, toolUseId, a.createdAt, answer));
  const got = Buffer.from(a.sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/**
 * Creates the answer file exclusively, so of two concurrent answers exactly one wins. Needs a pending question.
 * The answer is signed with the install secret (throws when the secret cannot be read: the hub's answer fails).
 */
export async function writeAnswer(sid: string, toolUseId: string, a: AnswerFile): Promise<'ok' | 'not-found' | 'conflict'> {
  if ((await readJson(pendingFile(sid, toolUseId))) === null) return 'not-found';
  const signed = signAnswer(sid, toolUseId, a, await installSecret());
  await ensureDir(paths().questionsDir(sid));
  try {
    await fs.writeFile(answerFile(sid, toolUseId), JSON.stringify(signed, null, 2), { encoding: 'utf8', flag: 'wx', mode: FILE_MODE });
    return 'ok';
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return 'conflict';
    throw e;
  }
}

export async function readAnswer(sid: string, toolUseId: string): Promise<SignedAnswer | null> {
  return readJson<SignedAnswer>(answerFile(sid, toolUseId));
}

/** Keys must be exactly the question texts; each value a trimmed string of 1-2000 chars (a label or free text). */
export function validAnswers(questions: Question[], answers: unknown): Record<string, string> | null {
  if (!isObj(answers)) return null;
  const keys = Object.keys(answers);
  const want = questions.map((q) => q.question);
  if (keys.length !== want.length || !want.every((k) => Object.hasOwn(answers, k))) return null;
  const out: Record<string, string> = {};
  for (const k of want) {
    const v = answers[k];
    if (typeof v !== 'string' || v.length < 1 || v.length > 2000 || v !== v.trim()) return null;
    out[k] = v;
  }
  return out;
}
