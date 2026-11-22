import { open } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import type { ChatEvent } from '../../shared/types.js';
import { TranscriptParser } from './parse.js';

const CHUNK = 64 * 1024;

export class TranscriptReader {
  private offset = 0;
  private partial = '';
  private decoder = new StringDecoder('utf8');
  private parser: TranscriptParser;
  private events = new Map<string, ChatEvent>(); // insertion order = first appearance
  private chain: Promise<unknown> = Promise.resolve();
  /** Number of non-empty lines that were not valid JSON. */
  skipped = 0;

  constructor(
    readonly path: string,
    readonly keys?: string[],
  ) {
    this.parser = new TranscriptParser(keys);
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

  private reset(): void {
    this.offset = 0;
    this.partial = '';
    this.decoder = new StringDecoder('utf8');
    this.parser = new TranscriptParser(this.keys);
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
        this.partial += this.decoder.write(buf.subarray(0, bytesRead));
        const lines = this.partial.split('\n');
        this.partial = lines.pop() ?? '';
        for (const raw of lines) this.consume(raw, out);
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
