# AI Chat Center — MVP design

Data: 2026-11-19 · Status: aguardando aprovação do usuário

**Decisões tomadas pelo Claude (corrigíveis):** stack (seção 6), status "aguardando você no terminal" via hook `Notification` (5.6), lista "Outras sessões abertas" (5.5), token + checagem de `Origin` no hub (5.5), mensagens da inbox em arquivos separados (5.2).
**Decisões do usuário:** nome "AI Chat Center" (`ai-chat-center`, comando `/cc`), projeto pessoal (sem nenhuma relação com empregador), desconectar após `/clear` (5.3), Windows no MVP e idioma escolhível com inglês por padrão (3).

## 1. Intenção e porquê

Quem usa o Claude Code costuma ter várias sessões abertas em terminais diferentes, e acompanhar todas é trabalhoso. Além disso, a tela do terminal mistura a conversa com muito ruído (chamadas de ferramenta, diffs, logs). O usuário praticamente só usa a parte da conversa.

O AI Chat Center é um app local com cara de WhatsApp, repaginado: **cada conversa é uma sessão do Claude Code**. Nele dá para ver as respostas e responder às sessões, com o ruído escondido.

O hábito continua o mesmo: a pessoa abre o terminal, roda `claude` e conversa por lá. Quando quiser, digita `/cc` dentro da sessão e ela passa a aparecer no app. A partir daí, o terminal e o app funcionam ao mesmo tempo, e cada mensagem pode ser mandada de qualquer um dos dois lados.

O projeto é open source no GitHub, para qualquer pessoa instalar e rodar localmente. O foco agora é o Claude, mas a ideia é aceitar outras IAs no futuro.

## 2. Objetivos, não-objetivos, antiobjetivos

**Objetivos do MVP**
- `/cc` dentro de uma sessão `claude` comum conecta essa sessão ao app.
- O app lista as sessões conectadas como conversas: nome, pasta do projeto, prévia da última mensagem, status (trabalhando/parado) e marcador de não lidas.
- Ao abrir uma conversa, o histórico aparece em balões: mensagens do usuário (marcando se vieram do terminal ou do app) e respostas do Claude. As ações (ferramentas) ficam recolhidas num item "⚙ N ações", que expande ao clicar.
- O usuário manda uma mensagem pelo app, a sessão recebe e o Claude responde. A resposta aparece no app e no terminal.
- As atualizações aparecem em tempo real, sem recarregar a página.
- `/cc off` desconecta a sessão.
- Instalação simples a partir do GitHub, como plugin do Claude Code.

**Não-objetivos (próximas rodadas)**
- Aprovar pedidos de permissão pelo app. No MVP, continuam só no terminal.
- Outras IAs. Fica só a fronteira de "adaptador" desenhada (ver 5.5), com o Claude como única implementação.
- App desktop empacotado (Electron/Tauri). O MVP abre no navegador, em `localhost`.
- Acesso remoto ou pelo celular.
- Criar sessões novas pelo app.
- Mostrar no terminal a mensagem do app "como se fosse digitada". Hoje ela aparece como retorno de hook (cosmético).

**Antiobjetivos (seria um fracasso mesmo funcionando)**
- Mudar a forma de iniciar sessões (exigir flags, aliases ou `claude --bg`).
- Ler, copiar ou intermediar credenciais do Claude, ou oferecer login do Claude no app.
- Modificar o binário do Claude Code ou depender de protocolos internos não documentados (o socket entre sessões, os internals do Remote Control).
- Deixar uma sessão travada ou lenta quando o app/servidor não está rodando.
- Expor as sessões na rede (qualquer coisa além de `127.0.0.1`).
- Afetar sessões em que o usuário não digitou `/cc`.

## 3. Restrições

- Plugin instalado pelo sistema de plugins do Claude Code (marketplace = o repositório no GitHub).
- Só mecanismos documentados: comandos de plugin, hooks de comando com `asyncRewake`, transcript `.jsonl` em `~/.claude/projects/`, `claude agents --json`.
- Regras da Anthropic: usa apenas o `claude` que o próprio usuário instalou e logou. Nada de credenciais. Não usar "Claude"/"Claude Code" no nome do produto e deixar claro no README que é um projeto independente.
- Requer Node.js ≥ 20 na máquina (verificar e dar uma mensagem clara se faltar).
- **Windows, Linux e macOS no MVP** (decisão do usuário: a maioria do público usa Windows). Consequências:
  - Waiter, `/cc` e hub em **Node puro**, sem shell script, `flock`, `jq` nem comandos Unix. Os hooks chamam `node "${CLAUDE_PLUGIN_ROOT}/…"`.
  - Lock do waiter por criação exclusiva de arquivo (`open` com `wx`) guardando o `pid`. Lock com processo morto é considerado vencido. Nada de `flock`.
  - Caminhos sempre via `os.homedir()`/`path.join`. O caminho do transcript vem de `transcript_path` na entrada do hook e nunca é recalculado a partir do `cwd`, porque a codificação da pasta muda no Windows.
  - Iniciar o hub em segundo plano sem janela de console (`spawn` com `detached` + `windowsHide`).
  - Validar no Windows: o formato do `claude agents --json`, a entrega por `asyncRewake` e a abertura do navegador. CI (GitHub Actions) com runners `windows-latest`, `ubuntu-latest` e `macos-latest` para os testes automatizados. O teste ponta a ponta numa máquina Windows real fica com o usuário, porque o Claude não tem acesso a uma.
- **Idioma escolhível** (decisão do usuário): toda mensagem visível ao usuário (UI, saídas do `/cc`, README) passa por i18n. **Padrão: inglês.** Também vem com **pt-BR**. A escolha fica nas configurações do app e é salva em `~/.ai-chat-center/config.json` (o `/cc` também a respeita). Detectar o idioma do navegador na primeira vez é aceitável, mas o padrão final é inglês. O texto de autorização que o `/cc` passa ao Claude e o marcador `[AI Chat Center]` ficam em inglês fixo, porque são protocolo e não interface.

## 4. Abordagens consideradas

| Abordagem | Como funciona | Por que sim/não |
|---|---|---|
| **1. Plugin com hook "despertador" (escolhida)** | `/cc` registra a sessão. Um hook `Stop`/`SessionStart` com `asyncRewake` fica esperando mensagens do app e, quando chega uma, sai com código 2, entregando o texto ao Claude. O app lê o `.jsonl`. | Mantém o hábito (`claude` puro) e usa só recursos documentados. Validada num teste descartável em 2026-11-19 (ver 7). Custo: a mensagem chega ao Claude como lembrete de sistema e exige autorização por sessão, que o próprio `/cc` dá. |
| 2. Plugin de "channel" | O servidor MCP de channel empurra eventos para a sessão. | Exige iniciar com `--dangerously-load-development-channels` e aceitar uma tela de confirmação a cada sessão. A resposta não aparece no terminal. Vai contra o hábito e contra acompanhar pelos dois lados. |
| 3. Socket interno entre sessões | Usa o mesmo canal de `SendMessage` entre sessões. | Não documentado e muda entre versões. Inviável para um projeto público. |
| 4. Sessões em segundo plano (`claude --bg` + `attach`) | O app e o terminal se conectam a um processo do daemon. | Muda a forma de iniciar sessões. Descartada pelo usuário. |

## 5. O desenho

### 5.1 Peças

```
 terminal (claude)                       navegador
 ┌───────────────────┐                  ┌──────────────────────┐
 │ sessão claude     │                  │ Web UI (React)       │
 │  + plugin:        │                  │ lista │ conversa     │
 │   /cc  (comando)  │                  └──────────▲───────────┘
 │   hook waiter ────┼──lê inbox──┐              HTTP + SSE (token)
 └────────┬──────────┘            │                │
          │ escreve               │      ┌─────────┴────────────┐
          ▼                       └──────┤ Hub local (Node)     │
 ~/.claude/projects/…/<sid>.jsonl ──lê──►│ 127.0.0.1:<porta>    │
                                         │ estado em ~/.ai-chat-center/
                                         └──────────────────────┘
```

1. **Plugin** (comando `/cc` e hooks). Vive no repositório e é instalado pelo `/plugin`.
2. **Hub**: um processo Node local que serve a Web UI, a API e o stream de eventos. Lê os transcripts e escreve na caixa de entrada de cada sessão.
3. **Web UI**: uma SPA servida pelo próprio hub.
4. **Estado em disco** (`~/.ai-chat-center/`): é a interface entre plugin e hub. O plugin funciona sem o hub rodando, e o hub funciona sem nenhuma sessão.

### 5.2 Estado em disco

```
~/.ai-chat-center/
  token                     # segredo aleatório da UI (0600), criado pelo hub
  hub.json                  # {pid, port} do hub em execução
  sessions/<session_id>.json   # registro: {sessionId, cwd, transcriptPath, pid (ou null), key, connectedAt, …} (0600)
  busy/<session_id>         # marcador: turno iniciado no terminal em andamento (ver 5.4)
  inbox/<session_id>/<ts>-<id>.msg   # mensagens pendentes do app (uma por arquivo, ordem pelo nome)
  waiter/<session_id>.lock  # flock: no máximo um waiter por sessão
  log/                      # logs do hub e dos waiters (rotacionados)
```

Pastas criadas com modo 0700. Escrita atômica: grava num arquivo temporário e renomeia. Mensagens em arquivos separados evitam que duas mensagens seguidas do app se sobrescrevam (no teste havia um único `.msg`).

### 5.3 Fluxo `/cc` (conectar)

1. O usuário digita `/cc` no terminal.
2. O comando do plugin roda um script que recebe o `session_id` e o `transcript_path` da sessão (a forma exata de obter isso no contexto de um comando fica com o construtor; plano B: um hook `UserPromptSubmit` que reconhece `/cc` e grava o registro).
3. O script cria `sessions/<sid>.json` e, se o hub não estiver rodando, inicia o hub em segundo plano e mostra a URL com o token.
4. O texto do comando, digitado pelo próprio usuário, contém a **autorização**: as mensagens marcadas `[AI Chat Center]` que chegarem por hook foram escritas pelo usuário no app e devem ser tratadas como se ele as tivesse digitado. Isso foi validado no teste: sem autorização, o Claude responde, mas recusa ações; com ela, executa.
5. O turno do `/cc` termina, o hook `Stop` dispara e o waiter fica armado.

*Atualização (onda final):* o `/cc` gera uma `key` aleatória (16 bytes hex) por conexão, guardada no registro e mostrada ao Claude no contexto (`AI Chat Center key: …`). O marcador passa a ser `[AI Chat Center message id=<id> key=<key>]` … `[/AI Chat Center message]`, e o `cc.md` manda confiar só em blocos com essa chave exata. Repetir o `/cc` numa sessão ativa mantém a chave; reconectar gera outra e esvazia a inbox. O pid do processo `claude` vem de `claude agents --json`; se não for encontrado, o registro fica com `pid: null` (sem usar o pid do shell do hook) e o contexto avisa que o fechamento do terminal será detectado pelo hub. `SessionStart` com `resume`/`startup` de um registro ativo atualiza `pid` e `transcriptPath`.

**Troca de sessão (`/clear` e afins)** — *decisão do usuário: desconecta.* Quando o `session_id` muda no mesmo terminal (o `SessionStart` com `source` `clear`, ou qualquer caso em que a sessão registrada deixa de existir como processo vivo com aquele id), a conexão **não** é levada para a sessão nova. No app, a conversa fica marcada "desconectada — digite /cc de novo" e o histórico continua visível. Se o usuário digitar `/cc` de novo, aparece uma conversa nova (outro id). O plugin não reaplica autorização sozinho. Na compactação (`/compact`) o id continua o mesmo, então a conexão se mantém. Se o Claude passar a recusar mensagens do app porque a autorização se perdeu no resumo, o usuário digita `/cc` de novo, e repetir o `/cc` numa sessão já conectada apenas reafirma a autorização. *(Comportamento na compactação: verificar na construção.)*

`/cc off`: marca o registro como desconectado e apaga as mensagens não entregues da inbox. O waiter vê que o registro sumiu e sai com código 0. O comando também pede ao Claude que deixe de aceitar mensagens do app.

### 5.4 Waiter (hook `asyncRewake`)

Registrado pelo plugin em `SessionStart` (para sessões retomadas que já estavam conectadas) e em `Stop` (rearme a cada turno).

- Lê o `session_id` do stdin. **Se a sessão não estiver registrada, sai na hora com código 0.** Assim, sessões sem `/cc` não sentem nada.
- Usa `flock` em `waiter/<sid>.lock`. Se já existe um waiter, sai com 0.
- Fica observando `inbox/<sid>/` (polling de ~1s, ou `fs.watch`). Ao achar mensagens, junta todas em ordem, apaga, escreve no stderr `[AI Chat Center] <texto>` e sai com código **2**, o que acorda a sessão.
- Se o registro sumir, sai com 0. Também sai com 0 depois de um tempo máximo (ex.: 1h); o próximo `Stop` rearma. Ponto em aberto: se a sessão ficar parada mais que isso, ninguém rearma. O construtor precisa resolver (ex.: o waiter não expira, ou o hub sinaliza).
- Mensagens que chegam enquanto o Claude trabalha esperam na inbox e são entregues no próximo `Stop`.
- *Atualização (onda final):* o hook `UserPromptSubmit` grava `busy/<sid>` (só para sessões ativas). Ao iniciar (antes do lock), o waiter apaga esse marcador e o estado de espera, porque o turno terminou; enquanto o marcador existir, ele não esvazia a inbox. Assim, uma mensagem enviada durante um turno iniciado no terminal só é entregue quando o turno acaba. Se o registro tiver `pid: null`, o waiter tenta resolver o pid uma vez; se não conseguir, pula a checagem de processo vivo (o hub marca a sessão como encerrada, e o waiter sai). O hub apaga um marcador com mais de 10 s quando a sessão aparece ociosa (turno interrompido sem `Stop`).
- Implementado em Node (obrigatório por causa do Windows, ver seção 3).

### 5.5 Hub

- `127.0.0.1` apenas, numa porta fixa padrão (ex.: 7777), configurável e com fallback se estiver ocupada.
- Autenticação: o token (`~/.ai-chat-center/token`) é exigido em toda chamada. A UI o recebe pela URL que o `/cc` mostra e guarda em `localStorage`. Valida `Origin`/`Host` para evitar que sites abertos no navegador falem com o hub.
- **Lista de conversas**: registros em `sessions/` cruzados com `claude agents --json`, que dá o status `busy`/`idle` e se o processo está vivo (consulta a cada poucos segundos). Uma sessão registrada cujo processo morreu aparece como "desconectada". Sessões vivas sem `/cc` aparecem numa seção recolhida "Outras sessões abertas", com a dica "digite /cc nela para conectar". Elas não podem ser abertas.
- **Histórico**: faz o parse do `.jsonl` (tail incremental com `fs.watch`) e o normaliza em eventos de chat:
  - `user` com texto: mensagem do usuário pelo terminal.
  - `user` cujo conteúdo é o retorno do hook com o marcador `[AI Chat Center message id=… key=…]`: mensagem do usuário **pelo app**, só quando a chave é a do registro (ou de uma conexão anterior da mesma sessão). Mostrar só o texto, sem o envelope.
  - `assistant` com `text`: balão do Claude.
  - `assistant` `tool_use` e o `user` `tool_result` correspondente: agrupados em "⚙ N ações" entre balões, com nome da ferramenta, entrada resumida e resultado (truncado).
  - Ignorar `thinking`, `attachment`, `system` e os lembretes do Claude Code. A conversa do `/cc` em si vira um aviso discreto "conectado ao AI Chat Center".
- **Adaptador**: o parse do transcript e a fonte de status ficam atrás de uma interface `Provider` (listar sessões, ler eventos, entregar mensagem). No MVP só existe `ClaudeCodeProvider`. Isso é só a fronteira, sem generalizar além disso.
- **API**: `GET /api/sessions`, `GET /api/sessions/:id/events?after=`, `POST /api/sessions/:id/messages`, `GET /api/stream` (SSE: novas mensagens, mudança de status, sessões entrando e saindo).
- **Ciclo de vida**: iniciado pelo `/cc` se não estiver rodando, com a pasta pessoal como diretório de trabalho. `GET /api/health` responde `{ok, pid, version}`; o `/cc` só reaproveita o hub se o pid for o de `hub.json` e a versão for a do plugin; senão encerra o hub antigo e inicia outro. Pode ficar rodando (é leve). Comando manual opcional para parar.

### 5.6 Web UI

Inspirada no WhatsApp Web, repaginada (identidade própria, tema claro e escuro):

```
┌───────────────────────────┬──────────────────────────────────────────┐
│ AI Chat Center      ⚙     │ api-pagamentos          ● trabalhando…   │
│ 🔍 buscar                 │ ~/projetos/api-pagamentos                │
├───────────────────────────┼──────────────────────────────────────────┤
│ ● api-pagamentos   12:40  │            ┌──────────────────────────┐  │
│   Rodei os testes, 2 f… 3 │            │ roda os testes   ⌨ 12:38 │  │
│ ○ fechar-duvidas   11:02  │            └──────────────────────────┘  │
│   Pronto, atualizei o…    │  ┌──────────────────────────────┐        │
│ ○ mensageria-fase1 ontem  │  │ ⚙ 4 ações  ▸                  │        │
│   Qual opção você pre…    │  └──────────────────────────────┘        │
│                           │  ┌──────────────────────────────┐        │
│ ▸ Outras sessões (2)      │  │ Rodei os testes: 2 falharam… │ 12:40  │
│                           │  └──────────────────────────────┘        │
│                           ├──────────────────────────────────────────┤
│                           │ [ digite uma mensagem…            ] ➤    │
└───────────────────────────┴──────────────────────────────────────────┘
```

- O balão do usuário mostra a origem: ⌨ terminal / 📱 app.
- Status no cabeçalho: "trabalhando…" (busy), "parado" (idle) ou **"aguardando você no terminal"**. Este último vem de um hook `Notification` do plugin, só para sessões conectadas: ele avisa o hub quando o Claude Code pede permissão ou espera uma resposta no terminal. A aprovação em si continua no terminal. *(Decisão do Claude, para que a conversa não fique "trabalhando…" para sempre quando, na verdade, está parada esperando aprovação.)* Uma mensagem enviada com o Claude ocupado fica marcada "na fila" até ser entregue.
- Respostas em Markdown (código com destaque).
- Notificação do navegador quando uma sessão termina um turno e a conversa não está aberta (opcional no MVP, barato).
- Em telas estreitas, a lista e a conversa viram telas separadas.

### 5.7 Instalação

1. `/plugin marketplace add <usuario>/<repo>` e depois `/plugin install control-center`.
2. Em qualquer sessão: `/cc`. Na primeira vez, o hub sobe e mostra a URL.
3. O README explica requisitos (Node ≥ 20), privacidade (tudo local) e que é um projeto independente.

## 6. Escolhas de stack (do Claude, corrigíveis)

- **Hub e waiter em Node + TypeScript.** É uma linguagem só, roda onde o plugin roda e não exige Python. Dependências mínimas (servidor HTTP pequeno, sem banco).
- **UI em React + Vite + TypeScript + Tailwind**, o padrão que o usuário já usa. O build é commitado/empacotado no plugin para o usuário final não precisar compilar.
- Sem banco de dados: a fonte da verdade são os `.jsonl` do Claude Code e `~/.ai-chat-center/`.

## 7. Aprendizados do teste (2026-11-19, Claude Code 2.1.328, Haiku)

- Um hook `Stop`/`SessionStart` com `asyncRewake: true` que sai com código 2 acorda uma sessão interativa parada. O texto do stderr chega ao Claude e ele responde no terminal. A entrega levou ~1s com polling de 1s.
- O rearme pelo `Stop` funcionou em 3 mensagens seguidas. O `flock` evitou waiters duplicados (o `Stop` disparou de novo enquanto havia um waiter vivo).
- No transcript, a mensagem entregue aparece como `type:"user"` com conteúdo `<task-notification>…Stop hook feedback…</task-notification><system-reminder>Stop hook blocking error from command "Stop": [marcador] texto`. Esse é o formato que o parser deve reconhecer (validar de novo na construção, porque pode mudar).
- Sem autorização prévia, o Claude responde a perguntas, mas recusa ações vindas por hook. Com uma autorização digitada pelo usuário no terminal, executou a ação (`Write`). Isso é julgamento do modelo, não uma garantia: testar também com Sonnet e Opus.
- `claude agents --json` (verificado em 2026-11-19) lista as sessões interativas comuns abertas no terminal, cada uma com `pid`, `cwd`, `kind:"interactive"`, `sessionId`, `name` e `status` (`busy`/`idle`). As sessões em segundo plano vêm com `kind:"background"`. Por isso a lista de "Outras sessões abertas" e o status ao vivo são viáveis.
- Uma sessão aberta a partir de outra sessão do Claude Code herda um marcador que desliga o transcript. Irrelevante para o uso real, mas os testes automatizados precisam de `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1`.

## 8. Riscos

- **Comportamento do `asyncRewake` ou do formato do transcript muda numa atualização.** Mitigação: o parser fica isolado no `ClaudeCodeProvider`, com fixtures de transcript reais nos testes e verificação da versão do Claude Code.
- **O modelo recusa mensagens do app mesmo com `/cc`.** Mitigação: redigir bem a autorização do `/cc`, testar nos três modelos e, no pior caso, a UI mostra a recusa normalmente (o usuário vê e responde pelo terminal).
- **Transcript atrasado** (a doc avisa que é escrito de forma assíncrona). Mitigação: o tail incremental tolera linhas parciais.

## 9. Deixado para o construtor

- Como o comando `/cc` obtém `session_id`/`transcript_path` (comando com script, ou hook `UserPromptSubmit` como plano B).
- Polling ou `fs.watch` no waiter e no hub.
- A porta padrão, a biblioteca HTTP, o design visual exato (paleta e tipografia próprias, sem copiar a marca do WhatsApp).
- A forma exata do texto de autorização do `/cc`.
- A estrutura de pastas do repositório (plugin, hub e ui num monorepo simples).
