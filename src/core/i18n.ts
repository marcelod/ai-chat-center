import en from './locales/en.json' with { type: 'json' };
import ptBR from './locales/pt-BR.json' with { type: 'json' };
import type { Lang } from './config.js';

type Tree = { [k: string]: string | Tree };

const locales: Record<Lang, Tree> = { en, 'pt-BR': ptBR };

export function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

function lookup(tree: Tree, key: string): string | undefined {
  let cur: string | Tree | undefined = tree;
  for (const part of key.split('.')) {
    if (typeof cur !== 'object' || cur === null || !Object.hasOwn(cur, part)) return undefined;
    cur = cur[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

export function t(lang: Lang, key: string, vars?: Record<string, string>): string {
  const text = lookup(locales[lang], key) ?? lookup(locales.en, key) ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, n) => (n in vars ? vars[n] : m)) : text;
}
