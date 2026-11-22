// The /cc command as typed. Shared by the prompt hook (which acts on it) and the transcript parser
// (which shows its connected/disconnected notice), so both always agree.
const CC_RE = /^\s*\/(?:ai-chat-center:)?cc(?:\s+(\S[\s\S]*?))?\s*$/i;

export function isCcCommand(prompt: unknown): 'on' | 'off' | 'unknown' | null {
  if (typeof prompt !== 'string') return null;
  const m = CC_RE.exec(prompt);
  if (!m) return null;
  if (m[1] === undefined) return 'on';
  return m[1].toLowerCase() === 'off' ? 'off' : 'unknown';
}
