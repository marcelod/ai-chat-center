import { useState, type KeyboardEvent } from 'react';
import { useT } from '../i18n';
import { SendIcon } from './icons';

type Props = { name: string; disabled: boolean; blockedByQuestion?: boolean; onSend: (text: string) => Promise<void> };
type Failure = { kind: 'disconnected' } | { kind: 'version'; direction: 'older' | 'newer' } | { kind: 'failed'; text: string };

/** The session runs another version of the plugin (audit R5-M1): `session-older-version` / `session-newer-version`. */
const versionOf = (e: unknown): 'older' | 'newer' | null => {
  const c = (e as { code?: unknown } | null)?.code;
  return c === 'session-older-version' ? 'older' : c === 'session-newer-version' ? 'newer' : null;
};

const statusOf = (e: unknown): number | undefined => {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : Number((e as Error | null)?.message);
};

export function Composer({ name, disabled: sessionOff, blockedByQuestion = false, onSend }: Props) {
  const t = useT();
  const disabled = sessionOff || blockedByQuestion;
  const [text, setText] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);

  const deliver = async (body: string) => {
    setFailure(null);
    try {
      await onSend(body);
    } catch (e) {
      if (statusOf(e) === 409) {
        setText((cur) => (cur === '' ? body : cur));
        const direction = versionOf(e);
        setFailure(direction ? { kind: 'version', direction } : { kind: 'disconnected' });
      } else {
        setFailure({ kind: 'failed', text: body });
      }
    }
  };

  const submit = () => {
    const body = text.trim();
    if (!body || disabled) return;
    setText('');
    void deliver(body);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <footer className="border-t border-line bg-surface px-4 py-3 md:px-12">
      {failure?.kind === 'disconnected' && (
        <p role="alert" className="mb-2 text-sm text-danger">
          {t('ui.composer.sendDisconnected')}
        </p>
      )}
      {failure?.kind === 'version' && (
        <p role="alert" className="mb-2 text-sm text-danger">
          {t(failure.direction === 'older' ? 'ui.composer.sendOlderVersion' : 'ui.composer.sendNewerVersion')}
        </p>
      )}
      {failure?.kind === 'failed' && (
        <p role="alert" className="mb-2 flex items-center gap-2 text-sm text-danger">
          {t('ui.composer.sendFailed')}
          <button
            type="button"
            onClick={() => void deliver(failure.text)}
            className="min-h-11 rounded-lg px-3 font-semibold underline"
          >
            {t('ui.composer.retry')}
          </button>
        </p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label={t('ui.composer.placeholder', { name })}
          placeholder={blockedByQuestion ? t('ui.composer.answerPlaceholder') : disabled ? t('ui.composer.disconnectedPlaceholder') : t('ui.composer.placeholder', { name })}
          className="max-h-40 min-h-[46px] flex-1 resize-none rounded-xl border border-field-border bg-surface px-3.5 py-3 text-[15px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:bg-field"
        />
        <button
          type="button"
          aria-label={t('ui.composer.send')}
          disabled={disabled || !text.trim()}
          onClick={submit}
          className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl bg-accent text-accent-contrast disabled:opacity-40"
        >
          <SendIcon />
        </button>
      </div>
      {sessionOff ? (
        <p className="mt-2 rounded-lg bg-field px-3 py-2 text-[12.5px] text-muted">{t('ui.composer.disconnectedHint')}</p>
      ) : (
        <p className="mt-2 text-[11.5px] text-muted">{t('ui.composer.hint')}</p>
      )}
    </footer>
  );
}
