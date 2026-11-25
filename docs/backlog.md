# Pendências

Itens combinados e deixados para depois. Estado em 2026-11-24, versão 0.5.1. Só o autor usa o app por enquanto: priorizar o que atrapalha o uso diário.

## A fazer

### Instalação mais fácil no Windows

Em avaliação pelo autor (2026-11-24).

No primeiro teste no Windows (2026-11-24), o atalho funcionou, mas a pessoa teve de instalar o Node, ajustar o PATH e fechar todos os VS Code e terminais antes de funcionar. Ideias: o `/cc` dizer claramente quando o Node não está no PATH que o Claude Code vê (e como corrigir); um guia curto de instalação no Windows; avaliar se os hooks podem achar o Node em locais comuns sem depender do PATH.

### Lista de comandos ao digitar `/`

Pedido do autor (2026-11-24). Numa sessão em segundo plano, ao digitar `/` no campo de mensagem, o app mostra uma lista com os comandos que funcionam pelo app, filtrada enquanto a pessoa digita. Se a pessoa digitar um comando que não funciona pelo app, o app avisa que ele tem de ser usado no terminal (`claude attach <id>`) e não o envia. Como os comandos se comportam pelo app (visto ao vivo na 0.5.1):

- **Funcionam:** os que agem na sessão, como `/compact`, `/rename <nome>` e `/reload-plugins`. Skills e comandos de plugin com argumento (`/ai-chat-center:cc answers on`) também.
- **Rodam, mas o resultado não chega ao app:** os que só mostram algo na tela, como `/status`, `/cost`, `/context` e `/help`. Hoje o app diz só "Comando enviado". Avaliar mostrar o resultado no app (ler a tela do attach?) ou avisar que ele só aparece no terminal.
- **Não funcionam pelo app:** os que abrem um menu para escolher com setas e Enter, como `/resume`, `/model` sem argumento, `/config` e `/agents`. O app só digita uma linha. Para retomar, o botão Retomar já faz esse papel.

A lista precisa ser conferida comando a comando antes de entrar no app. Ainda falta testar a maioria.

### Saber quando um comando terminou

Pedido do autor (2026-11-24). Hoje o app diz "Comando enviado" quando digitou o texto, mas não avisa quando o comando termina. Ideia: avisar quando a sessão volta a ficar parada depois do comando.

### Pergunta esperando resposta numa sessão em segundo plano

Visto ao vivo (2026-11-24). Com `answers off`, o diálogo de opções (AskUserQuestion) numa sessão em segundo plano só pode ser respondido no terminal, e não há terminal aberto. O autor teve de abrir um terminal e usar o `/resume`. Ideia: o app avisar "pergunta esperando resposta: use `claude attach <id>` ou ligue as respostas pelo app (`/ai-chat-center:cc answers on`)".

### Entrada por voz

Ideia antiga, ainda sem detalhes. Aguardando (2026-11-24).

### Memória dos waiters

Cada sessão conectada mantém um processo Node de cerca de 60 MB esperando mensagens (4 sessões ≈ 240 MB). Medir de novo e, se continuar assim, reduzir: exige mudar a forma de espera; rodada própria.

### Medir a CPU ao vivo

A queda esperada de consultas ao `claude agents` com tudo parado (de 12 para 2 por minuto, desde a 0.4.3) ainda não foi medida ao vivo; precisa de `/reload-plugins` e de um hub novo.

## Ideias

Levantamento de 2026-11-24, feito a partir do app e das opções do Claude Code 2.1.332 (`claude --help`). ★ marca as mais úteis para o uso diário. Ainda não planejadas: viram item de "A fazer" quando o autor escolher. Quando o autor pedir as ideias de novo, devolver esta lista com as ★ e com os itens de "A fazer".

Sugestão de ordem: 1 e 2 (fecham o "fazer tudo sem terminal"), depois 16, 9 e 21.

### Sessões em segundo plano
1. ★ **Nova sessão pelo app:** botão "+" com a pasta (das já usadas), o nome, o modelo e o esforço. O hub roda `claude --bg -n <nome> --model … --effort … "/ai-chat-center:cc"`, e a sessão já nasce conectada.
2. ★ **Ver a tela da sessão no app:** `claude logs <id>` mostra a tela da sessão. Resolve `/status`, `/cost` e `/context`: depois do comando, o app mostra o trecho da tela.
3. **Parar, reiniciar e remover pelo menu ⋮:** `claude stop`, `claude respawn` (roda a versão nova do Claude Code depois de um update) e `claude rm`. Também limpar sessões paradas que sobraram.
4. **Lista de comandos ao digitar `/`** (ver "A fazer").
5. **Aviso de que o comando terminou** (ver "A fazer").
6. **Pergunta esperando resposta com `answers off`** (ver "A fazer").
7. **Trocar modelo e esforço pelo app:** `/model <nome>` e `/effort <nível>` levam argumento e funcionam pelo attach. Botões no cabeçalho.
8. **Sessão num worktree:** "nova sessão isolada" com `claude --bg -w <nome>`, para tarefas paralelas no mesmo projeto.

### Conversa
9. ★ **Busca:** dentro da conversa e entre todas as conversas, incluindo as encerradas.
10. **Exportar uma conversa** em Markdown ou PDF.
11. **Respostas rápidas:** botões com mensagens frequentes ("pode seguir", "faz o commit", "resume o que falta").
12. **Sugestão da próxima mensagem:** `--prompt-suggestions` nas sessões criadas pelo app.
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

- "Trabalhando" preso com tarefa em segundo plano: corrigido na 0.4.4; ainda não reapareceu.
- Atalhos: Windows aprovado (ver "Instalação mais fácil no Windows"); macOS ainda não testado (`docs/testing/launcher-windows-macos.md`).
- Anexos: testar numa sessão sem modo auto. Ler um anexo fora da pasta do projeto pode pedir permissão no terminal e travar quem usa só o app; se pedir, avaliar liberar `~/.ai-chat-center/attachments` na sessão ao dar `/cc`. Não há limite total de espaço por sessão, só a limpeza de 30 dias.
- Fundo por conversa: cores e opacidade do véu (76%) escolhidas sem ver na tela; ajustar olhando nos dois temas.
- 0.4.9, modo da sessão: confirmar que o Claude Code manda `permission_mode` nos hooks (prompt, notificação e Stop). A troca com Shift+Tab só aparece no próximo evento (prompt enviado ou fim do turno).
- 0.4.9, uso de 5 horas: `/ai-chat-center:cc usage on` troca a status line do `settings.json` por um wrapper que grava o uso e chama a status line anterior; `usage off` restaura. Conferir que a status line no terminal continua igual, que o rodapé da lista mostra o uso e que o `off` devolve o `settings.json` como era. Uma status line definida nas configurações do projeto ganha da do usuário, e aí o wrapper não roda.

- 0.5.0, sessões em segundo plano: retomar pelo app e comandos `/…` (`docs/testing/background-sessions.md`). Comandos no Windows ficam para depois (sem `script`; o node-pty traz ~30 MB); macOS não testado.

## Limites conhecidos (mexer só se atrapalharem)

- Se o navegador fecha sem avisar o hub (crash), o `/cc` não abre janela por até 150 s.
- Uma aba comum (ou do VS Code) com o app conta como janela aberta.
- O Chrome pode não trazer a janela para a frente (`window.focus()`).
- O atalho do Linux supõe Chrome com o perfil "Default" (`StartupWMClass`).

## Feito

- 0.4.2: uma única janela do app, atalho no menu do Linux, logo novo.
- 0.4.3: menos consultas ao `claude agents` com tudo parado.
- 0.4.4 a 0.4.7: "trabalhando" preso corrigido, rascunho por conversa, menu ⋮ com Renomear e Remover do app, atalhos do Windows e do macOS, manifesto do PWA, conversa em grupo com os agentes.
- 0.4.8: anexos (📎, arrastar, Ctrl+V), fundo por conversa, Fixar no topo e Desconectar no menu ⋮.
- 0.4.9: modo da sessão no cabeçalho da conversa, uso de 5 horas no rodapé da lista (`/ai-chat-center:cc usage on|off`), teste do `connectedAt` isolado.
- 0.4.10: app na própria janela por padrão (`/ai-chat-center:cc window off` desliga).
- 0.5.1: o Retomar não passa mais o `CLAUDE_CONFIG_DIR` padrão (o erro "Workspace not trusted" da 0.5.0); retomar e `/compact` pelo app confirmados ao vivo.
- 0.5.0: retomar pelo app uma sessão encerrada (em segundo plano) e rodar comandos `/…` nas sessões em segundo plano.
- PWA: o Chrome oferece "Instalar app" sem service worker (confirmado em 2026-11-24).
- Push da `main` para o origin (até a 0.4.10; os commits da 0.5.0 e da 0.5.1 ainda não foram enviados, a pedido do autor).

## Lembretes de processo

- Toda mudança em `plugin/dist` exige subir a versão (há um teste que compara com a última tag `v*`). Ver `docs/testing/release-checklist.md`.
- O push para o GitHub usa a conta `marcelod`.
