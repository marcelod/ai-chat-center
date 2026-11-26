import type { CSSProperties } from 'react';
import type { BackgroundColor, BackgroundGradient, ChatBackground } from '@shared/background';

// The look of each background preset (the hub stores only the ids). Mid-tone, saturated colours: under the
// veil of the page colour (see .chat-bg-veil in index.css) they read as a light tint in the light theme and
// a deep tint in the dark one, and the bubbles keep their contrast in both.

export const COLOR_CSS: Record<BackgroundColor, string> = {
  rose: '#f43f5e',
  peach: '#fb923c',
  sand: '#d4a373',
  mint: '#34d399',
  teal: '#14b8a6',
  sky: '#38bdf8',
  lavender: '#a78bfa',
  slate: '#64748b',
};

export const GRADIENT_CSS: Record<BackgroundGradient, string> = {
  sunrise: 'linear-gradient(135deg, #f97316, #ec4899)',
  ocean: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
  meadow: 'linear-gradient(135deg, #84cc16, #14b8a6)',
  dusk: 'linear-gradient(135deg, #8b5cf6, #f43f5e)',
  aurora: 'linear-gradient(135deg, #22d3ee, #a855f7, #22c55e)',
  ember: 'linear-gradient(135deg, #ef4444, #f59e0b)',
};

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const DARK_TEXT = '#111827';

/** White or near-black initials, whichever reads better on these colours (the worst one decides). */
export function initialsColor(hexes: string[]): string {
  const lums = hexes.map(luminance);
  const white = Math.min(...lums.map((l) => contrast(l, 1)));
  const dark = Math.min(...lums.map((l) => contrast(l, luminance(DARK_TEXT))));
  return white >= dark ? '#ffffff' : DARK_TEXT;
}

/**
 * The conversation's background colour on its avatar (the circle with the initials), so it is easy to spot
 * in the list. An image background, or none, keeps the default avatar (undefined).
 */
export function avatarStyle(bg: ChatBackground | undefined): CSSProperties | undefined {
  if (!bg || bg.kind === 'image') return undefined;
  if (bg.kind === 'color') {
    const c = COLOR_CSS[bg.value];
    return c ? { background: c, color: initialsColor([c]) } : undefined;
  }
  const g = GRADIENT_CSS[bg.value];
  if (!g) return undefined;
  return { backgroundImage: g, color: initialsColor(g.match(/#[0-9a-f]{6}/gi) ?? []) };
}
