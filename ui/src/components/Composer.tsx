import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '../i18n';
import { loadDraft, saveDraft } from '../drafts';
import { SendIcon } from './icons';

type Props = { sessionId: string; name: string; disabled: boolean; blockedByQuestion?: boolean; onSend: (text: string) => Promise<void> };
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

export const LINE_PX = 22;
export const PAD_PX = 12;
export const MAX_LINES = 8;
export const MAX_HEIGHT = MAX_LINES * LINE_PX + 2 * PAD_PX;

export function Composer({ sessionId, name, disabled: sessionOff, blockedByQuestion = false, onSend }: Props) {
  const t = useT();
  const disabled = sessionOff || blockedByQuestion;
  const [text, setText] = useState(() => loadDraft(sessionId));
  const [failure, setFailure] = useState<Failure | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the content up to 8 lines, then scroll; shrinks back when the text is cleared.
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    // scrollHeight includes padding but not the border (box-sizing: border-box).
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT) + border}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, []);
  useLayoutEffect(resize, [text, resize]);
  useEffect(() => saveDraft(sessionId, text), [sessionId, text]);

  // A width change (window resize, sidebar toggle) re-wraps the text: measure again.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [resize]);

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
          ref={ref}
          rows={1}
          style={{ lineHeight: `${LINE_PX}px`, overflowY: 'hidden' }}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label={t('ui.composer.placeholder', { name })}
          placeholder={blockedByQuestion ? t('ui.composer.answerPlaceholder') : disabled ? t('ui.composer.disconnectedPlaceholder') : t('ui.composer.placeholder', { name })}
          className="min-h-[46px] flex-1 resize-none rounded-xl border border-field-border bg-surface px-3.5 py-3 text-[15px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:bg-field"
        />
        <button
          type="button"
          aria-label={t('ui.composer.send')}
          disabled={disabled || !text.trim()}
          onClick={submit}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-contrast disabled:opacity-40"
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
