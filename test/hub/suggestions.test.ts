import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from '../helpers/tmp.js';
import { wrapMessages } from '../../src/core/protocol.js';
import { normalizeReply } from '../../src/shared/quickReplies.js';
import {
  createSuggestionCache,
  suggestReplies,
  userTexts,
  type TranscriptSource,
} from '../../src/hub/suggestions.js';

// Spec 2026-11-27-suggested-quick-replies: the messages the user repeats become quick reply suggestions.

const NOW = Date.parse('2026-11-27T12:00:00Z');
const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
let n = 0;

const user = (content: unknown, at = iso(DAY), extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'user', uuid: `u${n++}`, timestamp: at, message: { role: 'user', content }, ...extra });
const queued = (prompt: unknown, at = iso(DAY), extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'attachment',
    uuid: `q${n++}`,
    timestamp: at,
    attachment: { type: 'queued_command', commandMode: 'prompt', humanTurn: true, prompt, ...extra },
  });
const app = (text: string, key = 'k1', at = iso(DAY)) =>
  user(`${wrapMessages([{ id: `m${n++}`, text, createdAt: at }], key)}\n\nReply in the app.`, at);

function setup() {
  const root = fs.realpathSync.native(tmpDir('acc-sugg-'));
  const projects = path.join(root, 'projects');
  fs.mkdirSync(path.join(projects, 'p'), { recursive: true });
  const file = (name: string, lines: string[]) => {
    const p = path.join(projects, 'p', name);
    fs.writeFileSync(p, lines.join('\n') + '\n');
    return p;
  };
  return { root, projects, file };
}

const run = (sources: TranscriptSource[], extra: Partial<Parameters<typeof suggestReplies>[1]> = {}) =>
  suggestReplies(sources, { now: () => NOW, ...extra });

describe('normalizeReply', () => {
  it('ignores case, accents, punctuation and extra spaces', () => {
    expect(normalizeReply('  Pode   SEGUIR!! ')).toBe('pode seguir');
    expect(normalizeReply('Faz o commit, por favor.')).toBe('faz o commit por favor');
    expect(normalizeReply('ação')).toBe('acao');
    expect(normalizeReply('...')).toBe('');
  });
});

describe('userTexts', () => {
  it('takes plain prompts, text blocks and queued prompts', () => {
    expect(userTexts(user('pode seguir'), [])).toEqual([{ text: 'pode seguir', ts: Date.parse(iso(DAY)) }]);
    expect(userTexts(user([{ type: 'text', text: 'ok' }]), []).map((t) => t.text)).toEqual(['ok']);
    expect(userTexts(queued('faz o commit'), []).map((t) => t.text)).toEqual(['faz o commit']);
  });

  it('takes the inner text of app messages with a trusted key only', () => {
    expect(userTexts(app('commit it', 'k1'), ['k1']).map((t) => t.text)).toEqual(['commit it']);
    expect(userTexts(app('commit it', 'evil'), ['k1'])).toEqual([]);
  });

  it('leaves out hook and system text, commands, tool results, images, agents and meta entries', () => {
    const none = [
      user('<command-name>/clear</command-name>\n<command-args></command-args>'),
      user('<local-command-stdout>done</local-command-stdout>'),
      user('<system-reminder>hi</system-reminder>'),
      user('<task-notification>x</task-notification>'),
      user('<bash-input>ls</bash-input>'),
      user('[Request interrupted by user]'),
      user([{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
      user([{ type: 'text', text: 'look' }, { type: 'image', source: {} }]),
      user('Another Claude session sent a message: <agent-message from="a">ok</agent-message>'),
      user('ok', iso(DAY), { isMeta: true }),
      user('ok', iso(DAY), { isSidechain: true }),
      user('ok', iso(DAY), { isCompactSummary: true }),
      user('ok', iso(DAY), { origin: { kind: 'peer', name: 'x' } }),
      queued('ok', iso(DAY), { commandMode: 'bash' }),
      queued('ok', iso(DAY), { humanTurn: false }),
      JSON.stringify({ type: 'assistant', timestamp: iso(DAY), message: { content: [{ type: 'text', text: 'ok' }] } }),
      'not json',
    ];
    for (const l of none) expect(userTexts(l, [])).toEqual([]);
  });
});

describe('suggestReplies', () => {
  it('suggests texts repeated 3 times or more, normalized, in the most recent original form', async () => {
    const { file, projects } = setup();
    const a = file('a.jsonl', [
      user('pode seguir', iso(5 * DAY)),
      user('Pode seguir!', iso(4 * DAY)),
      user('ok', iso(3 * DAY)),
      user('ok', iso(2 * DAY)),
    ]);
    const b = file('b.jsonl', [app('PODE   SEGUIR.', 'k1', iso(DAY)), queued('ok', iso(DAY / 2))]);
    const out = await run([{ path: a, keys: [], projects }, { path: b, keys: ['k1'], projects }]);
    expect(out).toEqual([
      { text: 'ok', count: 3 }, // same count: the most recent first
      { text: 'PODE SEGUIR.', count: 3 },
    ]);
  });

  it('needs 3 uses in the last 30 days, at most 80 characters, no commands or attachments', async () => {
    const { file, projects } = setup();
    const long = 'x'.repeat(81);
    const att = 'veja\n[Attachment: /home/u/.ai-chat-center/attachments/s/f.png]';
    const p = file('a.jsonl', [
      ...[1, 2].map((d) => user('twice', iso(d * DAY))),
      ...[1, 2, 40].map((d) => user('old', iso(d * DAY))),
      ...[1, 2, 3].map((d) => user(long, iso(d * DAY))),
      ...[1, 2, 3].map((d) => user('/compact', iso(d * DAY))),
      ...[1, 2, 3].map((d) => app(att, 'k1', iso(d * DAY))),
      ...[1, 2, 3].map((d) => user('<pasted_content id="1">hi</pasted_content id="1">', iso(d * DAY))),
    ]);
    expect(await run([{ path: p, keys: ['k1'], projects }])).toEqual([]);
  });

  it('does not count a queued prompt twice when the user entry repeats it', async () => {
    const { file, projects } = setup();
    const p = file('a.jsonl', [queued('go on', iso(DAY)), user('go on', iso(DAY - 60_000)), queued('go on', iso(DAY / 2))]);
    expect(await run([{ path: p, keys: [], projects }])).toEqual([]);
  });

  it('orders by use then recency and keeps at most the limit', async () => {
    const { file, projects } = setup();
    const lines: string[] = [];
    for (let i = 0; i < 12; i++) for (let k = 0; k < 3 + (i === 5 ? 2 : 0); k++) lines.push(user(`reply ${i}`, iso((20 - i) * DAY + k)));
    const p = file('a.jsonl', lines);
    const out = await run([{ path: p, keys: [], projects }]);
    expect(out).toHaveLength(10);
    expect(out[0]).toEqual({ text: 'reply 5', count: 5 });
    expect(out[1].text).toBe('reply 11');
  });

  it('reads only the end of a big file', async () => {
    const { file, projects } = setup();
    const filler = user('x'.repeat(900), iso(10 * DAY));
    const p = file('a.jsonl', [
      ...[1, 2, 3].map(() => user('early', iso(9 * DAY))),
      ...Array.from({ length: 50 }, () => filler),
      ...[1, 2, 3].map(() => user('late', iso(DAY))),
    ]);
    const out = await run([{ path: p, keys: [], projects }], { maxBytes: 10_000 });
    expect(out.map((s) => s.text)).toEqual(['late']);
  });

  it('reads only .jsonl files inside the projects folder, never through a link out of it', async () => {
    const { root, file, projects } = setup();
    const lines = [1, 2, 3].map(() => user('secret'));
    const outside = path.join(root, 'outside.jsonl');
    fs.writeFileSync(outside, lines.join('\n'));
    const link = path.join(projects, 'p', 'link.jsonl');
    fs.symlinkSync(outside, link);
    const txt = file('a.txt', lines);
    const out = await run([
      { path: outside, keys: [], projects },
      { path: link, keys: [], projects },
      { path: txt, keys: [], projects },
      { path: path.join(projects, 'p', 'missing.jsonl'), keys: [], projects },
    ]);
    expect(out).toEqual([]);
  });

  it('skips files not changed in the last 30 days', async () => {
    const { file, projects } = setup();
    const p = file('a.jsonl', [1, 2, 3].map(() => user('ok')));
    const old = new Date(NOW - 31 * DAY);
    fs.utimesSync(p, old, old);
    expect(await run([{ path: p, keys: [], projects }])).toEqual([]);
  });
});

describe('createSuggestionCache', () => {
  it('keeps the result for the TTL, shares a running scan and does not keep a failure', async () => {
    let t = 0;
    const scan = vi.fn(async () => [{ text: 'ok', count: 3 }]);
    const cache = createSuggestionCache(scan, { ttlMs: 1000, now: () => t });
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    expect(a).toEqual(b);
    expect(scan).toHaveBeenCalledTimes(1);
    t = 999;
    await cache.get();
    expect(scan).toHaveBeenCalledTimes(1);
    t = 1000;
    await cache.get();
    expect(scan).toHaveBeenCalledTimes(2);

    const failing = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue([]);
    const c2 = createSuggestionCache(failing, { ttlMs: 1000, now: () => 0 });
    await expect(c2.get()).rejects.toThrow();
    expect(await c2.get()).toEqual([]);
    expect(failing).toHaveBeenCalledTimes(2);
  });
});
