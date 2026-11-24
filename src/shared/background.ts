// Per-conversation background (shared by the hub and the web UI). The hub stores preset ids, never CSS:
// the UI maps each id to its colours (ui/src/components/backgrounds.ts).

export const BACKGROUND_COLORS = ['rose', 'peach', 'sand', 'mint', 'teal', 'sky', 'lavender', 'slate'] as const;
export const BACKGROUND_GRADIENTS = ['sunrise', 'ocean', 'meadow', 'dusk', 'aurora', 'ember'] as const;

export type BackgroundColor = (typeof BACKGROUND_COLORS)[number];
export type BackgroundGradient = (typeof BACKGROUND_GRADIENTS)[number];

/** What the app can set with PUT /api/sessions/<sid>/background (null: no background). */
export type BackgroundPreset = { kind: 'color'; value: BackgroundColor } | { kind: 'gradient'; value: BackgroundGradient };

/** `file` changes on every upload, so the app knows to fetch the image again. */
export type ImageBackground = { kind: 'image'; file: string };
export type ChatBackground = BackgroundPreset | ImageBackground;

/** Largest background image the hub accepts (bytes). */
export const BACKGROUND_IMAGE_MAX = 5 * 1024 * 1024;
