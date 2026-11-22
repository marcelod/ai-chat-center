import { useState } from 'react';
import type { ToolAction } from '@shared/types';
import { useT } from '../i18n';
import { CheckIcon, ChevronDownIcon, WrenchIcon } from './icons';

function Status({ item }: { item: ToolAction }) {
  const t = useT();
  if (item.result === undefined) return <span className="text-xs font-medium text-busy-text">{t('ui.chat.running')}</span>;
  if (item.isError) return <span className="text-xs font-semibold text-danger">{t('ui.chat.error')}</span>;
  return (
    <span role="img" aria-label={t('ui.chat.done')} className="text-ok">
      <CheckIcon width={16} height={16} />
    </span>
  );
}

export function ActionsGroup({ items }: { items: ToolAction[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const names = [...new Set(items.map((i) => i.name))].join(' · ');
  const count = t(items.length === 1 ? 'ui.chat.actionsOne' : 'ui.chat.actionsMany', { n: items.length });

  return (
    <div data-actions className="max-w-[600px] self-start">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 max-w-full items-center gap-2 rounded-full border border-line bg-surface px-4 text-[13px] text-muted"
      >
        <WrenchIcon width={16} height={16} className="shrink-0" />
        <b className="font-bold text-ink">{count}</b>
        <span className="truncate">{names}</span>
        <ChevronDownIcon width={16} height={16} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul className="mt-2 w-[600px] max-w-full divide-y divide-line rounded-xl border border-line bg-surface">
          {items.map((i) => (
            <li key={i.toolUseId} className="px-3 py-2.5">
              <div className="flex items-center gap-3">
                <span className="text-[13px] font-semibold">{i.name}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted" title={i.summary}>
                  {i.summary}
                </span>
                <Status item={i} />
              </div>
              {/* `!` shell mode: the output is the point, so show it (other tools keep only their status). */}
              {i.name === 'Shell' && i.result ? (
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-field p-2 font-mono text-xs">
                  {i.result}
                </pre>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
