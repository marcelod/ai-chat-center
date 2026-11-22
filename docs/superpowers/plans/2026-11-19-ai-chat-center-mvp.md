# AI Chat Center MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plugin do Claude Code + hub local + Web UI estilo WhatsApp que permite ver e responder, pelo navegador, sessões `claude` comuns que o usuário conectou com `/cc`.

**Architecture:** Hooks do plugin (Node) registram a sessão e mantêm um *waiter* `asyncRewake` que entrega mensagens da inbox em disco. O hub Node (HTTP + SSE em `127.0.0.1`) lê os transcripts `.jsonl`, cruza com `claude agents --json` para status e serve a SPA React. Plugin e hub só conversam pelo diretório de estado `~/.ai-chat-center/`.

**Tech Stack:** Node ≥ 20, TypeScript, esbuild (bundle dos hooks e do hub), Vitest, React 19 + Vite + Tailwind v4, `react-markdown`. Hub sem framework (`node:http`).

**Spec:** `docs/superpowers/specs/2026-11-19-ai-chat-center-mvp-design.md`

## Global Constraints

- Plataformas: **Windows, Linux e macOS**. Nada de shell script, `flock`, `jq` ou comando Unix em runtime. Só Node e `path.join`/`os.homedir()`.
- Node ≥ 20. Se faltar, o comando do hook falha, e o README documenta o requisito.
- Hub escuta **apenas `127.0.0.1`**. Porta padrão `7777` (`AI_CHAT_CENTER_PORT`), com fallback incremental até `7787`.
- Diretório de estado: `~/.ai-chat-center/` (sobrescrito por `AI_CHAT_CENTER_HOME`, usado nos testes).
- Nunca ler `~/.claude/.credentials.json` nem nenhuma credencial. Nunca usar "Claude" no nome do produto. O README diz "independent project, not affiliated with Anthropic".
- Sessões sem `/cc` não podem sentir nada: todo hook sai com código 0 em < 100 ms se a sessão não estiver registrada.
- i18n: todo texto visível ao usuário vem de `t(key)`. Idiomas `en` (padrão) e `pt-BR`. O texto de autorização do `/cc` e o marcador de mensagem são **inglês fixo** (protocolo).
- Marcador de protocolo: `[AI Chat Center message id=<id>]` … `[/AI Chat Center message]`.
- Após `/clear` a sessão é **desconectada** (sem migração automática).
- Escritas em disco atômicas (gravar em `*.tmp` e depois `rename`).

## Review Focus

1. **Sessão sem `/cc`** com o plugin instalado: os hooks não podem demorar nem imprimir nada. Teste em Task 4 (`hook ignores unregistered session`).
2. **Duas mensagens enviadas pelo app em sequência rápida** (ou com o Claude ocupado): as duas chegam, em ordem, sem perda. Teste em Task 3 (`delivers queued messages in order as one wake`).
3. **Sessão encerrada** (terminal fechado) enquanto o waiter espera: o waiter não pode ficar órfão para sempre. Teste em Task 3 (`exits when parent process is gone`).
4. **Transcript grande ou com linha parcial** durante a escrita: o parser não quebra nem duplica eventos. Teste em Task 6 (`partial trailing line is buffered until newline`).
5. **Site malicioso no navegador** chamando `http://127.0.0.1:7777/api/...`: tem que ser recusado sem token, e também com `Origin`/`Host` estranho mesmo com token. Teste em Task 8 (`rejects foreign Origin`, `rejects foreign Host`).

---

## File Structure

```
ai-chat-center/
  package.json                 # scripts: build, test, dev; workspaces: ["ui"]
  tsconfig.json
  vitest.config.ts
  .github/workflows/ci.yml
  .claude-plugin/marketplace.json
  plugin/                      # pasta instalada pelo Claude Code
    .claude-plugin/plugin.json
    commands/cc.md
    hooks/hooks.json
    dist/                      # gerado: hook.js, waiter.js, hub.js, ui/  (commitado)
  src/
    core/paths.ts              # resolve diretórios/arquivos de estado
    core/fsAtomic.ts           # writeJsonAtomic, readJson
    core/config.ts             # Config {language}
    core/i18n.ts               # t(), Lang
    core/locales/en.json, pt-BR.json
    core/registry.ts           # Registration CRUD
    core/inbox.ts              # enqueue/drain
    core/waiting.ts            # estado "aguardando no terminal"
    core/lock.ts               # lock por arquivo com pid
    core/protocol.ts           # wrap/unwrap do marcador
    hooks/hook.ts              # entry: session-start | prompt-submit | notification
    hooks/waiter.ts            # entry do waiter asyncRewake
    hooks/ensureHub.ts         # sobe o hub se não estiver rodando
    hub/transcript/parse.ts    # entrada .jsonl -> ChatEvent[]
    hub/transcript/reader.ts   # tail incremental
    hub/status.ts              # claude agents --json
    hub/provider.ts            # interface Provider + ClaudeCodeProvider
    hub/server.ts              # http, auth, rotas, SSE, estáticos
    hub/main.ts                # entry do hub
  test/…                       # espelha src/
  test/fixtures/transcript-spike.jsonl
  ui/                          # app Vite (React + Tailwind)
    src/main.tsx, App.tsx, api.ts, i18n.ts, components/…
```

---

### Task 1: Scaffold + core (paths, atomic fs, config, i18n)

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/core/{paths,fsAtomic,config,i18n}.ts`, `src/core/locales/{en,pt-BR}.json`
- Test: `test/core/{paths,config,i18n}.test.ts`

**Interfaces:**
- Produces:
  - `paths(): { home, token, hubJson, config, sessionsDir, inboxDir(sid), waiterLock(sid), waitingFile(sid), logDir }` (todas absolutas; `home` = `process.env.AI_CHAT_CENTER_HOME ?? path.join(os.homedir(), '.ai-chat-center')`)
  - `writeJsonAtomic(file: string, data: unknown): Promise<void>`, `readJson<T>(file: string): Promise<T | null>` (null se não existir ou JSON inválido)
  - `type Lang = 'en' | 'pt-BR'`; `loadConfig(): Promise<{ language: Lang }>` (padrão `{language:'en'}`); `saveConfig(c): Promise<void>`
  - `t(lang: Lang, key: string, vars?: Record<string,string>): string`, com fallback para `en` e depois para a própria key; interpolação `{name}`

- [ ] **Step 1:** `git init`, `npm init`, devDeps `typescript vitest esbuild @types/node`. `"type":"module"`, `"engines":{"node":">=20"}`. Scripts `test: vitest run`, `build: node scripts/build.mjs` (o script vem na Task 11).
- [ ] **Step 2: Testes que falham**
  - `paths respects AI_CHAT_CENTER_HOME`: com env = tmpdir, `paths().inboxDir('abc')` === `join(tmp,'inbox','abc')`.
  - `loadConfig defaults to en`: diretório vazio → `{language:'en'}`. Depois de `saveConfig({language:'pt-BR'})` → `'pt-BR'`.
  - `readJson returns null on corrupt file`.
  - `t interpolates and falls back`: `t('pt-BR','hub.started',{url:'x'})` contém `x`. Key só em `en` → texto em inglês. Key inexistente → a própria key.
  - `locales have identical key sets`: as keys (achatadas) de `en.json` e `pt-BR.json` são iguais.
- [ ] **Step 3:** Rodar `npx vitest run test/core`. Esperado: FAIL (módulos inexistentes).
- [ ] **Step 4:** Implementar. Keys iniciais dos locales: `hub.started` ("AI Chat Center is running at {url}"), `cc.connected`, `cc.disconnected`, `cc.notRegistered`, `node.missing`. A UI acrescenta as suas na Task 9.
- [ ] **Step 5:** Rodar os testes. Esperado: PASS.
- [ ] **Step 6:** Commit `chore: scaffold project with core paths, config and i18n`.

### Task 2: Core store (registry, inbox, waiting, lock, protocol)

**Files:**
- Create: `src/core/{registry,inbox,waiting,lock,protocol}.ts`
- Test: `test/core/{registry,inbox,lock,protocol}.test.ts`

**Interfaces:**
- Consumes: Task 1 `paths`, `writeJsonAtomic`, `readJson`.
- Produces:
  - `type Registration = { sessionId: string; transcriptPath: string; cwd: string; pid: number; connectedAt: string; disconnectedAt?: string; disconnectReason?: 'off' | 'clear' | 'exited' }`
  - `register(r: Omit<Registration,'connectedAt'>)`, `getRegistration(sid)`, `listRegistrations()`, `markDisconnected(sid, reason)` (todas async). `isActive(r) = !r.disconnectedAt`.
  - `type InboxMessage = { id: string; text: string; createdAt: string }`
  - `enqueue(sid, text): Promise<InboxMessage>` (arquivo `<epochMs>-<id>.msg`, id = `crypto.randomUUID()`), `drain(sid): Promise<InboxMessage[]>` (lê em ordem de nome, apaga, retorna), `peek(sid)`.
  - `setWaiting(sid, kind: 'permission'|'input')`, `clearWaiting(sid)`, `getWaiting(sid): Promise<{kind, at}|null>`
  - `acquireLock(file): Promise<boolean>` (`open(file,'wx')` grava o pid; se já existir e o pid estiver morto (`process.kill(pid,0)` lança `ESRCH`), apaga e tenta de novo uma vez), `releaseLock(file)`
  - `wrapMessages(msgs: InboxMessage[]): string`, `unwrapMessages(text: string): {id: string, text: string}[]`

- [ ] **Step 1: Testes que falham**
  - `enqueue/drain keeps order`: enfileira "a", "b", "c" → `drain` retorna os três em ordem, e um segundo `drain` retorna `[]`.
  - `markDisconnected keeps history`: depois de marcar, `getRegistration` ainda existe, com `disconnectReason:'clear'`.
  - `lock is exclusive`: o segundo `acquireLock` retorna `false`.
  - `stale lock is reclaimed`: arquivo de lock com pid `999999` (morto) → `acquireLock` retorna `true`.
  - `protocol roundtrip`: `unwrapMessages('noise ' + wrapMessages([m1,m2]) + ' tail')` → `[{id:m1.id,text:m1.text},{id:m2.id,text:m2.text}]`. Texto multilinha com `[` no meio continua íntegro.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar. Formato exato do `wrapMessages` para cada mensagem, unidas por `\n\n`:
  ```
  [AI Chat Center message id=<id>]
  <text>
  [/AI Chat Center message]
  ```
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(core): registry, inbox, waiting state, file lock and message protocol`.

### Task 3: Waiter (asyncRewake)

**Files:**
- Create: `src/hooks/waiter.ts`
- Test: `test/hooks/waiter.test.ts`

**Interfaces:**
- Consumes: Task 2 (`getRegistration`, `isActive`, `drain`, `acquireLock`, `releaseLock`, `wrapMessages`, `clearWaiting`).
- Produces: `runWaiter(input: {session_id: string}, opts: {parentPid: number; pollMs?: number; isAlive?: (pid:number)=>boolean}): Promise<{exitCode: 0|2; stderr: string}>`. O entry (`main`) lê o JSON do stdin, chama `runWaiter` com `parentPid: process.ppid`, escreve o `stderr` e chama `process.exit(exitCode)`.

Comportamento: sessão não registrada ou inativa → `0` na hora. Lock ocupado → `0`. Loop a cada `pollMs` (padrão 1000), na ordem: registro sumiu/inativo → `0`; `!isAlive(parentPid)` → `0`; `drain` não vazio → `clearWaiting`, `stderr = wrapMessages(msgs)`, `2`. Sem timeout máximo. Lock liberado em toda saída (`finally`).

- [ ] **Step 1: Testes que falham** (`pollMs: 10`)
  - `exits 0 immediately for unregistered session` (em < 50 ms).
  - `delivers queued messages in order as one wake`: registra, enfileira "um" e "dois" antes de iniciar → exit 2, e `unwrapMessages(stderr)` dá os textos `['um','dois']`.
  - `wakes on message enqueued while waiting`: inicia, enfileira depois de 30 ms → exit 2.
  - `exits 0 when disconnected while waiting`: `markDisconnected` durante a espera → exit 0.
  - `exits when parent process is gone`: `isAlive` passa a retornar `false` → exit 0.
  - `second waiter for same session exits 0` e o primeiro continua esperando.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(hooks): waiter that wakes the session with app messages`.

### Task 4: Hook handlers + `/cc` + ensureHub

**Files:**
- Create: `src/hooks/hook.ts`, `src/hooks/ensureHub.ts`
- Test: `test/hooks/hook.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `handleHook(event: 'session-start'|'prompt-submit'|'notification', input: HookInput, ctx: {parentPid: number; ensureHub: () => Promise<string /*url*/>}): Promise<{stdout?: string; exitCode: 0}>`
  - `type HookInput = { session_id: string; transcript_path: string; cwd: string; prompt?: string; source?: string; notification_type?: string; message?: string }`
  - `ensureHub(): Promise<string>`: lê `hub.json`. Se `GET http://127.0.0.1:<port>/api/health` responder em ≤ 500 ms, retorna a URL `http://127.0.0.1:<port>/?token=<token>`. Se não, faz `spawn(process.execPath, [<dir>/hub.js], {detached:true, stdio:'ignore', windowsHide:true}).unref()` e faz polling de `hub.json` + health por até 5 s.
  - `isCcCommand(prompt): 'on'|'off'|null`: casa `^\s*/(ai-chat-center:)?cc(\s+(off))?\s*$`.

Comportamento:
- `prompt-submit`: `isCcCommand` `'on'` → `register({sessionId, transcriptPath, cwd, pid: parentPid})`, chama `ensureHub`, `stdout = JSON {hookSpecificOutput:{hookEventName:'UserPromptSubmit', additionalContext:'AI Chat Center URL: <url>'}}`. `'off'` → `markDisconnected(sid,'off')`. Qualquer outro prompt numa sessão registrada → `clearWaiting(sid)`. Não registrada → nada.
- `session-start` com `source === 'clear'`: para cada registro ativo com `pid === parentPid` e `sessionId !== input.session_id` → `markDisconnected(…,'clear')`.
- `notification`: só se a sessão estiver registrada e ativa. `notification_type` `permission_prompt` → `setWaiting(sid,'permission')`; `idle_prompt`/`elicitation_dialog` → `'input'`; outros → ignora.

- [ ] **Step 1: Verificação manual (registrar o resultado num comentário no topo de `hook.ts`).** Instale um hook `UserPromptSubmit` de teste que grava o stdin num arquivo, digite `/cc` numa sessão de teste e confirme: (a) o hook dispara para slash command de plugin; (b) qual valor chega em `prompt` (`/cc` ou o texto expandido). Se (a) falhar, troque a detecção: o `cc.md` executa `!node "${CLAUDE_PLUGIN_ROOT}/dist/hook.js" cc-command ${CLAUDE_SESSION_ID}` e `handleHook` ganha o evento `'cc-command'` com o mesmo comportamento. Confirme também os valores reais de `notification_type` na doc de hooks.
- [ ] **Step 2: Testes que falham**
  - `hook ignores unregistered session`: os três eventos com sid desconhecido → `{exitCode:0}`, sem `stdout` e sem arquivos criados em `sessions/`.
  - `/cc registers and returns hub url` (com `ensureHub` falso retornando `'http://127.0.0.1:7777/?token=t'`).
  - `/ai-chat-center:cc off marks disconnected`.
  - `isCcCommand` table: `'/cc'`→on, `' /cc off '`→off, `'/ccx'`→null, `'please /cc'`→null.
  - `clear disconnects previous session of same terminal`: registro A com pid 42, `session-start` `{source:'clear', session_id:'B'}` com parentPid 42 → A ganha `disconnectReason:'clear'`.
  - `permission notification sets waiting`; `next prompt clears waiting`.
- [ ] **Step 3:** Rodar. Esperado: FAIL.
- [ ] **Step 4:** Implementar. O entry `main` lê `argv[2]` como evento, faz `JSON.parse` do stdin, escreve o `stdout` e captura qualquer erro (loga em `logDir` e sai com 0, porque um hook do plugin nunca pode quebrar a sessão).
- [ ] **Step 5:** Rodar. Esperado: PASS.
- [ ] **Step 6:** Commit `feat(hooks): /cc registration, clear handling, waiting notifications, hub autostart`.

### Task 5: Transcript parser

**Files:**
- Create: `src/hub/transcript/parse.ts`, `test/fixtures/transcript-spike.jsonl`
- Test: `test/hub/parse.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type ChatEvent =
    | { kind: 'user'; id: string; ts: string; text: string; origin: 'terminal' | 'app'; appMessageId?: string }
    | { kind: 'assistant'; id: string; ts: string; text: string }
    | { kind: 'actions'; id: string; ts: string; items: ToolAction[] }
    | { kind: 'notice'; id: string; ts: string; code: 'connected' | 'disconnected' }
  type ToolAction = { toolUseId: string; name: string; summary: string; result?: string; isError?: boolean }
  class TranscriptParser { push(entry: unknown): ChatEvent[] /* eventos novos ou atualizados (mesmo id = substituir) */ }
  ```
  `id` = `uuid` da entrada (ou `uuid#n` quando uma entrada gera vários eventos).

Regras (spec 5.5):
- `type:'assistant'`, blocos `text` → um evento `assistant` por entrada (blocos de texto concatenados). `tool_use` → acrescentado ao **último** evento `actions` aberto, ou abre um novo. Um `assistant` com texto fecha o grupo aberto. `thinking` é ignorado.
- `type:'user'` com `tool_result` → preenche `result` (truncado em 2000 caracteres) e `isError` da `ToolAction` com o mesmo `toolUseId`, e reemite aquele evento `actions`.
- `type:'user'` com conteúdo string: se `unwrapMessages` achar mensagens → um `user` `origin:'app'` por mensagem, com `appMessageId`. Se contiver `<command-name>/cc</command-name>` ou `/ai-chat-center:cc` → `notice`, `connected` ou `disconnected` conforme `<command-args>off`. Outros `<command-…>`, `<local-command-stdout>`, `<task-notification>` sem marcador e `<system-reminder>` puros → ignorados. O resto → `user` `origin:'terminal'`.
- `attachment`, `system` e linhas inválidas → ignorados.
- `summary` de ferramenta: `Bash` → `input.command`; `Read/Edit/Write` → `input.file_path`; outras → o primeiro valor string do input; tudo truncado em 120 caracteres.

- [ ] **Step 1:** Criar a fixture a partir do transcript real do teste ((o `.jsonl` da sessão de teste em `~/.claude/projects/`)), **removendo todas as entradas `type:"attachment"`** (contêm email e prompts do sistema). Trocar o marcador antigo do teste pelo formato de `wrapMessages` (com ids `m1`, `m2`). Acrescentar à mão uma entrada `<command-name>/cc</command-name>`.
- [ ] **Step 2: Testes que falham**
  - `spike fixture yields expected conversation`: a sequência de `kind` (sem os ids) é `['notice','user(app)','assistant','user(app)','assistant','user(terminal)','assistant','user(app)','actions','assistant']`. O `actions` tem 1 item `Write`, com `result` contendo `File created`.
  - `app message keeps id and strips envelope`: `text === 'Crie um arquivo chamado ola.txt nesta pasta contendo a palavra teste.'`, `appMessageId === 'm2'`.
  - `tool_result updates existing actions event` (o mesmo id é reemitido com `result`).
  - `invalid json line is ignored`.
- [ ] **Step 3:** Rodar. Esperado: FAIL.
- [ ] **Step 4:** Implementar.
- [ ] **Step 5:** Rodar. Esperado: PASS.
- [ ] **Step 6:** Commit `feat(hub): transcript parser into chat events`.

### Task 6: Incremental transcript reader

**Files:**
- Create: `src/hub/transcript/reader.ts`
- Test: `test/hub/reader.test.ts`

**Interfaces:**
- Consumes: Task 5 `TranscriptParser`, `ChatEvent`.
- Produces: `class TranscriptReader { constructor(path: string); readNew(): Promise<ChatEvent[]>; all(): ChatEvent[] }`. Guarda o offset em bytes e o buffer da linha parcial. `all()` mantém a lista consolidada (substituindo pelo `id`).

- [ ] **Step 1: Testes que falham**
  - `reads only appended lines`: escreve 2 linhas e lê; acrescenta 1 linha e `readNew` retorna só os eventos novos.
  - `partial trailing line is buffered until newline`: escreve meia linha → `[]`; completa → o evento aparece uma única vez.
  - `missing file returns []` (o transcript ainda não foi criado).
  - `handles CRLF`.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar com `fs.open` + `read` a partir do offset (sem reler o arquivo inteiro).
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(hub): incremental transcript reader`.

### Task 7: Status source + Provider

**Files:**
- Create: `src/hub/status.ts`, `src/hub/provider.ts`
- Test: `test/hub/provider.test.ts`

**Interfaces:**
- Consumes: Task 2 (registry, inbox, waiting), Task 6 `TranscriptReader`.
- Produces:
  - `type LiveSession = { pid: number; cwd: string; kind: 'interactive'|'background'; sessionId: string; name: string; status: 'busy'|'idle' }`
  - `listLiveSessions(run?: () => Promise<string>): Promise<LiveSession[]>`: executa `claude agents --json` (`execFile` com `shell: process.platform === 'win32'`, timeout 5 s). Em erro → `[]`.
  - `type SessionView = { sessionId: string; name: string; cwd: string; state: 'busy'|'idle'|'waiting'|'disconnected'; waitingKind?: 'permission'|'input'; lastEvent?: ChatEvent; pendingAppMessageIds: string[] }`
  - `interface Provider { listSessions(): Promise<{connected: SessionView[]; others: LiveSession[]}>; events(sid: string): Promise<ChatEvent[]>; poll(): Promise<ProviderChange[]>; send(sid: string, text: string): Promise<{id: string}> }`
  - `type ProviderChange = { type: 'events'; sessionId: string; events: ChatEvent[] } | { type: 'sessions' }`
  - `class ClaudeCodeProvider implements Provider` (recebe `listLiveSessions` injetável).

Regras de `state`: registro desconectado → `disconnected`. Ausente de `live` (pelo `sessionId`) → `markDisconnected(sid,'exited')` + `disconnected`. `getWaiting` presente → `waiting`. Senão, o `status` do live. `name` vem do live (fallback: basename do `cwd`). `others` = live `interactive` sem registro ativo. `send` numa sessão desconectada lança `SessionDisconnectedError`. `pendingAppMessageIds` = ids que ainda estão na inbox (`peek`).

- [ ] **Step 1: Testes que falham** (com live falso)
  - `merges registration with live status`.
  - `session missing from live becomes disconnected (exited)`.
  - `waiting overrides busy`.
  - `others lists unregistered interactive sessions only`.
  - `send enqueues and reports pending`; `send to disconnected throws`.
  - `poll emits events after transcript append`.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(hub): Claude Code provider with live status`.

### Task 8: Hub HTTP server

**Files:**
- Create: `src/hub/server.ts`, `src/hub/main.ts`
- Test: `test/hub/server.test.ts`

**Interfaces:**
- Consumes: Task 7 `Provider`, Task 1 config/paths.
- Produces: `createHub(opts: {provider: Provider; token: string; port: number; staticDir: string; pollMs?: number}): Promise<{url: string; close(): Promise<void>}>`. O `main.ts` gera ou lê o `token` (32 bytes hex, arquivo com mode 0600 onde suportado), tenta as portas 7777–7787, grava `hub.json` `{pid, port}` e loga em `logDir`.

Rotas (todas exigem `Authorization: Bearer <token>`, exceto `/api/health` e os estáticos; `/api/stream` aceita `?token=`):
- `GET /api/health` → `{ok:true}`
- `GET /api/sessions` → `{connected, others}`
- `GET /api/sessions/:id/events` → `ChatEvent[]`
- `POST /api/sessions/:id/messages` `{text}` → `202 {id}`. Texto vazio → 400. Desconectada → 409.
- `GET /api/config` / `PUT /api/config` `{language}` (valida `Lang`)
- `GET /api/stream` (SSE): `event: sessions` e `event: events` (data = `ProviderChange`), a partir de `provider.poll()` a cada `pollMs` (padrão 500). Heartbeat a cada 15 s.
- Estáticos: `staticDir` com fallback SPA para `index.html`.

Segurança: recusar com 403 quando o header `Host` não for `127.0.0.1:<port>` nem `localhost:<port>`, ou quando houver `Origin` diferente de `http://127.0.0.1:<port>` e `http://localhost:<port>`.

- [ ] **Step 1: Testes que falham** (provider falso, porta 0)
  - `rejects missing token` (401), `rejects foreign Origin` (403 mesmo com token), `rejects foreign Host` (403).
  - `lists sessions`, `posts message returns 202 and calls provider.send`, `posting to disconnected returns 409`, `empty text returns 400`.
  - `stream delivers events after provider change` (lê o primeiro `event: events`).
  - `config roundtrip`, `invalid language returns 400`.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar com `node:http`.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(hub): local HTTP API with token auth and SSE`.

### Task 9: UI — shell, i18n, conversation list

**Files:**
- Create: `ui/` (Vite React TS + Tailwind v4), `ui/src/{main.tsx,App.tsx,api.ts,i18n.ts}`, `ui/src/components/{SessionList.tsx,SettingsMenu.tsx}`
- Modify: `src/core/locales/{en,pt-BR}.json` (keys `ui.*`)
- Test: `ui/src/**/*.test.tsx` (Vitest + Testing Library)

**Interfaces:**
- Consumes: as rotas da Task 8 e os tipos `ChatEvent`/`SessionView`/`LiveSession` (importados de `src/` via alias `@core`/`@hub` só para tipos).
- Produces: `api.ts`: `getSessions()`, `getEvents(id)`, `sendMessage(id,text)`, `getConfig()`, `setConfig(c)`, `openStream(onChange)`. O token é lido de `?token=` na primeira carga, salvo em `localStorage` e removido da URL. `useT()` lê o idioma da config, e o `i18n.ts` importa os mesmos JSONs de `src/core/locales`.

UI (spec 5.6): a coluna esquerda tem título, busca (filtra por nome/pasta), itens com ponto de status, nome, horário e prévia do `lastEvent`, contador de não lidas (eventos `assistant` depois da última abertura, guardado em `localStorage`) e a seção recolhível "Outras sessões abertas (N)" com a dica `/cc`. O menu de configurações tem o seletor de idioma (English / Português (Brasil)). Identidade própria (nada de verde WhatsApp nem logo), tema claro e escuro via `prefers-color-scheme`. Sem token → tela "abra o link mostrado pelo /cc".

- [ ] **Step 1: Testes que falham**
  - `renders connected sessions with status and preview` (api mockada).
  - `search filters by name and cwd`.
  - `others section shows hint`.
  - `switching language re-renders labels` (`en` → `pt-BR`).
  - `missing token shows instructions`.
- [ ] **Step 2:** Rodar `npm -w ui test`. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(ui): app shell, i18n and session list`.

### Task 10: UI — chat view, composer, live updates

**Files:**
- Create: `ui/src/components/{ChatView.tsx,MessageBubble.tsx,ActionsGroup.tsx,Composer.tsx}`, `ui/src/useLiveSessions.ts`
- Test: `ui/src/components/*.test.tsx`

**Interfaces:**
- Consumes: `api.ts` (Task 9), tipos `ChatEvent`.
- Produces: `useLiveSessions()` mantém `sessions` e `eventsById` atualizados pelo SSE (com reconexão automática e backoff de até 10 s).

UI: o cabeçalho tem nome, pasta e status (`busy` "trabalhando…", `idle` "parado", `waiting` "aguardando você no terminal" com ícone de alerta, `disconnected` "desconectada — digite /cc de novo"). Balões: usuário à direita com ⌨ ou 📱; Claude à esquerda com Markdown (`react-markdown`, `remark-gfm`). `actions` vira um item recolhido "⚙ N ações" que expande mostrando nome, resumo e resultado (com erro em vermelho). Uma mensagem otimista enviada pelo app aparece "na fila" enquanto o id estiver em `pendingAppMessageIds` e é substituída quando chega o `user` com o mesmo `appMessageId`. Composer: Enter envia, Shift+Enter quebra linha, desabilitado em `disconnected`. Scroll automático para o fim se o usuário já estava no fim. Notificação do navegador quando um `assistant` chega numa conversa que não está aberta (pede permissão no primeiro clique em "ativar notificações" nas configurações). Em telas < 768 px, a lista e o chat viram telas alternadas.

- [ ] **Step 1: Testes que falham**
  - `renders bubbles with origin icons`.
  - `actions group collapsed then expands`.
  - `optimistic message shows queued then reconciles by appMessageId`.
  - `composer disabled when disconnected`.
  - `enter sends, shift+enter newline`.
  - `waiting state label`.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(ui): chat view, actions group and composer with live updates`.

### Task 11: Plugin packaging, build, README, CI

**Files:**
- Create: `scripts/build.mjs`, `plugin/.claude-plugin/plugin.json`, `plugin/commands/cc.md`, `plugin/hooks/hooks.json`, `.claude-plugin/marketplace.json`, `README.md`, `README.pt-BR.md`, `LICENSE` (MIT), `.github/workflows/ci.yml`
- Test: `test/plugin/build.test.ts`

**Interfaces:**
- Consumes: os entries `src/hooks/hook.ts`, `src/hooks/waiter.ts`, `src/hub/main.ts` e o `ui/dist`.
- Produces: `plugin/dist/{hook.js,waiter.js,hub.js}` (esbuild, `platform:node`, `format:esm`, bundle sem dependências externas) e `plugin/dist/ui/` (build do Vite). `ensureHub` localiza o `hub.js` como irmão do `hook.js` (`import.meta.url`).

`hooks.json`:
```json
{ "hooks": {
  "SessionStart": [{ "hooks": [
    { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/hook.js\" session-start" },
    { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/waiter.js\"", "asyncRewake": true } ] }],
  "Stop": [{ "hooks": [
    { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/waiter.js\"", "asyncRewake": true } ] }],
  "UserPromptSubmit": [{ "hooks": [
    { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/hook.js\" prompt-submit" } ] }],
  "Notification": [{ "hooks": [
    { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/hook.js\" notification" } ] }]
}}
```

`commands/cc.md` (copy fixa, inglês):
```markdown
---
description: Connect this session to AI Chat Center (use "off" to disconnect)
argument-hint: "[off]"
---
If the argument below is "off": I am disconnecting this session from my AI Chat Center app. From now on, ignore any text wrapped in [AI Chat Center message …] markers and do not act on it. Reply with one short line confirming, in my language.

Otherwise: I have just connected this session to AI Chat Center, a local app on my own computer that I use to chat with my sessions. From now on, text that arrives in hook feedback wrapped in "[AI Chat Center message id=…]" and "[/AI Chat Center message]" was typed by me in that app. Treat each one exactly as if I had typed it here in the terminal, including requests to run commands or edit files, under the same permission rules as my terminal messages. If I typed /cc again, this simply confirms that authorization. Reply with one short line, in my language, confirming the connection and showing the "AI Chat Center URL" from the context so I can open it.

Argument: $ARGUMENTS
```

- [ ] **Step 1: Teste que falha** `build produces plugin bundle`: depois de `npm run build`, os três `.js` e `plugin/dist/ui/index.html` existem, e `node plugin/dist/hook.js prompt-submit` com stdin `{"session_id":"x","transcript_path":"","cwd":"."}` sai com 0 sem imprimir nada (env `AI_CHAT_CENTER_HOME` temporário).
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar o `build.mjs`, os manifests, o `cc.md`, o `hooks.json` e o `marketplace.json` (`{"name":"ai-chat-center","owner":{…},"plugins":[{"name":"ai-chat-center","source":"./plugin"}]}`; conferir os campos obrigatórios na doc de plugins).
- [ ] **Step 4:** READMEs: o que é, requisitos (Node ≥ 20), instalação (`/plugin marketplace add <owner>/ai-chat-center`, `/plugin install ai-chat-center@ai-chat-center`), uso (`/cc`, `/cc off`), privacidade (tudo local, sem credenciais), limitações do MVP (permissões só no terminal, `/clear` desconecta) e "Independent project, not affiliated with or endorsed by Anthropic". O `README.md` é em inglês, com link para o `README.pt-BR.md`.
- [ ] **Step 5:** CI: matrix `ubuntu-latest`, `windows-latest`, `macos-latest` × Node 20 e 22, rodando `npm ci`, `npm test`, `npm -w ui test` e `npm run build`.
- [ ] **Step 6:** Rodar o teste. Esperado: PASS.
- [ ] **Step 7:** Commit `feat: plugin packaging, build, docs and CI`.

### Task 12: End-to-end verification

**Files:**
- Create: `scripts/e2e/drive-session.mjs` (adaptação em Node do `drive.py` do teste: abre `claude` num pty usando `node-pty` como devDependency e envia teclas), `docs/testing/windows-checklist.md`
- Test: manual e roteirizado (não roda na CI, porque gasta tokens)

- [ ] **Step 1:** Instalar o plugin localmente (`claude --plugin-dir ./plugin`, ou marketplace local) e abrir uma sessão de teste com `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1`.
- [ ] **Step 2:** Roteiro, conferindo cada item no app:
  - (a) `/cc` mostra a URL e a sessão aparece conectada;
  - (b) uma pergunta pelo app recebe resposta no app e no terminal;
  - (c) um pedido de ação pelo app ("crie ola.txt") é **executado**;
  - (d) duas mensagens rápidas são entregues em ordem;
  - (e) uma mensagem do terminal aparece no app com ⌨;
  - (f) um pedido que exige permissão mostra "aguardando você no terminal" (rode sem o modo automático);
  - (g) `/clear` mostra a conversa como desconectada;
  - (h) fechar o terminal mostra desconectada e não deixa o waiter órfão (`ps`/Gerenciador de Tarefas);
  - (i) uma sessão sem `/cc` aparece em "Outras sessões" e não é afetada;
  - (j) depois de `/compact`, a sessão continua conectada e aceita ações vindas do app (se recusar, `/cc` de novo resolve, conforme spec 5.3).
- [ ] **Step 3:** Repetir (b) e (c) com os modelos Sonnet e Opus. Registrar se algum recusa as mensagens do app.
- [ ] **Step 4:** Escrever o `docs/testing/windows-checklist.md` com o mesmo roteiro (a–i) e as verificações específicas: aspas e `${CLAUDE_PLUGIN_ROOT}` nos hooks, o `claude agents --json` via `shell:true`, o hub sem janela de console, os caminhos com espaços e o lock de processo morto. **O usuário roda esse checklist numa máquina Windows.**
- [ ] **Step 5:** Registrar os resultados em `docs/testing/e2e-results.md` e corrigir as falhas (cada correção com teste na task dona do código).
- [ ] **Step 6:** Commit `test: e2e script, windows checklist and results`.
