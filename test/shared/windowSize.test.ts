import { describe, expect, it } from 'vitest';
import { DEFAULT_WINDOW_SIZE, MAX_WINDOW_SIZE, MIN_WINDOW_SIZE, fitWindowSize, normalizeWindowSize } from '../../src/shared/windowSize.js';

describe('normalizeWindowSize', () => {
  it('keeps a sane size, rounding to whole pixels', () => {
    expect(normalizeWindowSize({ width: 1400, height: 900 })).toEqual({ width: 1400, height: 900 });
    expect(normalizeWindowSize({ width: 1400.6, height: 899.4 })).toEqual({ width: 1401, height: 899 });
  });
  it('clamps to the minimum and maximum', () => {
    expect(normalizeWindowSize({ width: 10, height: 10 })).toEqual(MIN_WINDOW_SIZE);
    expect(normalizeWindowSize({ width: 1e9, height: 1e9 })).toEqual(MAX_WINDOW_SIZE);
  });
  it('drops anything that is not two finite numbers', () => {
    for (const v of [null, undefined, 'x', [], {}, { width: '1400', height: 900 }, { width: 1400 }, { width: NaN, height: 900 }, { width: Infinity, height: 900 }, { width: 1400, height: true }]) {
      expect(normalizeWindowSize(v)).toBeNull();
    }
  });
  it('keeps only width and height', () => {
    expect(normalizeWindowSize({ width: 1400, height: 900, x: 5, evil: '<' })).toEqual({ width: 1400, height: 900 });
  });
});

describe('fitWindowSize', () => {
  it('the default fits a 1440x900 screen', () => {
    expect(DEFAULT_WINDOW_SIZE.width).toBeLessThanOrEqual(1440);
    expect(DEFAULT_WINDOW_SIZE.height).toBeLessThanOrEqual(900);
  });
  it('shrinks to the free area of the screen, never below the minimum', () => {
    expect(fitWindowSize({ width: 1400, height: 900 }, { width: 1920, height: 1040 })).toEqual({ width: 1400, height: 900 });
    expect(fitWindowSize({ width: 1400, height: 900 }, { width: 1366, height: 728 })).toEqual({ width: 1366, height: 728 });
    expect(fitWindowSize({ width: 1400, height: 900 }, { width: 100, height: 100 })).toEqual(MIN_WINDOW_SIZE);
  });
  it('ignores a screen size that is not usable', () => {
    expect(fitWindowSize({ width: 1400, height: 900 }, { width: 0, height: NaN })).toEqual({ width: 1400, height: 900 });
  });
});
