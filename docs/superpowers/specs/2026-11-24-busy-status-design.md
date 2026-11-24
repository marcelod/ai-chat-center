# Status "trabalhando" preso com tarefa em segundo plano — design curto

Data: 2026-11-24 · Status: aguardando aprovação do usuário

## Intenção
O app existe para mostrar o estado real das sessões; um "trabalhando" falso faz perder a confiança nele. Caso visto: sessão "Escalas - MeetaOne" com `1 shell still running` mostrava os três pontinhos com o terminal parado no prompt.

## Causa (reproduzida em 2026-11-24)
`claude agents --json` informa `status: "busy"` enquanto a sessão tem uma tarefa em segundo plano (shell com `run_in_background`, monitor), mesmo com o turno encerrado. O hub usa esse status como verdade. No teste, o marcador de turno do hub (`busy/<sid>`, gravado no UserPromptSubmit e apagado no Stop) estava ausente enquanto o `claude agents` dizia "busy"; e o turno que o Claude Code abre sozinho quando a tarefa termina também grava o marcador.

## Correção
- No `ClaudeCodeProvider`, o estado `busy` passa a exigir as duas coisas: o `claude agents` diz "busy" **e** existe o marcador de turno da sessão. "busy" sem marcador vira `idle`.
- `waiting` (pergunta, permissão) não muda.
- O cálculo do intervalo de consulta (`liveTtl`) continua tratando "busy" do `claude agents` como atividade (5 s), para pegar rápido o fim da tarefa.

## Fora
- Aviso "tarefa em segundo plano" no app: não agora (pode entrar depois; o dado existe: "busy" sem marcador).
- Turno interrompido com Esc enquanto há tarefa em segundo plano: o marcador fica e o "trabalhando" dura até a tarefa acabar (já acontece hoje; raro).

## Testes
`test/hub/provider.test.ts`: busy + marcador → busy; busy sem marcador → idle; idle + marcador velho → idle (comportamento atual); waiting inalterado.
