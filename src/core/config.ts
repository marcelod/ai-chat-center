import { paths } from './paths.js';
import { readJson, writeJsonAtomic } from './fsAtomic.js';

export type Lang = 'en' | 'pt-BR';
export interface Config {
  language: Lang;
}

const LANGS: Lang[] = ['en', 'pt-BR'];

export async function loadConfig(): Promise<Config> {
  const c = await readJson<Partial<Config>>(paths().config);
  const language = LANGS.includes(c?.language as Lang) ? (c!.language as Lang) : 'en';
  return { language };
}

export async function saveConfig(c: Config): Promise<void> {
  await writeJsonAtomic(paths().config, c);
}
