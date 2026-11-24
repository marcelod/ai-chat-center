// The /cc command as typed. Shared by the prompt hook (which acts on it) and the transcript parser
// (which shows its connected/disconnected notice), so both always agree.
const CC_RE = /^\s*\/(?:ai-chat-center:)?cc(?:\s+(\S[\s\S]*?))?\s*$/i;

export type CcCommand = 'on' | 'off' | 'answers-on' | 'answers-off' | 'window-on' | 'window-off' | 'usage-on' | 'usage-off' | 'unknown';

export function isCcCommand(prompt: unknown): CcCommand | null {
  if (typeof prompt !== 'string') return null;
  const m = CC_RE.exec(prompt);
  if (!m) return null;
  if (m[1] === undefined) return 'on';
  const arg = m[1].toLowerCase().split(/\s+/).join(' ');
  if (arg === 'off') return 'off';
  if (arg === 'answers on') return 'answers-on';
  if (arg === 'answers off') return 'answers-off';
  if (arg === 'window on') return 'window-on';
  if (arg === 'window off') return 'window-off';
  if (arg === 'usage on') return 'usage-on';
  if (arg === 'usage off') return 'usage-off';
  return 'unknown';
}
