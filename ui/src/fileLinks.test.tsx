import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '@shared/types';
import { useExistingFiles } from './fileLinks';

const ts = new Date(2026, 0, 5, 10, 0).toISOString();
const say = (text: string): ChatEvent => ({ kind: 'assistant', id: 'a1', ts, text });

describe('useExistingFiles', () => {
  it('asks about every cited path, 200 at a time and one batch after the other, without a new event', async () => {
    const paths = Array.from({ length: 450 }, (_, i) => `docs/f${i}.md`);
    const events = [say(paths.join(' '))];
    let inFlight = 0;
    let most = 0;
    const filesExist = vi.fn(async (ask: string[]) => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return ask.filter((p) => p.endsWith('9.md'));
    });
    const { result } = renderHook(() => useExistingFiles('s1', events, filesExist));
    await waitFor(() => expect(filesExist).toHaveBeenCalledTimes(3));
    expect(filesExist.mock.calls.map((c) => c[0].length)).toEqual([200, 200, 50]);
    expect(most).toBe(1);
    await waitFor(() => expect(result.current.has('docs/f449.md')).toBe(true));
    expect(result.current.has('docs/f9.md')).toBe(true);
  });

  it('a failed batch is not retried in a loop: it waits for the next change', async () => {
    const events = [say('a.md b.md')];
    const filesExist = vi.fn(async () => {
      throw new Error('down');
    });
    renderHook(() => useExistingFiles('s1', events, filesExist));
    await waitFor(() => expect(filesExist).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(filesExist).toHaveBeenCalledTimes(1);
  });
});
