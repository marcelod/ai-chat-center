# Atalho do app no Windows e no macOS, e manifesto — design

Data: 2026-11-24 · Status: caminho A escolhido pelo usuário; aguardando aprovação deste documento

**Decisão do usuário:** caminho A. Um atalho de verdade em cada sistema (como o do Linux da 0.4.2) roda o `open.mjs`, que liga o hub se preciso e abre a janela do app autenticada; mais um manifesto que usa os ícones 192 e 512 já empacotados.
**Decisões do Claude (corrigíveis):** marcadas com *(decisão do Claude)*.

## 1. Intenção

O usuário quer abrir o app no dia a dia por um ícone, como um programa, e ver ali as sessões ativas para continuar o trabalho: tudo num lugar só. No Linux isso já existe (`~/.local/share/applications/ai-chat-center.desktop`). Falta o mesmo no Windows e no macOS.

Um PWA instalado pelo Chrome não resolve sozinho: ele abre `http://127.0.0.1:7777/` mas não liga o hub (que desliga após 2 h sem uso) nem recebe o código de pareamento, então cai na tela "sem token". Por isso o atalho roda o `open.mjs`, que já faz as duas coisas.

## 2. Objetivos, não objetivos, antiobjetivos

- **Objetivo:** com `/ai-chat-center:cc window on`, o Windows ganha "AI Chat Center" no menu Iniciar e o macOS ganha `AI Chat Center.app` em `~/Applications` (Launchpad, Spotlight, pode ir para o Dock). Clicar abre o app pronto, com ou sem hub rodando; se a janela já está aberta, nada novo abre (comportamento atual do `open.mjs`).
- **Objetivo:** `manifest.webmanifest` com nome, cores e os ícones `icon-192.png`, `icon-512.png` e `icon-maskable-512.png`, ligado no `index.html`. Os ícones deixam de ser peso morto.
- **Não objetivo:** service worker, modo offline, botão "Instalar" próprio no app. Sem service worker o Chrome atual ainda pode oferecer "Instalar"; isso fica tolerado, não incentivado (o ícone instalado assim tem as limitações do §1).
- **Não objetivo:** retomar pelo app uma sessão cujo terminal foi fechado (`claude --resume`). Vai para `docs/backlog.md` como item próprio.
- **Antiobjetivo:** o token na linha de comando do atalho, num arquivo do atalho ou em qualquer lugar legível por outro processo. O atalho só aponta para `node` e `open.mjs`; a autenticação continua pelo código de uso único.
- **Antiobjetivo:** uma janela de console que fica aberta no Windows a cada clique.

## 3. Comportamento

- `/ai-chat-center:cc window on` cria o atalho do sistema atual; `window off` remove; todo `/cc` com a opção ligada o atualiza (a pasta do plugin e o caminho do Node mudam com atualizações), como no Linux hoje. A interface `ctx.launcher.install/remove` do `hook.ts` não muda: `installLauncher`/`removeLauncher` passam a despachar por plataforma e devolvem `true` também no Windows e no macOS.
- A confirmação de `window on` que hoje fala do atalho do Linux passa a valer para os três sistemas (texto ajustado nas duas línguas).

### 3.1 Windows

- Arquivo: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\AI Chat Center.lnk`. Ícone: `%LOCALAPPDATA%\ai-chat-center\ai-chat-center.ico` *(decisão do Claude: fora da pasta do plugin, que muda a cada versão)*.
- Destino do atalho: o `node.exe` que roda o hook (`process.execPath`), argumento `"<dist>\open.mjs"`, pasta de trabalho `<dist>`, janela **minimizada** (`WindowStyle = 7`) *(decisão do Claude: o console aparece minimizado por um instante na barra de tarefas e some quando o `open.mjs` termina, em menos de 1 s com o hub no ar. As alternativas foram descartadas: um `.vbs` com `wscript.exe` esconde tudo, mas o VBScript está sendo removido do Windows; `conhost --headless` não existe em versões mais antigas do Windows 10)*.
- Criação do `.lnk`: `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command <script fixo>` com `WScript.Shell.CreateShortcut`. Os caminhos vão por variáveis de ambiente do processo filho, nunca interpolados no script (sem injeção por caminho com aspas). Sem shell, `windowsHide: true`, tempo limite de 10 s. Falha só é registrada no log; nunca quebra o hook.
- O `.ico` é gerado em código: um ICO com uma imagem PNG embutida de 256×256 (formato aceito desde o Windows Vista). Precisa de `icon-256.png`, gerado uma vez a partir do `logo.svg` (como os outros ícones), versionado em `ui/public/icons/` *(decisão do Claude: o build não ganha dependência para desenhar o SVG)* e empacotado em `plugin/dist/ui/icons/`.
- Para não rodar o PowerShell a cada `/cc` (centenas de ms): um carimbo `%LOCALAPPDATA%\ai-chat-center\launcher.json` com `{node, openScript, icon, comment}`. Recria o `.lnk` só se ele não existe ou o carimbo mudou. O `.ico` usa a mesma escrita "só se mudou" do Linux.
- `window off`: apaga o `.lnk`, o `.ico` e o carimbo.

### 3.2 macOS

- Pacote: `~/Applications/AI Chat Center.app` *(decisão do Claude: `~/Applications` não pede senha de administrador e aparece no Launchpad e no Spotlight)*.
  - `Contents/Info.plist`: `CFBundleName`/`CFBundleDisplayName` "AI Chat Center", `CFBundleIdentifier` `com.ai-chat-center.launcher`, `CFBundleExecutable` `ai-chat-center`, `CFBundleIconFile` `icon`, `CFBundlePackageType` `APPL`, `LSUIElement` `true` *(decisão do Claude: o script não ganha ícone próprio pulando no Dock; quem aparece no Dock é a janela do Chrome)*.
  - `Contents/MacOS/ai-chat-center`: `#!/bin/sh` + `exec "<node>" "<dist>/open.mjs"`, com os caminhos em aspas simples escapadas, modo 0755.
  - `Contents/Resources/icon.icns`: gerado em código, um ICNS com PNG embutido (`ic09`, 512×512, a partir de `icon-512.png`).
- Escrita "só se mudou" arquivo a arquivo, atômica (como no Linux). Sem assinatura: um app criado localmente não recebe o atributo de quarentena, então o Gatekeeper não bloqueia.
- `window off`: apaga o pacote inteiro, mas só se o `Info.plist` tiver o nosso `CFBundleIdentifier` (nunca apagar um `.app` de outra origem com o mesmo nome).

### 3.3 Manifesto

- `ui/public/manifest.webmanifest`: `name` "AI Chat Center", `short_name` "AI Chat", `start_url` "/", `scope` "/", `display` "standalone", `background_color` e `theme_color` tirados das cores do tema escuro do app, `icons` 192 (`any`), 512 (`any`) e maskable 512 (`maskable`).
- `index.html`: `<link rel="manifest" href="/manifest.webmanifest">` e `<meta name="theme-color">`.
- Hub: `MIME['.webmanifest'] = 'application/manifest+json'`. A CSP atual já permite (`default-src 'self'` cobre `manifest-src`).

## 4. Restrições

- Node 18+, sem dependências novas; o build continua reproduzível.
- Mudou `plugin/dist`, sobe a versão (0.4.4) em todos os arquivos de versão.
- Os testes rodam no Linux: todo código de Windows e de macOS recebe plataforma, `env`, `home`, `spawn` e o sistema de arquivos por injeção, e os testes verificam os arquivos gerados (bytes do ICO/ICNS, `Info.plist`, script, carimbo) e os argumentos e o ambiente passados ao PowerShell.
- O teste real nos dois sistemas fica com o usuário: um roteiro curto em `docs/testing/` (ligar, clicar com hub desligado e ligado, atualizar o plugin, desligar).

## 5. Limites conhecidos

- No macOS, a janela `--app` aparece no Dock com o ícone do Chrome (ou de um "app shim" do Chrome), não com o nosso. No Windows, o ícone da janela na barra de tarefas vem da página (favicon e manifesto).
- Se o Node mudar de lugar (nvm, atualização) o atalho só se corrige no próximo `/cc`, como no Linux.
- Um `AI_CHAT_CENTER_HOME` personalizado no terminal não chega ao atalho aberto pelo menu Iniciar ou pelo Finder (mesmo limite do Linux); o roteiro de teste avisa.

## 6. Fica para quem implementar

Nomes internos, a divisão em arquivos (sugestão: `launcher.ts` despacha para `launcherWin.ts` e `launcherMac.ts`), o texto exato das mensagens, e as cores exatas do manifesto dentro do tema.
