# AI Chat Center

[English](README.md)

O AI Chat Center é um plugin do Claude Code com um pequeno app web local. Acompanhe suas sessões do Claude Code numa janela no estilo WhatsApp e responda por lá: fique de olho em tarefas longas, responda quando o Claude terminar e inicie ou retome sessões sem abrir um terminal. Tudo roda no seu próprio computador.

```
+----------------------+--------------------------------------+
| Sessões              | meu-projeto                          |
|----------------------|--------------------------------------|
| > meu-projeto   (2)  |  você:   coloca retry no upload      |
|   api-server         |  claude: pronto, 3 arquivos mudaram  |
|   site-docs          |  você:   agora roda os testes        |
|                      |--------------------------------------|
|                      | [ digite uma mensagem...       ] [>] |
+----------------------+--------------------------------------+
```

## O que dá para fazer

- **Conversar com todas as sessões conectadas** numa janela só: mensagens, respostas do Claude, as ações que ele executou (com o diff dos arquivos editados, se você ligar) e os agentes com quem ele falou, numa visão de conversa em grupo.
- **Mandar mensagens enquanto o Claude trabalha.** Elas ficam na fila e são entregues quando o turno termina.
- **Ver o estado de cada sessão** (trabalhando, parada, esperando você) e, se você ligar nas configurações, receber uma notificação do navegador quando o Claude responde.
- **Responder às perguntas de múltipla escolha do Claude** pelo app (opcional, veja `answers on` abaixo).
- **Anexar arquivos e imagens** (📎, arrastar e soltar ou colar).
- **Sessões em segundo plano:** iniciar uma sessão nova em qualquer pasta da sua pasta pessoal, retomar uma que terminou, rodar comandos de barra (`/compact`, `/model`, `/effort`…), trocar o modelo e o esforço e abrir a sessão num terminal (`claude attach`).
- **Painel lateral:** abrir os arquivos que o Claude cita (Markdown, imagens, código na linha citada com realce, PDF, diffs), acompanhar os subagentes da sessão (os que rodam em cima, os outros num "Histórico" fechado) e ver a tela do terminal da sessão (sessões em segundo plano; links, tokens e chaves são filtrados).
- **Parar, reiniciar e remover** sessões em segundo plano pelo menu ⋮, e limpar as paradas nas configurações. Comandos de informação (`/status`, `/cost`, `/context`, `/usage`…) abrem a tela deles no painel lateral.
- **Respostas rápidas (⚡):** as suas respostas prontas, mais sugestões tiradas do que você costuma digitar.
- **Exportar** uma conversa em Markdown ou PDF (sem tokens nem chaves).
- **Buscar** na conversa aberta (cada ocorrência destacada, com anterior e próxima) e em todas as conversas, inclusive as encerradas.
- **Organizar:** renomear, fixar no topo, agrupar por projeto (opcional), remover da lista e dar a cada conversa um fundo de cor, degradê ou imagem. A cor também pinta o círculo da conversa na lista.
- **Ver o uso de 5 horas** na lista (opcional, veja `usage on` abaixo).
- O app está em inglês e em português do Brasil.

## Requisitos

- **Claude Code 2.1.139 ou mais novo.** As sessões em segundo plano usam `claude --bg`, `claude agents` e `claude attach`, que pedem um Claude Code recente.
- **Node.js 18 ou mais novo no PATH que o Claude Code enxerga.** Os hooks rodam com `node`; o plugin não precisa de `npm install` nem de shell (nada de Git Bash no Windows). Sem o Node, todo prompt de toda sessão mostra um erro de hook: instale o Node ou desinstale o plugin.
- **Windows:** o instalador nativo do Claude Code não instala o Node. Instale o Node.js (pelo nodejs.org ou com `winget install OpenJS.NodeJS.LTS`), feche todos os terminais e editores e abra um novo, para o Claude Code enxergá-lo (`node -v` precisa funcionar ali).
- **Um navegador.** Chrome, Chromium ou Edge abrem o app numa janela própria; qualquer outro abre numa aba.

## Instalação

No Claude Code:

```
/plugin marketplace add marcelod/ai-chat-center
/plugin install ai-chat-center@ai-chat-center
```

Depois digite `/cc` numa sessão.

**A partir de um clone local** (para testar mudanças): `/plugin marketplace add /caminho/para/ai-chat-center` e o mesmo `/plugin install`. O plugin passa a rodar direto da pasta `plugin/` do clone: depois de um `npm run build`, rode `/reload-plugins` em cada sessão aberta.

## Atualização

1. `/plugin marketplace update ai-chat-center` (ou atualize pelo menu `/plugin`).
2. Em cada sessão que já estava aberta, rode `/reload-plugins` ou reinicie a sessão. Até lá ela continua com a cópia antiga, e o app mostra a versão do plugin dela em amarelo, embaixo do campo de mensagem.
3. Rode `/cc` uma vez em qualquer sessão: ele troca o hub em execução pelo novo.

A partir da 0.6.6, uma sessão aberta antes de uma atualização também passa a rodar os hooks da cópia mais nova instalada, assim que outra sessão tiver usado essa cópia.

## Uso

Digite `/cc` numa sessão para conectá-la. O plugin mostra no terminal um link para o app (`http://127.0.0.1:7777/#token=…`) e, por padrão, abre o app numa janela própria. O Claude só confirma a conexão; ele nunca repete o link.

| Comando | O que faz |
| --- | --- |
| `/cc` | Conecta a sessão (ou reconecta) e abre o app. |
| `/ai-chat-center:cc off` | Desconecta a sessão. As mensagens ainda não entregues são descartadas. |
| `/ai-chat-center:cc answers on` / `off` | Deixa o app responder ao diálogo de múltipla escolha do Claude (AskUserQuestion), inclusive confirmações. Desligado por padrão: o app então mostra essas perguntas só para leitura. |
| `/ai-chat-center:cc window on` / `off` | Abre o app numa janela própria a cada `/cc` (ligado por padrão). No Linux, `on` também põe um ícone "AI Chat Center" no menu de aplicativos. |
| `/ai-chat-center:cc usage on` / `off` | Mostra o uso de 5 horas no rodapé da lista. Ele envolve a sua status line em `~/.claude/settings.json`; `off` devolve a sua. |

`answers`, `window` e `usage` valem para todas as sessões, e só um comando digitado no terminal muda essas opções: uma mensagem do app nunca roda o `/cc`.

Digite os argumentos com o nome completo, `/ai-chat-center:cc`. O Claude Code só troca `/cc` pelo nome completo pelo menu de autocompletar: digitado com argumentos, `/cc off` pode responder "Unknown command". Se outro plugin ou um comando seu também definir `/cc`, use o nome completo em todos os comandos.

### Sessões em segundo plano

Uma sessão iniciada pelo botão **+** do app, ou retomada pelo app, roda como sessão em segundo plano do Claude Code (`claude --bg`). Ela não tem terminal, então o app também pode rodar comandos de barra nela (pelo `claude attach`), trocar o modelo e o esforço e abri-la num terminal pelo menu ⋮ quando ela precisa de algo que só o terminal faz, como um pedido de permissão. Uma sessão que você abriu num terminal não recebe comandos de barra pelo app (eles chegariam como texto comum): digite-os no terminal dela.

Observações:

- Sessões novas podem começar em qualquer pasta da sua pasta pessoal. Uma pasta que você nunca abriu no Claude Code precisa ser confiada antes: abra um terminal nela, rode `claude` uma vez e aceite.
- `/model` e `/effort` no Claude Code também gravam a escolha como padrão das novas sessões (`model` e `effortLevel` em `~/.claude/settings.json`). Trocar pelo app faz o mesmo.
- Comandos de barra e a tela da sessão ainda não funcionam pelo app no Windows. Retomar funciona.

## Como funciona

O plugin registra hooks no início da sessão, no envio de prompt, no Stop, nas notificações e na ferramenta AskUserQuestion. Sessões em que você nunca digitou `/cc` não gravam nada, e os hooks delas terminam na hora.

- **O hub.** O `/cc` sobe um servidor local (o hub) em 127.0.0.1 se ele não estiver rodando. Ele lê as transcrições que o Claude Code já grava em `~/.claude/projects` e as entrega ao app. Para o estado de cada sessão ele roda `claude agents`: a cada 5 segundos, mais ou menos, enquanto algo está mudando, e a cada 30 segundos com tudo parado. Uma janela do app escondida interrompe essas consultas, a não ser que as notificações do navegador estejam ligadas; uma verificação a cada 5 minutos continua percebendo as sessões que terminaram. O hub sai sozinho depois de 2 horas sem app visível e sem sessão conectada; o próximo `/cc` o sobe de novo.
- **Mensagens do app.** O hub assina cada mensagem e a coloca na caixa de entrada da sessão, em `~/.ai-chat-center`. Um pequeno processo em segundo plano, o waiter (`dist/waiter.mjs`, iniciado por hooks `asyncRewake`), observa essa caixa. Quando chega uma mensagem e nenhum turno está rodando, ele acorda a sessão e entrega a mensagem ao Claude como retorno de hook, entre marcadores com uma chave por conexão. Mensagens mandadas durante um turno esperam ele terminar, por mais longo que seja.
- **Perguntas.** Com `answers on`, o hook da AskUserQuestion (`dist/ask.mjs`) manda a pergunta para o app quando o turno começou pelo app e o app está aberto, e espera até 24 horas pela sua resposta, que o hub assina como uma mensagem. Em qualquer outro caso, o diálogo de sempre aparece no terminal.
- **A janela.** No `/cc`, o hook procura o Chrome, o Chromium ou o Edge e abre o app como janela `--app`. Sem eles, abre uma aba do navegador padrão (no macOS, o `/cc` explica como adicioná-lo ao Dock com o Safari). O token nunca vai na linha de comando do navegador: o hook pede ao hub um código de pareamento de uso único, válido por 60 segundos. Só fica uma janela do app aberta: com o app já aberto, o `/cc` mostra a sessão nele.
- **Fim.** Uma sessão fechada sem `/cc off` é marcada como encerrada quando o processo dela some. `/clear`, `/resume` de outra conversa e forks desconectam a conversa anterior. Quando uma sessão entra num worktree, o Claude Code move a transcrição; o hub a encontra na pasta de projeto do worktree e continua acompanhando.

## Arquitetura

Três partes, todas em TypeScript sobre Node.js, todas no seu computador. Não há banco de dados nem serviço na nuvem.

```
 Sessão do Claude Code                        ~/.ai-chat-center          Janela do navegador
+---------------------------+                (arquivos JSON: sessões,   +------------------+
| hooks (plugin/dist/*.mjs) |-- registra --->  caixa, config, segredo)  |  app (SPA React) |
|  /cc, prompt, Stop, ask   |                        ^      |            |                  |
|  waiter: acorda a sessão  |<-- msg assinada -------+      |            |                  |
+------------+--------------+                        |      v            |                  |
             | grava                      +----------+-----------+  SSE  |                  |
             v                            | hub (servidor HTTP)   |------>|                  |
 ~/.claude/projects/*.jsonl  ---- lê ---->|  127.0.0.1:7777       |<------| REST (token)     |
 `claude agents --json`      ---- roda -->|                       |       +------------------+
                                          +-----------------------+
```

- **Plugin (hooks)**, em `src/hooks/`, empacotado com esbuild em `plugin/dist/*.mjs`. O Claude Code os roda no início da sessão, a cada prompt, no Stop, nas notificações e antes da ferramenta AskUserQuestion. O `/cc` registra a sessão, sobe o hub se precisar e abre o app. O **waiter** é um pequeno processo por sessão conectada que observa a caixa de entrada da sessão e a acorda para entregar uma mensagem do app, como se você tivesse digitado.
- **Hub**, em `src/hub/`: um servidor HTTP em `node:http` puro (sem framework) que só escuta em 127.0.0.1. Ele monta o estado de cada sessão a partir das transcrições que o Claude Code grava (`~/.claude/projects/*.jsonl`), do `claude agents --json` (quais sessões rodam e se estão ocupadas) e dos próprios arquivos de estado. Serve o app, responde às chamadas REST dele (com token e checagem de Host e Origin) e envia as novidades por **Server-Sent Events**. A tela da sessão usa o `@xterm/headless`, um emulador de terminal sem janela.
- **App**, em `ui/`: uma aplicação de página única em **React 19**, com build pelo **Vite** e estilo em **Tailwind CSS 4**; as mensagens são renderizadas com `react-markdown` e `remark-gfm`, as únicas outras dependências em tempo de execução. As fontes vão junto, então ele não carrega nada da internet. Abre como janela própria do Chrome, Chromium ou Edge (`--app`), ou numa aba do navegador.
- **Estado** fica em `~/.ai-chat-center`, em arquivos JSON gravados de forma atômica (sessões, caixa de entrada, marcadores de ocupado e esperando, configurações, o segredo da instalação e o token do hub), legíveis só por você. `src/core/` cuida dessa camada e `src/shared/` tem os tipos e funções usados pelo hub e pelo app.

O caminho de uma mensagem do app:

1. Você digita no app; ele manda o texto ao hub com o token.
2. O hub assina com o segredo da instalação e coloca na caixa de entrada da sessão.
3. O waiter confere a assinatura, espera o turno acabar e acorda a sessão com o texto como retorno de hook.
4. O Claude responde; o Claude Code grava a resposta na transcrição.
5. O hub lê as linhas novas e as manda ao app por SSE.

**Ferramentas:** TypeScript, esbuild (hooks e hub), Vite (app), Vitest com Testing Library e jsdom (cerca de 960 testes do hub, dos hooks e do núcleo, e 500 do app). O CI no GitHub roda os testes no Linux, no macOS e no Windows com Node 22 e 24, confere que o `plugin/dist` bate com o código e faz um teste de fumaça do plugin compilado no Node 18 a 24 nos três sistemas.

## Privacidade e confiança

Tudo fica no seu computador. O hub escuta só em 127.0.0.1. O plugin não lê credenciais e não manda nada pela rede.

- **Mensagens do app têm a mesma autoridade que digitar no terminal, com um limite.** O Claude as trata como suas, inclusive pedidos para rodar comandos ou editar arquivos, com as mesmas regras de permissão. Elas nunca contam como sua resposta a algo que o Claude perguntou no terminal, como um pedido de permissão ou um "posso seguir?" antes de uma ação destrutiva: responda essas no terminal.
- **Isso depende do comportamento do modelo.** O Claude Code marca a saída dos hooks como "not user input", e o `/cc` pede ao Claude que confie mesmo assim nos blocos com chave vindos do waiter do AI Chat Center. Uma versão futura do Claude Code ou do modelo pode recusar as mensagens do app; se acontecer, digite o pedido no terminal e, por favor, avise.
- **O link do app leva um token.** Ele é novo a cada vez que o hub sobe, fica depois do `#` (o navegador nunca o manda ao hub) e sai da barra de endereço quando a página carrega. A aba o guarda no armazenamento da sessão. Antes de conectar ou mandar qualquer coisa, o app pede ao hub que prove que conhece o token, então outro programa na porta não recebe nada.
- **O link fica salvo na transcrição da sessão**, porque o Claude Code grava ali as mensagens dos hooks. Um `/export` ou uma transcrição compartilhada o carrega. Ele para de funcionar quando o hub reinicia.
- **Mensagens assinadas.** O hub assina toda mensagem do app com um segredo criado uma vez por instalação (`~/.ai-chat-center/install-secret`, legível só por você). O waiter só entrega mensagens com assinatura válida, para aquela sessão, não repetidas, não datadas no futuro e não mais antigas que a conexão. Um arquivo apenas gravado na caixa de entrada fica separado como `.unsigned`. As respostas de múltipla escolha também são assinadas: um arquivo de resposta que o hub não assinou para aquela pergunta é ignorado, e o diálogo do terminal responde.
- **A chave por conexão** permite ao Claude distinguir mensagens reais do app de um texto que só se parece com uma. O Claude só confia num bloco quando ele chega como retorno de hook do waiter, nunca vindo de um arquivo, de uma página da web ou da saída de um comando.
- **Recomendado:** mantenha as ferramentas de arquivo do próprio Claude fora da pasta de estado. Adicione `"Read(~/.ai-chat-center/**)"` e `"Edit(~/.ai-chat-center/**)"` em `permissions.deny` no `~/.claude/settings.json`. Comandos de shell continuam seguindo as suas regras de permissão do Bash.

## Limitações

- Pedidos de permissão só podem ser aprovados no terminal (numa sessão em segundo plano, abra pelo ⋮ > Abrir no terminal).
- Uma pergunta de múltipla escolha feita num turno que você começou pelo terminal é respondida no terminal; o app a mostra só para leitura. Sem janela do app aberta, as perguntas também vão para o terminal.
- Depois de uma sessão ficar parada mais de 24 horas, as mensagens do app deixam de ser entregues até o próximo turno: o Claude Code encerra o waiter depois de 24 horas. O app avisa para mandar qualquer prompt no terminal.
- Depois de interromper um turno (Esc), as mensagens do app chegam 10 a 25 segundos depois, quando o `claude agents` mostra a sessão parada.
- Ao retomar uma sessão antiga, mensagens do app que já estavam na fila havia mais de 30 minutos antes da retomada são descartadas; o app as marca como não entregues.
- Depois de um `/compact`, o Claude pode esquecer a conexão; se ele recusar uma mensagem do app, rode `/cc` de novo.
- Os subagentes podem ser acompanhados no painel lateral, só para leitura: não dá para mandar mensagem a um subagente.
- O app só é acessível deste computador (127.0.0.1).
- Só o Claude Code, por enquanto.

## Solução de problemas

- **O app não alcança o hub ou pede o link do `/cc`.** Digite `/cc` em qualquer sessão: ele sobe o hub se precisar e mostra um link novo.
- **Todo prompt mostra um erro de hook.** Falta o Node.js no PATH que o Claude Code enxerga. Instale-o e reinicie o Claude Code (no Windows, feche antes todos os terminais e editores).
- **Porta.** O hub usa 127.0.0.1:7777, ou a próxima livre até a 7787; o link sempre mostra a porta real. `AI_CHAT_CENTER_PORT` define a primeira porta a tentar.
- **Pasta de estado.** `~/.ai-chat-center` (defina `AI_CHAT_CENTER_HOME` para mudar). Os logs ficam na pasta `logs/` dela: `hub.log`, `hook.log`, `waiter.log`, `ask.log` e `launcher.log`.
- **Parar o hub.** Apague `~/.ai-chat-center/hub.json`: o hub sai em até um minuto. Ele sobe de novo no próximo `/cc`.

## Desinstalação

1. Se você ligou o `usage`, rode `/ai-chat-center:cc usage off` para devolver a sua status line.
2. `/plugin uninstall ai-chat-center@ai-chat-center` e depois `/plugin marketplace remove ai-chat-center`.
3. Apague a pasta de estado (token, segredo da instalação, sessões, logs). Um hub rodando sai em até um minuto.
   - macOS e Linux: `rm -rf ~/.ai-chat-center`
   - Windows PowerShell: `Remove-Item -Recurse -Force "$HOME\.ai-chat-center"`
4. No Linux, se você usou `window on`, o `window off` remove o ícone do menu; ou apague `~/.local/share/applications/ai-chat-center.desktop`.

## Desenvolvimento

Precisa do Node.js `^22.22.2 || >=24.15` (o jsdom, nos testes do app).

```
npm install
npm test            # testes do hub, dos hooks e do núcleo
npm -w ui test      # testes do app web
npm run build       # empacota o plugin em plugin/dist (vai para o git)
npm run test:build  # lento: faz o build e testa os pacotes
node scripts/smoke-runtime.mjs .   # teste rápido do plugin empacotado, Node 18+ puro
node scripts/smoke-flow.mjs .      # /cc, hub, mensagem do app, entrega, /cc off
```

O `plugin/dist` vai para o git para o plugin funcionar direto do marketplace: refaça o build depois de mudar o código. O CI falha se ele estiver desatualizado. As notas de trabalho do projeto estão no [CLAUDE.md](CLAUDE.md) e as pendências no [docs/backlog.md](docs/backlog.md).

## Lançamento de versão

As cópias instaladas só atualizam quando a versão do plugin muda.

1. Suba a versão em `package.json`, `plugin/.claude-plugin/plugin.json` e `src/core/version.ts` (um teste mantém as três iguais) e em `ui/package.json`. Se o formato das mensagens do app ou da assinatura mudou, suba também o `PROTOCOL` em `src/core/version.ts`.
2. `npm run build` e commit do `plugin/dist`.
3. Siga o [docs/testing/release-checklist.md](docs/testing/release-checklist.md), inclusive a verificação ao vivo de que o modelo padrão atual ainda age sobre uma mensagem do app.
4. Crie a tag `vX.Y.Z` no commit e faça o push da tag. Um teste falha quando o `plugin/dist` difere da última tag `v*` sem mudança de versão.

## Licença

MIT. Veja [LICENSE](LICENSE). Os softwares de terceiros incluídos no app web estão listados em [plugin/THIRD-PARTY-NOTICES.md](plugin/THIRD-PARTY-NOTICES.md).

Projeto independente, sem vínculo com a Anthropic nem endosso dela.
