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

## Layout, ideias para o futuro

- Comandos rápidos na caixa de mensagem.
- Entrada por voz.

## Ajustes do uso no dia a dia

O usuário está testando o app em uso real; os ajustes que surgirem entram aqui.

Feito na 0.4.2: uma única janela do app, atalho no menu de aplicativos do Linux e o logo novo (dois "C" com "AI").

## Lembretes de processo

- Toda mudança em `plugin/dist` exige subir a versão (há um teste que compara com a última tag `v*`). Ver `docs/testing/release-checklist.md`.
- O push para o GitHub usa a conta `marcelod`.
