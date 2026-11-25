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
// UserPromptSubmit also starts `waiter.mjs prompt` (asyncRewake), so a waiter exists during every turn,
// including one interrupted with Esc, which fires no Stop.
// notification_type values (code.claude.com/docs/en/hooks.md): permission_prompt, idle_prompt,
//  auth_success, auth_storage_failure, elicitation_dialog, elicitation_url_dialog,
//  elicitation_complete, elicitation_response, agent_needs_input, agent_completed, ...
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import { assertSessionId, paths } from '../core/paths.js';
import { DIR_MODE, ensureDir } from '../core/fsAtomic.js';
import { claudeConfigDir, codeStamp, getRegistration, isActive, markDisconnected, register, stampedByThisCode, updateRegistration } from '../core/registry.js';
import { clearWaiting, setWaiting } from '../core/waiting.js';
import { setBusy } from '../core/busy.js';
import { setEffort, setMode } from '../core/meta.js';
import { installStatusline, refreshWrapper, removeStatusline, type InstallResult, type RemoveResult } from './statusline.js';
import { readStatuslineState } from '../core/statuslineState.js';
import { clearTurnOrigin, promptOrigin, setTurnOrigin } from '../core/turn.js';
import { ensureHub } from './ensureHub.js';
import { loadConfig, saveConfig, type Lang } from '../core/config.js';
import { t } from '../core/i18n.js';
import { isCcCommand } from '../core/ccCommand.js';

export { isCcCommand };
import { resolveClaudePid } from './claudePid.js';
import { parentClaudePid } from './parentClaude.js';
import { findBrowser, findDefaultOpener, launchAppWindow, type DefaultOpener } from './openWindow.js';
import { installLauncher, removeLauncher } from './launcher.js';

export type HookEvent = 'prompt-submit' | 'notification';
export type HookInput = {
  session_id: string;
  transcript_path: string;
  cwd: string;
  prompt?: string;
  source?: string;
  notification_type?: string;
  message?: string;
  effort?: { level?: unknown };
  permission_mode?: unknown;
};
export interface HookContext {
  /** Returns the hub URL; `notice` receives lines for the user (an older hub that could not be stopped). */
  ensureHub: (notice?: (msg: string) => void) => Promise<string>;
  /** Resolves the claude process pid of a session, or null. Default: resolveClaudePid. */
  resolvePid?: (sessionId: string) => Promise<number | null>;
  /** The claude process from the hook's parent, or null. Default: parentClaudePid (src/hooks/parentClaude.ts). */
  parentClaudePid?: () => number | null;
  /** Path of a Chrome, Chromium or Edge binary, or null. Default: findBrowser (src/hooks/openWindow.ts). */
  findBrowser?: () => string | null;
  /** The default-browser command used without Chrome, Chromium or Edge. Default: findDefaultOpener. */
  findDefaultOpener?: () => DefaultOpener | null;
  /** For tests: the platform the /cc tips are for. Default: process.platform. */
  platform?: NodeJS.Platform;
  /** For tests: the pair-code request and the browser launch. Default: global fetch, child_process.spawn. */
  fetch?: typeof fetch;
  spawn?: typeof import('node:child_process').spawn;
  /** The launcher icon (src/hooks/launcher.ts). Absent (tests): no launcher is written or removed. */
  launcher?: { install(comment: string): boolean; remove(): void };
  /** The status line wrapper of `/cc usage on|off` (src/hooks/statusline.ts). Absent (tests): settings.json untouched. */
  statusline?: { install(): Promise<InstallResult>; remove(): Promise<RemoveResult>; refresh(): Promise<void> };
}
export interface HookResult {
  stdout?: string;
  exitCode: 0;
}

const MAX_PREVIOUS_KEYS = 20;

export const UNKNOWN_ARG = 'AI Chat Center: unknown argument. Use /cc, /ai-chat-center:cc off, /ai-chat-center:cc answers on, /ai-chat-center:cc answers off, /ai-chat-center:cc window on, /ai-chat-center:cc window off, /ai-chat-center:cc usage on or /ai-chat-center:cc usage off.';
export const WINDOW_ON = 'AI Chat Center: opening the app in its own window is ON';
export const WINDOW_OFF = 'AI Chat Center: opening the app in its own window is OFF';
export const USAGE_ON = 'AI Chat Center: showing the 5-hour usage in the app is ON';
export const USAGE_OFF = 'AI Chat Center: showing the 5-hour usage in the app is OFF';
export const USAGE_FAILED = 'AI Chat Center: the status line could not be changed';
export const ANSWERS_ON = 'AI Chat Center: answering questions from the app is ON';
export const ANSWERS_OFF = 'AI Chat Center: answering questions from the app is OFF';
export const CONNECTED = 'AI Chat Center: connected';
export const PID_UNKNOWN =
  'AI Chat Center: could not identify the Claude process; closing the terminal will be detected by the hub.';

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
  // Not listed by `claude agents`: the hook's parent, when it is the claude process (exec-form hooks).
  const pid = (await resolve(sid)) ?? (ctx.parentClaudePid ?? parentClaudePid)();
  const previousKeys = [...(prev?.previousKeys ?? []), ...(prev?.key && !keep ? [prev.key] : [])].slice(-MAX_PREVIOUS_KEYS);
  const reg = await register({
    sessionId: sid,
    transcriptPath: input.transcript_path,
    cwd: input.cwd,
    pid,
    configDir: claudeConfigDir(),
    ...codeStamp(),
    // The key stays while the connection is active; a reactivation gets a new one.
    key: keep && prev.key ? prev.key : crypto.randomBytes(16).toString('hex'),
    ...(previousKeys.length ? { previousKeys } : {}),
    // Re-running /cc on an active session keeps its original connectedAt.
    ...(keep ? { connectedAt: prev.connectedAt } : {}),
  });
  // The /cc turn itself is running: a fresh marker (any older one belonged to an earlier turn) so the app
  // shows it busy (the hub needs `claude agents` busy AND the marker) and no app message is injected
  // mid-turn. Written now, before the turn's Stop waiter is spawned: that waiter clears it (clearBusyIfOlder).
  await setBusy(sid);
  await clearWaiting(sid);
  await clearTurnOrigin(sid);
  // A question left by a hook killed without cleanup would keep the session waiting in the app.
  await fs.promises.rm(paths().questionsDir(sid), { recursive: true, force: true });
  const { language, openWindow } = await loadConfig();
  await refreshStatusline(ctx);
  // The token URL is shown to the user only (systemMessage). The model gets the key and a status
  // line: the token must not end up in the model context or be repeated in its reply.
  let status: string;
  let shown: string;
  const notices: string[] = [];
  const notice = (m: string) => {
    notices.push(m);
    logError(m);
  };
  try {
    const url = await ctx.ensureHub(notice);
    shown = t(language, 'hook.ready', { url });
    status = CONNECTED;
    if (openWindow) {
      // The plugin folder and the Node path change with updates: keep the launcher pointing at this copy.
      refreshLauncher(ctx, language);
      const opened = await openWindowQuietly(url, ctx, sid);
      // Safari (or another default browser) got an ordinary tab: say how to get the app in its own window.
      if (opened === 'tab' && (ctx.platform ?? process.platform) === 'darwin') shown += `\n${t(language, 'hook.tabMacTip')}`;
    }
  } catch (e) {
    // Keep the registration: the hub will show the session once it is up.
    logError(e);
    const log = path.join(paths().logDir, 'hook.log');
    status = `AI Chat Center: the hub failed to start. See ${log}`;
    shown = t(language, 'hook.hubFailed', { log });
  }
  const lines = [status, `AI Chat Center key: ${reg.key}`, ...notices];
  if (pid === null) lines.push(PID_UNKNOWN);
  return output(lines.join('\n'), [shown, ...notices].join('\n'));
}

/** Writes or refreshes the launcher icon; true when there is one (Linux, Windows, macOS). Never fails the hook. */
/** `/cc usage on|off`: points the status line at the wrapper, or puts the user's back. */
async function usageCommand(on: boolean, ctx: HookContext): Promise<HookResult> {
  const { language } = await loadConfig();
  try {
    if (on) {
      const r = await (ctx.statusline?.install() ?? Promise.resolve<InstallResult>('installed'));
      if (r === 'failed') throw new Error('status line install failed');
      return output(USAGE_ON, t(language, 'hook.usageOn'));
    }
    const r = await (ctx.statusline?.remove() ?? Promise.resolve<RemoveResult>('restored'));
    return output(USAGE_OFF, t(language, r === 'changed-since' ? 'hook.usageOffChanged' : 'hook.usageOff'));
  } catch (e) {
    logError(e);
    const log = path.join(paths().logDir, 'hook.log');
    return output(`${USAGE_FAILED}. See ${log}`, t(language, 'hook.usageFailed', { log }));
  }
}

/** While `usage on` is set, every /cc copies the wrapper of this plugin version to its stable path. */
async function refreshStatusline(ctx: HookContext): Promise<void> {
  try {
    if (ctx.statusline && (await readStatuslineState())) await ctx.statusline.refresh();
  } catch (e) {
    logError(e);
  }
}

function refreshLauncher(ctx: HookContext, language: Lang): boolean {
  try {
    return ctx.launcher?.install(t(language, 'hook.launcherComment')) ?? false;
  } catch (e) {
    logError(e);
    return false;
  }
}

/** Opens the app window (spec 2026-11-23-app-window); never fails or delays the /cc reply beyond a short timeout. */
async function openWindowQuietly(url: string, ctx: HookContext, sid: string): Promise<'opened' | 'tab' | 'reused' | false> {
  try {
    return await launchAppWindow(url, {
      findBrowser: ctx.findBrowser ?? (() => findBrowser()),
      findDefaultOpener: ctx.findDefaultOpener ?? (() => findDefaultOpener()),
      ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
      ...(ctx.spawn ? { spawn: ctx.spawn } : {}),
      onError: (msg) => logError(msg),
    }, sid);
  } catch (e) {
    // Messages from launchAppWindow never carry the token; log the message only (no stack, no url).
    logError(e instanceof Error ? e.message : String(e));
    return false;
  }
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
    let answersResult: HookResult | undefined;
    if (cmd === 'window-on' || cmd === 'window-off') {
      const on = cmd === 'window-on';
      const { language } = await saveConfig({ openWindow: on });
      const find = ctx.findBrowser ?? (() => findBrowser());
      const browser = on ? find() : null;
      const opener = on && browser === null ? (ctx.findDefaultOpener ?? (() => findDefaultOpener()))() : null;
      let note = '';
      if (on && browser === null) note = `\n${t(language, opener ? 'hook.windowDefaultBrowser' : 'hook.windowNoBrowser')}`;
      if (on && (browser !== null || opener !== null) && refreshLauncher(ctx, language)) note += `\n${t(language, 'hook.windowLauncher')}`;
      if (!on) {
        try {
          ctx.launcher?.remove();
        } catch (e) {
          logError(e);
        }
      }
      answersResult = output(on ? WINDOW_ON : WINDOW_OFF, t(language, on ? 'hook.windowOn' : 'hook.windowOff') + note);
    }
    if (cmd === 'answers-on' || cmd === 'answers-off') {
      const on = cmd === 'answers-on';
      const { language } = await saveConfig({ answersFromApp: on });
      answersResult = output(on ? ANSWERS_ON : ANSWERS_OFF, t(language, on ? 'hook.answersOn' : 'hook.answersOff'));
    }
    if (cmd === 'usage-on' || cmd === 'usage-off') answersResult = await usageCommand(cmd === 'usage-on', ctx);
    if (cmd === 'on') return connect(input, resolve, ctx);
    // `/cc answers on|off` and `/cc window on|off` are typed turns too: they get the same bookkeeping as any other prompt.
    const reg = await getRegistration(sid);
    if (!reg) return answersResult ?? nothing;
    if (cmd === 'off') await markDisconnected(sid, 'off');
    else if (isActive(reg)) {
      // This session runs this code now (restarted after a plugin update): the hub may send to it again.
      if (!stampedByThisCode(reg)) await updateRegistration(sid, codeStamp(), { ifConnectedAt: reg.connectedAt });
      await clearWaiting(sid);
      // A turn starts (typed, or woken by a delivery): the waiter must not inject app messages until it ends.
      await setBusy(sid);
      await setTurnOrigin(sid, promptOrigin(input.prompt, reg.key));
      const level = input.effort?.level;
      if (typeof level === 'string') {
        try {
          await setEffort(sid, level);
        } catch (e) {
          logError(e); // display-only data: never break the prompt hook
        }
      }
      await recordMode(sid, input.permission_mode);
    }
    return answersResult ?? nothing;
  }

  if (event === 'notification') {
    const reg = await getRegistration(sid);
    if (!reg || !isActive(reg)) return nothing;
    await recordMode(sid, input.permission_mode);
    const type = input.notification_type;
    // idle_prompt is ignored: it fires after any idle period, not when Claude asks something.
    if (type === 'permission_prompt') await setWaiting(sid, 'permission');
    else if (type === 'elicitation_dialog' || type === 'elicitation_url_dialog' || type === 'agent_needs_input')
      await setWaiting(sid, 'input');
  }
  return nothing;
}

/** Display-only: a failure is logged, never breaks the hook. */
async function recordMode(sid: string, mode: unknown): Promise<void> {
  if (typeof mode !== 'string') return;
  try {
    await setMode(sid, mode);
  } catch (e) {
    logError(e);
  }
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

/** dist/statusline.mjs, next to this bundle (dist/hook.mjs). */
const wrapperSource = () => path.join(path.dirname(fileURLToPath(import.meta.url)), 'statusline.mjs');

export async function main(): Promise<void> {
  let result: HookResult = { exitCode: 0 };
  try {
    const event = process.argv[2] as HookEvent;
    if (event !== 'prompt-submit' && event !== 'notification') return;
    const input = JSON.parse(await readStdin()) as HookInput;
    result = await handleHook(event, input, {
      ensureHub: (notice) => ensureHub({ notice }),
      launcher: { install: (comment) => installLauncher({ comment }), remove: () => removeLauncher() },
      statusline: {
        install: () => installStatusline({ source: wrapperSource() }),
        remove: () => removeStatusline({}),
        refresh: () => refreshWrapper({ source: wrapperSource() }),
      },
    });
  } catch (e) {
    logError(e);
  }
  if (result.stdout) process.stdout.write(result.stdout, () => process.exit(0));
  else process.exitCode = 0;
}
