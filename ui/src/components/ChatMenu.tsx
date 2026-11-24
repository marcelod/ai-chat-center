import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '../i18n';
import { MoreIcon } from './icons';

type Props = {
  /** Opens the title's rename input (absent: no Rename item). */
  onRename?: () => void;
  /** Removes the session from the app (absent: no Remove item). Rejects when the hub refused. */
  onRemove?: () => Promise<void>;
  /** Opens the background picker (absent: no Background item). */
  onBackground?: () => void;
};

/**
 * The ⋮ menu of a conversation (spec 2026-11-24-chat-menu-remove). Escape closes it and returns focus to
 * the button, a click outside closes it, arrow keys move between items. "Remove from app" asks to confirm
 * in place (a second click), never with window.confirm.
 */
export const ChatMenu = forwardRef<HTMLButtonElement, Props>(function ChatMenu({ onRename, onRemove, onBackground }, button) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const ownButton = useRef<HTMLButtonElement | null>(null);

  const setButton = (el: HTMLButtonElement | null) => {
    ownButton.current = el;
    if (typeof button === 'function') button(el);
    else if (button) button.current = el;
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    setConfirming(false);
    setFailed(false);
    if (refocus) ownButton.current?.focus();
  };

  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useLayoutEffect(() => {
    if (open) items()[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close(false);
    };
    // On the document, so Escape closes the menu wherever the focus is (a click on its padding, say).
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close(true);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!onRename && !onRemove && !onBackground) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      close(false);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const list = items();
    if (list.length === 0) return;
    const at = list.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
    list[next].focus();
  };

  const remove = async () => {
    if (!onRemove || busy) return;
    if (!confirming) {
      setConfirming(true);
      setFailed(false);
      return;
    }
    setBusy(true);
    try {
      await onRemove();
      setOpen(false);
      setConfirming(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const itemCls = 'flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm hover:bg-field focus:bg-field focus:outline-none';

  return (
    <div className="relative shrink-0" ref={root}>
      <button
        type="button"
        ref={setButton}
        aria-label={t('ui.chatMenu.label')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close(false) : setOpen(true))}
        className="flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-field"
      >
        <MoreIcon width={18} height={18} />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={t('ui.chatMenu.label')}
          onKeyDown={onKeyDown}
          className="absolute left-0 top-12 z-10 w-56 rounded-xl border border-line bg-surface p-1.5 shadow-lg"
        >
          {onRename && (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={itemCls}
              onClick={() => {
                close(false);
                onRename();
              }}
            >
              {t('ui.chatMenu.rename')}
            </button>
          )}
          {onBackground && (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-haspopup="dialog"
              className={itemCls}
              onClick={() => {
                close(false);
                onBackground();
              }}
            >
              {t('ui.background.menu')}
            </button>
          )}
          {onRemove && (
            <ConfirmItem
              className={`${itemCls} ${confirming ? 'font-semibold text-waiting-text' : ''}`}
              confirming={confirming}
              busy={busy}
              onClick={() => void remove()}
            />
          )}
          {failed && (
            <p role="alert" className="px-3 py-1 text-xs text-waiting-text">
              {t('ui.chatMenu.removeFailed')}
            </p>
          )}
        </div>
      )}
    </div>
  );
});

function ConfirmItem({ confirming, busy, className, onClick }: { confirming: boolean; busy: boolean; className: string; onClick: () => void }) {
  const t = useT();
  const self = useRef<HTMLButtonElement>(null);
  // The label changes under the user's focus: keep focus on it so a second Enter confirms.
  useLayoutEffect(() => {
    if (confirming) self.current?.focus();
  }, [confirming]);
  return (
    <button ref={self} type="button" role="menuitem" tabIndex={-1} aria-disabled={busy || undefined} className={className} onClick={onClick}>
      {t(confirming ? 'ui.chatMenu.confirmRemove' : 'ui.chatMenu.remove')}
    </button>
  );
}
