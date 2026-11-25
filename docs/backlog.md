# Pendências

Itens combinados e deixados para depois. Estado em 2026-11-25, versão 0.6.1. Só o autor usa o app por enquanto: priorizar o que atrapalha o uso diário.

## A fazer

### Instalação mais fácil no Windows

Em avaliação pelo autor (2026-11-24).

No primeiro teste no Windows (2026-11-24), o atalho funcionou, mas a pessoa teve de instalar o Node, ajustar o PATH e fechar todos os VS Code e terminais antes de funcionar. Ideias: o `/cc` dizer claramente quando o Node não está no PATH que o Claude Code vê (e como corrigir); um guia curto de instalação no Windows; avaliar se os hooks podem achar o Node em locais comuns sem depender do PATH.

### Pergunta esperando resposta numa sessão em segundo plano

Visto ao vivo (2026-11-24). Com `answers off`, o diálogo de opções (AskUserQuestion) numa sessão em segundo plano só pode ser respondido no terminal, e não há terminal aberto. O autor teve de abrir um terminal e usar o `/resume`. Ideia: o app avisar "pergunta esperando resposta: use `claude attach <id>` ou ligue as respostas pelo app (`/ai-chat-center:cc answers on`)".

### Recursos de segundo plano visíveis nas sessões de terminal

Pedido em 2026-11-25. A troca de modelo e esforço e a lista de comandos ao digitar `/` só aparecem em sessões em segundo plano (`bgId`), porque o app digita nelas pelo `claude attach`; numa sessão de terminal comum o texto do app chega como hook e o Claude Code não executa `/…`. Quem usa uma sessão de terminal acha que a atualização não carregou. Ideia: mostrar os botões desativados nessas sessões, com a dica "Disponível em sessões em segundo plano: retome a sessão pelo app".

### Mostrar a versão em uso

Pedido em 2026-11-25. Mostrar no app a versão do AI Chat Center que está rodando, por exemplo no menu de configurações ou no rodapé da lista. Dá para fazer:

- Versão do hub (o app): o hub já sabe a dele (`VERSION` em `src/core/version.ts`).
- Versão de cada sessão: o registro de cada sessão já guarda a versão do plugin que a conectou (`codeStamp`). Serve para ver qual sessão ainda roda uma versão antiga e precisa de `/reload-plugins`.
- Versão do Claude Code de cada sessão: as linhas da transcrição trazem o campo `version`; daria para mostrar no cabeçalho da conversa (confirmar).

### Recap da conversa

Pedido em 2026-11-25. O Claude Code mostra às vezes um resumo de onde a conversa parou ("recap"), ao voltar depois de um tempo fora. Dá para fazer: ele fica gravado na transcrição como linha `type: "system"`, `subtype: "away_summary"`, com o texto em `content` (conferido: 418 linhas nas transcrições locais). O app pode mostrar essa linha na conversa como um cartão de resumo, diferente das mensagens. Detalhe: o texto termina com "(disable recaps in /config)", que pode ser tirado ou trocado por uma dica do app.

### Sugestão da próxima mensagem

Pedido em 2026-11-25 (era a ideia 12). O Claude Code sugere às vezes a próxima mensagem, em cinza no campo de texto. Mais difícil que o recap: a sugestão **não** fica na transcrição (só fica `promptSource: "suggestion_accepted"` quando a pessoa aceita). Caminhos a avaliar: ler a sugestão da tela da sessão em segundo plano (`claude logs`, ver a ideia 2) ou pedir sugestões pelo `--prompt-suggestions` nas sessões criadas pelo app (confirmar se essa opção vale fora do modo `-p`). No app, a sugestão apareceria no campo de texto e o Tab aceitaria.

### Título "AI Chat Center" quebrando em duas linhas

Visto em 2026-11-25 (print do autor): no topo da lista de conversas, ao lado do logo (`ui/src/components/Logo.tsx`) e dos botões +, configurações e recolher, o título aparece como "AI Chat" numa linha e "Center" na outra. Ajustar para ficar numa linha só (por exemplo `white-space: nowrap`, fonte um pouco menor ou menos espaço entre os botões); se não couber em listas estreitas, cortar com reticências em vez de quebrar.

### Nova sessão em qualquer pasta

Pedido em 2026-11-25 (print do autor). No "+", o campo "Pasta" é uma lista só com as pastas já usadas em alguma sessão. Para abrir um projeto novo, a pessoa precisa abrir um terminal antes, o que vai contra a ideia de usar só o app. Ideia: permitir escolher qualquer pasta do computador.

- O seletor de pastas do navegador (`showDirectoryPicker`) não serve: ele não entrega o caminho completo, e o Safari e o Firefox não têm. O caminho viável é um navegador de pastas no próprio app, com o hub listando as subpastas (só pastas, sem arquivos), a partir da pasta pessoal, com "subir" e "entrar". Também aceitar digitar ou colar um caminho.
- Segurança: rota do hub com o mesmo token das outras; limitar à pasta pessoal; não seguir links simbólicos para fora dela; esconder pastas ocultas por padrão.
- Pasta nunca aberta no Claude Code: confirmar como o `claude --bg` se comporta com o aviso de confiança da pasta ("Do you trust the files in this folder?"). A 0.5.0 já teve o erro "Workspace not trusted". Se ele travar, o app precisa avisar antes ou oferecer a confiança de forma explícita.
- Talvez: criar uma pasta nova ali mesmo.

### Abrir um terminal da conversa pelo app

Pedido em 2026-11-25. Na conversa, um botão "Abrir no terminal" para quando o terminal foi fechado ou a sessão nasceu pelo app (+) e é preciso algo que o app ainda não faz (responder uma permissão, um diálogo, um comando interativo). Parece possível:

- Sessão em segundo plano (`bgId`): o hub abre o terminal do sistema rodando `claude attach <id>`. A sessão continua a mesma, e fechar o terminal não a encerra.
- Sessão encerrada: abrir com `claude --resume <id>` (ou retomar em segundo plano e dar attach, como o Retomar já faz).
- Sessão de terminal comum ainda aberta: já tem terminal; o botão não aparece (ou só avisa).
- Qual terminal: Linux `x-terminal-emulator`, `gnome-terminal`, `konsole` e outros, na pasta da sessão; macOS o Terminal.app (`open -a Terminal` com um script `.command`, ou `osascript`); Windows o Windows Terminal (`wt`) ou o `cmd`. Sem shell montado com texto do usuário: o id vem do hub e é validado.
- A confirmar: se dois `claude attach` na mesma sessão convivem (o do terminal e o que o hub usa para mandar comandos `/…`).

### Entrada por voz

Ideia antiga, ainda sem detalhes. Aguardando (2026-11-24).

### Memória dos waiters e lentidão na primeira vez

Medido de novo em 2026-11-25 com 4 sessões: um waiter por sessão, nenhum sobrando, cerca de 51 MB privados no total (o monitor mostra ~60 MB por processo porque conta o binário do Node, compartilhado). Caminhos: enxugar o waiter em Node (3 a 7 MB por sessão a menos, risco baixo) ou um waiter `sh` + `curl` no Linux e no macOS (1 a 2 MB, rodada grande, muda o modelo de segurança).

O que incomodou o autor foi outra coisa: nas duas primeiras execuções, uma em cada notebook, a máquina ficou um pouco lenta. Suspeitos a medir: o primeiro `/cc` (o hub sobe, abre a janela do Chrome, cria o atalho) e as consultas ao `claude agents`. **Verificar com calma mais pra frente**, a pedido do autor.

### CPU do hub com tudo parado

Medido em 2026-11-25: com uma sessão trabalhando, 11 consultas ao `claude agents` por minuto e 2,6% de CPU (esperado). Com tudo parado, 6 por minuto (esperado: 2) e 1,9% de CPU. Causa provável, a confirmar: a regra do intervalo (`liveTtl` em `src/hub/provider.ts`) lê o `busy` cru do `claude agents`, enquanto a tela usa a marca de turno do hub; uma sessão em segundo plano parada pode aparecer como `busy`. Correção pequena, **aguarda o OK do autor**.

## Ideias

Levantamento de 2026-11-24, feito a partir do app e das opções do Claude Code 2.1.332 (`claude --help`). ★ marca as mais úteis para o uso diário. Ainda não planejadas: viram item de "A fazer" quando o autor escolher. Quando o autor pedir as ideias de novo, devolver esta lista com as ★ e com os itens de "A fazer".

Sugestão de ordem: 2 (fecha o "fazer tudo sem terminal"), depois 16 e 21. ✅ marca as feitas.

### Sessões em segundo plano
1. ★ ✅ 0.6.0 **Nova sessão pelo app:** botão "+" com a pasta (das já usadas), o nome, o modelo e o esforço. O hub roda `claude --bg -n <nome> --model … --effort … "/ai-chat-center:cc"`, e a sessão já nasce conectada.
2. ★ **Ver a tela da sessão no app:** `claude logs <id>` mostra a tela da sessão. Resolve `/status`, `/cost` e `/context`: depois do comando, o app mostra o trecho da tela. Cuidado visto em 2026-11-25: a tela guarda o link do `/cc` com o token do app; o trecho precisa ser filtrado antes de aparecer.
3. **Parar, reiniciar e remover pelo menu ⋮:** `claude stop`, `claude respawn` (roda a versão nova do Claude Code depois de um update) e `claude rm`. Também limpar sessões paradas que sobraram.
4. ✅ 0.6.0 **Lista de comandos ao digitar `/`.**
5. ✅ 0.6.0 **Aviso de que o comando terminou.**
6. **Pergunta esperando resposta com `answers off`** (ver "A fazer").
7. ✅ 0.6.0 **Trocar modelo e esforço pelo app:** `/model <nome>` e `/effort <nível>` levam argumento e funcionam pelo attach. Botões no cabeçalho.
8. **Sessão num worktree:** "nova sessão isolada" com `claude --bg -w <nome>`, para tarefas paralelas no mesmo projeto.

### Conversa
9. ★ ✅ 0.6.0 **Busca:** dentro da conversa e entre todas as conversas, incluindo as encerradas.
10. **Exportar uma conversa** em Markdown ou PDF.
11. **Respostas rápidas:** botões com mensagens frequentes ("pode seguir", "faz o commit", "resume o que falta").
12. **Sugestão da próxima mensagem** (ver "A fazer").
13. **Diff dos arquivos editados**, com cores, em vez de só "Edit arquivo X".
14. **Fila de mensagens visível:** ver o que foi mandado com a sessão ocupada, com opção de editar ou cancelar antes de ela ler.
15. **Agendar uma mensagem:** por exemplo, "às 23:30 manda 'pode começar'".

### Avisos e visão geral
16. ★ **Notificação do sistema:** quando uma sessão termina o turno, pede permissão ou faz uma pergunta, mesmo com o app minimizado.
17. **Painel geral:** todas as sessões numa grade, com estado, tempo trabalhando e uso de contexto.
18. **Uso e custo por sessão:** tokens, contexto ocupado (aviso perto de compactar) e o histórico do uso de 5 horas.
19. **Agrupar sessões por projeto ou pasta** na lista.

### Permissões
20. **Responder permissões pelo app:** hoje proibido por segurança. Estudar uma versão restrita (só em segundo plano, só ferramentas de leitura, confirmação dupla). Exige decisão do autor antes.

### Acesso de outros lugares
21. ★ **Celular na rede de casa:** o hub escuta só no `127.0.0.1`. Pareamento por QR code e token; o `src/hub/pairing.ts` pode servir de base.
22. **Remote Control oficial:** comparar o `claude --remote-control` (acesso pelo claude.ai) com a ideia 21 antes de construir.

## A testar no uso

- 0.6.1, app sem Chrome: no macOS só com Safari, o `/cc` abre o app numa aba do Safari e mostra a dica "Arquivo > Adicionar ao Dock"; a janela criada pelo Dock deve trocar o código `#pair=` sozinha. Testar também com o Chrome em `~/Applications`. No Windows sem Chrome nem Edge, conferir que o `rundll32` abre a aba com o `#pair=` (o fragmento não pode se perder). Uma aba aberta conta como janela: o `/cc` seguinte não abre outra. O Safari pode suspender uma aba em segundo plano por muito tempo; se ela parar de avisar o hub por 150 s, o `/cc` abre uma aba nova.

- Atalho no macOS: ainda não testado; o autor está procurando alguém com Mac (`docs/testing/launcher-windows-macos.md`).
- Fundo por conversa: ok por enquanto; rever cores e véu (76%) com calma nos dois temas.

- 0.5.0, sessões em segundo plano: retomar pelo app e comandos `/…` (`docs/testing/background-sessions.md`). Comandos no Windows ficam para depois (sem `script`; o node-pty traz ~30 MB); macOS não testado.

- 0.6.0 (`docs/superpowers/specs/2026-11-25-app-batch-design.md`), na branch `feat/app-batch` até o merge:
  - Nova sessão pelo app: testada ao vivo pelo hub do worktree; falta testar pelo botão "+" no app.
  - Lista de comandos ao digitar `/`: conferir se os comandos marcados como "rodam pelo app" rodam mesmo, um por um.
  - Aviso de comando terminado: conferir com um `/compact` real.
  - Trocar modelo e esforço: o Claude Code também salva a escolha como padrão das novas sessões. No teste ao vivo, o modelo padrão foi devolvido para `opus`, mas o esforço padrão ficou `high` (o valor anterior não era conhecido): conferir `effortLevel` no `~/.claude/settings.json`. Avaliar se o hub deve devolver o padrão anterior depois de trocar.
  - Busca: conferir a velocidade com transcrições grandes (uma tem 9 MB).

## Limites conhecidos (mexer só se atrapalharem)

- Se o navegador fecha sem avisar o hub (crash), o `/cc` não abre janela por até 150 s.
- Uma aba comum (ou do VS Code) com o app conta como janela aberta.
- O Chrome pode não trazer a janela para a frente (`window.focus()`).
- O atalho do Linux supõe Chrome com o perfil "Default" (`StartupWMClass`).

## Feito

- 0.6.1: sem Chrome, Chromium ou Edge, o `/cc` abre o app numa aba do navegador padrão (Safari no macOS), com o código de uso único, e no macOS dá a dica "Arquivo > Adicionar ao Dock"; o Chrome também é procurado em `~/Applications`.
- Confirmados no uso em 2026-11-25: "trabalhando" travado não voltou (se voltar, entra de novo na lista); anexos numa sessão sem modo auto funcionam; modo da sessão aparece no cabeçalho ("auto mode"); uso de 5 horas ok; atalho no Windows aprovado.
- 0.4.2: uma única janela do app, atalho no menu do Linux, logo novo.
- 0.4.3: menos consultas ao `claude agents` com tudo parado.
- 0.4.4 a 0.4.7: "trabalhando" preso corrigido, rascunho por conversa, menu ⋮ com Renomear e Remover do app, atalhos do Windows e do macOS, manifesto do PWA, conversa em grupo com os agentes.
- 0.4.8: anexos (📎, arrastar, Ctrl+V), fundo por conversa, Fixar no topo e Desconectar no menu ⋮.
- 0.4.9: modo da sessão no cabeçalho da conversa, uso de 5 horas no rodapé da lista (`/ai-chat-center:cc usage on|off`), teste do `connectedAt` isolado.
- 0.4.10: app na própria janela por padrão (`/ai-chat-center:cc window off` desliga).
- 0.5.1: o Retomar não passa mais o `CLAUDE_CONFIG_DIR` padrão (o erro "Workspace not trusted" da 0.5.0); retomar e `/compact` pelo app confirmados ao vivo.
- 0.5.0: retomar pelo app uma sessão encerrada (em segundo plano) e rodar comandos `/…` nas sessões em segundo plano.
- 0.6.0: nova sessão pelo app (pasta, nome, modelo e esforço), lista de comandos ao digitar `/`, aviso de comando terminado, troca de modelo e esforço, busca na conversa e entre conversas; medição da memória dos waiters e da CPU do hub.
- PWA: o Chrome oferece "Instalar app" sem service worker (confirmado em 2026-11-24).
- Push da `main` para o origin (até a 0.4.10; os commits da 0.5.0 e da 0.5.1 ainda não foram enviados, a pedido do autor).

## Lembretes de processo

- Toda mudança em `plugin/dist` exige subir a versão (há um teste que compara com a última tag `v*`). Ver `docs/testing/release-checklist.md`.
- O push para o GitHub usa a conta `marcelod`.
