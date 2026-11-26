import { describe, expect, it } from 'vitest';
import { BACKGROUND_COLORS, BACKGROUND_GRADIENTS } from '@shared/background';
import { avatarStyle, COLOR_CSS, GRADIENT_CSS, initialsColor } from './backgrounds';

function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

describe('the conversation background on its avatar', () => {
  it('no background or an image keeps the default avatar', () => {
    expect(avatarStyle(undefined)).toBeUndefined();
    expect(avatarStyle({ kind: 'image', file: 'a.png' })).toBeUndefined();
  });
  it('a colour paints the avatar with that colour', () => {
    expect(avatarStyle({ kind: 'color', value: 'teal' })).toMatchObject({ background: COLOR_CSS.teal });
  });
  it('a gradient paints the avatar with the gradient', () => {
    expect(avatarStyle({ kind: 'gradient', value: 'ocean' })).toMatchObject({ backgroundImage: GRADIENT_CSS.ocean });
  });
  it('the initials stay readable on every colour (at least 3:1, large bold text)', () => {
    for (const c of BACKGROUND_COLORS) {
      const hex = COLOR_CSS[c];
      expect(ratio(hex, initialsColor([hex])), c).toBeGreaterThanOrEqual(3);
    }
    for (const g of BACKGROUND_GRADIENTS) {
      const stops = GRADIENT_CSS[g].match(/#[0-9a-f]{6}/gi)!;
      const text = initialsColor(stops);
      for (const s of stops) expect(ratio(s, text), `${g} ${s}`).toBeGreaterThanOrEqual(2.5);
    }
  });
  it('light colours (sand, mint) get dark initials', () => {
    expect(initialsColor([COLOR_CSS.sand])).not.toBe('#ffffff');
    expect(initialsColor([COLOR_CSS.mint])).not.toBe('#ffffff');
  });
});
