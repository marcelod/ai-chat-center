# Sessões em segundo plano: teste no uso (0.5.0)

Spec: `docs/superpowers/specs/2026-11-24-background-sessions-design.md`. Depois do `/plugin` → atualizar e `/reload-plugins`, rode um `/cc` para subir o hub novo.

Verificado ao vivo em 2026-11-24 (Linux, Claude Code 2.1.331): o módulo `src/hub/bgSessions.ts` retomou uma sessão parada (`ok: true`) e digitou `/rename` nela pelo `claude attach` (3,5 s; o nome mudou). Ainda falta o fluxo completo pelo app.

## Linux
- [ ] Feche o terminal de uma sessão conectada. Quando ela aparecer como encerrada, clique em **Retomar em segundo plano**: aparece "Retomando…", e em até ~15 s ela volta conectada, com `claude attach <id>` no cabeçalho.
- [ ] Mande uma mensagem normal: chega e a resposta aparece.
- [ ] Mande `/compact`: aparece "Comando /compact enviado." e, na conversa, o aviso de compactação.
- [ ] Mande `/compact` com a sessão trabalhando: "A sessão está ocupada…", e o texto volta para a caixa.
- [ ] Peça algo que precise de permissão: o aviso mostra `claude attach <id>`; rode no terminal e aprove por lá.
- [ ] Numa sessão aberta no terminal, digite `/compact`: aparece o aviso "chegaria como texto", e **Cancelar** não envia nada.
- [ ] Retomar uma sessão que você desconectou com `/cc off` mas que continua aberta no terminal: o app diz que ela ainda está aberta e não abre uma segunda cópia.
- [ ] Pasta sem confiança: o app mostra o erro do `claude --bg` ("Workspace not trusted").

### Nova sessão em qualquer pasta (0.6.2)
- [ ] No "+", **Procurar pastas…** abre na pasta pessoal; entrar, subir (desativado na pasta pessoal), caminho atual visível; **Usar esta pasta** coloca a pasta no topo da lista e fecha o navegador.
- [ ] Pastas ocultas só com "Mostrar pastas ocultas". Um link simbólico para fora da pasta pessoal não aparece.
- [ ] Colar um caminho e Enter: vai para a pasta (não inicia a sessão). `/etc` ou `/home/outra-pessoa`: "Só dá para usar pastas dentro da sua pasta pessoal."
- [ ] Iniciar numa pasta que já teve sessão e numa pasta nova **já confiada** no Claude Code: a sessão nasce conectada.
- [ ] Pasta nunca aberta no Claude Code (crie uma pasta vazia de teste): o app diz para abrir um terminal na pasta, rodar `claude` uma vez e aceitar a confiança. Confirme o texto exato do erro do `claude --bg` no log do hub (`isUntrustedError` em `src/hub/server.ts` procura "not trusted").
- [ ] Com `CLAUDE_CONFIG_DIR` próprio: uma pasta nova roda com a configuração padrão (`~/.claude`); só pastas com sessão anterior herdam o `CLAUDE_CONFIG_DIR` dela.

## macOS
- [ ] O mesmo roteiro. Atenção ao `/compact`: o `script` do macOS tem outra sintaxe (`script -q /dev/null claude attach <id>`), que não foi testada ao vivo.

## Windows
- [ ] Retomar funciona.
- [ ] `/compact` numa sessão em segundo plano: "Comandos pelo app ainda não funcionam no Windows."
