# Menu ⋮ da conversa e "Remover do app" — design curto

Data: 2026-11-24 · Status: aguardando aprovação do usuário

## Intenção
Criar o lugar das ações da conversa (próximas: fundo, fixar) e a primeira ação nova: tirar a sessão do app.

## Comportamento
- No topo da conversa, o lápis vira um botão ⋮ (rótulo acessível "Ações da conversa") que abre um menu com **Renomear** (faz o que o lápis faz hoje) e **Remover do app**.
- **Remover do app** (decisão do usuário): desconecta o AI Chat Center daquela sessão do Claude Code; a sessão continua normal no terminal.
  - Sessão ativa: fica desconectada como num `/cc off` (motivo novo `removed`): o waiter para, mensagens na fila são descartadas, nada mais é entregue. Um `/cc` no terminal reconecta e ela volta ao app.
  - Sessão já encerrada (`exited`, `off`, `clear`): só some da lista.
  - Em ambos os casos a conversa some da lista do app *(decisão do Claude: a sessão removida não aparece nem como "desconectada")*, e o app seleciona outra conversa.
- Confirmação dentro do próprio menu antes de remover (segundo clique em "Remover? Confirmar"), nunca `window.confirm` *(decisão do Claude)*.
- A sessão não é avisada pelo app (não há como entregar mensagem depois de desconectar); fica registrado na lista de pendências se fizer falta.

## Hub
- Rota nova `POST /api/sessions/<sid>/remove`, com o mesmo token e a mesma checagem de origem das outras rotas: ativa → `markDisconnected(sid, 'removed')`; e em todos os casos a sessão fica marcada como removida e sai de `listSessions` até um novo `/cc` (que registra de novo e limpa a marca). Responde 404 para sessão desconhecida.
- Como guardar a marca (campo na registration, ou apagar a registration como o `pruneRegistrations` faz) fica com quem implementar, desde que: o waiter da sessão pare em poucos segundos, nada mais seja entregue, e um `/cc` posterior traga a sessão de volta.
- SSE: a mudança aparece para todas as páginas abertas (como as outras mudanças de sessão).

## Testes
Hub: remover ativa → desconectada e fora da lista, waiter para; remover encerrada → fora da lista; `/cc` depois → volta; token ausente → 401. UI: menu abre e fecha (Esc, clique fora), renomear igual ao lápis, remover pede confirmação e chama a rota.
