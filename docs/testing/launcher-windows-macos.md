# Roteiro: atalho do app no Windows e no macOS

Teste manual do atalho criado por `/ai-chat-center:cc window on` (spec `docs/superpowers/specs/2026-11-24-launcher-windows-macos-design.md`). Os testes automáticos só rodam no Linux; este roteiro cobre o que eles não alcançam. Marque cada item com PASS, FAIL ou SKIPPED e anote o que viu. Se algo falhar, mande o conteúdo de `logs/hook.log` e `logs/launcher.log` da pasta `~/.ai-chat-center` (no Windows, `%USERPROFILE%\.ai-chat-center\logs`), **sem o token**.

Antes de começar: Chrome, Chromium ou Edge instalado; Node.js no `PATH`; o plugin na versão com este recurso (0.4.4 ou mais nova). Não defina `AI_CHAT_CENTER_HOME` no terminal: o atalho, aberto pelo menu Iniciar ou pelo Finder, não herda variáveis do terminal e usaria outra pasta (limite conhecido).

Para parar o hub entre os passos:

- Windows (PowerShell):
  ```powershell
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object CommandLine -like '*hub.mjs*' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  ```
- macOS (Terminal): `pkill -f hub.mjs`

## Windows (10 ou 11)

- [ ] **W1. Ligar.** Numa sessão do Claude Code, rode `/ai-chat-center:cc window on`. A resposta diz que o atalho foi adicionado. Existem:
  - `%APPDATA%\Microsoft\Windows\Start Menu\Programs\AI Chat Center.lnk`
  - `%LOCALAPPDATA%\ai-chat-center\ai-chat-center.ico` e `launcher.json`

  "AI Chat Center" aparece no menu Iniciar (busque por "AI Chat") com o ícone do app. Nas propriedades do atalho: Destino é o `node.exe` seguido de `"...\dist\open.mjs"`, "Executar" está como **Minimizada**, e nenhum campo contém o token (compare com o arquivo `token`).
- [ ] **W2. Clicar com o hub desligado.** Pare o hub. Clique no atalho. Um console aparece no máximo minimizado na barra de tarefas, por um instante, e some; nenhuma janela preta fica aberta. A janela do app abre já autenticada (sem a tela "sem token") e lista as sessões.
- [ ] **W3. Clicar com o hub ligado e a janela aberta.** Clique de novo. Nenhuma janela nova abre (a existente continua). Feche a janela do app e clique: ela abre de novo, autenticada.
- [ ] **W4. Rapidez do `/cc`.** Com a opção ligada, rode `/ai-chat-center:cc` duas vezes. A data de modificação do `.lnk` não muda na segunda vez (o PowerShell só roda quando algo mudou).
- [ ] **W5. Atualizar o plugin.** Atualize o plugin para uma versão nova (ou rode com outra pasta via `--plugin-dir`) e rode `/ai-chat-center:cc`. O Destino do atalho passa a apontar para a pasta nova; clicar continua funcionando.
- [ ] **W6. Desligar.** `/ai-chat-center:cc window off`. O `.lnk`, o `.ico` e o `launcher.json` somem; "AI Chat Center" sai do menu Iniciar.

## macOS

- [ ] **M1. Ligar.** `/ai-chat-center:cc window on`. A resposta diz que o atalho foi adicionado. Existe `~/Applications/AI Chat Center.app`; ele aparece no Launchpad e no Spotlight (busque "AI Chat Center") com o ícone do app. Confira que o token não está no pacote:
  ```sh
  grep -r "$(cat ~/.ai-chat-center/token)" ~/Applications/"AI Chat Center.app" && echo FALHOU || echo ok
  ```
- [ ] **M2. Clicar com o hub desligado.** `pkill -f hub.mjs`, depois abra o app pelo Launchpad ou pelo Finder. Nenhum aviso do Gatekeeper; o atalho não fica pulando no Dock; a janela do app abre autenticada e lista as sessões. (No Dock a janela aparece com o ícone do Chrome: limite conhecido.)
- [ ] **M3. Clicar com o hub ligado e a janela aberta.** Clique de novo: nenhuma janela nova. Feche a janela do app e clique: ela abre de novo, autenticada.
- [ ] **M4. Arrastar para o Dock.** Arraste `AI Chat Center.app` para o Dock e abra por ali: funciona como M2.
- [ ] **M5. Atualizar o plugin.** Atualize o plugin e rode `/ai-chat-center:cc`. `cat ~/Applications/"AI Chat Center.app"/Contents/MacOS/ai-chat-center` mostra a pasta nova; clicar continua funcionando.
- [ ] **M6. Desligar.** `/ai-chat-center:cc window off`. O pacote some de `~/Applications`.
- [ ] **M7. App de mesmo nome que não é nosso (opcional).** Crie `~/Applications/AI Chat Center.app` com outro conteúdo (por exemplo, copie qualquer `.app`, renomeie e confira que o `Info.plist` tem outro `CFBundleIdentifier`). `window on` e `window off` não mexem nele; `logs/hook.log` diz que ele não é nosso.

## Os dois sistemas: manifesto

- [ ] **P1.** Com a janela do app aberta, abra as ferramentas do desenvolvedor (F12) → Application → Manifest: nome "AI Chat Center", ícones 192, 512 e maskable carregados, sem erros.
