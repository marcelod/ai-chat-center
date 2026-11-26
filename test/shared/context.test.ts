import { describe, expect, it } from 'vitest';
import { contextWindowSize } from '../../src/shared/context.js';

describe('contextWindowSize', () => {
  it('uses the size Claude Code reported to the status line', () => {
    expect(contextWindowSize('claude-opus-5-5', 50_000, 1_000_000)).toEqual({ size: 1_000_000, exact: true });
    expect(contextWindowSize(undefined, 50_000, 200_000)).toEqual({ size: 200_000, exact: true });
  });
  it('without it: 1M for a model id that says so, 200k otherwise', () => {
    expect(contextWindowSize('claude-opus-5-5[1m]', 50_000)).toEqual({ size: 1_000_000, exact: false });
    expect(contextWindowSize('claude-sonnet-5-5-1m', 50_000)).toEqual({ size: 1_000_000, exact: false });
    expect(contextWindowSize('claude-opus-5-5', 50_000)).toEqual({ size: 200_000, exact: false });
    expect(contextWindowSize(undefined, 50_000)).toEqual({ size: 200_000, exact: false });
  });
  it('a context already larger than 200k means the 1M window', () => {
    expect(contextWindowSize('claude-opus-5-5', 247_217)).toEqual({ size: 1_000_000, exact: false });
  });
  it('ignores a reported size that is unusable or smaller than what is in use (stale after a model switch)', () => {
    for (const bad of [0, -1, NaN, 1.5, 999, 200_000_000, null]) {
      expect(contextWindowSize('claude-opus-5-5', 1000, bad as number)).toEqual({ size: 200_000, exact: false });
    }
    expect(contextWindowSize('claude-opus-5-5', 300_000, 200_000)).toEqual({ size: 1_000_000, exact: false });
  });
});
