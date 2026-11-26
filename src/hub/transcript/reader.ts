import { open } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import type { ChatEvent } from '../../shared/types.js';
import { TranscriptParser } from './parse.js';

const CHUNK = 64 * 1024;

export class TranscriptReader {
  private offset = 0;
  /** Pieces of the current incomplete line (joined only once its newline arrives: linear time). */
  private partial: string[] = [];
  private decoder = new StringDecoder('utf8');
  private parser: TranscriptParser;
  private events = new Map<string, ChatEvent>(); // insertion order = first appearance
  private chain: Promise<unknown> = Promise.resolve();
  /** Number of non-empty lines that were not valid JSON. */
  skipped = 0;

  constructor(
    readonly path: string,
    readonly keys?: string[],
    private readonly opts: { diffs?: boolean; sidechain?: boolean } = {},
  ) {
    this.parser = new TranscriptParser(keys, opts);
  }

  /** Events produced since the last call (updated events keep their id). */
  readNew(): Promise<ChatEvent[]> {
    const run = this.chain.then(() => this.doRead());
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Consolidated list: first-appearance order, latest version of each id. */
  all(): ChatEvent[] {
    return [...this.events.values()];
  }

  /** Raw model id of the latest assistant reply, if any. */
  model(): string | undefined {
    return this.parser.model;
  }

  /** Claude Code version recorded in the latest transcript lines, if any. */
  claudeVersion(): string | undefined {
    return this.parser.claudeVersion;
  }

  /** Tokens in the context now, and the last compaction (see TranscriptParser). */
  context(): { tokens?: number; lastCompactAt?: string } {
    const { contextTokens: tokens, lastCompact } = this.parser;
    return { ...(tokens !== undefined ? { tokens } : {}), ...(lastCompact ? { lastCompactAt: lastCompact.at } : {}) };
  }

  private reset(): void {
    this.offset = 0;
    this.partial = [];
    this.decoder = new StringDecoder('utf8');
    this.parser = new TranscriptParser(this.keys, this.opts);
    this.events.clear();
  }

  private async doRead(): Promise<ChatEvent[]> {
    let handle;
    try {
      handle = await open(this.path, 'r');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const out = new Map<string, ChatEvent>();
    try {
      const { size } = await handle.stat();
      if (size < this.offset) this.reset();
      const buf = Buffer.allocUnsafe(CHUNK);
      while (this.offset < size) {
        const { bytesRead } = await handle.read(buf, 0, Math.min(CHUNK, size - this.offset), this.offset);
        if (bytesRead === 0) break;
        this.offset += bytesRead;
        // Scan only the newly decoded text for newlines.
        const text = this.decoder.write(buf.subarray(0, bytesRead));
        let start = 0;
        for (let nl = text.indexOf('\n'); nl !== -1; nl = text.indexOf('\n', start)) {
          this.partial.push(text.slice(start, nl));
          const raw = this.partial.join('');
          this.partial = [];
          this.consume(raw, out);
          start = nl + 1;
        }
        if (start < text.length) this.partial.push(text.slice(start));
      }
    } finally {
      await handle.close();
    }
    return [...out.values()];
  }

  private consume(raw: string, out: Map<string, ChatEvent>): void {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!line.trim()) return;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      this.skipped++;
      return;
    }
    for (const ev of this.parser.push(entry)) {
      this.events.set(ev.id, ev);
      out.delete(ev.id); // keep latest version, ordered by last update
      out.set(ev.id, ev);
    }
  }
}
