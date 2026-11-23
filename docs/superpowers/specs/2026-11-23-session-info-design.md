# Branch, modelo e nível de raciocínio no app — design

Data: 2026-11-23 · Status: aprovado pelo usuário (itens 1–3; o uso do período de 5 h fica para depois)

**Decisão do usuário:** mostrar no app, por sessão, (1) a branch atual do git, mudando assim que ela muda; (2) o modelo em uso; (3) o nível de raciocínio (`effort`).
**Decisões do Claude (corrigíveis):** marcadas com *(decisão do Claude)*.

## Fontes
1. **Branch** *(decisão do Claude)*: o hub lê o `HEAD` do repositório da pasta da sessão a cada atualização da lista (leitura de arquivo, sem rodar `git`): sobe da pasta (`cwd`) até achar `.git`; se `.git` for um arquivo (worktree), segue o `gitdir:`; `ref: refs/heads/<nome>` → `<nome>`; HEAD destacado → os 7 primeiros caracteres do hash. Sem repositório → nada. Assim a troca aparece em segundos, sem esperar uma mensagem.
2. **Modelo:** o campo `message.model` da última resposta do assistente na transcrição. Exibido de forma curta *(decisão do Claude)*: `claude-opus-5-5` → "Opus 5.5", `claude-sonnet-5-5` → "Sonnet 5.5"; ids fora desse padrão aparecem como vieram. Um `/model` aparece a partir da próxima resposta.
3. **Nível de raciocínio:** o hook `prompt-submit` grava `input.effort.level` (quando o Claude Code o envia) junto da sessão a cada prompt. Um `/effort` aparece a partir do próximo prompt.

## Exibição *(decisão do Claude)*
No cabeçalho da conversa, a linha de baixo (hoje só a pasta) vira: `pasta · ⎇ branch · Opus 5.5 · 🧠 high`, cada parte só quando existe, truncando a pasta primeiro. Nada muda na lista de sessões.

## Fora do escopo
Uso do período de 5 h; status sujo do git (arquivos modificados).

## Deixado para quem implementar
Onde guardar o `effort` (arquivo por sessão, como `names`); campos novos na `SessionView` (`branch?`, `model?`, `effort?`) e no sinal de mudança do `poll`; ícones; testes.
