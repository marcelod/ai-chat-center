# Rodada 0.6.0: nova sessão, comandos, modelo e esforço, busca: design

Data: 2026-11-25 · Status: implementado na 0.6.0 (branch `feat/app-batch`)

Pedido do autor: itens "Memória dos waiters" e as ideias 1, 4, 5, 7 e 9 do `docs/backlog.md`, um por vez.

## Memória dos waiters (só medição)
- Medido em 2026-11-25 (Node 24, Linux): cada waiter mostra cerca de 63 MB de RSS, mas só cerca de 13,5 MB são dele (`Private_Dirty`). Cerca de 45 MB são as páginas do binário do Node, compartilhadas entre todos os processos Node. Um Node vazio já ocupa 43 MB de RSS e 8 MB privados.
- `--max-semi-space-size=1`, `--max-old-space-size=16` e `--jitless` não mudaram nada relevante (menos de 0,5 MB).
- Conclusão: 4 waiters custam cerca de 55 MB a mais, não 250 MB. Reduzir de verdade exige um waiter que não seja Node (por exemplo `sh` + `curl` no Linux e no macOS), com a lógica de entrega levada para o hub. É uma mudança grande e fica para decisão do autor.

## Nova sessão pelo app
- Botão "+" na lista. Diálogo com a pasta (só as que já tiveram sessão: registrations e `claude agents`), o nome, o modelo e o esforço (opcionais).
- `GET /api/folders` lista as pastas. `POST /api/sessions` `{ cwd, name?, model?, effort? }` roda `claude --bg [-n nome] [--model m] [--effort e] "/ai-chat-center:cc"` na pasta, com o `CLAUDE_CONFIG_DIR` da última sessão daquela pasta (o padrão não é passado). Retorna 201 com o id curto lido da saída, 400 para pasta desconhecida ou valor inválido, e 502 com a saída do `claude --bg`.
- Validação: nome com letras, números, espaço e `. _ -` (até 60), modelo `[A-Za-z0-9._-]` (com `[1m]` opcional) e esforço em `low|medium|high|xhigh|max`. No Windows, a linha do shell só recebe esses valores (nome entre aspas).
- O app abre a conversa nova assim que ela conecta (pelo `bgId`).
- Verificado ao vivo: a sessão abriu, conectou sozinha e usou o esforço pedido.

## Lista de comandos ao digitar `/`
- Só em sessões em segundo plano. Catálogo em `ui/src/commands.ts`: `app` (aparece na lista e é enviado), `screen` (só desenha na tela) e `terminal` (abre menu ou precisa do terminal). `/model`, `/effort` e `/rename` sem argumento contam como `terminal`.
- Setas escolhem, Tab ou Enter completam, Enter no nome completo envia, Esc fecha. Um comando `screen` ou `terminal` não é enviado: o app diz para usar `claude attach <id>`. Comandos desconhecidos (skills, plugins) são enviados.

## Aviso de que o comando terminou
- `ui/src/useCommandProgress.ts`. `/compact` termina quando o resumo da compactação aparece na transcrição. Um comando que deixou a sessão ocupada termina quando ela fica parada de novo. Os outros contam como terminados 4 s depois de digitados. A conversa mostra "⏳ /x rodando…" e depois "✓ /x terminou · hora".

## Trocar modelo e esforço pelo app
- Dois seletores no cabeçalho das sessões em segundo plano. Eles digitam `/model <alias>` e `/effort <nível>`, só com a sessão parada.
- **Visto ao vivo:** o Claude Code 2.1.332 também salva a escolha como padrão das novas sessões (`model` e `effortLevel` no `~/.claude/settings.json`). O app avisa disso ao lado dos seletores e na lista de comandos.

## Busca
- Na lista: a caixa continua filtrando por nome e pasta e, a partir de 2 caracteres, também busca nas mensagens de todas as conversas da lista (`GET /api/search?q=`, até 5 por conversa e 50 no total, as mais novas primeiro, com espera de 300 ms após a última tecla). Clicar num resultado abre a conversa já buscando aquele texto.
- Na conversa: botão de lupa no cabeçalho. Mostra só as mensagens com o texto e a contagem; Esc fecha.
- A busca ignora maiúsculas e acentos e olha só o texto das mensagens (não as ferramentas).
