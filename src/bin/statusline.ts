// Claude Code's status line command while `/cc usage on` is set (see hooks/statusline.ts). It records the
// account's rate-limit usage and the session's context window size for the app, then runs the status line the user had with the same input, so the
// terminal shows exactly what it showed before. It never fails the status line: any error only skips the record.
import { spawn } from 'node:child_process';
import { recordUsage, usageFromStatusInput } from '../core/usage.js';
import { readStatuslineState } from '../core/statuslineState.js';
import { contextWindowFromStatusInput, setContextWindow } from '../core/meta.js';
import { getRegistration } from '../core/registry.js';

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

async function main(): Promise<void> {
  const input = await readStdin();
  try {
    const data: unknown = JSON.parse(input.toString('utf8'));
    const usage = usageFromStatusInput(data);
    if (usage) await recordUsage(usage);
    // Only for sessions connected to the app at some point: no meta file for every other session.
    const cw = contextWindowFromStatusInput(data);
    if (cw && (await getRegistration(cw.sessionId))) await setContextWindow(cw.sessionId, cw.size);
  } catch {
    /* display only */
  }
  let command: unknown = null;
  try {
    command = (await readStatuslineState())?.original?.command;
  } catch {
    /* no original */
  }
  if (typeof command !== 'string' || !command.trim()) return;
  // The user's command, run the way Claude Code runs it: through the shell, input on stdin.
  const child = spawn(command, { shell: true, stdio: ['pipe', 'inherit', 'inherit'] });
  child.on('error', () => process.exit(0));
  child.stdin.on('error', () => {}); // a command that does not read its input
  child.stdin.end(input);
  child.on('exit', (code) => process.exit(code ?? 0));
}

main().catch(() => process.exit(0));
