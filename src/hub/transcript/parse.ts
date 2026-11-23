import { unwrapMessages } from '../../core/protocol.js';
import { isCcCommand } from '../../core/ccCommand.js';
import { parseQuestions } from '../../core/questions.js';
import type { ChatEvent, ToolAction } from '../../shared/types.js';

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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function summarize(name: string, input: unknown): string {
  if (!isRecord(input)) return '';
  let value: unknown;
  if (name === 'Bash') value = input.command;
  else if (name === 'Read' || name === 'Edit' || name === 'Write') value = input.file_path;
  else value = Object.values(input).find((v) => typeof v === 'string');
  return typeof value === 'string' ? truncate(value, SUMMARY_MAX) : '';
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
  /** Queued prompts already shown, to skip a later identical user entry. */
  private queued: { text: string; at: number }[] = [];
  /** The last `!` command, for the output entry that follows it. */
  private lastShell: string | null = null;

  /** @param keys trusted marker keys of the session; when given, other app-message blocks are ignored. */
  constructor(private readonly keys?: string[]) {}

  /** Returns new or updated events (same id = replace). */
  push(entry: unknown): ChatEvent[] {
    if (!isRecord(entry)) return [];
    const uuid = entry.uuid;
    const ts = entry.timestamp;
    if (typeof uuid !== 'string' || typeof ts !== 'string') return [];
    if (entry.isSidechain === true) return [];
    if (entry.type === 'attachment') return this.attachment(uuid, ts, entry.attachment);
    const message = isRecord(entry.message) ? entry.message : undefined;
    if (!message) return [];
    if (entry.type === 'assistant') return this.assistant(uuid, ts, message.content);
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
    return [{ kind: 'user', id: uuid, ts, text, origin: 'terminal', ...(n ? { images: n } : {}) }];
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
        const action: ToolAction = { toolUseId: block.id, name, summary: summarize(name, block.input) };
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
        out.push({ kind: 'user', id: uuid, ts, text, origin: 'terminal', ...(images ? { images } : {}) });
      }
      return out;
    }
    if (typeof content !== 'string') return [];

    const msgs = unwrapMessages(content, this.keys);
    if (msgs.length > 0) {
      this.open = null;
      return withIndex(
        msgs.map((m): ChatEvent => ({
          kind: 'user', id: uuid, ts, text: m.text, origin: 'app', appMessageId: m.id,
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
    return [{ kind: 'user', id: uuid, ts, text, origin: 'terminal' }];
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
      const ev = this.byToolUse.get(block.tool_use_id);
      const item = ev?.items.find((i) => i.toolUseId === block.tool_use_id);
      if (!ev || !item) continue;
      item.result = truncate(resultText(block.content), RESULT_MAX);
      if (block.is_error === true) item.isError = true;
      this.byToolUse.delete(block.tool_use_id);
      out.set(ev.id, snapshot(ev));
    }
    return [...out.values()];
  }
}
