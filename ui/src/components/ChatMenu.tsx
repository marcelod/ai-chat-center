import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '../i18n';
import { MoreIcon } from './icons';

type Props = {
  /** Opens the title's rename input (absent: no Rename item). */
  onRename?: () => void;
  /** Removes the session from the app (absent: no Remove item). Rejects when the hub refused. */
  onRemove?: () => Promise<void>;
  /** Pins or unpins the conversation (absent: no Pin item). Rejects when the hub refused. */
  onPin?: (pinned: boolean) => Promise<void>;
  pinned?: boolean;
  /** Disconnects the session from the app, keeping it listed (absent: no Disconnect item). Rejects when the hub refused. */
  onDisconnect?: () => Promise<void>;
  /** Opens the background picker (absent: no Background item). */
  onBackground?: () => void;
  /** Resumes the ended session in the background (absent: no Resume item). Rejects when the hub refused. */
  onResume?: () => Promise<void>;
};

/**
 * The ⋮ menu of a conversation (spec 2026-11-24-chat-menu-remove). Escape closes it and returns focus to
 * the button, a click outside closes it, arrow keys move between items. "Remove from app" asks to confirm
 * in place (a second click), never with window.confirm.
 */
export const ChatMenu = forwardRef<HTMLButtonElement, Props>(function ChatMenu({ onRename, onRemove, onPin, pinned = false, onDisconnect, onBackground, onResume }, button) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<'disconnect' | 'remove' | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
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
    setConfirming(null);
    setFailed(null);
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

  if (!onRename && !onRemove && !onPin && !onDisconnect && !onBackground && !onResume) return null;

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

  // Disconnect and Remove ask for a second click in place; a refusal is said in the menu.
  const confirmed = async (which: 'disconnect' | 'remove', act: (() => Promise<void>) | undefined, failKey: string) => {
    if (!act || busy) return;
    if (confirming !== which) {
      setConfirming(which);
      setFailed(null);
      return;
    }
    setBusy(true);
    try {
      await act();
      setOpen(false);
      setConfirming(null);
    } catch {
      setFailed(failKey);
    } finally {
      setBusy(false);
    }
  };

  const pin = async () => {
    if (!onPin || busy) return;
    setBusy(true);
    try {
      await onPin(!pinned);
      close(false);
    } catch {
      setFailed('ui.chatMenu.pinFailed');
    } finally {
      setBusy(false);
    }
  };

  const resume = async () => {
    if (!onResume || busy) return;
    setBusy(true);
    try {
      await onResume();
      close(false);
    } catch {
      setFailed('ui.chat.resume.error');
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
          {onResume && (
            <button type="button" role="menuitem" tabIndex={-1} aria-disabled={busy || undefined} className={itemCls} onClick={() => void resume()}>
              {t('ui.chatMenu.resume')}
            </button>
          )}
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
          {onPin && (
            <button type="button" role="menuitem" tabIndex={-1} aria-disabled={busy || undefined} className={itemCls} onClick={() => void pin()}>
              {t(pinned ? 'ui.chatMenu.unpin' : 'ui.chatMenu.pin')}
            </button>
          )}
          {onDisconnect && (
            <ConfirmItem
              className={`${itemCls} ${confirming === 'disconnect' ? 'font-semibold text-waiting-text' : ''}`}
              confirming={confirming === 'disconnect'}
              busy={busy}
              label="ui.chatMenu.disconnect"
              confirmLabel="ui.chatMenu.confirmDisconnect"
              onClick={() => void confirmed('disconnect', onDisconnect, 'ui.chatMenu.disconnectFailed')}
            />
          )}
          {onRemove && (
            <ConfirmItem
              className={`${itemCls} ${confirming === 'remove' ? 'font-semibold text-waiting-text' : ''}`}
              confirming={confirming === 'remove'}
              busy={busy}
              label="ui.chatMenu.remove"
              confirmLabel="ui.chatMenu.confirmRemove"
              onClick={() => void confirmed('remove', onRemove, 'ui.chatMenu.removeFailed')}
            />
          )}
          {failed && (
            <p role="alert" className="px-3 py-1 text-xs text-waiting-text">
              {t(failed)}
            </p>
          )}
        </div>
      )}
    </div>
  );
});

function ConfirmItem({ confirming, busy, className, label, confirmLabel, onClick }: { confirming: boolean; busy: boolean; className: string; label: string; confirmLabel: string; onClick: () => void }) {
  const t = useT();
  const self = useRef<HTMLButtonElement>(null);
  // The label changes under the user's focus: keep focus on it so a second Enter confirms.
  useLayoutEffect(() => {
    if (confirming) self.current?.focus();
  }, [confirming]);
  return (
    <button ref={self} type="button" role="menuitem" tabIndex={-1} aria-disabled={busy || undefined} className={className} onClick={onClick}>
      {t(confirming ? confirmLabel : label)}
    </button>
  );
}
