# Abrir o app em janela própria — design

Data: 2026-11-23 · Status: aprovado pelo usuário (opção B)

**Decisão do usuário:** opção B. Uma configuração ligada uma vez no terminal faz todo `/ai-chat-center:cc` abrir o app sozinho numa janela própria do Chrome/Chromium/Edge (`--app`, sem abas nem barra de endereço); sem navegador compatível, fica o link como hoje. PWA instalável fica para uma rodada própria.
**Decisões do Claude (corrigíveis):** marcadas com *(decisão do Claude)*.

## 1. Intenção
O AI Chat Center deve parecer um app, não uma aba no meio de outras. A janela `--app` dá isso hoje, sem empacotar nada.

## 2. Comportamento
- `/ai-chat-center:cc window on` liga, `/ai-chat-center:cc window off` desliga (só pelo terminal, como `answers`; o app não muda isso). Salvo em `config.json` (`openWindow`, padrão `false`), vale para todas as sessões. A confirmação diz se um navegador compatível foi encontrado.
- Com a opção ligada, todo `/ai-chat-center:cc` que conecta (ou reconecta) abre a janela do app, além de mostrar o link, **a menos que o app já esteja aberto** (revisão de 2026-11-23, pedido do usuário: manter uma janela só). Nesse caso nenhuma janela nova abre e a página aberta seleciona a sessão do `/cc` (e tenta `window.focus()`, que o navegador pode ignorar).
- Como o hub sabe que há uma página aberta: o stream SSE não serve, porque uma página oculta o fecha. Cada página manda `POST /api/window {id}` (id aleatório de 16 bytes em hex, com o token) ao abrir, a cada 20 s e ao voltar a ficar visível, e `{id, closing: true}` com `keepalive` no `pagehide`. O hub guarda os ids só em memória (no máximo 20) e conta uma página como aberta por 150 s depois do último ping (o Chrome limita os timers de uma página oculta a cerca de um por minuto). Um hub reiniciado não conhece páginas antigas (que também perderam o token) e abre uma janela nova.
- `POST /api/pair-code` aceita o corpo opcional `{sessionId}`; com uma página aberta responde `{live: true}` sem emitir código e guarda `{seq, sessionId}`, que a resposta do próximo ping devolve como `focus`. A página ignora o `focus` que já existia quando ela abriu.
- Navegadores procurados, nesta ordem *(decisão do Claude)*: Linux — `google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser`, `microsoft-edge`, `microsoft-edge-stable` no `PATH`; macOS — `/Applications/Google Chrome.app`, `Chromium.app`, `Microsoft Edge.app` (executável dentro de `Contents/MacOS`); Windows — `chrome.exe` e `msedge.exe` em `%ProgramFiles%`, `%ProgramFiles(x86)%` e `%LOCALAPPDATA%`. O processo é iniciado desacoplado (sem shell, stdio ignorado, `unref`), e uma falha só é registrada no `hook.log`.

## 3. Segurança: o token não vai na linha de comando
*(decisão do Claude)* Um argumento de processo pode ser lido por outros usuários da máquina (`ps`, `/proc/<pid>/cmdline`). Por isso a janela não recebe o link com `#token=`: o hook pede ao hub um **código de pareamento** de uso único e abre `http://127.0.0.1:<porta>/#pair=<código>`.
- `POST /api/pair-code` (com o token, como as outras rotas) devolve `{code}`: 32 bytes aleatórios em hex, válido por **60 s**, uso único, no máximo 5 pendentes (o mais antigo sai).
- `POST /api/pair` com `{code}` (sem token, mas com a mesma checagem de `Origin`/`Host` e limite de corpo) devolve `{token}` se o código existe e não venceu, e o apaga; senão `400`. Códigos só em memória no hub.
- A UI, ao abrir com `#pair=`, limpa o fragmento, troca o código pelo token e segue como se tivesse vindo de `#token=`.

## 3b. Atalho no launcher (Linux) — revisão de 2026-11-23
**Decisão do usuário:** o ícone é um atalho que inicia o hub (não um PWA instalado pelo Chrome): um PWA aberto pelo ícone com o hub parado, ou sem um `/cc` recente, não teria hub nem token.
- `/cc window on` (com navegador encontrado) grava `~/.local/share/applications/ai-chat-center.desktop` (respeita `XDG_DATA_HOME`) e o ícone `icons/hicolor/512x512/apps/ai-chat-center.png`; `window off` apaga os dois. Todo `/cc` com a opção ligada regrava se mudou (pasta do plugin e Node mudam com atualizações). Só Linux nesta rodada.
- `Exec` roda `dist/open.mjs` com `process.execPath` do hook (nvm não está no PATH do launcher): `ensureHub` e depois a mesma abertura do `/cc` (código de pareamento; não abre se já há página aberta). Erros em `logs/launcher.log`.
- `StartupWMClass=chrome-127.0.0.1__-Default` *(decisão do Claude, a confirmar no uso)*: o app_id que o Chrome dá a `--app=http://127.0.0.1:<porta>/` no perfil Default, sem a porta. Assim o GNOME agrupa a janela sob o ícone e um clique nele traz a janela aberta.
- Uma página aberta também segura o hub contra a saída por ociosidade (`windows()` no hub).
- Logo: `assets/brand/logo.svg` (gerado por `scripts/brand-logo.py` a partir de `assets/brand/logo-original.png`), usado como favicon, no cabeçalho e nos ícones `ui/public/icons/`.

## 4. Fora do escopo
PWA/ícone no sistema; trazer a janela para a frente de forma garantida; abrir a janela sem `/cc`.

## 5. Deixado para quem implementar
Nomes internos; como a UI espera a troca antes da primeira chamada; textos `en`/`pt-BR`; testes de unidade (busca do navegador com `PATH`/arquivos falsos, códigos, rotas, UI) e um teste manual no Linux.
