import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import en from '@core/locales/en.json';
import ptBR from '@core/locales/pt-BR.json';
import type { Language } from './api';

type Tree = { [k: string]: string | Tree };
const locales: Record<Language, Tree> = { en, 'pt-BR': ptBR };

function lookup(tree: Tree, key: string): string | undefined {
  let cur: string | Tree | undefined = tree;
  for (const part of key.split('.')) {
    if (typeof cur !== 'object' || cur === null || !Object.hasOwn(cur, part)) return undefined;
    cur = cur[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

export type T = (key: string, vars?: Record<string, string | number>) => string;

export function translate(lang: Language, key: string, vars?: Record<string, string | number>): string {
  const text = lookup(locales[lang], key) ?? lookup(locales.en, key) ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, n) => (n in vars ? String(vars[n]) : m)) : text;
}

const LangContext = createContext<Language>('en');

export function LangProvider({ lang, children }: { lang: Language; children: ReactNode }) {
  return createElement(LangContext.Provider, { value: lang }, children);
}

export const useLang = () => useContext(LangContext);

export function useT(): T {
  const lang = useLang();
  return useMemo(() => (key, vars) => translate(lang, key, vars), [lang]);
}
