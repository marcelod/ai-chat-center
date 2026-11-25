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

## macOS
- [ ] O mesmo roteiro. Atenção ao `/compact`: o `script` do macOS tem outra sintaxe (`script -q /dev/null claude attach <id>`), que não foi testada ao vivo.

## Windows
- [ ] Retomar funciona.
- [ ] `/compact` numa sessão em segundo plano: "Comandos pelo app ainda não funcionam no Windows."
