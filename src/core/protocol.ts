import type { InboxMessage } from './inbox.js';

// Block format: `[AI Chat Center message id=<id> key=<key>]\n<body>\n[/AI Chat Center message]`.
// The key is a per-connection secret shown to Claude by /cc, so text injected from elsewhere
// (files, tool output) cannot forge a trusted block.
const OPEN = (id: string, key?: string) => `[AI Chat Center message id=${id}${key ? ` key=${key}` : ''}]`;
const CLOSE = '[/AI Chat Center message]';

// A body must never contain CLOSE. Escaping adds one backslash to `[\…\/AI Chat Center message]`
// (any number of backslashes, including none); unescaping removes one, so it is reversible.
const escapeBody = (t: string) => t.replace(/\[(\\*)\/AI Chat Center message\]/g, '[$1\\/AI Chat Center message]');
const unescapeBody = (t: string) => t.replace(/\[(\\*)\\\/AI Chat Center message\]/g, '[$1/AI Chat Center message]');

export function wrapMessages(msgs: InboxMessage[], key: string | undefined): string {
  return msgs.map((m) => `${OPEN(m.id, key)}\n${escapeBody(m.text)}\n${CLOSE}`).join('\n\n');
}

/**
 * Extracts message blocks. When trusted key(s) are given, blocks with any other key, or with no
 * key, are ignored. Without keys (legacy registration) every block is accepted.
 */
export function unwrapMessages(text: string, keys?: string | string[]): { id: string; text: string }[] {
  const trusted = keys === undefined ? null : new Set((Array.isArray(keys) ? keys : [keys]).filter(Boolean));
  const re = /\[AI Chat Center message id=([^\]\s]+)(?: key=([^\]\s]+))?\]\n([\s\S]*?)\n\[\/AI Chat Center message\]/g;
  const out: { id: string; text: string }[] = [];
  for (const m of text.matchAll(re)) {
    if (trusted && trusted.size > 0 && !(m[2] && trusted.has(m[2]))) continue;
    out.push({ id: m[1]!, text: unescapeBody(m[3]!) });
  }
  return out;
}
