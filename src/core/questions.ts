import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from './paths.js';
import { ensureDir, FILE_MODE, readJson, removeFile, writeJsonAtomic } from './fsAtomic.js';
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

/** The most recent pending question of a session, or null. */
export async function getPending(sid: string): Promise<PendingQuestion | null> {
  let names: string[];
  try {
    names = await fs.readdir(paths().questionsDir(sid));
  } catch {
    return null;
  }
  let best: PendingQuestion | null = null;
  for (const n of names) {
    if (!n.endsWith('.json') || n.endsWith('.answer.json')) continue;
    const p = await readJson<PendingQuestion>(path.join(paths().questionsDir(sid), n));
    if (p && typeof p.createdAt === 'string' && (!best || p.createdAt > best.createdAt)) best = p;
  }
  return best;
}

export async function removePending(sid: string, toolUseId: string): Promise<void> {
  await removeFile(pendingFile(sid, toolUseId));
  await removeFile(answerFile(sid, toolUseId));
}

/** Deletes only the answer file (an invalid answer), so the question stays pending for a new one. */
export async function removeAnswer(sid: string, toolUseId: string): Promise<void> {
  await removeFile(answerFile(sid, toolUseId));
}

export type AnswerFile = { answers: Record<string, string> } | { release: true };

/** Creates the answer file exclusively, so of two concurrent answers exactly one wins. Needs a pending question. */
export async function writeAnswer(sid: string, toolUseId: string, a: AnswerFile): Promise<'ok' | 'not-found' | 'conflict'> {
  if ((await readJson(pendingFile(sid, toolUseId))) === null) return 'not-found';
  await ensureDir(paths().questionsDir(sid));
  try {
    await fs.writeFile(answerFile(sid, toolUseId), JSON.stringify(a, null, 2), { encoding: 'utf8', flag: 'wx', mode: FILE_MODE });
    return 'ok';
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return 'conflict';
    throw e;
  }
}

export async function readAnswer(sid: string, toolUseId: string): Promise<AnswerFile | null> {
  return readJson<AnswerFile>(answerFile(sid, toolUseId));
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
