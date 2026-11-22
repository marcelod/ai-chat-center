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

- Node.js 20 ou superior
- Claude Code

## Instalação

```
/plugin marketplace add marcelod/ai-chat-center
/plugin install ai-chat-center@ai-chat-center
```

## Uso

- Digite `/cc` em uma sessão para conectá-la. O terminal mostra um link para o app, no formato `http://127.0.0.1:7777/?token=…`; abra-o no navegador.
- Digite `/cc off` para desconectar a sessão.
- O comando também funciona pela forma do autocompletar, `/ai-chat-center:cc`.

## Como funciona

O plugin registra hooks que rodam quando uma sessão começa, quando você envia um prompt, quando o Claude Code para e quando ele envia uma notificação. Sessões em que você nunca digitou `/cc` ficam intocadas: os hooks terminam na hora e não gravam nada. O `/cc` inicia um hub local, caso ele ainda não esteja rodando. O hub lê as transcrições das sessões que o Claude Code já grava em disco e as serve para a interface web. As mensagens digitadas no app vão para uma caixa de entrada por sessão. Um pequeno processo em segundo plano, o waiter (`dist/waiter.js`, iniciado por um hook `asyncRewake` quando a sessão começa e sempre que o Claude Code para), vigia essa caixa; quando chega uma mensagem e nenhum turno está em andamento, ele acorda a sessão e a entrega como retorno de hook, envolvida em marcadores com uma chave própria de cada conexão, para que a sessão só confie nas mensagens que vieram mesmo de você. Mensagens enviadas enquanto o Claude trabalha esperam o turno terminar. O waiter termina assim que a sessão fecha ou é desconectada; ao desconectar, as mensagens ainda não entregues são descartadas.

O hub roda a partir da sua pasta pessoal e herda o ambiente da sessão que o iniciou, então ele vê as sessões que usam a mesma pasta de configuração do Claude (`CLAUDE_CONFIG_DIR`) que essa sessão.

## Privacidade

Tudo fica no seu computador. O hub escuta apenas em 127.0.0.1 e exige um token guardado na sua pasta pessoal. O plugin não lê nenhuma credencial e não envia nada pela rede.

## Limitações do MVP

- Pedidos de permissão só podem ser aprovados no terminal.
- O `/clear` desconecta a sessão; rode `/cc` novamente.
- As mensagens enviadas pelo app aparecem no terminal como retorno de hook.
- Somente Claude Code, por enquanto.

## Solução de problemas

- **O app diz que não consegue falar com o hub.** Digite `/cc` em qualquer sessão; ele inicia o hub de novo e mostra um link novo.
- **Parar o hub.** Encerre o processo cujo pid está em `~/.ai-chat-center/hub.json` (por exemplo `kill <pid>`, ou `Stop-Process -Id <pid>` no Windows). Ele volta a iniciar no próximo `/cc`.
- **Depois de atualizar o plugin**, o hub antigo é substituído automaticamente no próximo `/cc`.

## Desenvolvimento

```
npm install
npm test            # testes unitários (rápidos; não rodam o build)
npm -w ui test      # testes da interface web
npm run build       # empacota o plugin em plugin/dist (versionado)
npm run test:build  # lento: faz o build e testa os pacotes
```

O `plugin/dist` é versionado para o plugin funcionar direto do marketplace; refaça o build e faça commit dele após mudar o código. O CI falha se ele estiver desatualizado.

## Licença

MIT. Veja [LICENSE](LICENSE).

Projeto independente, sem afiliação ou endosso da Anthropic.
