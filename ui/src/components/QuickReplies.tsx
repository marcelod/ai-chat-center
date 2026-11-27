import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { DEFAULT_QUICK_REPLY_KEYS, MAX_QUICK_REPLIES, MAX_QUICK_REPLY_LENGTH, dismissSuggestion, saveQuickReplies, useDismissed, useQuickReplies } from '../quickReplies';
import { quickReplySuggestions } from '../api';
import { normalizeReply, type SuggestedReply } from '@shared/quickReplies';

// The ⚡ button under the message field (spec 2026-11-26-context-quick-replies). A pick only fills the field:
// nothing is sent until the user presses Enter, so a slip of the finger never sends a message.

export function QuickReplies({ onPick, disabled = false }: { onPick: (text: string) => void; disabled?: boolean }) {
  const t = useT();
  const saved = useQuickReplies();
  const list = saved ?? DEFAULT_QUICK_REPLY_KEYS.map((k) => t(k));
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const box = useRef<HTMLSpanElement>(null);
  // Suggestions from the hub (spec 2026-11-27-suggested-quick-replies): fetched when the menu opens; a failure
  // shows none. What is already in the list or was dismissed is not offered.
  const [suggested, setSuggested] = useState<SuggestedReply[]>([]);
  const dismissed = useDismissed();
  useEffect(() => {
    if (!open) return;
    let alive = true;
    quickReplySuggestions().then(
      (s) => alive && setSuggested(Array.isArray(s) ? s : []),
      () => alive && setSuggested([]),
    );
    return () => {
      alive = false;
    };
  }, [open]);
  const hidden = new Set([...list.map(normalizeReply), ...dismissed]);
  const offered = suggested.filter((s) => typeof s?.text === 'string' && !hidden.has(normalizeReply(s.text)));
  const button = useRef<HTMLButtonElement>(null);

  const close = (refocus = false) => {
    setOpen(false);
    setEditing(false);
    setDraft('');
    if (refocus) button.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const add = () => {
    const s = draft.trim();
    if (!s) return;
    saveQuickReplies([...list, s]);
    setDraft('');
  };
  const full = list.length >= MAX_QUICK_REPLIES;
  const small = 'rounded-lg px-2 py-1 text-xs font-semibold text-accent hover:bg-field disabled:opacity-40';

  return (
    <span ref={box} className="relative flex shrink-0">
      <button
        ref={button}
        type="button"
        aria-label={t('ui.quickReplies.label')}
        title={t('ui.quickReplies.label')}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        className={`flex h-7 w-7 items-center justify-center rounded-full text-sm hover:bg-field disabled:opacity-40 ${open ? 'bg-field' : ''}`}
      >
        <span aria-hidden="true">⚡</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t('ui.quickReplies.label')}
          className="absolute bottom-full left-0 z-30 mb-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-1.5 shadow-lg"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close(true);
            }
          }}
        >
          {list.length === 0 && <p className="px-2.5 py-1.5 text-xs text-muted">{t('ui.quickReplies.empty')}</p>}
          <ul className="max-h-64 overflow-y-auto">
            {list.map((text, i) => (
              <li key={text} className="flex items-center gap-1">
                <button
                  type="button"
                  autoFocus={i === 0 && !editing}
                  aria-label={t('ui.quickReplies.use', { text })}
                  onClick={() => {
                    close();
                    onPick(text);
                  }}
                  className="min-w-0 flex-1 truncate rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-field"
                >
                  {text}
                </button>
                {editing && (
                  <button
                    type="button"
                    aria-label={t('ui.quickReplies.remove', { text })}
                    onClick={() => saveQuickReplies(list.filter((x) => x !== text))}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-field hover:text-danger"
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
          {offered.length > 0 && (
            <section aria-label={t('ui.quickReplies.suggestions')} className="mx-0.5 mt-1 border-t border-line pt-1">
              <p className="truncate px-2 pb-0.5 text-[11px] text-muted" title={t('ui.quickReplies.suggestionsHint')}>
                <span className="font-semibold">{t('ui.quickReplies.suggestions')}</span> · {t('ui.quickReplies.suggestionsHint')}
              </p>
              <ul className="max-h-40 overflow-y-auto">
                {offered.map(({ text }) => (
                  <li key={text} className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={t('ui.quickReplies.useSuggestion', { text })}
                      onClick={() => {
                        close();
                        onPick(text);
                      }}
                      className="min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-[13px] italic text-ink hover:bg-field"
                    >
                      {text}
                    </button>
                    <button
                      type="button"
                      aria-label={t('ui.quickReplies.addSuggestion', { text })}
                      title={t('ui.quickReplies.addSuggestion', { text })}
                      disabled={full}
                      onClick={() => saveQuickReplies([...list, text])}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-semibold text-accent hover:bg-field disabled:opacity-40"
                    >
                      <span aria-hidden="true">+</span>
                    </button>
                    <button
                      type="button"
                      aria-label={t('ui.quickReplies.dismiss', { text })}
                      title={t('ui.quickReplies.dismiss', { text })}
                      onClick={() => dismissSuggestion(text)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-field hover:text-danger"
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className="mx-0.5 my-1 border-t border-line" />
          {editing ? (
            <form
              className="flex items-center gap-1 px-1"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <input
                autoFocus
                value={draft}
                maxLength={MAX_QUICK_REPLY_LENGTH}
                disabled={full}
                onChange={(e) => setDraft(e.target.value)}
                aria-label={t('ui.quickReplies.new')}
                placeholder={t('ui.quickReplies.new')}
                className="min-w-0 flex-1 rounded-lg border border-field-border bg-surface px-2 py-1 text-[13px] text-ink outline-none focus:border-accent"
              />
              <button type="submit" disabled={full || !draft.trim()} className={small}>
                {t('ui.quickReplies.add')}
              </button>
              <button type="button" onClick={() => { setEditing(false); setDraft(''); }} className={small}>
                {t('ui.quickReplies.done')}
              </button>
            </form>
          ) : (
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="min-w-0 truncate px-1 text-[11px] text-muted">{t('ui.quickReplies.hint')}</span>
              <button type="button" onClick={() => setEditing(true)} className={small}>
                {t('ui.quickReplies.edit')}
              </button>
            </div>
          )}
        </div>
      )}
    </span>
  );
}
