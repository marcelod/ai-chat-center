import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { EFFORTS, MODELS } from './NewSessionDialog';

// Switching the model and the effort of a background session from the app (spec 2026-11-25-app-batch):
// each choice types `/model <alias>` or `/effort <level>` through the command route.

const statusOf = (e: unknown) => (e as { status?: unknown } | null)?.status;

/**
 * `working`: the session is not idle. The hub only types commands into an idle session, so a choice made meanwhile
 * (a session just opened by "+" is busy running its first command) is kept and sent once the session is idle.
 * `unavailable`: not a background session, nothing can be sent.
 */
export function SessionControls({ onCommand, working, unavailable = false }: { onCommand: (line: string) => Promise<void>; working: boolean; unavailable?: boolean }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ model?: string; effort?: string }>({});
  const sending = useRef(false);
  const send = async (lines: string[]) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      for (const line of lines) await onCommand(line);
    } catch (e) {
      const s = statusOf(e);
      setError(t(s === 409 ? 'ui.composer.commandBusy' : s === 501 ? 'ui.composer.commandWindows' : 'ui.composer.commandFailed'));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const choose = (kind: 'model' | 'effort', value: string) => {
    if (!value) return;
    if (working) setPending((p) => ({ ...p, [kind]: value }));
    else void send([`/${kind} ${value}`]);
  };
  // The session became idle: apply what was chosen while it worked.
  useEffect(() => {
    if (working || unavailable || (!pending.model && !pending.effort)) return;
    const lines = [...(pending.model ? [`/model ${pending.model}`] : []), ...(pending.effort ? [`/effort ${pending.effort}`] : [])];
    setPending({});
    void send(lines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [working, pending]);
  const waiting = working && (pending.model || pending.effort);
  const sel = 'h-7 rounded-md border border-line bg-surface px-1.5 text-xs text-ink disabled:opacity-50';
  return (
    <span
      data-testid="session-controls"
      title={unavailable ? t('ui.chat.controlsTerminal') : undefined}
      className="flex flex-wrap items-center gap-1.5 pt-1 font-sans"
    >
      <select
        aria-label={unavailable ? `${t('ui.chat.switchModel')}. ${t('ui.chat.controlsTerminal')}` : t('ui.chat.switchModel')}
        value={pending.model ?? ''}
        disabled={unavailable || busy}
        onChange={(e) => choose('model', e.target.value)}
        className={sel}
      >
        <option value="">{t('ui.chat.switchModel')}</option>
        {MODELS.filter(Boolean).map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <select
        aria-label={unavailable ? `${t('ui.chat.switchEffort')}. ${t('ui.chat.controlsTerminal')}` : t('ui.chat.switchEffort')}
        value={pending.effort ?? ''}
        disabled={unavailable || busy}
        onChange={(e) => choose('effort', e.target.value)}
        className={sel}
      >
        <option value="">{t('ui.chat.switchEffort')}</option>
        {EFFORTS.filter(Boolean).map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      {/* Seen live (Claude Code 2.1.332): /model and /effort also save the choice as the default for new sessions. */}
      <span className="text-[11px] text-muted">
        {unavailable ? t('ui.chat.controlsTerminalShort') : waiting ? t('ui.chat.switchWhenIdle') : t('ui.chat.switchSavesDefault')}
      </span>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
