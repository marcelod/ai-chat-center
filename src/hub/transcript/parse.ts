import { unwrapMessages } from '../../core/protocol.js';
import type { ChatEvent, ToolAction } from '../../shared/types.js';

type ActionsEvent = Extract<ChatEvent, { kind: 'actions' }>;

const RESULT_MAX = 2000;
const SUMMARY_MAX = 120;

const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

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

function snapshot(ev: ActionsEvent): ActionsEvent {
  return { ...ev, items: ev.items.map((i) => ({ ...i })) };
}

function withIndex<T extends { id: string }>(events: T[], uuid: string): T[] {
  if (events.length > 1) events.forEach((e, i) => (e.id = `${uuid}#${i}`));
  return events;
}

export class TranscriptParser {
  private open: ActionsEvent | null = null;
  private byToolUse = new Map<string, ActionsEvent>();

  /** @param keys trusted marker keys of the session; when given, other app-message blocks are ignored. */
  constructor(private readonly keys?: string[]) {}

  /** Returns new or updated events (same id = replace). */
  push(entry: unknown): ChatEvent[] {
    if (!isRecord(entry)) return [];
    const uuid = entry.uuid;
    const ts = entry.timestamp;
    if (typeof uuid !== 'string' || typeof ts !== 'string') return [];
    const message = isRecord(entry.message) ? entry.message : undefined;
    if (!message) return [];
    if (entry.type === 'assistant') return this.assistant(uuid, ts, message.content);
    if (entry.type === 'user' && entry.isMeta !== true) return this.user(uuid, ts, message.content);
    return [];
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

  private user(uuid: string, ts: string, content: unknown): ChatEvent[] {
    if (Array.isArray(content)) return this.toolResults(content);
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
    if (cmd === '/cc' || cmd === '/ai-chat-center:cc') {
      const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(content)?.[1]?.trim();
      return [{ kind: 'notice', id: uuid, ts, code: args === 'off' ? 'disconnected' : 'connected' }];
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
    if (!content.trim()) return [];
    this.open = null;
    return [{ kind: 'user', id: uuid, ts, text: content, origin: 'terminal' }];
  }

  private toolResults(blocks: unknown[]): ChatEvent[] {
    const out = new Map<string, ActionsEvent>();
    for (const block of blocks) {
      if (!isRecord(block) || block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
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
