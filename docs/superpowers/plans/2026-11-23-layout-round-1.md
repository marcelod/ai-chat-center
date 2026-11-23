# Layout, rodada 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lista de sessões recolhível, renomear sessões (nome guardado no hub), caixa de mensagem que cresce até 8 linhas, logo B + favicon.

**Architecture:** O hub guarda um nome de exibição por sessão (`<home>/names/<sid>.json`), aplica-o na `SessionView.name` e expõe `PUT /api/sessions/:sid/name`. A UI edita o nome no cabeçalho da conversa, recolhe a coluna de sessões numa faixa de avatares (estado em `localStorage`), faz o textarea crescer até 8 linhas e mostra o logo/favicon.

**Tech Stack:** TypeScript, Node 18+, React 19 + Tailwind v4, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-23-layout-round-1-design.md`

## Global Constraints

- Textos em `src/core/locales/en.json` e `pt-BR.json`, mesmas chaves.
- Tokens de cor e padrões de componentes existentes (`ui/src/index.css`, `SessionList.tsx`, `ChatView.tsx`, `Composer.tsx`); claro e escuro; alvos de toque ≥ 44 px; botões só-ícone com `aria-label`.
- Nome de exibição: string, sem espaços nas pontas, 1–80 caracteres; `""` limpa (volta ao nome original). Nunca vira nome de arquivo (o arquivo é por `sid`, validado com `assertSessionId`).
- Rotas novas com o mesmo bearer + checagem de `Origin`/`Host` + limite de corpo das demais.
- `localStorage` sempre com try/catch; a UI funciona sem ele.
- A versão já é 0.3.1 (ainda sem tag): não subir de novo. `plugin/dist` é regenerado e commitado só na última tarefa.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Testes: `npm test` (raiz) e `npm -w ui run test` (UI); `npx tsc -p ui --noEmit`.

## Review Focus

1. Renomear uma sessão e depois ela reconectar (`/cc` de novo): o nome personalizado continua.
2. Nome com só espaços ou com 81 caracteres: 400, nada gravado.
3. Duas abas abertas: o nome novo aparece na outra aba (via `poll` → `sessions`).
4. Lista recolhida com uma sessão selecionada e depois expandida: a seleção e as não lidas continuam.
5. Texto colado com 30 linhas: o campo para em 8 linhas e rola; depois de enviar, volta a 1 linha.

---

### Task 1: Hub — nome de exibição por sessão

**Files:**
- Create: `src/core/names.ts`, `test/core/names.test.ts`
- Modify: `src/core/paths.ts` (`namesFile(sid)` → `<home>/names/<sid>.json`), `src/hub/provider.ts`, `src/hub/server.ts`, `src/shared/types.ts`
- Test: `test/hub/server.test.ts`, `test/hub/provider.test.ts`

**Interfaces:**
- Produces:
  - `getDisplayName(sid): Promise<string | null>`, `setDisplayName(sid, name: string): Promise<void>` (`""` apaga o arquivo), `validDisplayName(v: unknown): string | null` (aceita `""`; senão 1–80 após trim e sem diferença de trim; devolve o valor ou null).
  - `SessionView.name` = nome personalizado se existir, senão o atual (`l?.name || basename(cwd)`); `SessionView.originalName?: string` presente só quando há nome personalizado.
  - `PUT /api/sessions/:sid/name` com `{name: string}` → `200 {name: <nome exibido>}`; `400` corpo/nome inválido; `404` sessão sem registro.
- [ ] **Step 1: Testes que falham** — `names.test.ts`: set/get/limpar; `validDisplayName` rejeita `"  "`, `" a"`, 81 caracteres, número; aceita `""` e 80 caracteres. `server.test.ts`: PUT feliz, 400s, 404, 401 sem token, origem inválida. `provider.test.ts`: `listSessions` usa o nome personalizado e traz `originalName`; o nome sobrevive a uma nova `register` da mesma sessão; `poll()` emite `sessions` quando o nome muda.
- [ ] **Step 2:** `npx vitest run test/core/names.test.ts test/hub` → FAIL.
- [ ] **Step 3:** Implementar (padrão de `waiting.ts`/`busy.ts`; rota ao lado de `events|messages|questions`).
- [ ] **Step 4:** mesmo comando → PASS; `npm test`.
- [ ] **Step 5:** Commit `feat(names): per-session display name in the hub`.

### Task 2: UI — renomear no cabeçalho da conversa

**Files:**
- Modify: `ui/src/api.ts`, `ui/src/components/ChatView.tsx`, `ui/src/App.tsx` (passar o handler), locales
- Test: `ui/src/components/ChatView.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`PUT /api/sessions/:sid/name`, `SessionView.originalName`).
- Produces: `renameSession(sid: string, name: string): Promise<{name: string}>` em `api.ts`; prop `onRename?: (name: string) => Promise<void>` no `ChatView`.
- Comportamento: botão lápis (`aria-label` "Renomear sessão"/"Rename session") ao lado do nome; clique no nome ou no lápis abre um input com o nome atual, focado e selecionado; Enter ou perder o foco salva; Esc cancela; vazio salva `""` (volta ao original); mais de 80 caracteres é bloqueado pelo `maxLength`; erro mostra um texto curto ("Não foi possível renomear") e mantém o input; quando há `originalName`, um `title` no nome mostra o original.
- [ ] **Step 1: Testes que falham** — abre o input pelo lápis; Enter chama `onRename('Novo')`; Esc não chama; vazio chama `onRename('')`; falha mostra o erro; com `originalName` o título traz o original.
- [ ] **Step 2:** `npm -w ui run test` → FAIL.
- [ ] **Step 3:** Implementar; `App.tsx` chama `api.renameSession` e deixa o `poll`/stream atualizar a lista.
- [ ] **Step 4:** `npm -w ui run test`, `npx tsc -p ui --noEmit` → PASS.
- [ ] **Step 5:** Commit `feat(ui): rename a session from the chat header`.

### Task 3: UI — lista de sessões recolhível

**Files:**
- Modify: `ui/src/App.tsx`, `ui/src/components/SessionList.tsx`, locales
- Test: `ui/src/components/SessionList.test.tsx` (criar se não existir) ou `ui/src/App.test.tsx`

**Interfaces:**
- Produces: prop `collapsed: boolean` e `onToggleCollapsed: () => void` no `SessionList`; chave `localStorage` `acc.sessionsCollapsed` (`"1"`/`"0"`).
- Comportamento (só `md`+): botão no topo da lista ("Recolher lista"/"Expandir lista", ícone) alterna; recolhida, a `aside` tem ~72 px e mostra só as sessões conectadas como avatar (iniciais) + ponto de status + contador de não lidas pequeno; avatar com `aria-label` = nome e `title` = nome; clique seleciona. "Outras sessões abertas", busca/idioma/menu ficam ocultos quando recolhida. No celular o botão não aparece e o comportamento atual não muda.
- [ ] **Step 1: Testes que falham** — alterna e persiste em `localStorage`; recolhida mostra avatares com nome acessível e seleciona ao clicar; não lidas aparecem; `localStorage` que lança erro não quebra.
- [ ] **Step 2:** `npm -w ui run test` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm -w ui run test`, `npx tsc -p ui --noEmit` → PASS.
- [ ] **Step 5:** Commit `feat(ui): collapsible session list`.

### Task 4: Caixa de mensagem que cresce, logo B, favicon e build

**Files:**
- Create: `ui/src/components/Logo.tsx`, `ui/public/favicon.svg`, `ui/public/favicon-32.png`
- Modify: `ui/src/components/Composer.tsx`, `ui/src/components/SessionList.tsx` (logo ao lado do título), `ui/index.html` (`<link rel="icon" type="image/svg+xml" href="/favicon.svg">` e o PNG), `plugin/dist/*` (via `npm run build`)
- Test: `ui/src/components/Composer.test.tsx` (criar se não existir)

**Interfaces / valores:**
- Logo B (viewBox `0 0 100 100`), gradiente `#5b7cff` → `#3b5bdb`:
  `<path d="M32 22 A34 34 0 1 1 30 77 L18 88 L22 70" fill="none" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>` e texto `AI` em (52, 50), `font-weight 800`, `font-size 29`. Componente `Logo({ size }: { size: number })` com `aria-hidden` (o título ao lado já nomeia).
- Favicon: o mesmo desenho em SVG; PNG 32×32 gerado a partir dele (Chrome headless serve).
- Confirmar que o hub serve `/favicon.svg` e `/favicon-32.png` (mesmo `root` dos assets; MIME de `.svg`/`.png` existe em `server.ts`, senão adicionar).
- Composer: o textarea cresce com o conteúdo até 8 linhas (altura máx. = 8 × line-height + padding) e então rola; volta a 1 linha depois de enviar.
- [ ] **Step 1: Testes que falham** — Composer: depois de enviar, o valor é `""` e a altura volta ao mínimo (verificar o estilo/atributo que a implementação controla); a altura máxima aplicada corresponde a 8 linhas. Server: `GET /favicon.svg` → 200 `image/svg+xml`.
- [ ] **Step 2:** testes → FAIL.
- [ ] **Step 3:** Implementar; `npm run build`.
- [ ] **Step 4:** `npm test`, `npm -w ui run test`, `npx tsc -p ui --noEmit` → PASS; `plugin/dist/ui` contém os favicons.
- [ ] **Step 5:** Commit `feat(ui): growing composer, logo and favicon` (com `plugin/dist`).
