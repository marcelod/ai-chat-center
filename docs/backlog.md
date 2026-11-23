# Pendências

Itens combinados e deixados para depois. Estado em 2026-11-23, versão 0.4.0.

## Uso do período de 5 horas (adiado: "depois pensamos melhor")

Mostrar no app o consumo do período de 5 h e quando ele reinicia.

- Só o JSON da status line do Claude Code traz esse dado, em `rate_limits.five_hour` (`used_percentage`, `resets_at`). Os hooks não recebem.
- Ideia proposta (ainda não aprovada): um script de status line do plugin grava esse valor para o hub, que o exibe no app. Isso afeta a status line que o usuário já usa, então precisa ser opcional e não pode substituir uma status line existente sem aviso.
- Falta decidir onde mostrar no app e se é por sessão ou global (o limite é da conta).

## PWA (opção C da rodada da janela)

Hoje `/ai-chat-center:cc window on` abre o app numa janela própria do navegador (`--app`). A opção de PWA instalável (ícone no sistema, manifest, service worker) ficou para uma rodada própria.

## Logo próprio

O logo atual é a opção B. O usuário pode criar um logo próprio, baseado em dois "C" (Chat Center) com "AI" no meio, e substituir `ui/src/components/Logo.tsx` e os favicons em `ui/public/`.

## Layout, ideias para o futuro

- Comandos rápidos na caixa de mensagem.
- Entrada por voz.

## Ajustes do teste da 0.4.0

O usuário está testando a 0.4.0 com a janela do app; os ajustes que surgirem entram aqui.

## Lembretes de processo

- Toda mudança em `plugin/dist` exige subir a versão (há um teste que compara com a última tag `v*`). Ver `docs/testing/release-checklist.md`.
- O push para o GitHub usa a conta `marcelod`.
