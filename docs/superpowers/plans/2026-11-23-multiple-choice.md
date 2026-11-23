# Múltipla escolha pelo app — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Responder pelo app a janela nativa de múltipla escolha do Claude Code (`AskUserQuestion`) em turnos vindos do app, depois de uma liberação única feita no terminal.

**Architecture:** Um hook síncrono `PreToolUse` novo (`dist/ask.mjs`, matcher `AskUserQuestion`) decide o destino da pergunta: segue para o terminal (sai sem decisão) ou grava a pergunta pendente no estado da sessão e espera a resposta que o hub grava ao lado; então devolve `allow` + `updatedInput.answers`. O hook `prompt-submit` marca a origem de cada turno (app/terminal) e trata `/cc answers on|off`. O hub expõe a pergunta pendente na `SessionView`, recebe a resposta por um endpoint autenticado e publica a presença de abas do app num arquivo; o parser da transcrição transforma a chamada `AskUserQuestion` num evento `question`, que a UI mostra como cartão.

**Tech Stack:** TypeScript, Node 18+ (sem dependências novas no plugin), esbuild, vitest, React 19 + Tailwind (ui/).

**Spec:** `docs/superpowers/specs/2026-11-23-multiple-choice-design.md`

## Global Constraints

- Só API documentada de hooks: `PreToolUse` → `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"Answered in AI Chat Center","updatedInput":{...tool_input,"answers":{<question>:<label ou texto>}}}}`. Múltipla escolha: rótulos unidos com `", "`.
- Saída "sem decisão" = exit 0 sem stdout (a janela nativa aparece).
- Hooks em exec form (`"command":"node","args":["${CLAUDE_PLUGIN_ROOT}/dist/<x>.mjs","<event>"]`), como os demais (`test/hooks/hooksJson.test.ts`).
- Espera máxima do hook: 24 h (`timeout: 86400` no hooks.json; o hook desiste sozinho em 86 000 s).
- Estado em `AI_CHAT_CENTER_HOME` com `writeJsonAtomic`/`readJson`/`removeFile` de `src/core/fsAtomic.ts`; ids de sessão sempre por `assertSessionId`; `tool_use_id` validado por `/^[A-Za-z0-9_-]{1,128}$/` antes de virar nome de arquivo.
- Sessões sem `/cc` ativo: o hook sai na hora, sem decisão.
- A liberação (`answersFromApp`) só muda pelo hook `prompt-submit` (prompt digitado). Nenhum endpoint do hub a altera.
- Textos em `src/core/locales/en.json` e `pt-BR.json` (mesmas chaves).
- Cada commit termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **`PUT /api/config` apagando a liberação:** hoje `saveConfig({language})` sobrescreve o arquivo inteiro. Trocar o idioma no app não pode desligar nem ligar `answersFromApp` (teste na Task 1 e na Task 4).
2. **Resposta dupla ou atrasada:** duas abas respondem a mesma pergunta, ou a resposta chega depois de o hook ter saído (release, timeout, sessão fechada). Só a primeira vale (409 para as outras), e uma resposta sem pergunta pendente dá 404 (Task 2 e Task 4).
3. **Respostas que não batem com as perguntas:** chave faltando, chave a mais, valor vazio ou enorme. O hub recusa com 400 e o hook ignora o arquivo inválido (Task 2 e Task 3).
4. **A sessão fecha ou desconecta durante a espera:** `/cc off`, `/clear` ou terminal fechado. O hook sai sem decisão e apaga a pergunta pendente, para o app não ficar mostrando botões mortos (Task 3).
5. **Turno do terminal logo depois de um turno do app:** a origem precisa ser do turno atual. Um prompt digitado vira "terminal" mesmo que a mensagem anterior tenha vindo do app (Task 1).

---

### Task 1: Liberação, `/cc answers on|off` e origem do turno

**Files:**
- Modify: `src/core/config.ts`, `src/core/ccCommand.ts`, `src/core/paths.ts`, `src/hooks/hook.ts`, `src/hub/transcript/parse.ts` (só a chamada a `isCcCommand`), `src/core/locales/en.json`, `src/core/locales/pt-BR.json`
- Create: `src/core/turn.ts`
- Test: `test/core/config.test.ts`, `test/hooks/hook.test.ts`, `test/core/turn.test.ts`

**Interfaces:**
- Produces:
  - `Config = { language: Lang; answersFromApp: boolean }`; `loadConfig()` com padrão `answersFromApp: false`; `saveConfig(patch: Partial<Config>): Promise<Config>` (lê, mescla, grava, devolve o resultado).
  - `isCcCommand(prompt): 'on' | 'off' | 'answers-on' | 'answers-off' | 'unknown' | null`. Argumentos `answers on` e `answers off`, sem diferenciar maiúsculas e com espaços extras tolerados.
  - `paths().turnFile(sid)` → `<home>/turns/<sid>.json`.
  - `src/core/turn.ts`: `type TurnOrigin = 'app' | 'terminal'`; `setTurnOrigin(sid, origin): Promise<void>` grava `{origin, at}`; `getTurnOrigin(sid): Promise<TurnOrigin | null>`; `clearTurnOrigin(sid)`; `promptOrigin(prompt: unknown, key: string | undefined): TurnOrigin`, que devolve `'app'` quando `unwrapMessages(prompt, key)` (de `src/core/protocol.ts`) encontra ao menos um bloco.
  - Linhas de contexto do hook: `ANSWERS_ON = 'AI Chat Center: answering questions from the app is ON'` e `ANSWERS_OFF = 'AI Chat Center: answering questions from the app is OFF'`.

- [ ] **Step 1: Testes que falham**
  - `config.test.ts`: `saveConfig({answersFromApp:true})` seguido de `saveConfig({language:'pt-BR'})` → `loadConfig()` igual a `{language:'pt-BR', answersFromApp:true}`. Um arquivo antigo `{language:'en'}` carrega com `answersFromApp:false`.
  - `hook.test.ts`:
    - `isCcCommand('/cc answers on')` vale `'answers-on'`. `'/ai-chat-center:cc  ANSWERS  off '` vale `'answers-off'`. `'/cc answers'` vale `'unknown'`.
    - `prompt-submit` com `/cc answers on` grava `answersFromApp:true`, devolve `additionalContext` contendo `ANSWERS_ON` e um `systemMessage` localizado, e funciona sem sessão conectada.
    - Numa sessão ativa, um prompt com o bloco `[AI Chat Center message id=x key=<reg.key>]\ntexto\n[/AI Chat Center message]` grava a origem `'app'`. O mesmo bloco com outra chave grava `'terminal'`. Um prompt comum grava `'terminal'`.
    - `/cc` (conectar) apaga o `turnFile`.
  - `turn.test.ts`: `promptOrigin` cobre os casos acima; `getTurnOrigin` devolve `null` sem arquivo.
- [ ] **Step 2:** `npx vitest run test/core/config.test.ts test/core/turn.test.ts test/hooks/hook.test.ts`. Esperado: FAIL.
- [ ] **Step 3: Implementar**
  - No `handleHook` de `prompt-submit`: `answers-on`/`answers-off` chamam `saveConfig` e devolvem `output(ANSWERS_ON|OFF, t(language,'hook.answersOn'|'hook.answersOff'))`.
  - No ramo de sessão ativa, junto do `setBusy`: `setTurnOrigin(sid, promptOrigin(input.prompt, reg.key))`.
  - `connect` chama `clearTurnOrigin`.
  - No parser, os novos valores de `isCcCommand` retornam `[]`, como `'unknown'`.
  - Textos pt-BR: `hook.answersOn` = "AI Chat Center: agora você pode responder pelo app as perguntas de múltipla escolha, inclusive confirmações. Para desligar: /cc answers off". `hook.answersOff` = "AI Chat Center: perguntas de múltipla escolha voltam a ser respondidas só no terminal." Escrever o equivalente em inglês.
- [ ] **Step 4:** O mesmo comando do Step 2, mais `npx vitest run test/hub/parse.test.ts`. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(answers): /cc answers on|off and per-turn origin`.

### Task 2: Pergunta pendente e presença do app (estado em disco)

**Files:**
- Create: `src/core/questions.ts`, `src/core/presence.ts`
- Modify: `src/core/paths.ts`, `src/core/waiting.ts`
- Test: `test/core/questions.test.ts`, `test/core/presence.test.ts`

**Interfaces:**
- Produces:
  - Em `src/shared/types.ts` (contrato com a UI): `type QuestionOption = { label: string; description?: string }`; `type Question = { question: string; header?: string; options: QuestionOption[]; multiSelect?: boolean }`; `type PendingQuestion = { toolUseId: string; questions: Question[]; createdAt: string }`.
  - `paths().questionsDir(sid)` → `<home>/questions/<sid>/`. Arquivos `<toolUseId>.json` (a pendente) e `<toolUseId>.answer.json`.
  - `src/core/questions.ts`:
    - `assertToolUseId(id: string): void`;
    - `parseQuestions(input: unknown): Question[] | null`: aceita de 1 a 4 perguntas, cada uma com `question` não vazio e de 2 a 4 opções com `label`. Qualquer outra coisa dá `null`;
    - `putPending(sid, q: PendingQuestion)`; `getPending(sid): Promise<PendingQuestion | null>` (a mais recente); `removePending(sid, toolUseId)` (apaga os dois arquivos);
    - `type AnswerFile = { answers: Record<string, string> } | { release: true }`;
    - `writeAnswer(sid, toolUseId, a: AnswerFile): Promise<'ok' | 'not-found' | 'conflict'>`: grava com flag `wx` (dá `'conflict'` se já existir) e só se o pendente existir;
    - `readAnswer(sid, toolUseId): Promise<AnswerFile | null>`;
    - `validAnswers(questions: Question[], answers: unknown): Record<string,string> | null`: as chaves devem ser exatamente os textos das perguntas, e cada valor uma string sem espaços nas pontas, com 1 a 2000 caracteres.
  - `WaitingKind` passa a ser `'permission' | 'input' | 'question'`.
  - `paths().presenceFile` → `<home>/app-presence.json`. Em `src/core/presence.ts`: `writePresence(clients: number)` grava `{clients, pid: process.pid, at}`; `appPresent(now = Date.now()): Promise<boolean>`, que é verdadeiro quando `clients > 0`, `at` tem menos de 45 s e o `pid` está vivo (`isAlive` de `src/core/lock.ts`).
- [ ] **Step 1: Testes que falham**
  - `parseQuestions`: rejeita 0 ou 5 perguntas, 1 ou 5 opções e `label` vazio; aceita o formato do teste descartável (pergunta "Qual cor você prefere?" com Red, Blue e Yellow).
  - `writeAnswer`: sem pendente dá `'not-found'`; a primeira gravação dá `'ok'` e a segunda `'conflict'`.
  - `validAnswers`: rejeita chave faltando, chave a mais, valor `''`, valor com 2001 caracteres e valor que não é string; aceita texto livre que não é rótulo.
  - `assertToolUseId('../x')` lança erro.
  - `appPresent`: falso sem arquivo, com `clients:0`, com `at` de 46 s atrás e com pid morto; verdadeiro no caso feliz.
- [ ] **Step 2:** `npx vitest run test/core/questions.test.ts test/core/presence.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** Implementar, seguindo o padrão de `waiting.ts` e `busy.ts`.
- [ ] **Step 4:** O mesmo comando. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(answers): pending question and app presence state`.

### Task 3: O hook `ask` (PreToolUse)

**Files:**
- Create: `src/hooks/ask.ts`, `src/bin/ask.ts`
- Modify: `plugin/hooks/hooks.json`, `scripts/build.mjs` (entry `ask`), `test/hooks/hooksJson.test.ts` (aceitar `ask` em `SCRIPT` e checar o novo grupo)
- Test: `test/hooks/ask.test.ts`

**Interfaces:**
- Consumes: Task 1 (`loadConfig`, `getTurnOrigin`), Task 2 (todo o `questions.ts`, `appPresent`, `setWaiting`/`clearWaiting`), `getRegistration`/`isActive` e `isAlive` de `lock.ts`.
- Produces: `runAsk(input: AskInput, opts?: AskOptions): Promise<string | null>`, que devolve o stdout JSON ou `null` (sem decisão).
  - `AskInput = { session_id: string; tool_name: string; tool_use_id: string; tool_input: unknown }`.
  - `AskOptions = { pollMs?: number; deadlineMs?: number; parentPid?: number | null; isAlive?: (pid:number)=>boolean; present?: () => Promise<boolean> }`, com padrões 500 ms, 86 000 000 ms, `process.ppid`, o `isAlive` de `lock.ts` e `appPresent`.
- hooks.json, grupo novo: `"PreToolUse": [{ "matcher": "AskUserQuestion", "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/dist/ask.mjs", "pre-tool"], "timeout": 86400, "statusMessage": "AI Chat Center: answer in the app (Esc to cancel)" }] }]`. Síncrono: sem `async` nem `asyncRewake`.

Regras de `runAsk`, em ordem. Qualquer "não" devolve `null`; qualquer exceção é registrada em `logs/ask.log` e também devolve `null`:
1. `tool_name === 'AskUserQuestion'`, sessão válida e registro ativo.
2. `loadConfig().answersFromApp === true`.
3. `getTurnOrigin(sid) === 'app'`.
4. `parseQuestions(tool_input.questions)` não é nulo e `tool_use_id` é válido.
5. `present()` é verdadeiro.
6. `putPending` e `setWaiting(sid,'question')`, depois laço a cada `pollMs`:
   - **resposta:** se `validAnswers` aceita, devolve o JSON de allow; um arquivo inválido é apagado e a espera continua;
   - **`{release:true}`:** `setWaiting(sid,'input')` e devolve `null`;
   - **saída:** registro inativo, `connectedAt` diferente do inicial, `parentPid` morto ou `deadlineMs` estourado devolvem `null`.
7. `finally`: `removePending`, e `clearWaiting` exceto no caso de release.

- [ ] **Step 1: Testes que falham** (`ask.test.ts`, com `AI_CHAT_CENTER_HOME` temporário e `pollMs: 10`)
  - Devolve `null` sem esperar quando: o registro não existe; a liberação está desligada; a origem é `'terminal'`; a origem é `null`; não há abas do app (`present` falso); as perguntas são inválidas.
  - Caminho feliz: uma tarefa paralela chama `writeAnswer(sid, id, {answers:{'Qual cor você prefere?':'Blue'}})` → o JSON tem `permissionDecision:'allow'`, `updatedInput.questions` igual ao original e `updatedInput.answers` igual ao gravado. Depois disso, `getPending` dá `null` e `getWaiting` dá `null`.
  - Texto livre (`'Verde-limão'`) é aceito.
  - Um arquivo de resposta inválido (chave errada) é ignorado, e a resposta válida gravada depois é usada.
  - Release devolve `null` e deixa a espera como `{kind:'input'}`.
  - `markDisconnected(sid,'off')` durante a espera devolve `null` e remove o pendente.
  - `isAlive` falso para o `parentPid` devolve `null`.
  - `deadlineMs: 50` devolve `null`.
  - `hooksJson.test.ts`: o grupo `PreToolUse` tem matcher `AskUserQuestion`, `timeout` 86400 e é síncrono.
- [ ] **Step 2:** `npx vitest run test/hooks/ask.test.ts test/hooks/hooksJson.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** Implementar `runAsk`. `src/bin/ask.ts` lê o stdin, roda `runAsk`, escreve o stdout e sai com 0, e define `process.noDeprecation = true`, como `src/bin/hook.ts`. Adicionar `ask` ao `entryPoints` do `scripts/build.mjs`.
- [ ] **Step 4:** O mesmo comando, mais `npm run build` (deve gerar `plugin/dist/ask.mjs`). Esperado: PASS.
- [ ] **Step 5:** Commit `feat(answers): PreToolUse hook routes AskUserQuestion to the app`.

### Task 4: Hub — presença, pergunta pendente na sessão e endpoint de resposta

**Files:**
- Modify: `src/hub/server.ts`, `src/hub/provider.ts`, `src/shared/types.ts`
- Test: `test/hub/main.test.ts` (ou o teste de servidor existente que cobre `/api/sessions/.../messages`), `test/hub/provider.test.ts`

**Interfaces:**
- Consumes: Task 2 (`getPending`, `writeAnswer`, `validAnswers`, `writePresence`, `PendingQuestion`), Task 1 (`loadConfig`, `saveConfig`).
- Produces:
  - `SessionView.pendingQuestion?: PendingQuestion`, presente só com o registro ativo; `SessionView.waitingKind` passa a aceitar `'question'`.
  - `GET /api/config` devolve `{language, answersFromApp}`. `PUT /api/config` continua aceitando só `language` e chama `saveConfig({language})`, que mescla e preserva `answersFromApp`; um `answersFromApp` no corpo é ignorado.
  - `POST /api/sessions/:sid/questions/:toolUseId` com corpo `{answers: Record<string,string>}` ou `{release: true}`:
    - `202 {ok:true}` no sucesso;
    - `400` para `toolUseId` inválido, corpo inválido ou `validAnswers` nulo;
    - `403` quando `answersFromApp` está desligado;
    - `404` quando não há pendente com esse id;
    - `409` quando já foi respondida.
  - Usa a mesma autenticação (bearer), checagem de `Origin` e limite de corpo das outras rotas.
- [ ] **Step 1: Testes que falham**
  - O endpoint cobre cada código acima, e a resposta gravada pode ser lida por `readAnswer`.
  - `PUT /api/config {language:'pt-BR', answersFromApp:true}` com a liberação desligada continua desligada, e com ela ligada continua ligada.
  - A `listSessions` de uma sessão com pendente inclui `pendingQuestion` e `waitingKind:'question'`.
  - `poll()` emite `{type:'sessions'}` quando um pendente aparece ou some.
  - Conectar ou desconectar um cliente SSE grava `app-presence.json` com o número de abas; o heartbeat atualiza `at`; `close()` grava `clients:0`.
- [ ] **Step 2:** `npx vitest run test/hub`. Esperado: FAIL nos testes novos.
- [ ] **Step 3: Implementar**
  - `writePresence(clients.size)` ao conectar, ao desconectar, a cada heartbeat (já existe um timer) e no `close`.
  - Incluir a assinatura do pendente (o `toolUseId` ou nada) no que o `poll` compara para decidir se emite `sessions`.
- [ ] **Step 4:** `npx vitest run test/hub`. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(answers): hub exposes pending questions and accepts answers`.

### Task 5: Parser — evento `question` na conversa

**Files:**
- Modify: `src/hub/transcript/parse.ts`, `src/shared/types.ts`
- Test: `test/hub/parse.test.ts` (fixture nova em `test/fixtures/` se necessário)

**Interfaces:**
- Produces: `ChatEvent` ganha `{ kind: 'question'; id: string; ts: string; toolUseId: string; questions: Question[]; answers?: Record<string,string>; answerText?: string }`.
- [ ] **Step 1: Testes que falham**
  - Um `tool_use` `AskUserQuestion` vira um evento `question` próprio (não um item de `actions`) e fecha o grupo de ações aberto, como o texto faz.
  - O `tool_result` correspondente preenche `answers` a partir de `entry.toolUseResult.answers` quando for um objeto de strings; senão, preenche `answerText` com o texto do resultado (truncado a `RESULT_MAX`).
  - O evento atualizado é reemitido com o mesmo `id`.
  - Entrada malformada (sem `questions` válidas) volta ao comportamento atual (item de ações).
- [ ] **Step 2:** `npx vitest run test/hub/parse.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** Implementar, reutilizando `parseQuestions` da Task 2 e o mapa `byToolUse` (ou um mapa paralelo para perguntas).
- [ ] **Step 4:** O mesmo comando. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(answers): show AskUserQuestion as a question event`.

### Task 6: UI — cartão de pergunta

**Files:**
- Create: `ui/src/components/QuestionCard.tsx`, `ui/src/components/QuestionCard.test.tsx`
- Modify: `ui/src/api.ts`, `ui/src/components/ChatView.tsx`, `ui/src/components/Composer.tsx`, `ui/src/components/SessionList.tsx`, `src/core/locales/en.json`, `src/core/locales/pt-BR.json`
- Test: `ui/src/components/ChatView.test.tsx`

**Interfaces:**
- Consumes: `ChatEvent` `question` (Task 5), `SessionView.pendingQuestion` e `waitingKind:'question'` (Task 4), `GET /api/config` com `answersFromApp`.
- Produces:
  - `api.ts`: `answerQuestion(sid: string, toolUseId: string, answers: Record<string,string>): Promise<void>` e `releaseQuestion(sid: string, toolUseId: string): Promise<void>`; `UiConfig` ganha `answersFromApp: boolean`.
  - `QuestionCard` com props `{ event; pending: boolean; answersFromApp: boolean; onAnswer; onRelease }`.
- Estados do cartão:
  1. **Respondida** (`answers` ou `answerText`): pergunta e resposta, só leitura.
  2. **Pendente** (`pendingQuestion.toolUseId === event.toolUseId`):
     - cada pergunta com um botão por opção (com a descrição) e um campo "Outra resposta";
     - `multiSelect` usa caixas de seleção, e as escolhidas são unidas com `", "`;
     - um botão "Enviar" ativo só quando toda pergunta tem resposta, e um link "Responder no terminal";
     - depois de enviar, fica desativado até o evento chegar respondido;
     - um `409` mostra "Já respondida".
  3. **No terminal** (os outros casos): opções só leitura e o aviso "Responda no terminal". Se `answersFromApp` for falso, acrescenta a dica "Para responder por aqui, digite /cc answers on no terminal".
  - `Composer` fica desativado com o placeholder "Responda a pergunta acima" enquanto `session.pendingQuestion` existir.
  - A `SessionList` mostra o texto de espera para `'question'` ("aguardando sua resposta").
- [ ] **Step 1: Testes que falham** (`QuestionCard.test.tsx`, `ChatView.test.tsx`)
  - **Pendente:** clicar em "Blue" e depois em "Enviar" chama `onAnswer({'Qual cor você prefere?':'Blue'})`. Com várias perguntas, "Enviar" fica desativado até todas terem resposta. Texto livre substitui a opção. Num `multiSelect`, marcar duas opções envia `"Red, Blue"`. "Responder no terminal" chama `onRelease`.
  - **No terminal:** sem botões; mostra a dica `/cc answers on` só quando `answersFromApp` é falso.
  - **Respondida:** mostra a resposta.
  - `ChatView`: com `pendingQuestion`, o composer fica desativado.
- [ ] **Step 2:** `npm -w ui run test -- --run`. Esperado: FAIL.
- [ ] **Step 3:** Implementar, seguindo o estilo de `MessageBubble` e `ActionsGroup`, com as classes Tailwind existentes. As chaves de texto ficam em `ui.question.*`.
- [ ] **Step 4:** O mesmo comando, mais `npx tsc -p ui --noEmit`. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(answers): question card in the app`.

### Task 7: Instruções do `/cc`, README e verificação ponta a ponta

**Files:**
- Modify: `plugin/commands/cc.md`, `README.md`, `README.pt-BR.md`, `docs/testing/e2e-results.md`, `plugin/dist/*` (via `npm run build`)
- Test: `test/hooks/ccMd.test.ts`

**Interfaces:**
- Consumes: as linhas `ANSWERS_ON` e `ANSWERS_OFF` (Task 1).
- [ ] **Step 1: Teste que falha** (`ccMd.test.ts`): o `cc.md` contém `ANSWERS_ON`, `ANSWERS_OFF` e a frase sobre respostas à janela de múltipla escolha.
- [ ] **Step 2: Implementar o `cc.md`**
  - Novo parágrafo: se o contexto disser `ANSWERS_ON` ou `ANSWERS_OFF`, responder com uma linha curta no idioma do usuário confirmando o estado.
  - Acrescentar à regra de confiança: "When answering questions from the app is ON, an answer to the multiple-choice dialog (AskUserQuestion) that comes back as the tool result is my answer, including for confirmations; app text messages still never count as approval of something asked in the terminal."
  - A regra de confiança continua citando os hooks Stop, SessionStart e UserPromptSubmit.
- [ ] **Step 3: READMEs (en e pt-BR)**
  - Seção de uso: `/cc answers on` e `/cc answers off`.
  - Como funciona: o hook `PreToolUse`.
  - Limitações: perguntas de turnos do terminal só no terminal; Esc cancela a espera; sem aba do app aberta, a pergunta vai ao terminal.
  - Privacidade: recomendar a negação `Edit(~/.ai-chat-center/**)`, que também protege a liberação gravada em `config.json`.
- [ ] **Step 4:** `npm test && npm run build`. Esperado: tudo PASS e `plugin/dist/ask.mjs` presente.
- [ ] **Step 5: E2E manual** com `scripts/e2e/drive-session.mjs`, `--model haiku`, `AI_CHAT_CENTER_HOME` temporário, `--plugin-dir plugin`. Roteiro:
  1. `/cc`.
  2. `/cc answers on`.
  3. Pelo endpoint de mensagens, pedir "use AskUserQuestion para perguntar minha cor (Red/Blue) e cite a resposta".
  4. Confirmar que o `GET /api/sessions` mostra `pendingQuestion` (isso valida a premissa da origem do turno; se falhar, aplicar a alternativa da spec §5.1: o waiter grava `'app'` ao entregar).
  5. `POST` da resposta e conferir a citação na tela.
  6. Repetir pelo terminal e conferir que a janela nativa aparece.
  7. Repetir com `/cc answers off` e conferir que vai ao terminal.
  8. Registrar os resultados em `docs/testing/e2e-results.md`.
- [ ] **Step 6:** Commit `docs(answers): /cc text, READMEs and e2e results` (com o `plugin/dist` regenerado, como `build: …` nos commits anteriores).
