import type { BackgroundColor, BackgroundGradient } from '@shared/background';

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
