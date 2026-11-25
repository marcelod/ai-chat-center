# Pendências

Itens combinados e deixados para depois. Estado em 2026-11-24, versão 0.4.9. Só o autor usa o app por enquanto: priorizar o que atrapalha o uso diário.

## A fazer

### Comandos da sessão a partir do app

Rodar comandos como `/compact` e `/reload-plugins` pelo app.

- Limite conhecido: a mensagem do app chega à sessão como texto de hook, então um comando interno do Claude Code enviado assim não é executado (visto com `/compact` em 2026-11-24). É preciso outro caminho, por exemplo enviar as teclas ao terminal da sessão; investigar o que é viável no Linux, no Windows e no macOS.
- Comandos que a sessão consegue rodar pelo Bash ou por skills podem funcionar já pelo caminho atual.

### Retomar pelo app uma sessão encerrada

Hoje uma sessão sai do app quando o terminal dela fecha. Para continuar no dia seguinte pelo app, seria preciso abrir um terminal com `claude --resume <id>` a partir do app. Ligado aos atalhos do Windows e do macOS; rodada própria.

### Instalação mais fácil no Windows

Em avaliação pelo autor (2026-11-24).

No primeiro teste no Windows (2026-11-24), o atalho funcionou, mas a pessoa teve de instalar o Node, ajustar o PATH e fechar todos os VS Code e terminais antes de funcionar. Ideias: o `/cc` dizer claramente quando o Node não está no PATH que o Claude Code vê (e como corrigir); um guia curto de instalação no Windows; avaliar se os hooks podem achar o Node em locais comuns sem depender do PATH.

### Entrada por voz

Ideia antiga, ainda sem detalhes. Aguardando (2026-11-24).

### Memória dos waiters

Cada sessão conectada mantém um processo Node de cerca de 60 MB esperando mensagens (4 sessões ≈ 240 MB). Medir de novo e, se continuar assim, reduzir: exige mudar a forma de espera; rodada própria.

### Medir a CPU ao vivo

A queda esperada de consultas ao `claude agents` com tudo parado (de 12 para 2 por minuto, desde a 0.4.3) ainda não foi medida ao vivo; precisa de `/reload-plugins` e de um hub novo.

## A testar no uso

- "Trabalhando" preso com tarefa em segundo plano: corrigido na 0.4.4; ainda não reapareceu.
- Atalhos: Windows aprovado (ver "Instalação mais fácil no Windows"); macOS ainda não testado (`docs/testing/launcher-windows-macos.md`).
- Anexos: testar numa sessão sem modo auto. Ler um anexo fora da pasta do projeto pode pedir permissão no terminal e travar quem usa só o app; se pedir, avaliar liberar `~/.ai-chat-center/attachments` na sessão ao dar `/cc`. Não há limite total de espaço por sessão, só a limpeza de 30 dias.
- Fundo por conversa: cores e opacidade do véu (76%) escolhidas sem ver na tela; ajustar olhando nos dois temas.
- 0.4.9, modo da sessão: confirmar que o Claude Code manda `permission_mode` nos hooks (prompt, notificação e Stop). A troca com Shift+Tab só aparece no próximo evento (prompt enviado ou fim do turno).
- 0.4.9, uso de 5 horas: `/ai-chat-center:cc usage on` troca a status line do `settings.json` por um wrapper que grava o uso e chama a status line anterior; `usage off` restaura. Conferir que a status line no terminal continua igual, que o rodapé da lista mostra o uso e que o `off` devolve o `settings.json` como era. Uma status line definida nas configurações do projeto ganha da do usuário, e aí o wrapper não roda.

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
- PWA: o Chrome oferece "Instalar app" sem service worker (confirmado em 2026-11-24).
- Push da `main` para o origin.

## Lembretes de processo

- Toda mudança em `plugin/dist` exige subir a versão (há um teste que compara com a última tag `v*`). Ver `docs/testing/release-checklist.md`.
- O push para o GitHub usa a conta `marcelod`.
