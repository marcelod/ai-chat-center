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
  | { kind: 'actions'; id: string; ts: string; items: ToolAction[] }
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
  cwd: string;
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
   * App messages that failed the signature check (sent through an older version's hub, typically) and were
   * kept aside, not delivered. The app says so.
   */
  undeliveredUnsigned?: number;
};

export type QuestionOption = { label: string; description?: string };
export type Question = { question: string; header?: string; options: QuestionOption[]; multiSelect?: boolean };
/** An AskUserQuestion waiting for an answer from the app (see core/questions.ts). */
export type PendingQuestion = { toolUseId: string; questions: Question[]; createdAt: string };

export type ProviderChange =
  | { type: 'events'; sessionId: string; events: ChatEvent[] }
  | { type: 'sessions' };

export type SessionsResponse = { connected: SessionView[]; others: LiveSession[] };
