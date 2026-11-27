import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent, SessionView } from '@shared/types';
import { exportConversation, printConversation } from './PrintConversation';
import { buildExport } from '../exportConversation';
import { translate } from '../i18n';

const t = (k: string, v?: Record<string, string | number>) => translate('en', k, v);
const now = new Date(2026, 10, 27, 14, 5);
const TOKEN = 'f'.repeat(64);
const session = { sessionId: 's1', name: 'billing api', cwd: '/home/me/billing', state: 'idle', pendingAppMessageIds: [] } as SessionView;
const events: ChatEvent[] = [
  { kind: 'user', id: 'u1', ts: new Date(2026, 10, 27, 9, 0).toISOString(), origin: 'app', text: `Please **fix** http://127.0.0.1:1/#token=${TOKEN}` },
  { kind: 'assistant', id: 'a1', ts: new Date(2026, 10, 27, 9, 1).toISOString(), text: 'Done ![shot](http://example.com/x.png)' },
  { kind: 'actions', id: 'x1', ts: new Date(2026, 10, 27, 9, 2).toISOString(), items: [{ toolUseId: 't', name: 'Edit', summary: 'src/x.ts' }] },
];

afterEach(() => {
  window.dispatchEvent(new Event('afterprint'));
  vi.restoreAllMocks();
});

describe('printConversation', () => {
  it('shows the conversation only while printing, named after the file, then takes it out', () => {
    document.title = 'AI Chat Center';
    let seen = '';
    let titleAtPrint = '';
    const print = vi.fn(() => {
      const host = document.querySelector('.print-export');
      seen = host?.innerHTML ?? '';
      titleAtPrint = document.title;
    });
    act(() => printConversation(buildExport(session, events, t, now), 'billing-api-2026-11-27', t, print));
    expect(print).toHaveBeenCalledTimes(1);
    expect(titleAtPrint).toBe('billing-api-2026-11-27');
    expect(seen).toContain('billing api');
    expect(seen).toContain('<strong>You</strong> · 09:00');
    expect(seen).toContain('<strong>fix</strong>');
    expect(seen).toContain('<code>src/x.ts</code>');
    expect(seen).not.toContain(TOKEN);
    expect(seen).not.toContain('127.0.0.1');
    expect(seen).not.toContain('<img');
    act(() => window.dispatchEvent(new Event('afterprint')));
    expect(document.querySelector('.print-export')).toBeNull();
    expect(document.title).toBe('AI Chat Center');
  });

  it('a new export takes out a print view the browser never closed', () => {
    const doc = buildExport(session, events, t, now);
    act(() => printConversation(doc, 'a', t, () => {}));
    act(() => printConversation(doc, 'b', t, () => {}));
    expect(document.querySelectorAll('.print-export')).toHaveLength(1);
  });
});

describe('exportConversation', () => {
  it('downloads the Markdown as <name>-<date>.md', async () => {
    let blob: Blob | undefined;
    const create = vi.fn((b: Blob) => {
      blob = b;
      return 'blob:x';
    });
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    let download = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      download = this.download;
    });
    exportConversation('md', session, events, 'pt-BR', now);
    expect(download).toBe('billing-api-2026-11-27.md');
    expect(blob?.type).toBe('text/markdown;charset=utf-8');
    const text = await blob!.text();
    expect(text).toContain('# billing api');
    expect(text).toContain('**Você** · 09:00');
    expect(text).not.toContain(TOKEN);
  });
});
