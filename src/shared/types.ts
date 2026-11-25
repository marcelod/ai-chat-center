// Shared contract between the hub (src/hub) and the web UI (ui/).
// Copied verbatim from the implementation plan (Tasks 5 and 7); change only together with both sides.

import type { ChatBackground } from './background.js';

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
      /** Names of the files attached in the app (`[Attachment: <path>]` lines, taken out of `text`). */
      attachments?: string[];
      /** A `!` shell-mode command typed in the terminal (its output follows as an actions item). */
      shell?: true;
    }
  | { kind: 'assistant'; id: string; ts: string; text: string }
  /** A message from a teammate or a subagent of the session (not typed by the user): who sent it and what it says. */
  | { kind: 'agent'; id: string; ts: string; from: string; text: string }
  /** What Claude asked a subagent or sent a teammate (Agent, SendMessage): to whom, and the request. */
  | { kind: 'toAgent'; id: string; ts: string; to: string; text: string }
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
  /** Short id of a background session (`claude attach <id>`); only for kind background. */
  bgId?: string;
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
  /** Claude Code permission mode sent with the last hook (default, acceptEdits, plan, auto, ...). */
  mode?: string;
  /** Pinned to the top of the list in the app (see core/pins.ts). */
  pinned?: true;
  /** Background chosen for this conversation in the app (⋮ menu); absent when none. */
  background?: ChatBackground;
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
  /** Runs as a Claude Code background session: its short id, for `claude attach <id>` and app commands. */
  bgId?: string;
  /** The app asked to resume this ended session and it has not reconnected yet. */
  resuming?: true;
  /** Why the last resume from the app failed (output of `claude --bg`, or a timeout). */
  resumeError?: string;
};

export type QuestionOption = { label: string; description?: string };
export type Question = { question: string; header?: string; options: QuestionOption[]; multiSelect?: boolean };
/** An AskUserQuestion waiting for an answer from the app (see core/questions.ts). */
/** `pid`: the hook process waiting for the answer; a question whose process is dead is stale (see getPending). */
export type PendingQuestion = { toolUseId: string; questions: Question[]; createdAt: string; pid?: number };

export type ProviderChange =
  | { type: 'events'; sessionId: string; events: ChatEvent[] }
  | { type: 'sessions' };

/** One rate-limit window of the account, as the status line reports it. */
export type UsageWindow = { usedPercentage: number; resetsAt: string };
/** The account's usage of its rate-limit windows, recorded by the status line wrapper. */
export type Usage = { fiveHour?: UsageWindow; sevenDay?: UsageWindow; updatedAt: string };

export type SessionsResponse = { connected: SessionView[]; others: LiveSession[]; usage?: Usage };
