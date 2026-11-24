# Rascunho por conversa — design curto

Data: 2026-11-24 · Status: aguardando aprovação do usuário

## Intenção
Hoje o texto digitado e não enviado some ao trocar de conversa (o `Composer` é recriado com `key={sessionId}`). Perda de texto diária.

## Comportamento
- Cada conversa guarda seu rascunho até ser enviado ou apagado. Trocar de conversa e voltar mostra o texto como estava.
- Sobrevive a recarregar a página; morre quando a janela/aba fecha *(decisão do Claude: `sessionStorage`, como o token; nunca `localStorage`, que deixaria o texto em disco sem prazo)*.
- Chave `acc.draft.<sessionId>`; texto vazio apaga a chave. Gravação a cada mudança (o texto é pequeno; sem debounce necessário, mas pode usar um curto).
- Envio com sucesso apaga o rascunho; envio com falha mantém o texto (o comportamento atual de devolver o texto à caixa continua).
- Storage indisponível (modo privado, bloqueio): funciona só em memória durante a página aberta, sem erro.
- Rascunho de uma sessão que sumiu da lista: fica até a aba fechar (não vale limpar).

## Escopo
Só `ui/` (`Composer.tsx` e um pequeno módulo de rascunhos). Sem mudança no hub.

## Testes
`Composer.test.tsx`: digitar, trocar de sessão, voltar → texto mantido; enviar → limpo; falha no envio → mantido; storage que lança erro → sem quebrar.
