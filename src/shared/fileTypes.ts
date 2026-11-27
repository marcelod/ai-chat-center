// The file types the side panel opens (specs 2026-11-26-side-panel and 2026-11-27-side-panel-file-types).
// Shared by the hub (what it serves) and the web UI (which cited paths can become links).

export type PanelFileKind = 'markdown' | 'image' | 'text' | 'pdf';

export const MARKDOWN_EXTENSIONS = ['md', 'markdown'] as const;
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'] as const;
/**
 * Code and plain text, shown with line numbers. Configuration formats that usually hold secrets (`.env`,
 * `.ini`, `.conf`, keys and certificates) are left out on purpose, as are one-letter extensions other than
 * C's (they turn too many words into candidates).
 */
export const TEXT_EXTENSIONS = [
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonc',
  'css', 'scss', 'sass', 'less', 'html', 'htm', 'vue', 'svelte', 'astro',
  'py', 'rb', 'php', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'swift', 'dart', 'lua',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'cs',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'sql', 'graphql', 'gql', 'proto',
  'yaml', 'yml', 'toml', 'xml', 'txt', 'log', 'csv', 'tsv',
] as const;
export const PDF_EXTENSIONS = ['pdf'] as const;

const KIND = new Map<string, PanelFileKind>([
  ...MARKDOWN_EXTENSIONS.map((e) => [e, 'markdown'] as const),
  ...IMAGE_EXTENSIONS.map((e) => [e, 'image'] as const),
  ...TEXT_EXTENSIONS.map((e) => [e, 'text'] as const),
  ...PDF_EXTENSIONS.map((e) => [e, 'pdf'] as const),
]);

/** Every extension the panel opens, longest first (for a regular expression alternation). */
export const PANEL_EXTENSIONS: readonly string[] = [...KIND.keys()].sort((a, b) => b.length - a.length);

/** The kind of a file by its name (the extension, case ignored); null for a type the panel does not open. */
export function panelFileKind(name: string): PanelFileKind | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(name);
  return (m && KIND.get(m[1].toLowerCase())) || null;
}
