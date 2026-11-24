# Pendências

Itens combinados e deixados para depois. Estado em 2026-11-24, versão 0.4.3.

## Uso do período de 5 horas (adiado: "depois pensamos melhor")

Mostrar no app o consumo do período de 5 h e quando ele reinicia.

- Só o JSON da status line do Claude Code traz esse dado, em `rate_limits.five_hour` (`used_percentage`, `resets_at`). Os hooks não recebem.
- Ideia proposta (ainda não aprovada): um script de status line do plugin grava esse valor para o hub, que o exibe no app. Isso afeta a status line que o usuário já usa, então precisa ser opcional e não pode substituir uma status line existente sem aviso.
- Falta decidir onde mostrar no app e se é por sessão ou global (o limite é da conta).

## PWA (opção C da rodada da janela)

Hoje `/ai-chat-center:cc window on` abre o app numa janela própria do navegador (`--app`). A 0.4.2 já trouxe o atalho no menu do Linux e os ícones do app; o PWA instalável (manifest, service worker, instalação no Windows e no macOS) segue para uma rodada própria.

## Manifesto de PWA

`ui/public/icons/icon-192.png` e `icon-maskable-512.png` já vão no plugin, mas nada os usa: falta o `manifest.webmanifest` (e um service worker mínimo) para o Chrome oferecer "Instalar app", inclusive no Windows e no macOS. Decidir: fazer o manifesto ou tirar esses dois ícones.

## Memória dos waiters

Cada sessão conectada mantém um processo Node de cerca de 60 MB esperando mensagens (4 sessões ≈ 240 MB). Reduzir exige mudar a forma de espera; rodada própria.

## Janela única, limites conhecidos

- Se o navegador fecha sem avisar o hub (crash), o `/cc` não abre janela por até 150 s.
- Uma aba comum (ou do VS Code) com o app conta como janela aberta.
- O Chrome pode não trazer a janela para a frente (`window.focus()`).
- O atalho do Linux supõe Chrome com o perfil "Default" (`StartupWMClass`).

## Melhorias do app (pedidas em 2026-11-24)

### Rascunho por conversa

Hoje, quando a pessoa escreve algo numa conversa, troca para outra e volta, o texto que não foi enviado se perde. O rascunho de cada conversa deve ser mantido até ser enviado ou apagado. Falta decidir se ele sobrevive a recarregar a página (localStorage) ou só à troca de conversa.

### Anexos: arquivos, imagens e área de transferência

Enviar arquivos e imagens pelo app, escolhendo o arquivo, arrastando para a caixa ou colando com Ctrl+V. Falta definir como o anexo chega à sessão: o hub grava o arquivo num diretório e a mensagem leva o caminho, já que o Claude lê imagens pelo caminho.

### Comandos da sessão a partir do app

Rodar comandos como `/compact` e `/reload-plugins` pelo app. Isto absorve a ideia anterior de "comandos rápidos na caixa de mensagem".

- Limite conhecido: a mensagem do app chega à sessão como texto de hook, então um comando interno do Claude Code enviado assim não é executado. Foi o que aconteceu com `/compact` em 2026-11-24. É preciso outro caminho, por exemplo enviar as teclas ao terminal da sessão; investigar o que é viável no Linux, no Windows e no macOS.
- Comandos que a sessão consegue rodar pelo Bash ou por skills podem funcionar já pelo caminho atual.

### Menu de ações da conversa

Trocar o lápis por um menu de três pontos verticais (⋮) com as ações da conversa:

- Renomear (o que o lápis faz hoje).
- Remover do app: some só do app; a sessão continua no terminal, e a pessoa pode seguir por lá.
- Outras ações possíveis: escolher o fundo (ver o item abaixo), fixar a conversa no topo, desconectar a sessão.

### Fundo por conversa

Cada conversa pode ter um fundo próprio: cor sólida, degradê ou imagem. Serve para identificar a conversa rapidamente e não confundir uma com a outra. O fundo é escolhido pelo menu de ações; manter o contraste do texto legível nos temas claro e escuro.

### Retomar pelo app uma sessão encerrada

Hoje uma sessão sai do app quando o terminal dela fecha. Para continuar no dia seguinte pelo app, seria preciso abrir um terminal com `claude --resume <id>` a partir do app. Pedido ligado ao atalho do Windows e do macOS (2026-11-24); rodada própria.

### Entrada por voz

Ideia antiga, ainda sem detalhes.

## Ajustes do uso no dia a dia

O usuário está testando o app em uso real; os ajustes que surgirem entram aqui.

Feito na 0.4.2: uma única janela do app, atalho no menu de aplicativos do Linux e o logo novo (dois "C" com "AI").

## Erros a corrigir

### App mostra "trabalhando" com a sessão parada (2026-11-24)

O app segue mostrando o indicador de digitação (os três pontos) depois que o Claude já terminou a resposta. No terminal, a sessão está ociosa, esperando o prompt.

- Caso visto: sessão "Escalas - MeetaOne". O terminal mostrava `Worked for 2m 56s · done 9:11 · 1 shell still running` e, logo depois, o `recap`.
- Suspeita, ainda não verificada: o shell em segundo plano que continua rodando. Talvez o Stop hook não dispare, ou dispare de outro jeito, enquanto há uma tarefa em background, e o hub não fique sabendo que o turno acabou. Também vale checar se o `recap` gera algum evento que o hub entende como trabalho novo.
- Para reproduzir: numa sessão conectada, pedir algo que deixe um comando com `run_in_background` rodando e ver se o app sai de "trabalhando" quando a resposta termina.

## Depois da revisão da 0.4.2 (2026-11-24)

- **Push para o origin:** a `main` local está à frente de `origin/main` (backlog + correções da 0.4.3). Push no fim do dia, com a conta `marcelod`.
- **Medir a CPU com a 0.4.3 rodando:** a queda esperada de consultas ao `claude agents` com tudo parado (de 12 para 2 por minuto) ainda não foi medida ao vivo; precisa de `/reload-plugins` e de um hub novo.
- **Teste fraco em `test/hub/provider.test.ts`:** no teste de sessão recém-conectada, a asserção da segunda sessão passa pela regra "pid vivo e não listado", não pela regra `connectedAt`. Ajustar o teste para isolar cada regra.

## Situação das entregas 0.4.4 a 0.4.7 (2026-11-24)

- "Trabalhando" preso com tarefa em segundo plano: corrigido; o usuário vai confirmar com o uso.
- Rascunho por conversa: aprovado.
- Menu ⋮ com "Remover do app": aprovado; a posição dos três pontos ainda vai ser ajustada.
- Atalho do Windows e do macOS, manifesto do PWA e ícone de 256: testar depois do push, com alguém usando Windows e macOS (`docs/testing/launcher-windows-macos.md`).
- Conversa em grupo (0.4.6 e 0.4.7): mensagens dos agentes com nome, iniciais e cor próprios; pedidos do Claude aos agentes como "Claude → agente".

## Entregas da 0.4.8 (2026-11-24), a testar

- Anexos (📎, arrastar, Ctrl+V; 20 MB por arquivo, 10 por mensagem). Ficam em `~/.ai-chat-center/attachments/<sid>/` e somem com a limpeza (30 dias ou sessão apagada).
  - Testar numa sessão sem modo auto: ler um anexo fora da pasta do projeto pode pedir permissão no terminal e travar quem usa só o app. Se pedir, avaliar liberar essa pasta na sessão ao dar `/cc`.
  - Sem limite total de espaço por sessão; só a limpeza de 30 dias.
- Fundo por conversa (8 cores, 6 degradês, imagem até 5 MB). Cores e opacidade do véu (76%) escolhidas sem ver na tela: ajustar olhando nos dois temas.
- Fixar no topo e Desconectar no menu ⋮.

## Lembretes de processo

- Toda mudança em `plugin/dist` exige subir a versão (há um teste que compara com a última tag `v*`). Ver `docs/testing/release-checklist.md`.
- O push para o GitHub usa a conta `marcelod`.
