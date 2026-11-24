import { describe, expect, it } from 'vitest';
import { BACKGROUND_COLORS, BACKGROUND_GRADIENTS } from '@shared/background';
import { COLOR_CSS, GRADIENT_CSS } from './backgrounds';
import { translate } from '../i18n';

describe('background presets', () => {
  it('every preset id the hub accepts has its look and a name in both languages', () => {
    expect(Object.keys(COLOR_CSS).sort()).toEqual([...BACKGROUND_COLORS].sort());
    expect(Object.keys(GRADIENT_CSS).sort()).toEqual([...BACKGROUND_GRADIENTS].sort());
    for (const v of Object.values(COLOR_CSS)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
    for (const v of Object.values(GRADIENT_CSS)) expect(v).toMatch(/^linear-gradient\(/);
    for (const lang of ['en', 'pt-BR'] as const) {
      for (const id of BACKGROUND_COLORS) expect(translate(lang, `ui.background.color.${id}`)).not.toBe(`ui.background.color.${id}`);
      for (const id of BACKGROUND_GRADIENTS) expect(translate(lang, `ui.background.gradient.${id}`)).not.toBe(`ui.background.gradient.${id}`);
    }
  });
});
