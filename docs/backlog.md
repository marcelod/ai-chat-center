# Pendências

Itens combinados e deixados para depois. Estado em 2026-11-27, versão 0.6.8. Só o autor usa o app por enquanto: priorizar o que atrapalha o uso diário.

## A fazer

### Instalação mais fácil no Windows

Em avaliação pelo autor (2026-11-24).

No primeiro teste no Windows (2026-11-24), o atalho funcionou, mas a pessoa teve de instalar o Node, ajustar o PATH e fechar todos os VS Code e terminais antes de funcionar. Ideias: o `/cc` dizer claramente quando o Node não está no PATH que o Claude Code vê (e como corrigir); um guia curto de instalação no Windows; avaliar se os hooks podem achar o Node em locais comuns sem depender do PATH.

### Sugestão da próxima mensagem

Pedido em 2026-11-25. Investigado na rodada 0.6.2 (Claude Code 2.1.332), **adiado**: a sugestão não fica na transcrição (só `promptSource: "suggestion_accepted"` quando aceita), não fica em `~/.claude` e nenhum hook a entrega. `--prompt-suggestions` só entrega a sugestão no modo `-p`/SDK (`stream-json`), o que exigiria outro modo de sessão (sem `--bg`, `/cc` e attach). Caminho possível depois da ideia 2 (ver a tela da sessão): ler a linha cinza do `claude logs <id>`, com o filtro de token; frágil a cada versão. Bônus barato, se o autor quiser: marcar no app as mensagens com `suggestion_accepted`. Cuidado registrado: `claude --bg --help` cria uma sessão de verdade; para ver a ajuda, use `claude --help`.

### Painel lateral: o que ainda falta

Na 0.6.8 o painel ganhou código com a linha citada, PDF e o diff das edições. Falta, quando o autor quiser: quebrar linhas no visualizador de código, realce de sintaxe melhor (hoje é aproximado e sem dependência) e PDF no celular (o frame costuma ficar vazio; "Abrir numa nova aba" e "Baixar" funcionam). PDF desenhado pelo próprio app exigiria o pdf.js (dependência nova).

### Janela antiga do app fica aberta e vazia depois de um update

Visto em 2026-11-27. Às vezes, depois de `/reload-plugins` e `/cc`, abre uma janela nova do app e a antiga continua aberta, mas vazia (sem conversas nem mensagens). Causa provável: com uma versão nova do plugin, o `/cc` encerra o hub da versão anterior e sobe um novo (`src/hooks/ensureHub.ts`, "stops a hub of another version"). O hub novo não conhece a janela antiga (a presença fica no hub), então abre outra; a antiga perde a conexão e, sem um pareamento válido no hub novo, fica vazia. Confirmar se o token muda ao reiniciar o hub.

Ideias, da melhor para a mais simples:
- A janela antiga se reconectar sozinha ao hub novo (volta a achar o hub e pede um novo pareamento) e o `/cc` reaproveitá-la em vez de abrir outra. Exige um jeito seguro de parear de novo sem o token na URL.
- O hub antigo, antes de sair, avisar as páginas abertas ("o app foi atualizado") e elas se fecharem (`window.close()` funciona na janela `--app` aberta pelo hub; numa aba comum, mostrar "Atualizado: feche esta aba").
- No mínimo, a janela sem conexão mostrar "O app foi atualizado; esta janela pode ser fechada" em vez de ficar vazia.

### Entrada por voz

Ideia antiga, ainda sem detalhes. Aguardando (2026-11-24).

### Memória dos waiters e lentidão na primeira vez

Medido de novo em 2026-11-25 com 4 sessões: um waiter por sessão, nenhum sobrando, cerca de 51 MB privados no total (o monitor mostra ~60 MB por processo porque conta o binário do Node, compartilhado). Caminhos: enxugar o waiter em Node (3 a 7 MB por sessão a menos, risco baixo) ou um waiter `sh` + `curl` no Linux e no macOS (1 a 2 MB, rodada grande, muda o modelo de segurança).

O que incomodou o autor foi outra coisa: nas duas primeiras execuções, uma em cada notebook, a máquina ficou um pouco lenta. Suspeitos a medir: o primeiro `/cc` (o hub sobe, abre a janela do Chrome, cria o atalho) e as consultas ao `claude agents`. **Verificar com calma mais pra frente**, a pedido do autor.

## Ideias

Levantamento de 2026-11-24, feito a partir do app e das opções do Claude Code 2.1.332 (`claude --help`). ★ marca as mais úteis para o uso diário. Ainda não planejadas: viram item de "A fazer" quando o autor escolher. Quando o autor pedir as ideias de novo, devolver esta lista com as ★ e com os itens de "A fazer".

Sugestão de ordem: 2 (fecha o "fazer tudo sem terminal"), depois 16 e 21. ✅ marca as feitas.

### Sessões em segundo plano
1. ★ ✅ 0.6.0 **Nova sessão pelo app:** botão "+" com a pasta (das já usadas), o nome, o modelo e o esforço. O hub roda `claude --bg -n <nome> --model … --effort … "/ai-chat-center:cc"`, e a sessão já nasce conectada.
2. ★ ✅ 0.6.7 **Ver a tela da sessão no app:** `claude logs <id>` mostra a tela da sessão. Resolve `/status`, `/cost` e `/context`: depois do comando, o app mostra o trecho da tela. Cuidado visto em 2026-11-25: a tela guarda o link do `/cc` com o token do app; o trecho precisa ser filtrado antes de aparecer.
3. ✅ 0.6.7 **Parar, reiniciar e remover pelo menu ⋮:** `claude stop`, `claude respawn` (roda a versão nova do Claude Code depois de um update) e `claude rm`. Também limpar sessões paradas que sobraram.
4. ✅ 0.6.0 **Lista de comandos ao digitar `/`.**
5. ✅ 0.6.0 **Aviso de que o comando terminou.**
6. ✅ 0.6.2 **Pergunta esperando resposta com `answers off`.**
7. ✅ 0.6.0 **Trocar modelo e esforço pelo app:** `/model <nome>` e `/effort <nível>` levam argumento e funcionam pelo attach. Botões no cabeçalho.
8. **Sessão num worktree:** "nova sessão isolada" com `claude --bg -w <nome>`, para tarefas paralelas no mesmo projeto.

### Conversa
9. ★ ✅ 0.6.0 **Busca:** dentro da conversa e entre todas as conversas, incluindo as encerradas.
10. ✅ 0.6.8 **Exportar uma conversa** em Markdown ou PDF.
11. ✅ 0.6.7 **Respostas rápidas:** botões com mensagens frequentes ("pode seguir", "faz o commit", "resume o que falta").
12. **Sugestão da próxima mensagem** (ver "A fazer").
13. ✅ 0.6.2 **Diff dos arquivos editados**, com cores, em vez de só "Edit arquivo X".
14. **Fila de mensagens visível:** ver o que foi mandado com a sessão ocupada, com opção de editar ou cancelar antes de ela ler.
15. **Agendar uma mensagem:** por exemplo, "às 23:30 manda 'pode começar'".

### Avisos e visão geral
16. ★ ✅ 0.6.7 **Notificação do sistema:** quando uma sessão termina o turno, pede permissão ou faz uma pergunta, mesmo com o app minimizado.
17. **Painel geral:** todas as sessões numa grade, com estado, tempo trabalhando e uso de contexto.
18. **Uso e custo por sessão:** tokens, contexto ocupado (ver "Tamanho do contexto da conversa" em "A fazer") e o histórico do uso de 5 horas.
19. ✅ 0.6.8 **Agrupar sessões por projeto ou pasta** na lista. Desenho combinado com o autor (2026-11-27):
    - Opcional, **desligado por padrão** ("Agrupar por projeto" nas configurações); desligado, a lista fica como hoje (mais recentes no topo).
    - Um grupo por pasta da sessão, com o nome da última parte do caminho e a contagem ("ai-chat-center (3)"); o caminho completo ao passar o mouse.
    - Grupos ordenados pela conversa mais recente de cada um; dentro do grupo, também da mais recente para a mais antiga.
    - ▾/▸ abre e fecha cada grupo; o app lembra o estado.
    - Fixadas continuam no topo, fora dos grupos.
    - Grupo fechado mostra se alguma conversa dele está trabalhando, agentes trabalhando ou tem mensagem nova.
    - A busca ignora os grupos e mostra os resultados direto.

### Permissões
20. **Responder permissões pelo app:** hoje proibido por segurança. Estudar uma versão restrita (só em segundo plano, só ferramentas de leitura, confirmação dupla). Exige decisão do autor antes.

### Acesso de outros lugares
21. ★ **Celular na rede de casa:** o hub escuta só no `127.0.0.1`. Pareamento por QR code e token; o `src/hub/pairing.ts` pode servir de base.
22. **Remote Control oficial:** comparar o `claude --remote-control` (acesso pelo claude.ai) com a ideia 21 antes de construir.

## A testar no uso

- 0.6.8 (rodada em paralelo; specs em `docs/superpowers/specs/2026-11-27-*`; reiniciar o hub depois do `/reload-plugins` para ele carregar o código novo):
  - Tela da sessão: ⋮ → "Tela da sessão" mostra só a tela atual (sem a lista de quadros "Doodling…"), com espaços entre as palavras e o link do `/cc` como `[app link removed]`. Com a sessão pensando, "Atualizar" algumas vezes mostra sempre um único quadro. Linhas de até 200 colunas, rolando para o lado; dois temas.
  - `/status`, `/cost`, `/context`, `/usage`, `/help`, `/doctor` (só em segundo plano): aparecem na lista do `/`; enviar `/context` mostra "/context enviado…", o painel abre sozinho na tela da sessão e o resultado aparece em até ~6 s. **Risco**: `/status`, `/usage` e `/help` abrem um diálogo na sessão; depois deles, mandar uma mensagem comum e um `/rename x` e conferir que a sessão aceita (se travar, anotar qual comando; dá para voltar a bloquear ou o hub mandar Esc). Em sessão de terminal, continua bloqueado.
  - Abrir no terminal com o Ptyxis: ⋮ → "Abrir no terminal" abre uma janela do Ptyxis na pasta da sessão rodando `claude attach <id>`, sem a janela "(Falhou)". Se a pasta ou o `--new-window` derem problema, anotar (alternativa: `ptyxis -d <pasta> -- …`). Com gnome-terminal e Ptyxis instalados, abre o gnome-terminal (dá para inverter). Console do GNOME (`kgx`) não testado.
  - Agent bloqueado: pedir um subagente que o modo auto negue; o balão "Claude → …" fica apagado, com o selo "Não executado" e o motivo numa linha curta, sem recarregar; não conta em "agentes trabalhando". Dois temas e com fundo.
  - Painel de subagentes: os que rodam em cima ("Nenhum subagente rodando agora" se nenhum), os terminados desde a sua última mensagem logo abaixo, e "Histórico (N)" fechado com o resto; ▸/▾; voltar de um subagente mantém o Histórico aberto.
  - Respostas rápidas sugeridas: mandar a mesma mensagem curta 3 vezes (variando maiúsculas/pontuação); depois de até 10 min (cache do hub; ou reiniciar o hub), ⚡ mostra "Sugestões" com ela, "+" adiciona e "×" dispensa para sempre. Conferir se a primeira abertura do ⚡ demora.
  - Painel lateral: `src/hub/server.ts:100` citado abre o código rolado e destacado na linha 100; `docs/backlog.md:20` abre como fonte, sem linha abre formatado; um PDF (citado ou anexo) aparece no painel no computador ("Abrir numa nova aba" e "Baixar" também); com "Mostrar alterações dos arquivos" ligado, "Abrir no painel" ao lado de "Ver alterações" mostra o diff maior.
  - Exportar: ⋮ → "Exportar conversa" → "Markdown (.md)" baixa `<nome>-AAAA-MM-DD.md` (procurar no arquivo: nada de `127.0.0.1`, `token=`, `[AI Chat Center message` nem `key=`); "PDF" abre a impressão com página clara só com a conversa, também com o tema escuro e com fundo. Um hash git completo numa mensagem sai como `[redacted]` (mesmo filtro da tela).
  - Agrupar por projeto (⚙, desligado por padrão): grupos "pasta (n)", fixadas no topo, ▾/▸ lembrado depois de recarregar, grupo fechado mostra trabalhando/agentes/não lidas, a busca ignora os grupos; lista recolhida só com ícones fica sem grupos. Grupo fechado não mostra "esperando permissão/resposta": dizer se quer.

- 0.6.7 (rodada em paralelo; specs em `docs/superpowers/specs/2026-11-26-*`):
  - Janela maior: ✅ lembra o último tamanho (2026-11-27, `/cc` em outra sessão abriu no tamanho deixado). Falta: abrir sem tamanho guardado (tirar `windowSize` do `~/.ai-chat-center/config.json`) e ver se cresce para 1280×860. Com o Chrome aberto, `/cc` abre a janela e ela cresce para 1280×860 (ou o último tamanho); redimensionar e esperar 1 s grava `windowSize` em `~/.ai-chat-center/config.json`; maximizada não grava; F5 não muda o tamanho. Conferir no Windows e no macOS.
  - Contexto: ✅ ok no uso (2026-11-27). Pizza "◔ N%" na barra; balão com tokens, modelo, quanto falta e o último compact; com `usage on` o total passa a ser exato (1M numa sessão 1M); `/compact` derruba o percentual na hora; amarelo ≥80% e vermelho ≥90%; no celular o balão não sai da tela.
  - Respostas rápidas (⚡): escolher preenche o campo sem enviar; editar a lista e recarregar mantém.
  - Notificações do sistema: ✅ fim do turno com o app sem foco mostra a notificação no Linux (2026-11-27). Clicar no corpo da notificação abre a conversa ✅ (o botão "Configurações" é do Chrome). Pergunta ✅ (a notificação diz "Fez uma pergunta" e leva ao app, onde a pergunta aparece). Falta: permissão (numa sessão fora do modo auto), Windows e macOS. (Configurações, desligadas por padrão): fim do turno, pedido de permissão e pergunta, só com o app escondido ou sem foco; clicar abre a conversa. Linux, Windows e macOS/Safari.
  - Painel lateral: ✅ `.md` e imagem citados abrem no painel (2026-11-27); o autor quer usar o painel para mais coisas com o tempo (ver "Painel lateral: próximos tipos de arquivo"). Caminho de `.md` ou imagem citado vira link só se existir; painel abre à direita (tela cheia no celular), X/Esc fecham, links relativos e "Voltar"; anexo de imagem clicável. Imagens remotas nas mensagens agora mostram só o texto alternativo: confirmar se é o desejado.
  - Subagentes e "agentes trabalhando (N)": ✅ (2026-11-27) cabeçalho mostra "agents working (1)", a lista mostra o contador, o painel lista os subagentes com tipo, modelo, tempo, última ferramenta e Working/Finished. Achado: um `Agent` que o modo auto bloqueou ainda aparece na conversa como "Claude → Teste B…", como se tivesse sido lançado; mostrar como bloqueado (ou esconder) quando o resultado da ferramenta for um erro. Subagentes: clicar no estado do cabeçalho abre a lista (descrição, tipo, modelo, tempo, última ferramenta) e a transcrição de cada um.
  - "Agentes trabalhando (N)": lançar 2 subagentes em segundo plano e encerrar o turno; cabeçalho e lista mostram o estado; volta para "parada" em até ~5 s quando terminam; sessão morta não prende (no máximo 10 min).
  - Tela da sessão: ✅ abre pelo ⋮ e o filtro funciona: o link do `/cc` aparece como `[app link removed]`, sem 127.0.0.1 nem token (2026-11-27), mas o conteúdo vem como quadros soltos da animação (ver "Tela da sessão mostra cada quadro da animação" em "A fazer"). Outro achado em 2026-11-27: o app ainda **bloqueia** `/status` ("only shows its result on the session's screen, so the app would show nothing. Use it in a terminal"), regra da 0.6.0 de antes da tela da sessão existir. Agora que a tela existe, liberar `/status`, `/cost`, `/context` e afins nas sessões em segundo plano e, depois do comando, abrir a tela da sessão no painel sozinho (ou mostrar "ver o resultado na tela da sessão"). (⋮, só em segundo plano): depois de `/status`, o texto aparece sem link 127.0.0.1, sem token e sem a chave (`[app link removed]`/`[redacted]`); conferir a largura das linhas.
  - Parar / reiniciar / remover: ✅ aparentemente ok no teste do autor com uma sessão criada pelo "+" (2026-11-27). (⋮ em sessão de segundo plano viva) e "Limpar sessões paradas" nas configurações. Testar com uma sessão de teste criada pelo "+": parar (confirmação no menu), reiniciar (deve reconectar sozinha em até ~1 min, sem `/cc`; anotar se não), remover (some da lista e de `claude agents --json --all`).

- 0.6.6:
  - Atualização para todas as sessões: só vale a partir da 0.6.6 (as sessões abertas numa versão anterior não têm o código novo e ainda precisam de `/reload-plugins` uma vez). Na próxima atualização instalada pelo marketplace (0.6.7 ou maior), conferir que uma sessão aberta antes passa a mostrar a versão nova na barra sob o campo de mensagem depois do próximo turno, sem `/reload-plugins`. Um waiter já esperando continua no código antigo até o próximo evento. Com o plugin carregado da pasta do repositório (`plugin/`) nada muda: todas as sessões já leem os mesmos arquivos. Voltar para uma versão mais antiga não vale enquanto a pasta da mais nova existir no cache: apagar `~/.ai-chat-center/plugin.json` e a pasta da versão mais nova.
  - CPU do hub: com tudo parado (inclusive uma sessão em segundo plano com tarefa rodando depois do turno), conferir que o hub consulta o `claude agents` cerca de 2 vezes por minuto. A causa não foi confirmada ao vivo: se continuar em 6, medir de novo quem consulta (os waiters também consultam em alguns casos).
  - Busca na conversa: destaque amarelo em todas as ocorrências e laranja na atual, ↑/↓ rolando até ela; aberta a partir de um resultado da busca da lista, começa na ocorrência mais recente. Não acha texto dividido pela formatação (metade em negrito) nem o que está recolhido numa mensagem de agente.
  - Blocos de código com Copiar e Quebrar linhas; balão da mensagem "Claude → agente" sobre o fundo; cor do fundo no círculo das iniciais (lista e cabeçalho): conferir nos dois temas.

- 0.6.5: barra sob o campo de mensagem (chip de modelo · esforço com lista e submenu de esforço, modo, versão do plugin) em tela larga e no celular; o menu abre para cima sem sair da tela; sessão de terminal mostra o chip apagado com a dica ao passar o mouse.

- 0.6.3: diff escondido por padrão ("Mostrar alterações dos arquivos" nas configurações liga); numa sessão criada pelo "+", escolher modelo e esforço logo de cara e conferir que são aplicados quando o primeiro `/cc` termina (sem erro 409 entre `/model` e `/effort`); CI do Windows deve passar depois do push.

- 0.6.2 (rodada em paralelo, specs e roteiros em `docs/testing/background-sessions.md`):
  - Pergunta esperando numa sessão em segundo plano: conferir que o `claude agents` mostra `waiting` durante o diálogo e que o aviso aparece (com e sem `answers on`).
  - Abrir no terminal (menu ⋮ e aviso): Linux (qual terminal abre; o `-e` do `x-terminal-emulator`), macOS (o `.command` no Terminal com o PATH do shell de login), Windows (`wt -d .` e, sem `wt`, o `cmd start`). Conferir também dois `claude attach` ao mesmo tempo: o do terminal aberto e o que o hub usa por ~2 s ao mandar um comando `/…`.
  - Nova sessão em qualquer pasta: navegador de pastas e caminho colado; numa pasta nunca aberta no Claude Code, ver o texto real do erro de confiança do `claude --bg` e se o app mostra a mensagem clara (ou se o `--bg` trava e cai no limite de 60 s). Decisão pendente do autor: avisar antes lendo `~/.claude.json` (`hasTrustDialogAccepted`) ou deixar como está.
  - Botões de segundo plano desativados numa sessão de terminal, e a linha de aviso ao digitar `/`.
  - Versões: versão do app nas configurações; "plugin X" e "Claude Code X" no cabeçalho; destaque de versão antiga numa sessão aberta antes de atualizar o plugin.
  - Título numa linha só, com reticências numa lista estreita. No print de 2026-11-25 aparece "AI Chat C…" mesmo com a lista larga: o nome inteiro deveria caber (fonte um pouco menor ou menos espaço entre os botões +, ⚙ e ▢).
  - Recap: cartão "Resumo" numa conversa com `away_summary`, nos dois temas.
  - Diff: "Ver alterações" em Edit/MultiEdit/Write, rolagem, cores nos dois temas, e o peso de abrir uma conversa grande com muitas edições (cada ação leva até 400 linhas).

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
- Marca de pergunta (0.6.2): se o diálogo de pergunta for fechado com Esc, a marca "pergunta esperando" só sai no próximo prompt ou Stop; só aparece no app se o `claude agents` falhar. Correção possível: limpar num PostToolUse do AskUserQuestion.
- "Abrir no terminal" diz que abriu assim que o terminal é iniciado; se faltar `DISPLAY`/`WAYLAND_DISPLAY` no hub ou o terminal sair com erro, nada aparece. No macOS, um `.command` que o Terminal nunca rodou deixa a pasta temporária.
- A busca entre conversas não traz os recaps (só a busca dentro da conversa).

## Feito

- 0.6.8: tela da sessão interpretada como terminal (só a tela final, com espaços); `/status`, `/cost`, `/context` e afins liberados em segundo plano, abrindo a tela no painel; "Abrir no terminal" com Ptyxis e Console do GNOME (e o terminal real atrás do `x-terminal-emulator`); chamada de agente bloqueada aparece como "Não executado"; painel de subagentes com os que rodam em cima e "Histórico (N)"; respostas rápidas sugeridas pelo uso; painel lateral com código na linha citada, PDF e diff; exportar conversa em Markdown ou PDF; agrupar sessões por projeto (opcional).
- 0.6.7: janela do app abre maior e lembra o tamanho; tamanho do contexto em pizza na barra; respostas rápidas (⚡); notificações do sistema; painel lateral com Markdown e imagens citados, subagentes da sessão e a tela da sessão (filtrada); estado "agentes trabalhando (N)"; parar, reiniciar e remover sessões em segundo plano pelo ⋮ e limpeza das paradas.
- 0.6.6: sessões abertas antes de uma atualização passam a rodar a versão mais nova instalada (a partir da próxima); o hub não encurta o intervalo do `claude agents` por um "trabalhando" que a tela mostra como parado; blocos de código com Copiar e Quebrar linhas (texto sem linguagem já quebra); balão com fundo na mensagem "Claude → agente"; a cor ou o degradê do fundo pinta o círculo das iniciais, com iniciais claras ou escuras conforme o contraste; o nome "AI Chat Center" cabe inteiro no topo da lista (título e botões um pouco menores); busca na conversa destaca cada ocorrência, com ↑/↓ (e Enter/Shift+Enter) e contador "i de n", sem esconder as outras mensagens; README revisado e CLAUDE.md criado.
- 0.6.5: cabeçalho da conversa enxuto (nome, pasta, attach e branch); modelo, esforço, modo e versão do plugin foram para a direita da dica do teclado, sob o campo de mensagem; o chip do modelo abre a lista de modelos e, no último item, os níveis de esforço; a versão do Claude Code fica no texto ao passar o mouse sobre a do plugin. Desenho aprovado em 2026-11-25.
- 0.6.4: mensagens dos agentes (e do Claude para eles) vêm recolhidas na primeira linha, com "Ver tudo" para abrir.
- 0.6.3: CI do Windows corrigido (testes de Linux/macOS e marca de pergunta que ficava presa quando o hook era encerrado à força no Windows); diff dos arquivos desligado por padrão, com opção nas configurações; modelo e esforço escolhidos enquanto a sessão trabalha são aplicados quando ela fica parada.
- 0.6.2: aviso de pergunta esperando numa sessão em segundo plano; "Abrir no terminal" (`claude attach`) pelo menu ⋮ e pelos avisos; nova sessão em qualquer pasta da pasta pessoal; botões de segundo plano visíveis (desativados) nas sessões de terminal; versão do app, do plugin e do Claude Code; título numa linha; recap da conversa; diff dos arquivos editados. Sugestão da próxima mensagem investigada e adiada.
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
