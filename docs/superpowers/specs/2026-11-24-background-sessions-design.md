# Retomar sessões e rodar comandos pelo app (sessões em segundo plano): design

Data: 2026-11-24 · Status: aguardando aprovação do usuário

Itens 1 e 2 do `docs/backlog.md`, feitos juntos (decisão do usuário: pelo caminho oficial das sessões em segundo plano do Claude Code).

## Intenção
- **Retomar**: continuar pelo app uma sessão cujo terminal fechou, sem abrir terminal.
- **Comandos**: rodar `/compact`, `/reload-plugins`, `/rename` e afins pelo app.

## Por que sessões em segundo plano
A mensagem do app chega como texto de hook, então um comando interno não roda. "Digitar" no terminal da pessoa também não dá: no Linux dela (GNOME Terminal no Wayland) o kernel desliga o TIOCSTI (`dev.tty.legacy_tiocsti = 0`), não há tmux, e xdotool/ydotool não funcionam ou exigem root. O Claude Code tem um caminho oficial: `claude --bg` roda a sessão num serviço próprio, `claude attach <id>` abre essa sessão num terminal, e `claude agents --json` lista a sessão com `kind: "background"` e um `id` curto.

## Verificado ao vivo (2026-11-24, Claude Code 2.1.331, Linux)
1. `claude --bg --resume <sessionId> "/ai-chat-center:cc"` retoma uma sessão parada com o mesmo `sessionId`, roda o `/cc` e a sessão volta conectada ao app, com um novo `pid` na registration.
2. `claude attach <id>` num pseudo-terminal (node-pty ou `script -qfec "claude attach <id>" /dev/null`) aceita texto digitado: `/rename cc-teste` rodou e o nome mudou no `claude agents`.
3. Matar o processo do attach não encerra a sessão (ela continua `idle` no `claude agents`).
4. `claude --bg` numa pasta sem confiança falha com "Workspace not trusted". Pastas onde a pessoa já usou o Claude Code são confiáveis.

## Comportamento

### Retomar (item 2)
- Uma conversa encerrada (`exited`, `off` ou `clear`, ainda não removida) ganha o botão **Retomar** no cabeçalho e no menu ⋮.
- Ao clicar, o hub roda `claude --bg --resume <sessionId> "/ai-chat-center:cc"` na `cwd` da registration, com `CLAUDE_CONFIG_DIR` igual ao `configDir` dela, desligado do hub (`detached`, `unref`). O app mostra "Retomando…" até a sessão voltar ativa. Se ela não voltar em 60 s, o app mostra a saída de erro do comando (por exemplo, "Workspace not trusted").
- O `/cc` passa pelo hook como se a pessoa o digitasse, o que mantém o modelo de confiança atual: chave nova, contexto "AI Chat Center: connected". *(Decisão do Claude: não criar outro caminho de registro.)*
- O `/cc` rodado numa sessão em segundo plano não abre a janela do app *(decisão do Claude)*: quem clicou já está no app. O hook sabe disso por uma variável de ambiente que o hub passa ao `claude --bg` (`AI_CHAT_CENTER_NO_WINDOW=1`).
- A sessão retomada fica em segundo plano. Para vê-la no terminal: `claude attach <id>`. O app mostra esse comando no cabeçalho, com botão de copiar.
- Sessão ainda ativa num terminal: o botão não aparece. Duas instâncias da mesma conversa não podem rodar ao mesmo tempo.

### Comandos (item 1)
- Em sessões em segundo plano (`kind: "background"` no `claude agents`), uma mensagem que começa com `/` vai pelo attach e não pela fila do waiter. O hub abre `claude attach <id>` num pseudo-terminal, espera o prompt aparecer, digita o texto e Enter, espera 2 s e fecha o attach.
- Só com a sessão parada (`status: "idle"`). Ocupada ou esperando permissão: o hub responde 409 e o app diz "A sessão está ocupada; tente quando ela terminar". *(Decisão do Claude: um comando digitado no meio de um turno entra na fila do Claude Code de um jeito que o app não acompanha.)*
- Em sessões interativas (terminal da pessoa), uma mensagem começando com `/` mostra um aviso antes de enviar: "Comandos do Claude Code só rodam em sessões em segundo plano. Enviar como texto mesmo assim?". *(Decisão do Claude: skills que a sessão roda sozinha ainda podem servir como texto.)*
- O resultado aparece na conversa como hoje, pela transcrição. Comandos que só mudam a tela (`/status`, `/cost`) não deixam nada na transcrição: o app mostra "Comando enviado" e mais nada.
- Pseudo-terminal: `script` no Linux (`script -qfec CMD /dev/null`) e no macOS (`script -q /dev/null claude attach <id>`), sem dependência nativa. **Windows fica fora desta rodada** para comandos: não existe `script`, e o node-pty traz cerca de 30 MB de binários. O app diz "Ainda não disponível no Windows". O retomar funciona no Windows.

### Permissões numa sessão em segundo plano
Um pedido de permissão para a sessão, e não há terminal aberto. O app já mostra "esperando permissão" (Notification hook). O aviso passa a incluir o comando `claude attach <id>` para responder no terminal. *(O app nunca responde permissões; continua assim.)*

## Hub
- `SessionView` ganha `background?: { id: string }`, a partir do `claude agents --json` que o provider já lê.
- `POST /api/sessions/<sid>/resume`: 404 para sessão desconhecida ou removida, 409 se ativa, 202 ao iniciar. A saída de erro do `claude --bg` fica guardada por 60 s e aparece em `SessionView.resumeError?`.
- `POST /api/sessions/<sid>/command` com `{ text }`: `text` precisa começar com `/`, ter uma linha só e no máximo 200 caracteres. 404 se a sessão não estiver em segundo plano, 409 se ela não estiver `idle`, 501 no Windows, 200 depois de digitar. Um comando por sessão de cada vez (lock).
- As duas rotas usam o mesmo token e a mesma checagem de origem das outras. Só chamam o `claude` com argumentos em array (`execFile`/`spawn`, sem shell). O `script` recebe uma linha de comando montada só com o `id` curto validado (`/^[0-9a-f]{8}$/`).

## Riscos
- `claude attach` e a saída do `--bg` não são uma API estável. Se o formato mudar, o app mostra o erro e não fica preso. Todo o contato fica em `src/hub/background.ts`.
- Reconhecer o prompt pronto no attach: esperar o caractere `❯` na saída, com prazo de 10 s, senão desistir com erro.
- macOS: a sintaxe do `script` não foi testada ao vivo; entra no checklist de teste.

## Testes
Hub, com `claude` e `script` falsos injetados: retomar (202, 409 ativa, 404 removida, erro do comando aparece), comando (validação do texto, 409 ocupada, 404 interativa, 501 Windows, lock), `background.id` na `SessionView`. Hook: `AI_CHAT_CENTER_NO_WINDOW=1` não abre janela. UI: botão Retomar só em encerradas, "Retomando…", aviso do `/` em sessão interativa, comando de attach copiável. Ao vivo (checklist): retomar uma sessão real, `/compact` pelo app, permissão em segundo plano, macOS.
