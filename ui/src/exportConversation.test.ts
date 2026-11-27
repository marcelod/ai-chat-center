import { describe, expect, it } from 'vitest';
import type { ChatEvent, SessionView } from '@shared/types';
import { buildExport, exportFileName, exportMarkdown, inlineCode } from './exportConversation';
import { translate } from './i18n';

const t = (k: string, v?: Record<string, string | number>) => translate('en', k, v);
const tPt = (k: string, v?: Record<string, string | number>) => translate('pt-BR', k, v);
const at = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m).toISOString();
const now = new Date(2026, 10, 27, 14, 5);

const session = {
  sessionId: 's1',
  name: 'My: project/fix?',
  cwd: '/home/me/proj',
  branch: 'main',
  state: 'idle',
  pendingAppMessageIds: [],
} as SessionView;

const TOKEN = 'a'.repeat(64);

const events: ChatEvent[] = [
  { kind: 'notice', id: 'n0', ts: at(26, 9, 0), code: 'connected' },
  {
    kind: 'user',
    id: 'u1',
    ts: at(26, 9, 1),
    origin: 'terminal',
    text: `/cc\nopen http://127.0.0.1:4823/#token=${TOKEN}`,
  },
  {
    kind: 'user',
    id: 'u2',
    ts: at(26, 9, 2),
    origin: 'app',
    text: '[AI Chat Center message id=m1 key=0123456789abcdef0123]\nPlease **fix** it\n[/AI Chat Center message]',
    attachments: ['shot.png', 'notes.txt'],
    images: 1,
  },
  { kind: 'assistant', id: 'a1', ts: at(26, 9, 3), text: 'Sure.\n\n```ts\nconst x = 1;\n```' },
  {
    kind: 'actions',
    id: 'x1',
    ts: at(26, 9, 4),
    items: [
      { toolUseId: 't1', name: 'Edit', summary: 'src/x.ts', result: 'long result '.repeat(100), diff: { lines: [{ op: '+', text: 'SECRET DIFF' }], added: 1, removed: 0 } },
      { toolUseId: 't2', name: 'Bash', summary: 'npm  test\n--run' },
    ],
  },
  { kind: 'actions', id: 'x2', ts: at(26, 9, 5), items: [{ toolUseId: 't3', name: 'Read', summary: 'a`b.ts' }] },
  { kind: 'toAgent', id: 'g1', ts: at(27, 10, 0), to: 'reviewer', text: 'Review the diff' },
  { kind: 'agent', id: 'g2', ts: at(27, 10, 1), from: 'reviewer', text: 'Looks good' },
  { kind: 'recap', id: 'r1', ts: at(27, 10, 2), text: 'You fixed x.' },
  { kind: 'user', id: 'u3', ts: at(27, 10, 3), origin: 'terminal', text: 'ls -la', shell: true },
  {
    kind: 'question',
    id: 'q1',
    ts: at(27, 10, 4),
    toolUseId: 'tq',
    questions: [{ question: 'Which one?', header: 'Pick', options: [{ label: 'A' }, { label: 'B' }] }],
    answerText: 'A',
  },
  { kind: 'notice', id: 'n1', ts: at(27, 10, 5), code: 'compacted' },
];

describe('buildExport + exportMarkdown', () => {
  const doc = buildExport(session, events, t, now);
  const md = exportMarkdown(doc, t);

  it('starts with the session name, folder, branch and export date', () => {
    expect(md.startsWith('# My: project/fix?\n')).toBe(true);
    expect(md).toContain('- **Folder:** `/home/me/proj`');
    expect(md).toContain('- **Branch:** `main`');
    expect(md).toContain('- **Exported:** 2026-11-27 14:05');
  });

  it('has a heading per day and an author with time per message', () => {
    expect(md).toContain('## 2026-11-26');
    expect(md).toContain('## 2026-11-27');
    expect(md).toContain('**You** · 09:02');
    expect(md).toContain('**Claude** · 09:03');
    expect(md).toContain('**Claude → reviewer** · 10:00');
    expect(md).toContain('**Agent reviewer** · 10:01');
    expect(md).toContain('**Recap** · 10:02');
  });

  it('keeps Markdown text as is', () => {
    expect(md).toContain('Please **fix** it');
    expect(md).toContain('```ts\nconst x = 1;\n```');
  });

  it('shows app messages without the block, id or key', () => {
    expect(md).not.toContain('AI Chat Center message');
    expect(md).not.toContain('m1');
    expect(md).not.toContain('0123456789abcdef');
  });

  it('never carries the app link or token', () => {
    expect(md).not.toContain('127.0.0.1');
    expect(md).not.toContain(TOKEN);
    expect(md).not.toContain('token=');
    expect(md).toContain('[app link removed]');
  });

  it('lists attachments by name and counts images', () => {
    expect(md).toContain('_Attachments: shot.png, notes.txt_');
    expect(md).toContain('_Images: 1_');
  });

  it('summarises tool actions in one line each, merged, without diffs or results', () => {
    expect(md).toContain('- Edit `src/x.ts`\n- Bash `npm test --run`\n- Read ``a`b.ts``');
    expect(md).not.toContain('SECRET DIFF');
    expect(md).not.toContain('long result');
  });

  it('shows a shell command as code, a question with its options and the answer', () => {
    expect(md).toContain('`! ls -la`');
    expect(md).toContain('**Pick:** Which one?\n\n- A\n- B');
    expect(md).toMatch(/\*\*You\*\* · 10:04\n\nA/);
  });

  it('keeps notices as short lines', () => {
    expect(md).toContain('_Conversation compacted · 10:05_');
    expect(md).toContain('_Connected · 09:00_');
  });

  it('speaks the chosen language', () => {
    const pt = exportMarkdown(buildExport(session, events, tPt, now), tPt);
    expect(pt).toContain('- **Pasta:** `/home/me/proj`');
    expect(pt).toContain('**Você** · 09:02');
    expect(pt).toContain('_Anexos: shot.png, notes.txt_');
  });

  it('redacts the session name and folder too', () => {
    const d = buildExport({ ...session, name: `x ${TOKEN}`, cwd: '/tmp/localhost:1' } as SessionView, [], t, now);
    expect(d.title).toBe('x [redacted]');
    expect(exportMarkdown(d, t)).not.toContain(TOKEN);
  });
});

describe('inlineCode', () => {
  it('wraps text in a backtick run longer than any inside', () => {
    expect(inlineCode('a')).toBe('`a`');
    expect(inlineCode('a``b')).toBe('```a``b```');
    expect(inlineCode('`x')).toBe('`` `x ``');
  });
});

describe('exportFileName', () => {
  it('is the cleaned session name and the date', () => {
    expect(exportFileName('My: project/fix?', now, 'md', t)).toBe('My-project-fix-2026-11-27.md');
    expect(exportFileName('  ..  ', now, 'pdf', t)).toBe('conversation-2026-11-27.pdf');
    expect(exportFileName('a'.repeat(200), now, 'md', t)).toBe(`${'a'.repeat(80)}-2026-11-27.md`);
    expect(exportFileName('ação útil', now, 'md', t)).toBe('ação-útil-2026-11-27.md');
  });
});
