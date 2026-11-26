import { unwrapMessages } from '../../core/protocol.js';
import { isCcCommand } from '../../core/ccCommand.js';
import { parseQuestions } from '../../core/questions.js';
import type { ChatEvent, ToolAction } from '../../shared/types.js';
import { attachmentPaths, splitAttachments } from '../../shared/attachments.js';
import { toolDiff } from '../../shared/diff.js';

type ActionsEvent = Extract<ChatEvent, { kind: 'actions' }>;
type QuestionEvent = Extract<ChatEvent, { kind: 'question' }>;

const RESULT_MAX = 2000;
/** An older Claude Code also wrote a queued prompt as a user entry when it ran: shown once. */
const QUEUED_DEDUP_MS = 30 * 60_000;
const INTERRUPTED = '[Request interrupted by user';

const tag = (content: string, name: string): string | undefined =>
  new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(content)?.[1];
const SUMMARY_MAX = 120;

const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

/**
 * Wrapper tags Claude Code puts around parts of a prompt; the bubble shows the inner text only.
 * Pasted text: `<pasted_content id="N">…</pasted_content id="N">` (the close repeats the id; a plain
 * close or no close at all is handled too). Agent teams: `<teammate-message teammate_id=… color=…>…</teammate-message>`.
 */
const WRAPPER_TAGS = /<\/?(?:pasted_content|teammate-message)(?:\s+[\w-]+="[^"]*")*\s*>/g;
const unwrapPrompt = (text: string): string => text.replace(WRAPPER_TAGS, '');

/** The text of a user message without its `[Attachment: <path>]` lines, and those files' names (chips). */
function body(text: string): { text: string; attachments?: string[]; attachmentPaths?: string[] } {
  const r = splitAttachments(text);
  return r.attachments.length ? { ...r, attachmentPaths: attachmentPaths(text) } : { text };
}


const AGENT_MESSAGE_PREFIX = 'Another Claude session sent a message:';
const AGENT_BLOCK = /<(teammate-message|agent-message)((?:\s+[\w-]+="[^"]*")*)\s*>\n?([\s\S]*?)<\/\1>/g;

function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1];
}

/**
 * The messages inside a teammate/subagent entry: who sent each and its text. A teammate's JSON status
 * (idle_notification and the like) shows only its `result`, and nothing when it has none; a subagent's
 * hand-back shows only the report, without the harness frame around it.
 */
export function agentMessages(content: string, names: Map<string, string> = new Map()): { from: string; text: string }[] {
  const out: { from: string; text: string }[] = [];
  for (const m of content.matchAll(AGENT_BLOCK)) {
    const [, tag, attrs, rawBody] = m;
    let text = rawBody.trim();
    let from: string;
    if (tag === 'teammate-message') {
      from = attr(attrs, 'teammate_id') ?? '';
      if (text.startsWith('{')) {
        try {
          const j = JSON.parse(text) as Record<string, unknown>;
          const said = [j.result, j.message, j.content].find((v) => typeof v === 'string' && v.trim() !== '');
          text = typeof said === 'string' ? said.trim() : '';
          if (!from && typeof j.from === 'string') from = j.from;
        } catch {
          /* not JSON: show as written */
        }
      }
    } else {
      const id = attr(attrs, 'from') ?? '';
      from = names.get(id) ?? '';
      const marker = 'The report follows:';
      const at = rawBody.indexOf(marker);
      if (at >= 0) {
        text = rawBody
          .slice(at + marker.length)
          .replace(/^\n/, '')
          .split('\n')
          .map((l) => (l.startsWith('  ') ? l.slice(2) : l))
          .join('\n')
          .trim();
      }
    }
    if (text) out.push({ from, text: truncate(text, RESULT_MAX * 4) });
  }
  return out;
}

/**
 * Claude's message to an agent: a subagent started with Agent/Task (named after its `name`, else its
 * description; the text is the prompt) or a SendMessage with a text message. Null for anything else (a
 * structured SendMessage stays an action).
 */
function toAgentMessage(name: string, input: unknown): { to: string; text: string } | null {
  if (!isRecord(input)) return null;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  if (name === 'Agent' || name === 'Task') {
    const text = str(input.prompt);
    if (!text) return null;
    return { to: str(input.name) || str(input.description), text: truncate(text, RESULT_MAX * 4) };
  }
  if (name === 'SendMessage') {
    const text = str(input.message);
    if (!text) return null;
    return { to: str(input.to), text: truncate(text, RESULT_MAX * 4) };
  }
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function summarize(name: string, input: unknown): string {
  if (!isRecord(input)) return '';
  let value: unknown;
  if (name === 'Bash') value = input.command;
  else if (name === 'Read' || name === 'Edit' || name === 'MultiEdit' || name === 'Write') value = input.file_path;
  else value = Object.values(input).find((v) => typeof v === 'string');
  return typeof value === 'string' ? truncate(value, SUMMARY_MAX) : '';
}

/** The diff of an Edit, MultiEdit or Write call, when its input has the old/new texts. */
function actionDiff(name: string, input: unknown): ToolAction['diff'] {
  if (!isRecord(input)) return undefined;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const edits: { oldText: string; newText: string }[] = [];
  if (name === 'Edit') {
    const o = str(input.old_string);
    const n = str(input.new_string);
    if (o !== undefined && n !== undefined) edits.push({ oldText: o, newText: n });
  } else if (name === 'MultiEdit' && Array.isArray(input.edits)) {
    for (const e of input.edits) {
      if (!isRecord(e)) continue;
      const o = str(e.old_string);
      const n = str(e.new_string);
      if (o !== undefined && n !== undefined) edits.push({ oldText: o, newText: n });
    }
  } else if (name === 'Write') {
    const c = str(input.content);
    if (c !== undefined) edits.push({ oldText: '', newText: c });
  }
  return (edits.length && toolDiff(edits)) || undefined;
}

/** The recap text without Claude Code's trailing "(disable recaps in /config)" hint. */
export function cleanRecap(content: string): string {
  return content.replace(/\s*\(\s*disable\s+recaps?\s+in\s+\/config\s*\)\s*\.?\s*$/i, '').trim();
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (isRecord(b) && typeof b.text === 'string' ? b.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/** Text blocks joined, and the number of image blocks, of a prompt (string or content blocks). */
function promptParts(prompt: unknown): { text: string; images: number } {
  if (typeof prompt === 'string') return { text: prompt, images: 0 };
  if (!Array.isArray(prompt)) return { text: '', images: 0 };
  const texts: string[] = [];
  let images = 0;
  for (const b of prompt) {
    if (!isRecord(b)) continue;
    if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
    else if (b.type === 'image') images++;
  }
  return { text: texts.join('\n'), images };
}

function snapshot(ev: ActionsEvent): ActionsEvent {
  return { ...ev, items: ev.items.map((i) => ({ ...i })) };
}

function withIndex<T extends { id: string }>(events: T[], uuid: string): T[] {
  if (events.length > 1) events.forEach((e, i) => (e.id = `${uuid}#${i}`));
  return events;
}

/**
 * Turns transcript entries into chat events. Shapes handled besides plain messages and tools:
 * prompts typed while Claude was busy (`queued_command` attachments), prompts with images, the
 * compaction summary (a notice), `!` shell mode (`<bash-input>` / `<bash-stdout>` / `<bash-stderr>`),
 * and `/cc` notices. Sidechain entries (subagents) are skipped: a subagent's work already shows as
 * the parent's Task/Agent action.
 */
export class TranscriptParser {
  private open: ActionsEvent | null = null;
  private byToolUse = new Map<string, ActionsEvent>();
  private questions = new Map<string, QuestionEvent>();
  /** Subagent id → its description (from the Agent tool result), to name a subagent's hand-back. */
  private agentNames = new Map<string, string>();
  /** Agent tool_use id → the name shown for that agent, until its result gives the agent id. */
  private agentCalls = new Map<string, string>();
  /** Queued prompts already shown, to skip a later identical user entry. */
  private queued: { text: string; at: number }[] = [];
  /** The last `!` command, for the output entry that follows it. */
  private lastShell: string | null = null;
  /** `message.model` of the latest main-thread assistant entry (synthetic ones ignored). */
  model: string | undefined;
  /** `version` (Claude Code) of the latest main-thread entry that carries one. */
  claudeVersion: string | undefined;

  /** @param keys trusted marker keys of the session; when given, other app-message blocks are ignored. */
  constructor(
    private readonly keys?: string[],
    private readonly opts: { diffs?: boolean; sidechain?: boolean } = {},
  ) {}

  /** Returns new or updated events (same id = replace). */
  push(entry: unknown): ChatEvent[] {
    if (!isRecord(entry)) return [];
    const uuid = entry.uuid;
    const ts = entry.timestamp;
    if (typeof uuid !== 'string' || typeof ts !== 'string') return [];
    if (entry.isSidechain === true && !this.opts.sidechain) return [];
    if (typeof entry.version === 'string' && entry.version) this.claudeVersion = entry.version;
    if (entry.type === 'system' && entry.subtype === 'away_summary' && typeof entry.content === 'string') {
      const text = cleanRecap(entry.content);
      if (!text) return [];
      this.open = null;
      return [{ kind: 'recap', id: uuid, ts, text }];
    }
    if (entry.type === 'attachment') return this.attachment(uuid, ts, entry.attachment);
    const message = isRecord(entry.message) ? entry.message : undefined;
    if (!message) return [];
    if (entry.type === 'assistant') {
      const model = message.model;
      if (typeof model === 'string' && model && model !== '<synthetic>') this.model = model;
      return this.assistant(uuid, ts, message.content);
    }
    if (entry.type === 'user') {
      const fromAgent = this.peer(uuid, ts, entry.origin, message.content);
      if (fromAgent) return fromAgent;
    }
    if (entry.type === 'user' && entry.isMeta !== true) {
      if (entry.isCompactSummary === true) return [{ kind: 'notice', id: uuid, ts, code: 'compacted' }];
      return this.user(uuid, ts, message.content, entry.toolUseResult);
    }
    return [];
  }

  /** A prompt the user typed while Claude was busy is recorded only as a queued_command attachment. */
  private attachment(uuid: string, ts: string, a: unknown): ChatEvent[] {
    if (!isRecord(a) || a.type !== 'queued_command' || a.commandMode !== 'prompt') return [];
    if (a.isMeta === true || a.humanTurn !== true) return [];
    const parts = promptParts(a.prompt);
    const text = unwrapPrompt(parts.text);
    const images = parts.images;
    const pasted = Array.isArray(a.imagePasteIds) ? a.imagePasteIds.length : 0;
    if (!text.trim() && !images && !pasted) return [];
    this.open = null;
    this.queued.push({ text: text.trim(), at: Date.parse(ts) || 0 });
    const n = Math.max(images, pasted);
    return [{ kind: 'user', id: uuid, ts, ...body(text), origin: 'terminal', ...(n ? { images: n } : {}) }];
  }

  private takeQueued(text: string, ts: string): boolean {
    const at = Date.parse(ts) || 0;
    this.queued = this.queued.filter((q) => at - q.at <= QUEUED_DEDUP_MS);
    const want = text.trim();
    const i = this.queued.findIndex((q) => q.text === want);
    if (i < 0) return false;
    this.queued.splice(i, 1);
    return true;
  }

  private assistant(uuid: string, ts: string, content: unknown): ChatEvent[] {
    if (!Array.isArray(content)) return [];
    const created: ChatEvent[] = []; // new events of this entry, in block order
    const updated: ActionsEvent[] = []; // groups opened by earlier entries
    let assistantEv: Extract<ChatEvent, { kind: 'assistant' }> | undefined;
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === 'text' && typeof block.text === 'string') {
        if (!block.text.trim()) continue;
        this.open = null; // text closes the group, in block order
        if (assistantEv) assistantEv.text += block.text;
        else {
          assistantEv = { kind: 'assistant', id: uuid, ts, text: block.text };
          created.push(assistantEv);
        }
      } else if (block.type === 'tool_use' && typeof block.id === 'string') {
        const name = typeof block.name === 'string' ? block.name : '';
        const questions = name === 'AskUserQuestion' ? parseQuestions(block.input) : null;
        if (questions) {
          this.open = null; // a question closes the group, like text
          const q: QuestionEvent = { kind: 'question', id: uuid, ts, toolUseId: block.id, questions };
          this.questions.set(block.id, q);
          created.push(q);
          continue;
        }
        const toAgent = toAgentMessage(name, block.input);
        if (toAgent) {
          this.open = null; // a message to an agent closes the group, like text
          created.push({ kind: 'toAgent', id: uuid, ts, ...toAgent });
          if (name !== 'SendMessage') this.agentCalls.set(block.id, toAgent.to);
          continue;
        }
        const action: ToolAction = { toolUseId: block.id, name, summary: summarize(name, block.input) };
        const diff = this.opts.diffs === false ? undefined : actionDiff(name, block.input);
        if (diff) action.diff = diff;
        if (!this.open) {
          this.open = { kind: 'actions', id: uuid, ts, items: [] };
          created.push(this.open);
        } else if (!created.includes(this.open) && !updated.includes(this.open)) {
          updated.push(this.open);
        }
        this.open.items.push(action);
        this.byToolUse.set(block.id, this.open);
      }
    }
    if (created.length > 1) created.forEach((e, i) => (e.id = `${uuid}#${i}`));
    return [...updated, ...created].map((e) => (e.kind === 'actions' ? snapshot(e) : e));
  }

  private user(uuid: string, ts: string, content: unknown, toolUseResult?: unknown): ChatEvent[] {
    if (Array.isArray(content)) {
      const out: ChatEvent[] = this.toolResults(content, toolUseResult);
      const parts = promptParts(content);
      const text = unwrapPrompt(parts.text);
      const images = parts.images;
      if ((text.trim() || images) && !text.startsWith(INTERRUPTED) && !this.takeQueued(text, ts)) {
        this.open = null;
        out.push({ kind: 'user', id: uuid, ts, ...body(text), origin: 'terminal', ...(images ? { images } : {}) });
      }
      return out;
    }
    if (typeof content !== 'string') return [];

    const msgs = unwrapMessages(content, this.keys);
    if (msgs.length > 0) {
      this.open = null;
      return withIndex(
        msgs.map((m): ChatEvent => ({
          kind: 'user', id: uuid, ts, ...body(m.text), origin: 'app', appMessageId: m.id,
        })),
        uuid,
      );
    }

    const cmd = /<command-name>\s*(\/[^<\s]+)\s*<\/command-name>/.exec(content)?.[1];
    if (cmd) {
      const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(content)?.[1]?.trim();
      const cc = isCcCommand(args ? `${cmd} ${args}` : cmd); // the same rule as the hook
      if (cc === 'on' || cc === 'off') return [{ kind: 'notice', id: uuid, ts, code: cc === 'on' ? 'connected' : 'disconnected' }];
      if (cc === 'unknown' || cc === 'answers-on' || cc === 'answers-off' || cc === 'window-on' || cc === 'window-off') return [];
    }

    const shellIn = tag(content, 'bash-input');
    if (shellIn !== undefined) {
      this.open = null;
      this.lastShell = shellIn;
      return [{ kind: 'user', id: uuid, ts, text: shellIn, origin: 'terminal', shell: true }];
    }
    const stdout = tag(content, 'bash-stdout');
    const stderr = tag(content, 'bash-stderr');
    if (stdout !== undefined || stderr !== undefined) {
      const err = (stderr ?? '').trim();
      const result = [stdout ?? '', stderr ?? ''].filter((x) => x.trim()).join('\n');
      const item: ToolAction = { toolUseId: uuid, name: 'Shell', summary: truncate(this.lastShell ?? '', SUMMARY_MAX), result: truncate(result, RESULT_MAX) };
      if (err) item.isError = true;
      this.lastShell = null;
      this.open = null;
      return [{ kind: 'actions', id: uuid, ts, items: [item] }];
    }

    const t = content.trimStart();
    if (
      t.startsWith('<command-') ||
      t.startsWith('<local-command-') ||
      t.startsWith('<task-notification>') ||
      t.startsWith('<system-reminder>')
    ) {
      return [];
    }

    const text = unwrapPrompt(content);
    if (!text.trim()) return [];
    if (this.takeQueued(text, ts)) return [];
    this.open = null;
    return [{ kind: 'user', id: uuid, ts, ...body(text), origin: 'terminal' }];
  }

  /**
   * A teammate's or subagent's message (agent teams, SendMessage, a subagent's hand-back): Claude Code
   * stores it as a user entry (older versions without `isMeta`), but the user did not type it. Shown as the
   * agent's, with only what it said. Newer versions add `origin: {kind: 'peer', name, handbackReportText}`.
   * Null when the entry is not one.
   */
  private peer(uuid: string, ts: string, origin: unknown, content: unknown): ChatEvent[] | null {
    const text = typeof content === 'string' ? content : promptParts(content).text;
    const isPeer = isRecord(origin) && origin.kind === 'peer';
    if (!isPeer && !text.trimStart().startsWith(AGENT_MESSAGE_PREFIX)) return null;
    let msgs = agentMessages(text, this.agentNames);
    if (isPeer) {
      const name = typeof origin.name === 'string' && origin.name ? origin.name : undefined;
      const report = typeof origin.handbackReportText === 'string' ? origin.handbackReportText.trim() : '';
      if (msgs.length === 0 && report) msgs = [{ from: '', text: truncate(report, RESULT_MAX * 4) }];
      if (msgs.length === 1) {
        if (report) msgs[0].text = truncate(report, RESULT_MAX * 4);
        if (name && !msgs[0].from) msgs[0].from = name;
      }
    }
    this.open = null;
    return msgs.map((m, i, all) => ({ kind: 'agent' as const, id: all.length > 1 ? `${uuid}#${i}` : uuid, ts, ...m }));
  }

  private toolResults(blocks: unknown[], toolUseResult?: unknown): ChatEvent[] {
    const out = new Map<string, ChatEvent>();
    for (const block of blocks) {
      if (!isRecord(block) || block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
      const q = this.questions.get(block.tool_use_id);
      if (q) {
        const a = isRecord(toolUseResult) && isRecord(toolUseResult.answers) ? toolUseResult.answers : undefined;
        const values = a ? Object.values(a) : [];
        if (block.is_error === true) {
          // Interrupted or rejected: not an answer.
          q.error = true;
          q.answerText = truncate(resultText(block.content), RESULT_MAX);
        } else if (a && values.length > 0 && values.every((v) => typeof v === 'string')) q.answers = { ...(a as Record<string, string>) };
        else q.answerText = truncate(resultText(block.content), RESULT_MAX);
        this.questions.delete(block.tool_use_id);
        out.set(q.id, { ...q });
        continue;
      }
      const call = this.agentCalls.get(block.tool_use_id);
      if (call !== undefined) {
        const id = /agentId:\s*([\w-]+)/.exec(resultText(block.content))?.[1];
        if (id && call) this.agentNames.set(id, call);
        this.agentCalls.delete(block.tool_use_id);
        continue;
      }
      const ev = this.byToolUse.get(block.tool_use_id);
      const item = ev?.items.find((i) => i.toolUseId === block.tool_use_id);
      if (!ev || !item) continue;
      const full = resultText(block.content);
      if (item.name === 'Agent' || item.name === 'Task') {
        const id = /agentId:\s*([\w-]+)/.exec(full)?.[1];
        if (id && item.summary) this.agentNames.set(id, item.summary);
      }
      item.result = truncate(full, RESULT_MAX);
      if (block.is_error === true) item.isError = true;
      this.byToolUse.delete(block.tool_use_id);
      out.set(ev.id, snapshot(ev));
    }
    return [...out.values()];
  }
}
