# Layout, rodada 1 — design

Data: 2026-11-23 · Status: aguardando aprovação do usuário

**Decisões do usuário** (respondidas pelo cartão de múltipla escolha do app): direção visual "WhatsApp refinado"; mexer na lista de sessões, na caixa de mensagem e no visual geral; lista de sessões que recolhe e expande; renomear sessões; caixa de mensagem que cresce conforme se digita, até um limite; logo próprio usado também como favicon, conceito **B (arco-balão)** por enquanto (o usuário pode criar outro depois, inspirado no conceito C); comandos rápidos, ditado por voz e anexos ficam fora do MVP.
**Decisões do Claude (corrigíveis):** marcadas com *(decisão do Claude)*.

## 1. Intenção

O app é o lugar central das conversas com as sessões. Esta rodada deixa a tela mais confortável sem mudar a cara de chat: mais espaço para a conversa quando o usuário quiser, nomes de sessão que façam sentido para ele, digitação de textos longos sem rolar dentro de uma linha só, e uma identidade visual mínima (logo e favicon).

## 2. Objetivos e não-objetivos

**Objetivos**
1. **Recolher/expandir a lista de sessões** (desktop, `md` para cima). *(decisão do Claude)* Recolhida, a coluna vira uma faixa estreita (~72 px) com o avatar de cada sessão conectada e o ponto de status; clicar num avatar abre a conversa; um botão no topo alterna os dois modos. O estado fica salvo no navegador (`localStorage`, com try/catch). No celular nada muda (a lista e a conversa já são telas separadas).
2. **Renomear uma sessão.** *(decisão do Claude)* O nome novo vale só no AI Chat Center (não muda nada no Claude Code), fica guardado pelo hub por sessão e aparece em todas as abas. Renomeia-se pelo cabeçalho da conversa (clicar no nome ou num ícone de lápis, editar no lugar, Enter salva, Esc cancela); nome vazio volta ao nome original. Limite de 80 caracteres.
3. **Caixa de mensagem que cresce** conforme as linhas aumentam, até **8 linhas**; depois disso rola. Ao enviar, volta a uma linha.
4. **Logo B** (arco invertido que termina num "rabinho" de balão, com "AI" no centro, na cor de destaque do app) no topo da lista de sessões, ao lado do nome "AI Chat Center", e como **favicon** (SVG, mais um PNG 32×32 de reserva).

**Não-objetivos:** comandos rápidos, ditado por voz, anexar imagens, temas novos, reorganizar/agrupar sessões, abrir o app como janela própria (item separado).

## 3. Restrições

- Mesmo stack (React 19 + Tailwind v4, tokens de cor existentes), claro e escuro, acessível (botões com rótulo, foco visível, alvos de 44 px).
- O nome personalizado passa pelo mesmo controle de acesso do hub (token, `Origin`/`Host`), é validado (texto, 1–80 caracteres sem espaços nas pontas) e nunca vira nome de arquivo.
- Textos em `en` e `pt-BR`.
- Mudanças na UI e no hub exigem subir a versão (teste de `plugin/dist` × tag).

## 4. Abordagens consideradas

- **Nome personalizado só no navegador (`localStorage`):** simples, mas some em outra aba/navegador e não acompanha o app no futuro como janela própria. Descartada.
- **Nome personalizado no hub (escolhida):** um arquivo por sessão (ou um mapa) no estado do AI Chat Center, exposto na `SessionView` como o nome exibido; endpoint autenticado para mudar.
- **Recolher a lista totalmente (sem faixa):** mais espaço, mas perde o acesso rápido às sessões e o status. Preferida a faixa estreita.

## 5. Deixado para quem implementar

- Formato exato do armazenamento do nome e do endpoint (`PUT /api/sessions/:sid/name` com `{name}`, `name: ""` limpa).
- Medição da altura do campo (por `scrollHeight` ou `field-sizing: content` com fallback).
- Arquivos do logo (`ui/public/` ou importados), `<link rel="icon">` no `ui/index.html`.
- Testes de UI (alternar a lista, persistência; renomear: salvar, cancelar, limpar, erro; campo: cresce até 8 linhas e volta ao enviar) e do hub (endpoint e validação).
