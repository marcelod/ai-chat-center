import { useT } from '../i18n';
import { CloseIcon, FileIcon } from './icons';

/** A file picked in the composer, not sent yet. `url`: object URL of an image's thumbnail. */
export type PendingFile = { id: string; file: File; url?: string };

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The composer's files: thumbnail (image) or file icon, name and size, each removable. */
export function PendingAttachments({ files, onRemove, disabled }: { files: PendingFile[]; onRemove: (id: string) => void; disabled?: boolean }) {
  const t = useT();
  if (files.length === 0) return null;
  return (
    <ul aria-label={t('ui.composer.attachments')} className="mb-2 flex flex-wrap gap-2">
      {files.map((f) => (
        <li key={f.id} className="flex max-w-[260px] items-center gap-2 rounded-lg border border-line bg-field py-1 pl-1 pr-1 text-[13px]">
          {f.url ? (
            <img src={f.url} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface text-muted">
              <FileIcon width={18} height={18} />
            </span>
          )}
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-ink" title={f.file.name}>
              {f.file.name}
            </span>
            <span className="text-[11px] text-muted">{formatSize(f.file.size)}</span>
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRemove(f.id)}
            aria-label={t('ui.composer.removeAttachment', { name: f.file.name })}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface disabled:opacity-40"
          >
            <CloseIcon width={14} height={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The files a sent message carries (names only: the files live on the hub machine). */
export function SentAttachments({ names }: { names: string[] }) {
  const t = useT();
  if (names.length === 0) return null;
  return (
    <ul aria-label={t('ui.chat.attachments')} className="mt-1 flex flex-wrap gap-1.5">
      {names.map((n, i) => (
        <li key={`${i}-${n}`} className="flex max-w-full items-center gap-1 rounded-md bg-field px-2 py-0.5 text-[12px] text-muted">
          <FileIcon width={13} height={13} className="shrink-0" />
          <span className="truncate" title={n}>
            {n}
          </span>
        </li>
      ))}
    </ul>
  );
}
