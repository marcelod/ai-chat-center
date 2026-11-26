import { paths } from './paths.js';
import { readJson, writeJsonAtomic } from './fsAtomic.js';
import { normalizeWindowSize, type WindowSize } from '../shared/windowSize.js';

export type Lang = 'en' | 'pt-BR';
export interface Config {
  language: Lang;
  /** The app may answer Claude Code's multiple-choice dialogs (/cc answers on|off). */
  answersFromApp: boolean;
  /** Opening the app in its own browser window (/cc window on|off). On unless `window off` saved false. */
  openWindow: boolean;
  /** The last size of the app window, reported by the app (PUT /api/window-size). Absent until then. */
  windowSize?: WindowSize;
}

const LANGS: Lang[] = ['en', 'pt-BR'];

export async function loadConfig(): Promise<Config> {
  const c = await readJson<Partial<Config>>(paths().config);
  const language = LANGS.includes(c?.language as Lang) ? (c!.language as Lang) : 'en';
  const windowSize = normalizeWindowSize(c?.windowSize);
  return { language, answersFromApp: c?.answersFromApp === true, openWindow: c?.openWindow !== false, ...(windowSize ? { windowSize } : {}) };
}

export async function saveConfig(patch: Partial<Config>): Promise<Config> {
  const next = { ...(await loadConfig()), ...patch };
  await writeJsonAtomic(paths().config, next);
  return next;
}
