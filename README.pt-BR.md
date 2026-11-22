# AI Chat Center

[English](README.md)

O AI Chat Center é um plugin para o Claude Code mais um pequeno app local. Ele permite acompanhar suas sessões de código no terminal em uma interface web no estilo WhatsApp e responder por lá, para que você vigie uma sessão demorada de outra janela do navegador no mesmo computador.

```
+----------------------+--------------------------------------+
| Sessões              | meu-projeto                          |
|----------------------|--------------------------------------|
| > meu-projeto   (2)  |  você:   adicione retry no upload    |
|   api-server         |  claude: pronto, 3 arquivos mudaram  |
|   site-docs          |  você:   agora rode os testes        |
|                      |--------------------------------------|
|                      | [ digite uma mensagem...       ] [>] |
+----------------------+--------------------------------------+
```

## Requisitos

- **Para usar:** o Claude Code e o Node.js 18 ou mais recente no `PATH` que os hooks do Claude Code enxergam. O plugin não precisa de `npm install`. Se o `node` não for encontrado, os hooks não fazem nada (em silêncio) e o `/cc` não consegue conectar.
- **Para desenvolver:** Node.js 22.12 ou mais recente.

## Instalação

```
/plugin marketplace add marcelod/ai-chat-center
/plugin install ai-chat-center@ai-chat-center
```

## Uso

- Digite `/cc` em uma sessão para conectá-la. O plugin mostra no terminal um link para o app, no formato `http://127.0.0.1:7777/?token=…`; abra-o no navegador. O Claude só confirma a conexão: o link é mostrado a você pelo plugin e o Claude nunca o repete.
- Digite `/cc off` para desconectar a sessão.
- O comando também funciona pelo nome completo, `/ai-chat-center:cc`. Se outro plugin ou um comando seu também definir `/cc`, use `/ai-chat-center:cc`.

## Como funciona

O plugin registra hooks que rodam quando uma sessão começa, quando você envia um prompt, quando o Claude Code para e quando ele envia uma notificação. Sessões em que você nunca digitou `/cc` ficam intocadas: os hooks terminam na hora e não gravam nada. O `/cc` inicia um hub local, caso ele ainda não esteja rodando. O hub lê as transcrições das sessões que o Claude Code já grava em disco e as serve para a interface web. As mensagens digitadas no app vão para uma caixa de entrada por sessão. Um pequeno processo em segundo plano, o waiter (`dist/waiter.mjs`, iniciado por um hook `asyncRewake` quando a sessão começa ou é retomada e sempre que o Claude Code para), vigia essa caixa; quando chega uma mensagem e nenhum turno está em andamento, ele acorda a sessão e a entrega como retorno de hook, envolvida em marcadores com uma chave própria de cada conexão, para que a sessão só confie nas mensagens que vieram mesmo de você. Mensagens enviadas enquanto o Claude trabalha esperam o turno terminar. O waiter termina assim que a sessão fecha ou é desconectada; ao desconectar, as mensagens ainda não entregues são descartadas.

O hub roda a partir da sua pasta pessoal e herda o ambiente da sessão que o iniciou, então ele enxerga as sessões que usam a mesma pasta de configuração do Claude (`CLAUDE_CONFIG_DIR`) dessa sessão. Ele se encerra sozinho depois de 2 horas sem nenhum navegador conectado e sem nenhuma sessão conectada; o próximo `/cc` o inicia de novo.

## Privacidade e confiança

Tudo fica no seu computador. O hub escuta apenas em 127.0.0.1. O plugin não lê nenhuma credencial e não envia nada pela rede.

- **As mensagens do app têm a mesma autoridade que digitar no terminal.** O Claude as trata como suas, inclusive pedidos para rodar comandos ou editar arquivos, com as mesmas regras de permissão.
- **O link do app carrega um token.** Um token novo é criado sempre que o hub inicia. O navegador o guarda só naquela aba (armazenamento de sessão), então, depois de reiniciar o hub, ou em uma nova aba ou outro navegador, abra de novo o link do `/cc`. O token é mostrado só para você; ele não é enviado ao Claude.
- **A chave de cada conexão** permite ao Claude distinguir mensagens reais do app de textos que só se parecem com uma. O Claude só confia em um bloco de mensagem quando ele chega como retorno de hook do waiter, nunca quando aparece em um arquivo, numa página web ou na saída de um comando, mesmo com a chave certa.
- **Qualquer coisa que consiga gravar em `~/.ai-chat-center` com o seu usuário pode enviar mensagens** às suas sessões conectadas, como o app faz. A pasta é criada com acesso só para você (0700 no macOS e no Linux); mantenha assim.

## Limitações

- Pedidos de permissão só podem ser aprovados no terminal.
- `/clear`, `/resume` de outra conversa e forks desconectam a conversa anterior; rode `/cc` de novo.
- Depois que uma sessão fica ociosa por mais de 24 horas, as mensagens do app deixam de ser entregues: o Claude Code encerra o waiter após 24 horas e nada o reinicia até o próximo turno. Digite qualquer coisa no terminal ou rode `/cc` de novo.
- Mensagens do app que esperam mais de 30 minutos sem serem entregues (por exemplo, durante um turno longo) são descartadas; o app as marca como não entregues.
- Depois de um `/compact`, o Claude pode esquecer a conexão; se ele recusar uma mensagem do app, rode `/cc` de novo.
- O trabalho de subagentes não aparece como mensagens: ele aparece como ação da sessão principal.
- As mensagens enviadas pelo app aparecem no terminal como retorno de hook.
- Por enquanto, só o Claude Code.

## Solução de problemas

- **O app diz que não consegue falar com o hub, ou pede o link do `/cc`.** Digite `/cc` em qualquer sessão; ele reinicia o hub se precisar e mostra um link novo. O token muda sempre que o hub reinicia, e cada aba do navegador precisa do link uma vez.
- **Porta.** O hub usa 127.0.0.1:7777. Se essa porta estiver ocupada, ele tenta de 7778 a 7787; o link do `/cc` sempre mostra a porta real.
- **Variáveis de ambiente.** `AI_CHAT_CENTER_PORT` define a primeira porta a tentar. `AI_CHAT_CENTER_HOME` muda a pasta de estado (padrão `~/.ai-chat-center`). Defina-as no ambiente em que o Claude Code é iniciado.
- **Logs** ficam em `~/.ai-chat-center/logs/`: `hub.log` (o hub), `hook.log` (o `/cc` e o hook de prompt) e `waiter.log` (entrega de mensagens, inclusive as antigas descartadas).
- **Parar o hub.** Encerre o processo cujo pid está em `~/.ai-chat-center/hub.json` (por exemplo `kill <pid>`, ou `Stop-Process -Id <pid>` no Windows). Ele volta a iniciar no próximo `/cc`.
- **Depois de atualizar o plugin**, o hub antigo é substituído automaticamente no próximo `/cc`. Exceção: um hub da versão 0.1.x não consegue se provar para as versões novas, então ele continua rodando na porta dele e o hub novo usa a próxima. Pare-o uma vez (veja acima) ou reinicie o computador.

## Desinstalação

1. Desinstale o plugin: `/plugin uninstall ai-chat-center@ai-chat-center`.
2. Pare o hub (pid em `~/.ai-chat-center/hub.json`):
   - macOS e Linux: `kill "$(node -p "require(process.env.HOME + '/.ai-chat-center/hub.json').pid")"`
   - Windows PowerShell: `Stop-Process -Id (Get-Content "$HOME\.ai-chat-center\hub.json" | ConvertFrom-Json).pid`
3. Apague o estado (token, registros, logs):
   - macOS e Linux: `rm -rf ~/.ai-chat-center`
   - Windows PowerShell: `Remove-Item -Recurse -Force "$HOME\.ai-chat-center"`

## Desenvolvimento

```
npm install
npm test            # testes unitários (rápidos; não rodam o build)
npm -w ui test      # testes da interface web
npm run build       # empacota o plugin em plugin/dist (versionado no git)
npm run test:build  # lento: faz o build e testa os bundles
node scripts/smoke-runtime.mjs .   # teste de fumaça do plugin, com Node 18+ puro
```

A pasta `plugin/dist` fica no repositório para que o plugin funcione direto do marketplace; refaça o build e faça commit dela depois de mudar o código-fonte. A CI falha se ela estiver desatualizada. O build também gera `plugin/LICENSE` e `plugin/THIRD-PARTY-NOTICES.md`.

## Publicação de versões

As cópias instaladas só são atualizadas quando a versão do plugin muda.

1. Aumente a versão em `package.json`, `plugin/.claude-plugin/plugin.json` e `src/core/version.ts` (um teste mantém as três iguais).
2. Rode `npm run build` e faça commit de `plugin/dist`.
3. Crie a tag `vX.Y.Z` no commit da versão. Um teste falha quando `plugin/dist` difere da última tag `v*` sem mudança de versão.

## Licença

MIT. Veja [LICENSE](LICENSE). O software de terceiros incluído na interface web está listado em [plugin/THIRD-PARTY-NOTICES.md](plugin/THIRD-PARTY-NOTICES.md).

Projeto independente, sem afiliação com a Anthropic nem endosso dela.
