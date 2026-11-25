# Retomar sessões e comandos pelo app: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O app retoma uma sessão encerrada em segundo plano (`claude --bg --resume <sid> "/ai-chat-center:cc"`) e, em sessões em segundo plano, roda comandos `/…` digitando-os por `claude attach` num pseudo-terminal.

**Architecture:** Um módulo novo `src/hub/background.ts` concentra todo o contato com `claude --bg`, `claude attach` e `script`. O provider expõe `background.id` e `resumeError` na `SessionView`. O server ganha duas rotas, e a UI ganha o botão Retomar, o envio de comandos e os avisos.

**Tech Stack:** TypeScript, Node 18+, React 19, vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-background-sessions-design.md`

## Global Constraints
- Processos só com `spawn`/`execFile` e argumentos em array. O único texto montado é o do `script -c`, com o `id` curto validado por `/^[0-9a-f]{8}$/`.
- O texto do comando é validado (começa com `/`, uma linha, no máximo 200 caracteres, sem caracteres de controle) antes de ser digitado.
- Comandos só com a sessão `idle`, um por sessão de cada vez. Windows: 501 para comandos; o retomar funciona.
- Sem dependência nativa nova (nada de node-pty no `plugin/dist`).
- Versão 0.5.0 (mudança de comportamento visível); `plugin/dist` regenerado e commitado na última tarefa (ver `docs/testing/release-checklist.md`).
- Textos novos em `en` e `pt-BR`; commits com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Testes: `npm test`, `npm -w ui run test`, `npx tsc -p ui --noEmit`.

## Review Focus
1. Retomar uma sessão ainda ativa num terminal nunca pode acontecer (duas instâncias da conversa).
2. O `/cc` vindo do retomar passa pelo mesmo hook e pela mesma chave nova de um `/cc` digitado. Nenhum caminho de registro paralelo.
3. Nenhuma entrada do app chega a um shell: o texto do comando só vai para o stdin do pseudo-terminal.
4. O attach sempre fecha (prazo de 10 s para o prompt, 2 s depois do Enter) e nunca derruba a sessão.
5. `claude` ausente, pasta sem confiança, saída inesperada: erro visível no app, nada preso em "Retomando…".

---

### Task 1: `src/hub/background.ts`: retomar e digitar
**Files:** Create `src/hub/background.ts`, `test/hub/background.test.ts`.
**Produces:** `resumeInBackground(reg, opts): Promise<{ ok: true } | { ok: false; error: string }>` (spawn `claude --bg --resume <sid> "/ai-chat-center:cc"` com `cwd`, `CLAUDE_CONFIG_DIR` e `AI_CHAT_CENTER_NO_WINDOW=1`, captura stderr e o código de saída); `typeCommand(id, text, opts): Promise<void>` (pseudo-terminal por `script` no Linux e no macOS, espera `❯`, digita, Enter, fecha; lança erro no Windows); `isValidCommand(text)`, `isBgId(id)`. `spawn` e a plataforma injetáveis.
- [ ] Testes que falham (argumentos exatos por plataforma, env, validação, prazo do prompt, fechamento, erro do `--bg` propagado) → implementar → PASS → commit `feat(bg): resume in background and type commands through claude attach`.

### Task 2: Provider e rotas do hub
**Files:** Modify `src/shared/types.ts` (`SessionView.background?: { id }`, `resumeError?`, `resuming?`), `src/hub/provider.ts` (lê `kind`/`id` do `claude agents`; estado de retomada por 60 s; entra no sinal de mudança do poll), `src/hub/server.ts` (`POST /api/sessions/<sid>/resume`, `POST /api/sessions/<sid>/command`, lock por sessão); testes em `test/hub/provider.test.ts`, `test/hub/server.test.ts`.
- [ ] Testes que falham (códigos 202/404/409/501/200 do spec, token ausente 401, lock, Review Focus 1) → implementar → PASS → commit `feat(bg): resume and command routes`.

### Task 3: Hook: `/cc` sem janela em segundo plano
**Files:** Modify `src/hooks/hook.ts` (ou `src/hooks/openWindow.ts`): com `AI_CHAT_CENTER_NO_WINDOW=1` o `/cc` não abre janela; teste em `test/hooks/hook.test.ts`.
- [ ] Teste que falha → implementar → PASS → commit `feat(bg): no app window for a /cc run by the hub`.

### Task 4: UI
**Files:** Modify `ui/src/api.ts` (`resumeSession`, `sendCommand`), `ui/src/components/ChatView.tsx` e o menu ⋮ (Retomar, "Retomando…", erro, `claude attach <id>` copiável), o composer (`/` em sessão em segundo plano vai para `sendCommand`; em sessão interativa, aviso antes de enviar como texto; 409 → "ocupada"; 501 → "ainda não disponível no Windows"), o aviso de permissão (inclui `claude attach <id>`), locales; testes correspondentes.
- [ ] Testes que falham → implementar → PASS → commit `feat(bg): resume button and commands in the app`.

### Task 5: Build, checklist e backlog
**Files:** `package.json` (0.5.0), `plugin/dist`, Create `docs/testing/background-sessions.md` (retomar uma sessão real, `/compact` pelo app, permissão em segundo plano, Windows só retomar, macOS `script`), Modify `docs/backlog.md` (itens 1 e 2 para "A testar no uso").
- [ ] `npm run build` → todos os testes → commit `build: 0.5.0 and regenerate plugin/dist`.
