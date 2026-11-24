import { describe, expect, it } from 'vitest';
import type { SessionView } from '@shared/types';
import { formatTime, previewText } from './format';
import { translate } from './i18n';

const now = new Date(2026, 0, 14, 15, 0);
const t = (k: string) => translate('en', k);
const at = (d: number, h = 9, m = 5) => new Date(2026, 0, d, h, m).toISOString();

describe('formatTime', () => {
  it('shows HH:MM for today', () => expect(formatTime(at(14), 'en', t, now)).toBe('09:05'));
  it('shows yesterday', () => expect(formatTime(at(13), 'en', t, now)).toBe('yesterday'));
  it('shows a short weekday within 6 days', () => expect(formatTime(at(10), 'en', t, now)).toBe('Sat'));
  it('shows a short date when older than 6 days', () => {
    const out = formatTime(at(6), 'en', t, now);
    expect(out).toMatch(/Jan/);
    expect(out).toMatch(/6/);
  });
});

describe('previewText for a message with attachments', () => {
  const s = (text: string, attachments: string[]) =>
    ({
      sessionId: 's', name: 'n', cwd: '/', state: 'idle', pendingAppMessageIds: [],
      lastEvent: { kind: 'user', id: 'u', ts: at(14), text, origin: 'app', attachments },
    }) as SessionView;
  it('shows the text when there is one, else the file names', () => {
    expect(previewText(s('hello', ['a.png']), t)).toBe('You: hello');
    expect(previewText(s('', ['a.png', 'b.txt']), t)).toBe('You: 📎 a.png, b.txt');
  });
});

describe('previewText for a pending question', () => {
  it('shows the question waiting text', () => {
    const s = { sessionId: 's', name: 'n', cwd: '/', state: 'waiting', waitingKind: 'question', pendingAppMessageIds: [] } as SessionView;
    expect(previewText(s, (k) => k)).toBe('ui.question.waiting');
  });
});
