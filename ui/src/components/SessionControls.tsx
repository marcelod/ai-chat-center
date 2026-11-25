import { useState } from 'react';
import { useT } from '../i18n';
import { EFFORTS, MODELS } from './NewSessionDialog';

// Switching the model and the effort of a background session from the app (spec 2026-11-25-app-batch):
// each choice types `/model <alias>` or `/effort <level>` through the command route.

const statusOf = (e: unknown) => (e as { status?: unknown } | null)?.status;

export function SessionControls({ onCommand, disabled, unavailable = false }: { onCommand: (line: string) => Promise<void>; disabled: boolean; unavailable?: boolean }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (line: string) => {
    setBusy(true);
    setError(null);
    try {
      await onCommand(line);
    } catch (e) {
      const s = statusOf(e);
      setError(t(s === 409 ? 'ui.composer.commandBusy' : s === 501 ? 'ui.composer.commandWindows' : 'ui.composer.commandFailed'));
    } finally {
      setBusy(false);
    }
  };
  const sel = 'h-7 rounded-md border border-line bg-surface px-1.5 text-xs text-ink disabled:opacity-50';
  return (
    <span
      data-testid="session-controls"
      title={unavailable ? t('ui.chat.controlsTerminal') : undefined}
      className="flex flex-wrap items-center gap-1.5 pt-1 font-sans"
    >
      <select
        aria-label={unavailable ? `${t('ui.chat.switchModel')}. ${t('ui.chat.controlsTerminal')}` : t('ui.chat.switchModel')}
        value=""
        disabled={disabled || busy}
        onChange={(e) => e.target.value && void send(`/model ${e.target.value}`)}
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
        value=""
        disabled={disabled || busy}
        onChange={(e) => e.target.value && void send(`/effort ${e.target.value}`)}
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
      <span className="text-[11px] text-muted">{unavailable ? t('ui.chat.controlsTerminalShort') : t('ui.chat.switchSavesDefault')}</span>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
