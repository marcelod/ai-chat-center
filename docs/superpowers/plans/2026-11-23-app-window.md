# Abrir o app em janela própria — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/ai-chat-center:cc window on|off`; com a opção ligada, cada `/ai-chat-center:cc` abre o app numa janela `--app` do Chrome/Chromium/Edge usando um código de pareamento de uso único (o token nunca vai na linha de comando).

**Architecture:** Flag `openWindow` em `config.json` tratada pelo hook `prompt-submit`; hub com códigos de pareamento em memória (`POST /api/pair-code` autenticado, `POST /api/pair` troca código por token); módulo `src/hooks/openWindow.ts` acha o navegador e o inicia desacoplado; a UI aceita `#pair=`.

**Tech Stack:** TypeScript, Node 18+ (sem dependências novas), React 19, vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-app-window-design.md`

## Global Constraints
- Comandos com argumentos sempre mostrados na forma completa `/ai-chat-center:cc …`; `isCcCommand` aceita as duas formas.
- Textos em `en` e `pt-BR`.
- Nenhum token em argumento de processo, log ou stdout do modelo. O código de pareamento: 32 bytes hex, 60 s, uso único, máx. 5 pendentes.
- `POST /api/pair` sem bearer, mas com a checagem de `Origin`/`Host` e o limite de corpo existentes.
- Spawn sem shell (`shell: false`), `detached: true`, `stdio: 'ignore'`, `unref()`; falhas só em `logs/hook.log`.
- Versão: subir para 0.4.0 na última tarefa (`package.json`, `package-lock.json`, `plugin/.claude-plugin/plugin.json`, `ui/package.json`, `src/core/version.ts`) e regenerar/commitar `plugin/dist`.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Testes: `npm test`, `npm -w ui run test`, `npx tsc -p ui --noEmit`.

## Review Focus
1. Código de pareamento usado duas vezes, vencido ou inventado: `400`, sem token.
2. Hook sem navegador compatível: nenhuma exceção, link mostrado como sempre, confirmação do `window on` avisa.
3. `/ai-chat-center:cc window on` sem sessão conectada: salva a flag e não abre janela.
4. App aberto com `#pair=` inválido: mostra a tela de "abra o link do /cc" (a mesma de token ausente), sem loop.
5. `PUT /api/config` (idioma) não altera `openWindow`.

---

### Task 1: Flag `openWindow` e `/ai-chat-center:cc window on|off`
**Files:** `src/core/config.ts`, `src/core/ccCommand.ts`, `src/hooks/hook.ts`, `src/hub/transcript/parse.ts` (novos valores → `[]`), `plugin/commands/cc.md`, locales, testes em `test/core/config.test.ts`, `test/hooks/hook.test.ts`, `test/hooks/ccMd.test.ts`, `test/hub/parse.test.ts`.
**Produces:** `Config.openWindow: boolean` (padrão false, `=== true`); `isCcCommand` → `'window-on' | 'window-off'`; constantes `WINDOW_ON = 'AI Chat Center: opening the app in its own window is ON'`, `WINDOW_OFF = 'AI Chat Center: opening the app in its own window is OFF'`; `cc.md` ganha o ramo dessas linhas (resposta de uma linha confirmando, no idioma do usuário) e o `unknown argument` passa a listar `/ai-chat-center:cc window on|off`. O `window on` acrescenta à mensagem do usuário se nenhum navegador foi encontrado (usa `findBrowser` da Task 3; até lá, injetar por `HookContext.findBrowser?`).
- [ ] Testes que falham (parse dos argumentos, flag salva sem sessão, bookkeeping de turno igual ao `answers`, `PUT /api/config` preserva `openWindow`, `cc.md` tem o ramo) → implementar → PASS → commit `feat(window): /cc window on|off`.

### Task 2: Códigos de pareamento no hub e `#pair=` na UI
**Files:** `src/hub/pairing.ts` (novo), `src/hub/server.ts`, `ui/src/api.ts`, `ui/src/App.tsx` (se precisar esperar), testes `test/hub/pairing.test.ts`, `test/hub/server.test.ts`, `ui/src/api.test.ts`.
**Produces:** `createPairing(now?)` com `issue(): string` e `redeem(code: string): boolean` (60 s, uso único, máx. 5); rotas `POST /api/pair-code` → `200 {code}` (bearer) e `POST /api/pair` `{code}` → `200 {token}` | `400`; na UI, `#pair=<code>` é removido da URL, trocado pelo token (guardado como o de `#token=`) antes da primeira chamada autenticada; falha cai no estado de token ausente.
- [ ] Testes que falham (emitir/resgatar, reuso, vencido com relógio injetado, limite de 5, rotas com 401/403/400, UI troca e limpa o fragmento, UI com código inválido) → implementar → PASS → commit `feat(window): one-time pairing codes`.

### Task 3: Achar o navegador e abrir a janela no `/cc`
**Files:** `src/hooks/openWindow.ts` (novo), `src/hooks/hook.ts` (`connect`), `README.md`, `README.pt-BR.md`, `docs/testing/release-checklist.md` (item manual), versão 0.4.0, `plugin/dist`.
**Produces:** `findBrowser(env = process.env, platform = process.platform, exists = fs.existsSync): string | null` (ordem da spec §2); `openAppWindow(url: string, deps?): boolean` (spawn conforme as Global Constraints, `--app=<url>` e `--new-window`); em `connect`, com `openWindow` ligado e o hub de pé: pede um código ao hub (`POST /api/pair-code` com o token do disco) e abre `http://127.0.0.1:<porta>/#pair=<code>`; qualquer falha só registra em `hook.log`.
- [ ] Testes que falham (`findBrowser` por plataforma com `PATH`/`exists` falsos; `openAppWindow` chama o spawn injetado com os argumentos certos e sem token; `connect` abre só com a flag ligada, não abre sem navegador, não quebra se o hub recusar) → implementar → READMEs (uso: `window on|off`, limitação: precisa de Chrome/Chromium/Edge) → versão 0.4.0 → `npm run build` → PASS → commit `feat(window): open the app in its own window on /cc` com `plugin/dist`.
