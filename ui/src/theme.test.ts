import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, readTheme, saveTheme } from './theme';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('theme', () => {
  it('defaults to system, with no data-theme', () => {
    expect(readTheme()).toBe('system');
    applyTheme(readTheme());
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('saves and applies light and dark, and system clears both', () => {
    saveTheme('dark');
    expect(readTheme()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    saveTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    saveTheme('system');
    expect(readTheme()).toBe('system');
    expect(localStorage.getItem('acc.theme')).toBeNull();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('ignores an unknown stored value', () => {
    localStorage.setItem('acc.theme', 'neon');
    expect(readTheme()).toBe('system');
  });

  it('still applies the theme when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => saveTheme('dark')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(readTheme()).toBe('system');
  });
});
