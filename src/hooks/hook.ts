// Manual probe (Claude Code, interactive, plugin loaded with --plugin-dir, haiku):
//  (a) UserPromptSubmit DOES fire for a plugin slash command.
//  (b) `prompt` is the literal typed text, NOT the expanded command body:
//      typing `/ai-chat-center-probe:cc` delivered prompt "/ai-chat-center-probe:cc".
//      Typing `/cc` + Enter also delivered "/ai-chat-center-probe:cc" (the autocomplete menu
//      completed it to the namespaced form first), so both forms must be accepted.
//  So no `cc-command` fallback is needed. Only `/cc` and `/ai-chat-center:cc` are valid.
//  (c) process.ppid inside a hook is NOT the claude process: Claude Code runs hooks via
//      `/bin/sh -c <command>`, so ppid is that short-lived shell and the claude process is its
//      parent (2 prompts in one session: ppid differed each time, grandparent was always the
//      same `claude --plugin-dir ...` pid). Hence the claude pid comes from `claude agents --json`
//      (resolveClaudePid) and is stored as Registration.pid (null when it cannot be resolved).
// Stop and SessionStart are not hooked synchronously: the asyncRewake waiter (`waiter.mjs stop`)
// clears waiting/busy when a turn ends, and `waiter.mjs start` handles /clear, /resume and fork.
// notification_type values (code.claude.com/docs/en/hooks.md): permission_prompt, idle_prompt,
//  auth_success, auth_storage_failure, elicitation_dialog, elicitation_url_dialog,
//  elicitation_complete, elicitation_response, agent_needs_input, agent_completed, ...
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { assertSessionId, paths } from '../core/paths.js';
import { DIR_MODE, ensureDir } from '../core/fsAtomic.js';
import { getRegistration, isActive, markDisconnected, register } from '../core/registry.js';
import { clearWaiting, setWaiting } from '../core/waiting.js';
import { clearBusy, setBusy } from '../core/busy.js';
import { ensureHub } from './ensureHub.js';
import { loadConfig } from '../core/config.js';
import { t } from '../core/i18n.js';
import { resolveClaudePid } from './claudePid.js';

export type HookEvent = 'prompt-submit' | 'notification';
export type HookInput = {
  session_id: string;
  transcript_path: string;
  cwd: string;
  prompt?: string;
  source?: string;
  notification_type?: string;
  message?: string;
};
export interface HookContext {
  ensureHub: () => Promise<string>;
  /** Resolves the claude process pid of a session, or null. Default: resolveClaudePid. */
  resolvePid?: (sessionId: string) => Promise<number | null>;
}
export interface HookResult {
  stdout?: string;
  exitCode: 0;
}

const CC_RE = /^\s*\/(?:ai-chat-center:)?cc(?:\s+(\S[\s\S]*?))?\s*$/i;
const MAX_PREVIOUS_KEYS = 20;

export const UNKNOWN_ARG = 'AI Chat Center: unknown argument. Use /cc or /cc off.';
export const CONNECTED = 'AI Chat Center: connected';
export const PID_UNKNOWN =
  'AI Chat Center: could not identify the Claude process; closing the terminal will be detected by the hub.';

export function isCcCommand(prompt: unknown): 'on' | 'off' | 'unknown' | null {
  if (typeof prompt !== 'string') return null;
  const m = CC_RE.exec(prompt);
  if (!m) return null;
  if (m[1] === undefined) return 'on';
  return m[1].toLowerCase() === 'off' ? 'off' : 'unknown';
}

const output = (context: string, systemMessage?: string): HookResult => ({
  exitCode: 0,
  stdout: JSON.stringify({
    ...(systemMessage ? { systemMessage } : {}),
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
  }),
});

async function tightenHome(): Promise<void> {
  try {
    await ensureDir(paths().home);
    await fs.promises.chmod(paths().home, DIR_MODE);
  } catch {
    /* best effort (no-op on Windows) */
  }
}

async function connect(input: HookInput, resolve: (sid: string) => Promise<number | null>, ctx: HookContext) {
  const sid = input.session_id;
  const prev = await getRegistration(sid);
  const keep = prev && isActive(prev);
  await tightenHome();
  const pid = await resolve(sid);
  const previousKeys = [...(prev?.previousKeys ?? []), ...(prev?.key && !keep ? [prev.key] : [])].slice(-MAX_PREVIOUS_KEYS);
  const reg = await register({
    sessionId: sid,
    transcriptPath: input.transcript_path,
    cwd: input.cwd,
    pid,
    // The key stays while the connection is active; a reactivation gets a new one.
    key: keep && prev.key ? prev.key : crypto.randomBytes(16).toString('hex'),
    ...(previousKeys.length ? { previousKeys } : {}),
    // Re-running /cc on an active session keeps its original connectedAt.
    ...(keep ? { connectedAt: prev.connectedAt } : {}),
  });
  await clearBusy(sid);
  await clearWaiting(sid);
  const { language } = await loadConfig();
  // The token URL is shown to the user only (systemMessage). The model gets the key and a status
  // line: the token must not end up in the model context or be repeated in its reply.
  let status: string;
  let shown: string;
  try {
    shown = t(language, 'hook.ready', { url: await ctx.ensureHub() });
    status = CONNECTED;
  } catch (e) {
    // Keep the registration: the hub will show the session once it is up.
    logError(e);
    const log = path.join(paths().logDir, 'hook.log');
    status = `AI Chat Center: the hub failed to start. See ${log}`;
    shown = t(language, 'hook.hubFailed', { log });
  }
  const lines = [status, `AI Chat Center key: ${reg.key}`];
  if (pid === null) lines.push(PID_UNKNOWN);
  return output(lines.join('\n'), shown);
}

export async function handleHook(event: HookEvent, input: HookInput, ctx: HookContext): Promise<HookResult> {
  const nothing: HookResult = { exitCode: 0 };
  const sid = input?.session_id;
  const resolve = ctx.resolvePid ?? ((id: string) => resolveClaudePid(id));
  try {
    assertSessionId(sid);
  } catch {
    return nothing;
  }

  if (event === 'prompt-submit') {
    const cmd = isCcCommand(input.prompt);
    if (cmd === 'unknown') return output(UNKNOWN_ARG, t((await loadConfig()).language, 'hook.unknownArg'));
    if (cmd === 'on') return connect(input, resolve, ctx);
    const reg = await getRegistration(sid);
    if (!reg) return nothing;
    if (cmd === 'off') await markDisconnected(sid, 'off');
    else if (isActive(reg)) {
      await clearWaiting(sid);
      // A terminal turn starts: the waiter must not inject app messages until it ends.
      await setBusy(sid);
    }
    return nothing;
  }

  if (event === 'notification') {
    const reg = await getRegistration(sid);
    if (!reg || !isActive(reg)) return nothing;
    const type = input.notification_type;
    // idle_prompt is ignored: it fires after any idle period, not when Claude asks something.
    if (type === 'permission_prompt') await setWaiting(sid, 'permission');
    else if (type === 'elicitation_dialog' || type === 'elicitation_url_dialog' || type === 'agent_needs_input')
      await setWaiting(sid, 'input');
  }
  return nothing;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function logError(e: unknown): void {
  try {
    const dir = paths().logDir;
    fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    fs.appendFileSync(
      path.join(dir, 'hook.log'),
      `${new Date().toISOString()} ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`,
    );
  } catch {
    /* never break the session */
  }
}

export async function main(): Promise<void> {
  let result: HookResult = { exitCode: 0 };
  try {
    const event = process.argv[2] as HookEvent;
    if (event !== 'prompt-submit' && event !== 'notification') return;
    const input = JSON.parse(await readStdin()) as HookInput;
    result = await handleHook(event, input, { ensureHub: () => ensureHub() });
  } catch (e) {
    logError(e);
  }
  if (result.stdout) process.stdout.write(result.stdout, () => process.exit(0));
  else process.exitCode = 0;
}
