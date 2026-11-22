import { describe, it, expect } from 'vitest';
import en from '../../src/core/locales/en.json' with { type: 'json' };
import ptBR from '../../src/core/locales/pt-BR.json' with { type: 'json' };
import { t, flatten } from '../../src/core/i18n.js';

describe('i18n', () => {
  it('interpolates and falls back', () => {
    expect(t('pt-BR', 'hub.started', { url: 'x' })).toContain('x');
    expect(t('en', 'hub.started', { url: 'http://h' })).toBe('AI Chat Center is running at http://h');
    expect(t('pt-BR', 'no.such.key')).toBe('no.such.key');
  });
  it('falls back to en when key is only in en', () => {
    const k = 'test.onlyEn';
    (en as any).test = { onlyEn: 'English only' };
    try {
      expect(t('pt-BR', k)).toBe('English only');
    } finally {
      delete (en as any).test;
    }
  });
  it('locales have identical key sets', () => {
    expect(Object.keys(flatten(ptBR)).sort()).toEqual(Object.keys(flatten(en)).sort());
  });
});
