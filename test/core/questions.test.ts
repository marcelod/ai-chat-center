import { describe, it, expect, beforeEach } from 'vitest';
import {
  assertToolUseId, parseQuestions, putPending, getPending, removePending,
  writeAnswer, readAnswer, validAnswers,
} from '../../src/core/questions.js';
import { tmpDir } from '../helpers/tmp.js';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../../src/core/paths.js';

beforeEach(() => {
  process.env.AI_CHAT_CENTER_HOME = tmpDir('acc-');
});

const opt = (label: string) => ({ label });
const q = (n: number, text = 'Q?') => ({ question: text, options: Array.from({ length: n }, (_, i) => opt(`o${i}`)) });
const colors = {
  questions: [{
    question: 'Qual cor você prefere?', header: 'Cor', multiSelect: false,
    options: [{ label: 'Red', description: 'r' }, { label: 'Blue' }, { label: 'Yellow' }],
  }],
};

describe('parseQuestions', () => {
  it('accepts the throwaway-test format', () => {
    const r = parseQuestions(colors);
    expect(r).toHaveLength(1);
    expect(r![0].options.map((o) => o.label)).toEqual(['Red', 'Blue', 'Yellow']);
  });
  it('rejects 0 or 5 questions', () => {
    expect(parseQuestions({ questions: [] })).toBeNull();
    expect(parseQuestions({ questions: Array.from({ length: 5 }, (_, i) => q(2, `q${i}`)) })).toBeNull();
    expect(parseQuestions({ questions: Array.from({ length: 4 }, (_, i) => q(2, `q${i}`)) })).toHaveLength(4);
  });
  it('rejects 1 or 5 options and empty labels', () => {
    expect(parseQuestions({ questions: [q(1)] })).toBeNull();
    expect(parseQuestions({ questions: [q(5)] })).toBeNull();
    expect(parseQuestions({ questions: [{ question: 'Q?', options: [opt('a'), opt('')] }] })).toBeNull();
    expect(parseQuestions({ questions: [{ question: '', options: [opt('a'), opt('b')] }] })).toBeNull();
  });
  it('rejects junk', () => {
    expect(parseQuestions(null)).toBeNull();
    expect(parseQuestions('x')).toBeNull();
    expect(parseQuestions({})).toBeNull();
  });
});

describe('assertToolUseId', () => {
  it('throws on traversal and accepts normal ids', () => {
    expect(() => assertToolUseId('../x')).toThrow();
    expect(() => assertToolUseId('')).toThrow();
    expect(() => assertToolUseId('toolu_01AbC-9')).not.toThrow();
  });
});

describe('pending and answers', () => {
  const pending = (id: string, createdAt: string) => ({ toolUseId: id, questions: parseQuestions(colors)!, createdAt });

  it('getPending returns null, then the most recent; removePending deletes both files', async () => {
    expect(await getPending('s1')).toBeNull();
    await putPending('s1', pending('a', '2026-01-01T00:00:00.000Z'));
    await putPending('s1', pending('b', '2026-01-01T00:00:05.000Z'));
    expect((await getPending('s1'))!.toolUseId).toBe('b');
    expect(await writeAnswer('s1', 'b', { release: true })).toBe('ok');
    await removePending('s1', 'b');
    expect(await readAnswer('s1', 'b')).toBeNull();
    expect((await getPending('s1'))!.toolUseId).toBe('a');
  });

  it('writeAnswer: not-found without pending, ok then conflict', async () => {
    expect(await writeAnswer('s1', 'a', { release: true })).toBe('not-found');
    await putPending('s1', pending('a', '2026-01-01T00:00:00.000Z'));
    expect(await writeAnswer('s1', 'a', { answers: { 'Qual cor você prefere?': 'Red' } })).toBe('ok');
    expect(await writeAnswer('s1', 'a', { release: true })).toBe('conflict');
    expect(await readAnswer('s1', 'a')).toEqual({ answers: { 'Qual cor você prefere?': 'Red' } });
  });

  it('concurrent answers yield one ok and one conflict', async () => {
    await putPending('s1', pending('a', '2026-01-01T00:00:00.000Z'));
    const r = await Promise.all([writeAnswer('s1', 'a', { release: true }), writeAnswer('s1', 'a', { answers: {} })]);
    expect(r.sort()).toEqual(['conflict', 'ok']);
  });

  it('getPending skips and deletes a question whose hook process is dead (killed without cleanup)', async () => {
    const dead = 2 ** 30; // beyond any pid_max: kill(pid, 0) fails with ESRCH
    await putPending('s1', { ...pending('a', '2026-01-01T00:00:00.000Z'), pid: process.pid });
    await putPending('s1', { ...pending('b', '2026-01-01T00:00:05.000Z'), pid: dead });
    await writeAnswer('s1', 'b', { release: true });
    expect((await getPending('s1'))!.toolUseId).toBe('a');
    expect(fs.existsSync(path.join(paths().questionsDir('s1'), 'b.json'))).toBe(false);
    expect(fs.existsSync(path.join(paths().questionsDir('s1'), 'b.answer.json'))).toBe(false);
    expect(fs.existsSync(path.join(paths().questionsDir('s1'), 'a.json'))).toBe(true);
  });

  it('getPending ignores answer files', async () => {
    await putPending('s1', pending('a', '2026-01-01T00:00:00.000Z'));
    await writeAnswer('s1', 'a', { release: true });
    expect((await getPending('s1'))!.toolUseId).toBe('a');
  });
});

describe('validAnswers', () => {
  const qs = parseQuestions({ questions: [q(2, 'A?'), q(2, 'B?')] })!;
  it('accepts labels and free text', () => {
    expect(validAnswers(qs, { 'A?': 'o0', 'B?': 'texto livre' })).toEqual({ 'A?': 'o0', 'B?': 'texto livre' });
  });
  it('rejects missing key, extra key, bad values', () => {
    expect(validAnswers(qs, { 'A?': 'x' })).toBeNull();
    expect(validAnswers(qs, { 'A?': 'x', 'B?': 'y', 'C?': 'z' })).toBeNull();
    expect(validAnswers(qs, { 'A?': '', 'B?': 'y' })).toBeNull();
    expect(validAnswers(qs, { 'A?': 'x'.repeat(2001), 'B?': 'y' })).toBeNull();
    expect(validAnswers(qs, { 'A?': 'x'.repeat(2000), 'B?': 'y' })).not.toBeNull();
    expect(validAnswers(qs, { 'A?': 1, 'B?': 'y' })).toBeNull();
    expect(validAnswers(qs, { 'A?': ' x', 'B?': 'y' })).toBeNull();
    expect(validAnswers(qs, null)).toBeNull();
    expect(validAnswers(qs, ['A?', 'B?'])).toBeNull();
  });
});
