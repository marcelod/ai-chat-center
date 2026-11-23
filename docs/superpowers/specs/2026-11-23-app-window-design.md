# Abrir o app em janela própria — design

Data: 2026-11-23 · Status: aprovado pelo usuário (opção B)

**Decisão do usuário:** opção B. Uma configuração ligada uma vez no terminal faz todo `/ai-chat-center:cc` abrir o app sozinho numa janela própria do Chrome/Chromium/Edge (`--app`, sem abas nem barra de endereço); sem navegador compatível, fica o link como hoje. PWA instalável fica para uma rodada própria.
**Decisões do Claude (corrigíveis):** marcadas com *(decisão do Claude)*.

## 1. Intenção
O AI Chat Center deve parecer um app, não uma aba no meio de outras. A janela `--app` dá isso hoje, sem empacotar nada.

## 2. Comportamento
- `/ai-chat-center:cc window on` liga, `/ai-chat-center:cc window off` desliga (só pelo terminal, como `answers`; o app não muda isso). Salvo em `config.json` (`openWindow`, padrão `false`), vale para todas as sessões. A confirmação diz se um navegador compatível foi encontrado.
- Com a opção ligada, todo `/ai-chat-center:cc` que conecta (ou reconecta) abre uma janela nova do app, além de mostrar o link. *(decisão do Claude)* Sempre abre uma janela (não tenta reaproveitar uma já aberta): o Chrome não oferece isso de forma confiável, e o link novo traz o token atual.
- Navegadores procurados, nesta ordem *(decisão do Claude)*: Linux — `google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser`, `microsoft-edge`, `microsoft-edge-stable` no `PATH`; macOS — `/Applications/Google Chrome.app`, `Chromium.app`, `Microsoft Edge.app` (executável dentro de `Contents/MacOS`); Windows — `chrome.exe` e `msedge.exe` em `%ProgramFiles%`, `%ProgramFiles(x86)%` e `%LOCALAPPDATA%`. O processo é iniciado desacoplado (sem shell, stdio ignorado, `unref`), e uma falha só é registrada no `hook.log`.

## 3. Segurança: o token não vai na linha de comando
*(decisão do Claude)* Um argumento de processo pode ser lido por outros usuários da máquina (`ps`, `/proc/<pid>/cmdline`). Por isso a janela não recebe o link com `#token=`: o hook pede ao hub um **código de pareamento** de uso único e abre `http://127.0.0.1:<porta>/#pair=<código>`.
- `POST /api/pair-code` (com o token, como as outras rotas) devolve `{code}`: 32 bytes aleatórios em hex, válido por **60 s**, uso único, no máximo 5 pendentes (o mais antigo sai).
- `POST /api/pair` com `{code}` (sem token, mas com a mesma checagem de `Origin`/`Host` e limite de corpo) devolve `{token}` se o código existe e não venceu, e o apaga; senão `400`. Códigos só em memória no hub.
- A UI, ao abrir com `#pair=`, limpa o fragmento, troca o código pelo token e segue como se tivesse vindo de `#token=`.

## 4. Fora do escopo
PWA/ícone no sistema; reaproveitar uma janela já aberta; abrir a janela sem `/cc`.

## 5. Deixado para quem implementar
Nomes internos; como a UI espera a troca antes da primeira chamada; textos `en`/`pt-BR`; testes de unidade (busca do navegador com `PATH`/arquivos falsos, códigos, rotas, UI) e um teste manual no Linux.
