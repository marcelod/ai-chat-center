// Unsent text per conversation. sessionStorage (like the token): survives a reload, dies with the tab,
// never lands on disk. If storage is unavailable the in-memory map keeps drafts for the open page.
const PREFIX = 'acc.draft.';
const memory = new Map<string, string>();

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadDraft(sessionId: string): string {
  try {
    return storage()?.getItem(PREFIX + sessionId) ?? memory.get(sessionId) ?? '';
  } catch {
    return memory.get(sessionId) ?? '';
  }
}

export function saveDraft(sessionId: string, text: string): void {
  if (text) memory.set(sessionId, text);
  else memory.delete(sessionId);
  try {
    const s = storage();
    if (!s) return;
    if (text) s.setItem(PREFIX + sessionId, text);
    else s.removeItem(PREFIX + sessionId);
  } catch {
    /* storage full or blocked: the in-memory copy is enough */
  }
}
