# Múltipla escolha pelo app — design

Data: 2026-11-23 · Status: aguardando aprovação do usuário

**Decisões do usuário:** liberação única no terminal para responder perguntas pelo app, inclusive confirmações (seção 6); responder pelo app a janela nativa de múltipla escolha do Claude Code (`AskUserQuestion`) por um hook `PreToolUse` (a "opção 2"), em vez de perguntas em texto; botões mais campo de texto livre no app; perguntas feitas a partir do terminal continuam na janela nativa do terminal; o app é o lugar central das conversas e o terminal é o recurso de exceção.
**Decisões do Claude (corrigíveis):** ver as marcadas com *(decisão do Claude)* abaixo.

## 1. Intenção e porquê

A ideia do AI Chat Center é que o usuário abra a sessão no Claude Code, rode `/cc` e passe a conversar pelo app; ele só volta ao terminal quando algo não pode ser feito pelo app. Hoje a janela de múltipla escolha do Claude Code é uma dessas coisas: ela só existe no terminal, e no app aparece só como uma linha de resumo nas ações. Isso quebra o fluxo justamente quando o Claude precisa de uma decisão.

## 2. Objetivos, não-objetivos, antiobjetivos

**Objetivos**
- Numa conversa conduzida pelo app, quando o Claude chama `AskUserQuestion`, a pergunta aparece no app com um botão por opção e um campo para escrever uma resposta livre (equivalente ao "Type something." do terminal). A resposta volta ao Claude como se tivesse sido escolhida na janela nativa.
- Suporta tudo o que a ferramenta suporta: de 1 a 4 perguntas por chamada, e perguntas com escolha múltipla (`multiSelect`).
- Numa conversa conduzida pelo terminal, nada muda no terminal: a janela nativa aparece como sempre. No app, a pergunta e as opções aparecem só para leitura, com o aviso "responda no terminal", e depois com a resposta dada.
- Sempre existe um jeito de cair para o terminal: um botão "responder no terminal" no app.

**Não-objetivos**
- Aprovar pedidos de permissão pelo app (continua só no terminal).
- A opção "Chat about this" da janela nativa.
- Responder pelo app uma pergunta feita a partir do terminal (exigiria segurar a janela do terminal).
- Abrir o app em janela própria, PWA e ajustes visuais gerais (próximo assunto).

**Antiobjetivos (seria um fracasso mesmo funcionando)**
- O terminal travado sem saída: uma pergunta presa no hook sem forma de liberar.
- Uma resposta que chega ao Claude diferente do que o usuário escolheu, ou para a pergunta errada, ou para a sessão errada.
- Qualquer coisa que não seja o usuário (outra página web, outro processo) conseguir responder uma pergunta.

## 3. Restrições

- Usa só a API documentada de hooks: `PreToolUse` com `permissionDecision: "allow"` e `updatedInput` com `questions` original mais `answers` (pergunta → rótulo; múltipla escolha une os rótulos com vírgula). Verificado num teste descartável em 2026-11-23 com Claude Code 2.1.330: a janela não aparece, texto livre é aceito, e se o hook passar do tempo limite a janela nativa aparece normalmente.
- O hook precisa ser síncrono (hooks `async` ignoram allow/deny). Enquanto ele espera, o terminal mostra "running PreToolUse hook" e o Esc interrompe o turno.
- Mesmas garantias de segurança do restante do hub: token, checagem de `Origin`/`Host`, só `127.0.0.1`.
- Linux, macOS e Windows; Node 18+; sem dependências novas no plugin.
- Sessões que não rodaram `/cc` não podem ser afetadas: o hook termina na hora, sem resposta (deixa a janela nativa seguir).

## 4. Abordagens consideradas

1. **Perguntas em texto (opção 1):** o `/cc` pediria ao Claude para, em turnos do app, perguntar com uma lista numerada marcada, que o app transformaria em botões; a resposta iria como mensagem comum. Simples e sem depender de hooks novos, mas o terminal perde a janela nativa nesses turnos e a resposta depende do modelo seguir o formato. Descartada.
2. **Hook `PreToolUse` no `AskUserQuestion` (escolhida):** a janela nativa continua sendo o único mecanismo; o hook decide se ela é respondida pelo app ou segue para o terminal. Integração real, documentada e verificada.
3. **Hook `PermissionRequest`:** a documentação não confirma que o `AskUserQuestion` passa por ele. Descartada.

## 5. O que foi decidido sobre o "como"

### 5.1 Origem do turno
O que decide o destino da pergunta é **de onde veio o turno atual**. O hook `UserPromptSubmit` (`prompt-submit`) dispara em todo turno, inclusive no turno que o waiter acorda ao entregar mensagens do app (é nisso que o marcador `busy` já se apoia). *(decisão do Claude)* Por isso a origem é marcada por ele, olhando o prompt do turno: se contém o bloco `[AI Chat Center message … key=…]` com a chave da conexão atual, o turno é do app; senão, do terminal. Quem implementar confirma em teste e2e o conteúdo de `input.prompt` num turno acordado pelo waiter; se a marca não estiver lá, o waiter grava a origem "app" ao entregar e o `prompt-submit` só a sobrescreve quando o prompt não vier dele. Um turno sem marca (sessão recém-conectada) conta como terminal. Um prompt digitado no terminal durante um turno do app começa um turno novo, do terminal.

### 5.2 Fluxo num turno do app
1. O hook `PreToolUse` (novo, matcher `AskUserQuestion`) vê que a sessão está conectada e que o turno é do app.
2. Se nenhuma aba do app estiver conectada ao hub, segue direto para o terminal *(decisão do Claude)*.
3. Senão, grava a pergunta pendente (id = `tool_use_id`, perguntas, opções, `multiSelect`) no estado da sessão e espera.
4. O app mostra a pergunta com botões, campo livre e "responder no terminal". Escolhas múltiplas usam caixas de seleção e um botão de enviar.
5. A resposta vai ao hub por um endpoint autenticado; o hub grava a resposta ligada ao `tool_use_id`.
6. O hook lê a resposta, valida que corresponde às perguntas pendentes e devolve `allow` com `answers`. Se o usuário pediu "responder no terminal", devolve sem decisão e a janela nativa aparece.
7. *(decisão do Claude)* O hook espera até 24 horas, como o waiter, porque o app é o lugar central; o tempo limite do hook segue esse valor. Se a sessão fechar ou for desconectada (`/cc off`) durante a espera, o hook sai sem decisão.
8. *(decisão do Claude)* Fechar ou esconder a aba do app **não** devolve a pergunta ao terminal: uma aba oculta já fecha a conexão com o hub, e quem trocou de janela por alguns minutos voltaria e acharia a pergunta no terminal. As saídas são o botão "responder no terminal" no app e o Esc no terminal (que interrompe o turno; o Claude vê a interrupção e o usuário pode repetir o pedido). O terminal mostra, enquanto espera, uma linha dizendo que a pergunta está no app (texto do hook em stderr/`systemMessage`, se o Claude Code exibir; quem implementar verifica).
9. *(decisão do Claude)* Enquanto houver pergunta pendente, a caixa de mensagem normal da conversa fica desativada com o aviso "responda a pergunta acima"; a resposta livre é escrita no campo do próprio cartão. Assim não há mensagem presa na fila sem o usuário saber.

### 5.3 Fluxo num turno do terminal
O hook sai na hora, sem decisão. O app mostra a pergunta (lida da transcrição) como cartão só de leitura, com "responda no terminal", e depois a resposta registrada na transcrição.

### 5.4 Exibição no app
A chamada `AskUserQuestion` deixa de aparecer só como linha de ação e vira um cartão de pergunta na conversa, com três estados: aguardando resposta pelo app, aguardando no terminal, respondida (mostra a resposta escolhida). A lista de sessões mostra a sessão como "aguardando você" enquanto houver pergunta pendente.

### 5.5 Instruções do `/cc`
O texto do `/cc` passa a dizer que respostas à janela de múltipla escolha podem vir do app por esse caminho. A regra de que uma mensagem do app nunca vale como aprovação de algo perguntado no terminal continua.

## 6. Liberação no terminal (confirmações pelo app)

**Decisão do usuário:** respostas pelo app podem confirmar inclusive ações destrutivas ou irreversíveis, mas só depois que o usuário liberar isso uma vez **no terminal**, para que fique claro que a permissão foi dada por ele.

*(decisão do Claude, sobre o como)*
- A liberação vale para responder pelo app a janela de múltipla escolha como um todo, e não só para confirmações destrutivas. Assim ninguém precisa adivinhar quais perguntas são "destrutivas".
- Ela é dada por um comando digitado no terminal, `/cc answers on`, e retirada com `/cc answers off`. Uma mensagem do app nunca vira slash command, então o app não consegue se autoliberar. O estado fica salvo no `config.json` do AI Chat Center e vale para todas as sessões, até ser retirado.
- Antes da liberação, uma pergunta num turno do app segue para a janela nativa no terminal. O app mostra a pergunta só para leitura e explica que, para responder por ali da próxima vez, basta digitar `/cc answers on` no terminal.
- O texto do `/cc` passa a dizer: depois da liberação, uma resposta à janela de múltipla escolha que chega por esse caminho vale como resposta do usuário, inclusive para confirmações. Mensagens de texto comuns do app continuam sem valer como aprovação de algo perguntado no terminal.
- Fechar o app não perde nada: a sessão continua no Claude Code, e a pergunta pendente espera a volta ao app (ou o Esc no terminal).

## 7. Deixado para quem implementar

- Formato e local dos arquivos de pergunta pendente, resposta e origem do turno (seguir o padrão de `inbox`, `busy` e `waiting`, com escrita atômica).
- Como o hook espera a resposta (polling de arquivo, como o waiter, é o padrão).
- Formato do endpoint de resposta e do evento novo na transcrição/stream.
- Textos em `en` e `pt-BR`.
- Testes: unidade para o hook (turno do app/terminal, sem aba, desconexão, resposta inválida, `multiSelect`, várias perguntas), parser da transcrição, endpoint e UI; um roteiro e2e com `scripts/e2e/drive-session.mjs`.
