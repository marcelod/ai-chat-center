// Shared contract between the hub (src/hub) and the web UI (ui/).
// Copied verbatim from the implementation plan (Tasks 5 and 7); change only together with both sides.

export type ToolAction = {
  toolUseId: string;
  name: string;
  summary: string;
  result?: string;
  isError?: boolean;
};

export type ChatEvent =
  | {
      kind: 'user';
      id: string;
      ts: string;
      text: string;
      origin: 'terminal' | 'app';
      appMessageId?: string;
      /** Number of images attached to the prompt (shown as a chip). */
      images?: number;
      /** A `!` shell-mode command typed in the terminal (its output follows as an actions item). */
      shell?: true;
    }
  | { kind: 'assistant'; id: string; ts: string; text: string }
  /** A message from a teammate or a subagent of the session (not typed by the user): who sent it and what it says. */
  | { kind: 'agent'; id: string; ts: string; from: string; text: string }
  | { kind: 'actions'; id: string; ts: string; items: ToolAction[] }
  | {
      kind: 'question';
      id: string;
      ts: string;
      toolUseId: string;
      questions: Question[];
      answers?: Record<string, string>;
      answerText?: string;
      /** The tool result was an error (interrupted, rejected): the question was not answered. */
      error?: true;
    }
  | { kind: 'notice'; id: string; ts: string; code: 'connected' | 'disconnected' | 'compacted' };

export type LiveSession = {
  pid: number;
  cwd: string;
  kind: 'interactive' | 'background';
  sessionId: string;
  name: string;
  status: 'busy' | 'idle' | 'waiting';
};

export type SessionView = {
  sessionId: string;
  name: string;
  /** The name Claude Code gives the session; present only when a custom display name replaces it. */
  originalName?: string;
  cwd: string;
  /** Git branch of the session folder (short hash when detached); absent outside a repository. */
  branch?: string;
  /** Short model name of the last assistant reply ("Opus 5.5"); absent before the first reply. */
  model?: string;
  /** Reasoning effort level recorded at the last prompt; absent when Claude Code does not send it. */
  effort?: string;
  state: 'busy' | 'idle' | 'waiting' | 'disconnected';
  waitingKind?: 'permission' | 'input' | 'question';
  /** An AskUserQuestion the app can answer; only for an active session. */
  pendingQuestion?: PendingQuestion;
  lastEvent?: ChatEvent;
  pendingAppMessageIds: string[];
  /** The same queued messages with their text, so the app can show them after a reload or in another tab. */
  pendingAppMessages?: { id: string; text: string; createdAt: string }[];
  /** App messages are queued for this idle session and no waiter is running: a terminal prompt resumes delivery. */
  deliveryStalled?: boolean;
  /**
   * Claude Code is not writing this session's transcript: app messages still reach it, but the app cannot show
   * them or the replies. Typically a claude started in a terminal that inherited another session's variables.
   */
  transcriptMissing?: boolean;
  /**
   * App messages that failed the signature check (sent through an older version's hub, typically) and were
   * kept aside, not delivered. The app says so.
   */
  undeliveredUnsigned?: number;
};

export type QuestionOption = { label: string; description?: string };
export type Question = { question: string; header?: string; options: QuestionOption[]; multiSelect?: boolean };
/** An AskUserQuestion waiting for an answer from the app (see core/questions.ts). */
/** `pid`: the hook process waiting for the answer; a question whose process is dead is stale (see getPending). */
export type PendingQuestion = { toolUseId: string; questions: Question[]; createdAt: string; pid?: number };

export type ProviderChange =
  | { type: 'events'; sessionId: string; events: ChatEvent[] }
  | { type: 'sessions' };

export type SessionsResponse = { connected: SessionView[]; others: LiveSession[] };
