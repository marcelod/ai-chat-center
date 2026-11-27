// File links of a conversation (spec 2026-11-26-side-panel): which cited paths exist (asked to the hub in
// batches, each path once) and how to open one in the side panel.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ChatEvent, ToolDiff } from '@shared/types';
import { fileKind, findFilePaths } from './filePaths';

export type FileLinks = {
  isLinkable: (path: string) => boolean;
  /** Opens a file in the panel; `line` (1-based): the line cited, scrolled to and marked. */
  open: (path: string, line?: number) => void;
  /** Opens an edit's diff in the panel (spec 2026-11-27-side-panel-file-types); absent: no such button. */
  openDiff?: (title: string, diff: ToolDiff) => void;
};
const Ctx = createContext<FileLinks | null>(null);

export function FileLinksProvider({ value, children }: { value: FileLinks; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useFileLinksContext = () => useContext(Ctx);

/** Most paths one check sends (the hub answers at most 200). */
const BATCH = 200;

/** The candidate file paths of the events: paths cited in texts and the attachments the panel can show. */
export function candidatePaths(events: ChatEvent[]): string[] {
  const out = new Set<string>();
  for (const e of events) {
    if (e.kind === 'assistant' || e.kind === 'agent' || e.kind === 'toAgent' || e.kind === 'recap' || e.kind === 'user') {
      for (const p of findFilePaths(e.text)) out.add(p);
    }
    if (e.kind === 'user') for (const p of e.attachmentPaths ?? []) if (fileKind(p)) out.add(p);
  }
  return [...out];
}

/** The paths of `events` the hub says the panel can open. Each path is asked once per session. */
export function useExistingFiles(sessionId: string, events: ChatEvent[], filesExist?: (paths: string[]) => Promise<string[]>): ReadonlySet<string> {
  const [, setVersion] = useState(0);
  const known = useRef<{ sid: string; asked: Set<string>; found: Set<string> }>({ sid: sessionId, asked: new Set(), found: new Set() });
  if (known.current.sid !== sessionId) known.current = { sid: sessionId, asked: new Set(), found: new Set() };
  useEffect(() => {
    if (!filesExist) return;
    const k = known.current;
    const ask = candidatePaths(events).filter((p) => !k.asked.has(p)).slice(0, BATCH);
    if (ask.length === 0) return;
    for (const p of ask) k.asked.add(p);
    filesExist(ask).then(
      (found) => {
        if (known.current !== k || found.length === 0) return;
        for (const p of found) k.found.add(p);
        setVersion((v) => v + 1);
      },
      () => {
        for (const p of ask) k.asked.delete(p); // asked again at the next change
      },
    );
  }, [sessionId, events, filesExist]);
  return known.current.found;
}
