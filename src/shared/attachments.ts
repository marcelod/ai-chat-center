// Files attached in the app: uploaded to the hub, then named in the message by absolute path (Claude Code
// reads files and images by path). Shared by the hub (transcript parser) and the web UI.

/** Largest file the hub accepts (bytes). */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
/** Most files one message may carry. */
export const MAX_ATTACHMENTS = 10;

/** One fixed form regardless of the UI language, so the transcript parser can recognise it. */
export const attachmentLine = (absPath: string): string => `[Attachment: ${absPath}]`;

/** An absolute POSIX path or a Windows drive path. */
const LINE_RE = /^\[Attachment: ((?:\/|[A-Za-z]:[\\/]).*)\]$/;

/** The message text followed by one attachment line per path. */
export function withAttachments(text: string, paths: string[]): string {
  const body = text.trim();
  const lines = paths.map(attachmentLine);
  return [...(body ? [body] : []), ...lines].join('\n');
}

/** The file name shown for a stored attachment: no folder, no 16-hex random prefix. */
export function attachmentDisplayName(absPath: string): string {
  const base = absPath.split(/[\\/]/).pop() ?? absPath;
  return base.replace(/^[0-9a-f]{16}-/, '') || base;
}

/** Takes attachment lines out of a message: the remaining text and the attached files' names. */
export function splitAttachments(text: string): { text: string; attachments: string[] } {
  const attachments: string[] = [];
  const kept: string[] = [];
  for (const line of text.split('\n')) {
    const m = LINE_RE.exec(line.replace(/\r$/, ''));
    if (m) attachments.push(attachmentDisplayName(m[1]));
    else kept.push(line);
  }
  if (attachments.length === 0) return { text, attachments };
  return { text: kept.join('\n').trim(), attachments };
}
