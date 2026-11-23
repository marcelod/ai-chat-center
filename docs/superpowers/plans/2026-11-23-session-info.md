# Branch, modelo e nível de raciocínio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `SessionView` ganha `branch?`, `model?`, `effort?`; o cabeçalho da conversa mostra `pasta · ⎇ branch · Modelo · 🧠 effort`.

**Architecture:** O hook `prompt-submit` grava o `effort` por sessão; o hub lê o `HEAD` do git a partir do `cwd`, pega o modelo da última resposta da transcrição e expõe os três campos; a UI os exibe.

**Tech Stack:** TypeScript, Node 18+, React 19, vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-session-info-design.md`

## Global Constraints
- Sem rodar `git` nem outros processos: só leitura de arquivos. Caminhos de `.git`/`gitdir:` lidos com tolerância a erro (qualquer falha → sem branch).
- `effort` aceito só como string curta (`/^[a-z]{1,16}$/`); estado em `<home>/meta/<sid>.json` via `assertSessionId` e escrita atômica.
- Campos novos entram no sinal de mudança do `poll` (outra aba vê a troca).
- Versão continua 0.4.0 (ainda sem tag); `plugin/dist` regenerado e commitado na última tarefa.
- Textos novos em `en` e `pt-BR`; commits com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Testes: `npm test`, `npm -w ui run test`, `npx tsc -p ui --noEmit`.

## Review Focus
1. Pasta dentro de um subdiretório do repositório: a branch é achada subindo até a raiz.
2. Worktree (`.git` é arquivo) e HEAD destacado.
3. Pasta sem git, ou `.git` ilegível: nada quebra, sem branch.
4. Sessão sem resposta ainda: sem modelo; depois de um `/model`, o novo aparece na próxima resposta.
5. `effort` ausente no input do hook (Claude Code antigo): nada gravado, nada quebra.

---

### Task 1: Hub e hook — branch, modelo e effort na `SessionView`
**Files:** Create `src/core/gitBranch.ts`, `src/core/meta.ts`, testes `test/core/gitBranch.test.ts`, `test/core/meta.test.ts`; Modify `src/core/paths.ts` (`metaFile(sid)`), `src/hooks/hook.ts` (grava effort no ramo de sessão ativa), `src/hub/provider.ts` (preenche os campos; modelo a partir do leitor/transcrição), `src/hub/transcript/*` se preciso para expor o último modelo, `src/shared/types.ts`; testes em `test/hooks/hook.test.ts`, `test/hub/provider.test.ts`, `test/hub/parse.test.ts`.
**Produces:** `readGitBranch(cwd: string): Promise<string | null>`; `setEffort(sid, level)`, `getEffort(sid)`; `shortModel(id: string): string`; `SessionView.branch?`, `model?` (já curto), `effort?`.
- [ ] Testes que falham (Review Focus 1–5, `shortModel` para opus/sonnet/haiku/fable e id desconhecido, poll emite `sessions` quando branch/model/effort mudam) → implementar → PASS → commit `feat(info): branch, model and effort in the session view`.

### Task 2: UI — linha de informações no cabeçalho e build
**Files:** Modify `ui/src/components/ChatView.tsx`, locales (rótulos acessíveis: "Branch", "Modelo", "Nível de raciocínio"), `ui/src/components/ChatView.test.tsx`, `plugin/dist`.
**Produces:** a linha `pasta · ⎇ branch · Modelo · 🧠 effort` (cada parte só se existir; a pasta trunca primeiro; cada parte com `title`/rótulo acessível).
- [ ] Testes que falham (todas as partes; só a pasta; sem branch) → implementar → `npm run build` → PASS → commit `feat(info): show branch, model and effort in the chat header` com `plugin/dist`.
