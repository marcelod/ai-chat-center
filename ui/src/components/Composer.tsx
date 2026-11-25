import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, withAttachments } from '@shared/attachments';
import { useT } from '../i18n';
import { loadDraft, saveDraft } from '../drafts';
import { PaperclipIcon, SendIcon } from './icons';
import { PendingAttachments, type PendingFile } from './Attachments';
import { classify, suggestions } from '../commands';

type Props = {
  sessionId: string;
  name: string;
  disabled: boolean;
  blockedByQuestion?: boolean;
  onSend: (text: string) => Promise<void>;
  /** Uploads one file to the hub and resolves to its absolute path. Without it, nothing can be attached. */
  onUpload?: (file: File) => Promise<string>;
  /**
   * Types a slash command into a background session (spec 2026-11-24-background-sessions). Present only for
   * a background session: there, a one-line message starting with `/` goes here instead of onSend.
   */
  onCommand?: (text: string) => Promise<void>;
  /** Short id of the background session, for "use claude attach <id>" when a command needs the terminal. */
  attachId?: string;
};
/** A one-line message that names a slash command (`/compact`, `/rename x`): the hub's rule (bgSessions.isValidCommand). A path such as `/home/x` is text. */
export const isSlashCommand = (text: string) => text.length <= 200 && /^\/[A-Za-z0-9][\w:.-]*( [^\n]*)?$/.test(text);
type CommandNote = { kind: 'sent' | 'busy' | 'windows' | 'failed' | 'screen' | 'terminal'; cmd: string };
type Failure = { kind: 'disconnected' } | { kind: 'version'; direction: 'older' | 'newer' } | { kind: 'failed'; text: string };
type AttachError = { kind: 'tooLarge'; name: string } | { kind: 'tooMany' } | { kind: 'upload' };

let nextFileId = 0;
const objectUrl = (f: File): string | undefined => {
  if (!f.type.startsWith('image/') || typeof URL.createObjectURL !== 'function') return undefined;
  try {
    return URL.createObjectURL(f);
  } catch {
    return undefined;
  }
};
const revoke = (p: PendingFile) => {
  if (p.url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(p.url);
};
const hasFiles = (dt: DataTransfer | null) => Boolean(dt && Array.from(dt.types ?? []).includes('Files'));

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

export function Composer({ sessionId, name, disabled: sessionOff, blockedByQuestion = false, onSend, onUpload, onCommand, attachId }: Props) {
  const t = useT();
  const disabled = sessionOff || blockedByQuestion;
  const [text, setText] = useState(() => loadDraft(sessionId));
  const [failure, setFailure] = useState<Failure | null>(null);
  // Attachments live in memory only (not in the draft): they need not survive a reload.
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [attachError, setAttachError] = useState<AttachError | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [command, setCommand] = useState<CommandNote | null>(null);
  /** A slash command typed in an interactive session: held until the user says to send it as text. */
  const [asText, setAsText] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  // The list of commands shown while a command name is typed in a background session (spec 2026-11-25-app-batch).
  const [pick, setPick] = useState(0);
  const [menuOff, setMenuOff] = useState<string | null>(null);
  const menu = onCommand && !disabled && menuOff !== text ? suggestions(text) : [];
  const menuId = `${sessionId}-commands`;
  const picker = useRef<HTMLInputElement>(null);
  const filesRef = useRef(files);
  filesRef.current = files;
  // Hub path of each pending file already uploaded (by PendingFile id): a retry after a partial failure reuses it.
  const uploadedRef = useRef(new Map<string, string>());
  // Thumbnails are object URLs: released when the composer goes away.
  useEffect(() => () => filesRef.current.forEach(revoke), []);

  const addFiles = (list: File[]) => {
    if (!onUpload || disabled || uploading || list.length === 0) return;
    let error: AttachError | null = null;
    const room = MAX_ATTACHMENTS - filesRef.current.length;
    const fit: File[] = [];
    for (const f of list) {
      if (f.size > MAX_ATTACHMENT_BYTES) error = { kind: 'tooLarge', name: f.name };
      else if (fit.length >= room) error ??= { kind: 'tooMany' };
      else fit.push(f);
    }
    setAttachError(error);
    if (fit.length === 0) return;
    const added = fit.map((file) => ({ id: `f${++nextFileId}`, file, url: objectUrl(file) }));
    const next = [...filesRef.current, ...added];
    filesRef.current = next;
    setFiles(next);
  };
  const removeFile = (id: string) => {
    const gone = filesRef.current.find((f) => f.id === id);
    if (gone) revoke(gone);
    uploadedRef.current.delete(id);
    const next = filesRef.current.filter((f) => f.id !== id);
    filesRef.current = next;
    setFiles(next);
    setAttachError(null);
  };

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

  // A failed send keeps its text (drafts spec): put back in the box (409), or held by the retry banner.
  // Either is gone once the chat is switched, so the text then becomes the chat's draft unless it has one.
  const mounted = useRef(false);
  const textRef = useRef(text);
  textRef.current = text;
  const failureRef = useRef(failure);
  failureRef.current = failure;
  const keepAsDraft = useCallback(
    (body: string) => {
      if (!loadDraft(sessionId)) saveDraft(sessionId, body);
    },
    [sessionId],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const f = failureRef.current;
      if (f?.kind === 'failed' && !textRef.current) keepAsDraft(f.text);
    };
  }, [keepAsDraft]);

  const deliver = async (body: string) => {
    setFailure(null);
    try {
      await onSend(body);
    } catch (e) {
      if (!mounted.current) {
        keepAsDraft(body);
        return;
      }
      if (statusOf(e) === 409) {
        setText((cur) => (cur === '' ? body : cur));
        const direction = versionOf(e);
        setFailure(direction ? { kind: 'version', direction } : { kind: 'disconnected' });
      } else {
        setFailure({ kind: 'failed', text: body });
      }
    }
  };

  const runCommand = async (cmd: string) => {
    if (!onCommand) return;
    setFailure(null);
    setCommand(null);
    try {
      await onCommand(cmd);
      if (mounted.current) setCommand({ kind: 'sent', cmd });
    } catch (e) {
      if (!mounted.current) return keepAsDraft(cmd);
      const st = statusOf(e);
      setText((cur) => (cur === '' ? cmd : cur));
      setCommand({ kind: st === 409 ? 'busy' : st === 501 ? 'windows' : 'failed', cmd });
    }
  };

  const submit = async () => {
    const typed = text.trim();
    const batch = filesRef.current;
    if ((!typed && batch.length === 0) || disabled || uploading) return;
    setCommand(null);
    if (batch.length === 0 && isSlashCommand(typed)) {
      if (onCommand) {
        const kind = classify(typed);
        if (kind !== 'app') {
          setCommand({ kind, cmd: typed.split(' ')[0] }); // the text stays in the box
          return;
        }
        setText('');
        void runCommand(typed);
        return;
      }
      if (asText !== typed) {
        setAsText(typed); // asks once; the text stays in the box
        return;
      }
    }
    setAsText(null);
    if (batch.length === 0 || !onUpload) {
      if (!typed) return;
      setText('');
      void deliver(typed);
      return;
    }
    // Upload first; the text and the files stay in the box until every file is on the hub.
    setUploading(true);
    setAttachError(null);
    setFailure(null);
    const paths: string[] = [];
    try {
      for (const f of batch) {
        let stored = uploadedRef.current.get(f.id);
        if (stored === undefined) {
          stored = await onUpload(f.file);
          uploadedRef.current.set(f.id, stored);
        }
        paths.push(stored);
      }
    } catch (e) {
      if (!mounted.current) return; // the files are gone with the composer; the text is still the draft
      setUploading(false);
      if (statusOf(e) === 409) {
        const direction = versionOf(e);
        setFailure(direction ? { kind: 'version', direction } : { kind: 'disconnected' });
      } else setAttachError({ kind: 'upload' });
      return;
    }
    const body = withAttachments(typed, paths);
    if (!mounted.current) {
      // Switched chat during the upload: the message still goes to its session; its text is no draft anymore.
      if (loadDraft(sessionId).trim() === typed) saveDraft(sessionId, '');
      void onSend(body).catch(() => keepAsDraft(body));
      return;
    }
    setUploading(false);
    batch.forEach(revoke);
    uploadedRef.current.clear();
    filesRef.current = [];
    setFiles([]);
    setText('');
    void deliver(body);
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(e.clipboardData?.files ?? []);
    if (pasted.length === 0 || !onUpload) return;
    // Text wins (e.g. cells copied from a spreadsheet also carry an image): let the browser paste it.
    if (Array.from(e.clipboardData?.types ?? []).includes('text/plain')) return;
    e.preventDefault();
    addFiles(pasted);
  };
  const canDrop = Boolean(onUpload) && !disabled && !uploading;
  const onDragOver = (e: DragEvent<HTMLElement>) => {
    if (!canDrop || !hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  };
  const onDrop = (e: DragEvent<HTMLElement>) => {
    setDragging(false);
    if (!canDrop || !hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    addFiles(Array.from(e.dataTransfer.files ?? []));
  };

  const choose = (i: number) => {
    const c = menu[i];
    if (!c) return;
    const next = c.arg ? `${c.cmd} ` : c.cmd;
    setText(next);
    setMenuOff(next); // a full name: the list closes until the text changes
    setPick(0);
    ref.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menu.length > 0 && !e.nativeEvent.isComposing) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = menu.length;
        setPick((p) => (Math.min(p, n - 1) + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenuOff(text);
        return;
      }
      const c = menu[Math.min(pick, menu.length - 1)];
      // Tab, or Enter on a name not typed in full, completes it; Enter on the full name sends it.
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && c.cmd !== text.trim())) {
        e.preventDefault();
        choose(Math.min(pick, menu.length - 1));
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <footer
      className={`border-t bg-surface px-4 py-3 md:px-12 ${dragging ? 'border-accent ring-2 ring-inset ring-accent/40' : 'border-line'}`}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {dragging && <p className="mb-2 text-sm font-semibold text-accent">{t('ui.composer.dropHere')}</p>}
      {attachError && (
        <p role="alert" className="mb-2 text-sm text-danger">
          {attachError.kind === 'tooLarge'
            ? t('ui.composer.attachTooLarge', { name: attachError.name })
            : attachError.kind === 'tooMany'
              ? t('ui.composer.attachTooMany', { max: MAX_ATTACHMENTS })
              : t('ui.composer.attachFailed')}
        </p>
      )}
      {uploading && (
        <p role="status" className="mb-2 text-sm text-muted">
          {t('ui.composer.uploading')}
        </p>
      )}
      <PendingAttachments files={files} onRemove={removeFile} disabled={uploading} />
      {command && (
        <p role={command.kind === 'sent' ? 'status' : 'alert'} className={`mb-2 text-sm ${command.kind === 'sent' ? 'text-muted' : 'text-danger'}`}>
          {command.kind === 'sent'
            ? t('ui.composer.commandSent', { cmd: command.cmd })
            : command.kind === 'screen'
              ? t('ui.composer.commandScreen', { cmd: command.cmd, attach: `claude attach ${attachId ?? ''}`.trim() })
              : command.kind === 'terminal'
                ? t('ui.composer.commandTerminal', { cmd: command.cmd, attach: `claude attach ${attachId ?? ''}`.trim() })
                : command.kind === 'busy'
              ? t('ui.composer.commandBusy')
              : command.kind === 'windows'
                ? t('ui.composer.commandWindows')
                : t('ui.composer.commandFailed')}
        </p>
      )}
      {asText !== null && asText === text.trim() && (
        <div role="alert" className="mb-2 flex flex-wrap items-center gap-2 text-sm text-waiting-text">
          <span>{t('ui.composer.slashInteractive', { cmd: asText.split(' ')[0] })}</span>
          <button type="button" onClick={() => void submit()} className="min-h-11 rounded-lg px-3 font-semibold underline">
            {t('ui.composer.sendAsText')}
          </button>
          <button type="button" onClick={() => setAsText(null)} className="min-h-11 rounded-lg px-3 underline">
            {t('ui.composer.cancel')}
          </button>
        </div>
      )}
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
        {onUpload && (
          <>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              tabIndex={-1}
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            <button
              type="button"
              aria-label={t('ui.composer.attach')}
              title={t('ui.composer.attach')}
              disabled={disabled || uploading}
              onClick={() => picker.current?.click()}
              className="flex h-12 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-field disabled:opacity-40"
            >
              <PaperclipIcon />
            </button>
          </>
        )}
        <div className="relative flex-1">
        {menu.length > 0 && (
          <ul
            id={menuId}
            role="listbox"
            aria-label={t('ui.commands.label')}
            className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-72 overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-lg"
          >
            {menu.map((c, i) => (
              <li
                key={c.cmd}
                id={`${menuId}-${i}`}
                role="option"
                aria-selected={i === Math.min(pick, menu.length - 1)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(i);
                }}
                className="cursor-pointer px-3 py-2 text-sm aria-selected:bg-selected hover:bg-field"
              >
                <span className="font-mono font-semibold text-ink">{c.cmd}</span>
                {c.arg && <span className="ml-1.5 font-mono text-xs text-muted">{t(c.arg)}</span>}
                <span className="block text-xs text-muted">{t(c.desc)}</span>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={ref}
          rows={1}
          style={{ lineHeight: `${LINE_PX}px`, overflowY: 'hidden' }}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          readOnly={uploading}
          aria-label={t('ui.composer.placeholder', { name })}
          aria-controls={menu.length > 0 ? menuId : undefined}
          aria-activedescendant={menu.length > 0 ? `${menuId}-${Math.min(pick, menu.length - 1)}` : undefined}
          aria-autocomplete={onCommand ? 'list' : undefined}
          placeholder={blockedByQuestion ? t('ui.composer.answerPlaceholder') : disabled ? t('ui.composer.disconnectedPlaceholder') : t('ui.composer.placeholder', { name })}
          className="block min-h-[46px] w-full resize-none rounded-xl border border-field-border bg-surface px-3.5 py-3 text-[15px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:bg-field"
        />
        </div>
        <button
          type="button"
          aria-label={t('ui.composer.send')}
          disabled={disabled || uploading || (!text.trim() && files.length === 0)}
          onClick={() => void submit()}
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
