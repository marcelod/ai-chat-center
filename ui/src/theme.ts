// Light/dark choice for this browser. 'system' follows the OS (prefers-color-scheme); 'light' and 'dark'
// set data-theme on <html>, which index.css uses to pick the color tokens.
export type Theme = 'system' | 'light' | 'dark';

const KEY = 'acc.theme';
const THEMES: Theme[] = ['system', 'light', 'dark'];

export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.includes(v as Theme) ? (v as Theme) : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}

export function saveTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    /* storage unavailable: the choice lasts until the page reloads */
  }
}
