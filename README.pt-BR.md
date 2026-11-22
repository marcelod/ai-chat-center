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

- **Para usar:** Claude Code 2.1.139 ou mais recente (os hooks usam a forma exec, `command` mais `args`, adicionada nessa versão) e Node.js 18 ou mais recente. O plugin não precisa de `npm install`, e os hooks não precisam de shell (nem do Git Bash no Windows).
- **O Node.js 18+ precisa estar no PATH que o Claude Code enxerga; sem ele, todo prompt mostra um erro de hook. Desinstale o plugin ou instale o Node.**
- **Windows:** o instalador nativo do Claude Code não instala o Node. Instale o Node.js 18 ou mais recente (por exemplo pelo nodejs.org, ou com `winget install OpenJS.NodeJS.LTS`) e abra um terminal novo para que o Claude Code o encontre no PATH (`node -v` deve funcionar ali). Sem ele, todo prompt de toda sessão mostra um erro de hook.
- **Para desenvolver:** Node.js 22.22.2 ou um 22.x mais recente, ou Node.js 24.15 ou mais recente (`^22.22.2 || >=24.15`, exigido pelo jsdom nos testes da interface).

## Instalação

```
/plugin marketplace add marcelod/ai-chat-center
/plugin install ai-chat-center@ai-chat-center
```

## Uso

- Digite `/cc` em uma sessão para conectá-la. O plugin mostra no terminal um link para o app, no formato `http://127.0.0.1:7777/#token=…`; abra-o no navegador. O Claude só confirma a conexão: o link é mostrado a você pelo plugin e o Claude nunca o repete.
- Digite `/cc off` para desconectar a sessão.
- O comando também funciona pelo nome completo, `/ai-chat-center:cc`. Se outro plugin ou um comando seu também definir `/cc`, use `/ai-chat-center:cc`.

## Como funciona

O plugin registra hooks que rodam quando uma sessão começa, quando você envia um prompt, quando o Claude Code para e quando ele envia uma notificação. Sessões em que você nunca digitou `/cc` não gravam nada, e os hooks delas terminam na hora, com uma exceção: enquanto outra sessão estiver conectada, o waiter que começa com toda sessão (início, retomada, `/clear` e fork) roda o `claude agents` uma vez (uma fração de segundo) para verificar se a nova conversa substituiu uma conectada no mesmo terminal e, se for o caso, desconecta essa outra. O `/cc` inicia um hub local, caso ele ainda não esteja rodando. O hub lê as transcrições das sessões que o Claude Code já grava em disco e as serve para a interface web. Enquanto uma aba do app está aberta, o hub também roda o `claude agents` a cada 5 segundos, mais ou menos, para saber o estado das sessões; uma aba oculta fecha a conexão (a menos que as notificações do navegador estejam ligadas), o que interrompe isso. As mensagens digitadas no app vão para uma caixa de entrada por sessão. Um pequeno processo em segundo plano, o waiter (`dist/waiter.mjs`, iniciado por um hook `asyncRewake` quando a sessão começa ou é retomada, quando um turno começa e sempre que o Claude Code para), vigia essa caixa; quando chega uma mensagem e nenhum turno está em andamento, ele acorda a sessão e a entrega como retorno de hook, envolvida em marcadores com uma chave própria de cada conexão, para que a sessão só confie nas mensagens que vieram mesmo de você. Mensagens enviadas enquanto o Claude trabalha esperam o turno terminar, por mais que ele demore. Um turno que você interrompe (Esc) ou que termina com um erro da API não dispara o hook Stop do Claude Code; o waiter iniciado com esse turno continua esperando e, quando há mensagens na fila, consulta o `claude agents` (no máximo a cada 15 segundos) para saber se a sessão está ociosa e então as entrega. O waiter termina quando a sessão fecha ou é desconectada; ao desconectar, as mensagens ainda não entregues são descartadas. Quando o plugin não conseguiu identificar o processo da sessão, o waiter consulta o `claude agents` uma vez por minuto: ele termina depois de cerca de 3 minutos em que a sessão não aparece mais na lista, ou depois de 30 minutos em que essa consulta continua falhando.

O hub roda a partir da sua pasta pessoal e herda o ambiente da sessão que o iniciou, então ele enxerga as sessões que usam a mesma pasta de configuração do Claude (`CLAUDE_CONFIG_DIR`) dessa sessão. Ele se encerra sozinho depois de 2 horas sem nenhum navegador conectado e sem nenhuma sessão conectada; o próximo `/cc` o inicia de novo. O `/cc` espera até cerca de 5 segundos por um hub em execução que demora a responder, em vez de iniciar um segundo, e um hub que o `~/.ai-chat-center/hub.json` não cita mais (outro hub o substituiu, ou a pasta foi apagada) se encerra em até um minuto, para que um token antigo não continue funcionando. Uma sessão que você fechou sem `/cc off` deixa de contar como conectada quando o processo dela termina: o hub verifica a cada 5 minutos, mesmo sem nenhum navegador aberto, e a marca como encerrada depois de três verificações seguidas que não a encontram mais.

## Privacidade e confiança

Tudo fica no seu computador. O hub escuta apenas em 127.0.0.1. O plugin não lê nenhuma credencial e não envia nada pela rede.

- **As mensagens do app têm a mesma autoridade que digitar no terminal, com um limite.** O Claude as trata como suas, inclusive pedidos para rodar comandos ou editar arquivos, com as mesmas regras de permissão. Elas nunca valem como a sua resposta a algo que o Claude perguntou no terminal, como um pedido de permissão ou um "posso continuar?" antes de uma ação destrutiva ou irreversível: responda a esses no terminal.
- **Isso depende do comportamento do modelo.** O Claude Code rotula a saída do waiter como uma notificação do sistema, "não é entrada do usuário". O comando `/cc` pede ao Claude que trate os blocos com a chave que chegam do hook do AI Chat Center como digitados por você. Isso depende de como o modelo segue essa instrução e pode mudar numa versão futura do Claude Code ou do modelo; se mudar, o Claude pode recusar as mensagens do app. Nesse caso, digite o pedido no terminal e, por favor, relate o problema.
- **O link do app carrega um token.** Um token novo é criado sempre que o hub inicia. Ele fica na parte do link depois do `#`, que o navegador nunca envia ao hub, e o app o tira da barra de endereço assim que a página carrega. O navegador o guarda só naquela aba (armazenamento de sessão), então, depois de reiniciar o hub, ou em uma nova aba ou outro navegador, abra de novo o link do `/cc`. O token é mostrado só para você; ele não é enviado ao Claude.
- **O link do app fica salvo na transcrição da sessão.** O plugin o mostra para você como uma mensagem de hook, e o Claude Code grava essa mensagem no arquivo de transcrição da sessão (em `~/.claude/projects`), então um `/export`, uma transcrição compartilhada ou um backup o levam junto. O token dele deixa de funcionar assim que o hub reinicia, já que cada início cria um novo, e o hub se encerra sozinho depois de 2 horas sem nenhum navegador e sem nenhuma sessão conectada.
- **A chave de cada conexão** permite ao Claude distinguir mensagens reais do app de textos que só se parecem com uma. O Claude só confia em um bloco de mensagem quando ele chega como retorno de hook do waiter, nunca quando aparece em um arquivo, numa página web ou na saída de um comando, mesmo com a chave certa.
- **O hub assina cada mensagem do app** com um segredo criado uma vez por instalação (`~/.ai-chat-center/install-secret`, legível só por você), e o waiter só entrega mensagens cuja assinatura confere: um arquivo simplesmente gravado na caixa de entrada é descartado (e registrado no `waiter.log`). Qualquer coisa que consiga ler esse segredo com o seu usuário ainda pode assinar mensagens, como o app faz. A pasta é criada com acesso só para você (0700 no macOS e no Linux); mantenha assim.
- **Recomendado: mantenha as ferramentas do próprio Claude fora da pasta de estado.** Acrescente regras de negação às configurações do Claude Code (`~/.claude/settings.json`, em `permissions.deny`): `"Read(~/.ai-chat-center/**)"`, `"Edit(~/.ai-chat-center/**)"`. Assim, um texto injetado numa sessão (uma página web, um arquivo) não consegue fazer o Claude ler o segredo ou o token com as ferramentas de arquivo. Elas não cobrem comandos de shell, que continuam seguindo as suas regras de permissão do Bash.

## Limitações

- Pedidos de permissão só podem ser aprovados no terminal.
- `/clear`, `/resume` de outra conversa e forks desconectam a conversa anterior; rode `/cc` de novo.
- Depois que uma sessão fica ociosa por mais de 24 horas, as mensagens do app deixam de ser entregues: o Claude Code encerra o waiter após 24 horas e nada o reinicia até o próximo turno. Digite qualquer coisa no terminal ou rode `/cc` de novo.
- Se nenhum waiter estiver rodando para uma sessão (ele atingiu o limite de 24 horas ou foi encerrado) enquanto há mensagens do app esperando, o app avisa: "envie qualquer mensagem no terminal para retomar a entrega". Qualquer prompt que você digitar inicia um novo waiter.
- Depois que você interrompe um turno (Esc), as mensagens enviadas pelo app são entregues de 10 a 25 segundos depois, quando o `claude agents` informa que a sessão está ociosa. Sem o `claude` no PATH que os hooks enxergam, elas esperam o seu próximo prompt no terminal.
- Ao retomar uma sessão antiga, as mensagens do app enfileiradas mais de 30 minutos antes são descartadas em vez de entregues (o log do waiter registra isso); o app as marca como não entregues. Mensagens enviadas durante um turno longo são entregues quando o turno termina, qualquer que seja a idade delas.
- Depois de um `/compact`, o Claude pode esquecer a conexão; se ele recusar uma mensagem do app, rode `/cc` de novo.
- O trabalho de subagentes não aparece como mensagens: ele aparece como ação da sessão principal.
- As mensagens enviadas pelo app aparecem no terminal como retorno de hook.
- O Claude age sobre as mensagens do app só porque o `/cc` pede isso, acima do rótulo "não é entrada do usuário" que o Claude Code põe na saída dos hooks (veja Privacidade e confiança). Uma versão futura do Claude Code ou do modelo pode recusá-las.
- Por enquanto, só o Claude Code.

## Solução de problemas

- **O app diz que não consegue falar com o hub, ou pede o link do `/cc`.** Digite `/cc` em qualquer sessão; ele reinicia o hub se precisar e mostra um link novo. O token muda sempre que o hub reinicia, e cada aba do navegador precisa do link uma vez.
- **Porta.** O hub usa 127.0.0.1:7777. Se essa porta estiver ocupada, ele tenta de 7778 a 7787; o link do `/cc` sempre mostra a porta real.
- **Variáveis de ambiente.** `AI_CHAT_CENTER_PORT` define a primeira porta a tentar. `AI_CHAT_CENTER_HOME` muda a pasta de estado (padrão `~/.ai-chat-center`). Defina-as no ambiente em que o Claude Code é iniciado.
- **Logs** ficam em `~/.ai-chat-center/logs/`: `hub.log` (o hub), `hook.log` (o `/cc` e o hook de prompt) e `waiter.log` (entrega de mensagens, inclusive as antigas descartadas).
- **Parar o hub.** Encerre o processo cujo pid está em `~/.ai-chat-center/hub.json` (por exemplo `kill <pid>`, ou `Stop-Process -Id <pid>` no Windows). Ele volta a iniciar no próximo `/cc`.
- **Depois de atualizar o plugin**, rode `/cc` uma vez em uma sessão conectada: esse `/cc` substitui o hub antigo. Só um hub mais antigo é substituído: uma sessão que ainda roda uma cópia mais antiga do plugin usa o hub mais novo como ele está. Um hub da versão 0.2.0 ou anterior não consegue se provar, então ele só é parado quando tudo o identifica como nosso (o pid do hub.json está vivo, o hub informa esse pid e uma versão mais antiga, e aceita o token gravado no disco). Caso contrário, o `/cc` avisa que não conseguiu verificá-lo e o deixa rodando; reinicie o computador ou pare-o (veja acima). Até esse `/cc`, um hub que continua rodando segue aceitando mensagens da aba dele. Mensagens na fila de um hub anterior à 0.2.3 não são assinadas do jeito que a 0.2.3 confere, então nunca são entregues: elas ficam separadas na caixa de entrada da sessão como `.unsigned` (registradas no `waiter.log`), e o app mostra que uma mensagem de uma versão anterior não foi entregue. Envie-as de novo.

## Desinstalação

1. Desinstale o plugin: `/plugin uninstall ai-chat-center@ai-chat-center`.
2. Remova o marketplace: `/plugin marketplace remove ai-chat-center`.
3. Pare o hub, se estiver rodando (pid em `~/.ai-chat-center/hub.json`; nada acontece se o arquivo não existir):
   - macOS e Linux: `f=~/.ai-chat-center/hub.json; [ -f "$f" ] && kill "$(node -p "require('$f').pid")" 2>/dev/null; true`
   - Windows PowerShell: `$f = "$HOME\.ai-chat-center\hub.json"; if (Test-Path $f) { Stop-Process -Id (Get-Content $f | ConvertFrom-Json).pid -ErrorAction SilentlyContinue }`
4. Apague o estado (token, segredo da instalação, registros, logs). Um hub que ainda esteja rodando se encerra sozinho em até um minuto:
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
node scripts/smoke-flow.mjs .      # /cc, hub, mensagem do app, entrega pelo waiter, /cc off, com Node 18+ puro
```

A pasta `plugin/dist` fica no repositório para que o plugin funcione direto do marketplace; refaça o build e faça commit dela depois de mudar o código-fonte. A CI falha se ela estiver desatualizada. O build também gera `plugin/LICENSE` e `plugin/THIRD-PARTY-NOTICES.md`.

## Publicação de versões

As cópias instaladas só são atualizadas quando a versão do plugin muda.

1. Aumente a versão em `package.json`, `plugin/.claude-plugin/plugin.json` e `src/core/version.ts` (um teste mantém as três iguais).
2. Rode `npm run build` e faça commit de `plugin/dist`.
3. Siga o [docs/testing/release-checklist.md](docs/testing/release-checklist.md), incluindo a verificação ao vivo de que o modelo padrão atual ainda age sobre uma mensagem do app.
4. Crie a tag `vX.Y.Z` no commit da versão. Um teste falha quando `plugin/dist` difere da última tag `v*` sem mudança de versão.

## Licença

MIT. Veja [LICENSE](LICENSE). O software de terceiros incluído na interface web está listado em [plugin/THIRD-PARTY-NOTICES.md](plugin/THIRD-PARTY-NOTICES.md).

Projeto independente, sem afiliação com a Anthropic nem endosso dela.
