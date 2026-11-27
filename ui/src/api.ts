import type { ChatEvent, ProviderChange, SessionsResponse, StoppedBackground, SubagentInfo } from '@shared/types';
import type { BackgroundPreset } from '@shared/background';
import type { SearchHit } from '@shared/search';
import type { SuggestedReply } from '@shared/quickReplies';
import type { WindowSize } from '@shared/windowSize';

export type Language = 'en' | 'pt-BR';
export type UiConfig = { language: Language; answersFromApp: boolean; windowSize?: WindowSize };

const TOKEN_KEY = 'acc.token';

// The token is kept per browser tab (sessionStorage): it dies with the tab, and it rotates on every
// hub start anyway. Never localStorage, which any page later served on this origin could read.
function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readStored(): string | null {
  try {
    return storage()?.getItem(TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

const PAIR_CODE_RE = /^[0-9a-f]{64}$/;

function keep(t: string): void {
  try {
    storage()?.setItem(TOKEN_KEY, t);
  } catch {
    /* storage unavailable: the token lives in memory only */
  }
}

/**
 * Reads the token on first load from the fragment (`#token=`, printed by /cc since 0.2.2: never sent to
 * the server, less likely to persist) or, for links printed by 0.2.1 and earlier, from `?token=`. Keeps
 * it for this tab and clears it from the URL either way. (`?token=` is accepted during 0.2.x only.)
 * A window opened by /cc carries `#pair=<one-time code>` instead (the token never goes on the browser's
 * command line): the code is cleared from the URL here too and returned for the trade (see `ready`).
 */
function initToken(): { token: string | null; pairCode: string | null } {
  try {
    localStorage.removeItem(TOKEN_KEY); // left by 0.1.x
  } catch {
    /* storage unavailable */
  }
  let token: string | null = null;
  let pairCode: string | null = null;
  try {
    const url = new URL(window.location.href);
    const frag = new URLSearchParams(url.hash.replace(/^#/, ''));
    const fromHash = frag.get('token');
    const fromQuery = url.searchParams.get('token');
    const fromPair = frag.get('pair');
    token = fromHash || fromQuery;
    if (fromHash !== null || fromQuery !== null || fromPair !== null) {
      frag.delete('token');
      frag.delete('pair');
      url.searchParams.delete('token');
      const hash = frag.toString();
      window.history.replaceState(null, '', url.pathname + url.search + (hash ? `#${hash}` : ''));
    }
    if (!token && fromPair !== null && PAIR_CODE_RE.test(fromPair)) pairCode = fromPair;
  } catch {
    /* ignore */
  }
  if (token) {
    keep(token);
    return { token, pairCode: null };
  }
  return { token: readStored(), pairCode };
}

/** Trades a one-time pairing code for the token (POST /api/pair). Any failure leaves no token; never throws. */
async function redeemPairCode(code: string): Promise<void> {
  try {
    const res = await fetch('/api/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      cache: 'no-store',
    });
    if (!res.ok) return;
    const j = (await res.json()) as { token?: unknown };
    if (typeof j?.token === 'string' && j.token !== '') {
      token = j.token;
      keep(j.token);
    }
  } catch {
    /* hub unreachable or bad answer: no token */
  }
}

const initial = initToken();
let token: string | null = initial.token;
/** The pairing trade started at load (at most once per page load), or null when there was no `#pair=`. */
const pairing: Promise<void> | null = initial.pairCode ? redeemPairCode(initial.pairCode) : null;

let pairingPending = pairing !== null;
void pairing?.then(() => {
  pairingPending = false;
});

/** True when this page load came with `#pair=`: a window just opened by /cc or the launcher. */
export function openedByPair(): boolean {
  return pairing !== null;
}

/** True while the `#pair=` trade started at load has not finished (the App waits for `ready`). */
export function isPairing(): boolean {
  return pairingPending;
}

/** Resolves once the token is settled (after the `#pair=` trade, if any): whether there is one. */
export async function ready(): Promise<boolean> {
  if (pairing) await pairing;
  return hasToken();
}

export function hasToken(): boolean {
  if (!token) token = initToken().token;
  return Boolean(token);
}

const authListeners = new Set<() => void>();

/** Subscribes to token loss (a 401 from the hub). Returns an unsubscribe function. */
export function onAuthLost(cb: () => void): () => void {
  authListeners.add(cb);
  return () => authListeners.delete(cb);
}

const byeListeners = new Set<() => void>();

/** Subscribes to the hub saying `bye` on the stream (it is stopping). A token loss follows at once. */
export function onHubStopped(cb: () => void): () => void {
  byeListeners.add(cb);
  return () => byeListeners.delete(cb);
}

function dropToken(): void {
  token = null;
  try {
    storage()?.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
  authListeners.forEach((cb) => cb());
}

export class ApiError extends Error {
  /** `code` from the hub's error body, e.g. `session-older-version` on a 409 (audit R5-M1). */
  constructor(
    public status: number,
    public code?: string,
  ) {
    super(`${status}`);
  }
}

async function errorCode(res: Response): Promise<string | undefined> {
  try {
    const j = (await res.json()) as { code?: unknown };
    return typeof j?.code === 'string' ? j.code : undefined;
  } catch {
    return undefined;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (pairing) await pairing; // never send a request before the #pair= trade settled the token
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token ?? ''}`,
    },
  });
  if (res.status === 401) dropToken();
  if (!res.ok) {
    const body = await errorBody(res);
    throw Object.assign(new ApiError(res.status, body.code), body.detail ? { detail: body.detail } : {});
  }
  return (await res.json()) as T;
}

async function errorBody(res: Response): Promise<{ code?: string; detail?: string }> {
  try {
    const j = (await res.json()) as { code?: unknown; error?: unknown };
    return { code: typeof j?.code === 'string' ? j.code : undefined, detail: typeof j?.error === 'string' ? j.error : undefined };
  } catch {
    return {};
  }
}

/** Messages that contain `q` in every conversation of the app (newest first). */
export async function searchAll(q: string): Promise<SearchHit[]> {
  return (await request<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`)).hits;
}

/** Messages the user often sends, offered as quick replies (spec 2026-11-27-suggested-quick-replies). */
export async function quickReplySuggestions(): Promise<SuggestedReply[]> {
  return (await request<{ suggestions: SuggestedReply[] }>('/api/quick-replies/suggestions')).suggestions;
}

export type Folder = { cwd: string; lastUsed: string };
/** The folders the user already ran sessions in (the "recent" list of the "+" dialog). */
export async function listFolders(): Promise<Folder[]> {
  return (await request<{ folders: Folder[] }>('/api/folders')).folders;
}
export type FolderListing = { path: string; parent: string | null; entries: { name: string; path: string }[]; truncated: boolean };
/**
 * The subfolders of a folder inside the home folder (default: the home folder itself). Rejects with ApiError
 * (`code`: folder-invalid, folder-outside, folder-not-found, folder-denied).
 */
export async function browseFolders(path?: string, hidden = false): Promise<FolderListing> {
  const q = new URLSearchParams();
  if (path) q.set('path', path);
  if (hidden) q.set('hidden', '1');
  const qs = q.toString();
  return request<FolderListing>(`/api/folders/browse${qs ? `?${qs}` : ''}`);
}
export type NewSessionInput = { cwd: string; name?: string; model?: string; effort?: string };
/**
 * Starts a new background session that connects to the app at once. Resolves to its short id when
 * `claude --bg` showed one. Rejects with ApiError (`detail`: the output of `claude --bg` on a 502; `code`
 * `untrusted` when the folder was never trusted in Claude Code).
 */
export async function newSession(input: NewSessionInput): Promise<{ bgId?: string }> {
  const check = await verifyHub();
  if (check === 'mismatch') {
    dropToken();
    throw new ApiError(401);
  }
  return request<{ bgId?: string }>('/api/sessions', { method: 'POST', body: JSON.stringify(input) });
}

/** Drops the token (the hub could not prove it knows it): the app shows the "open the /cc link" screen. */
export function forgetToken(): void {
  dropToken();
}

export type HubCheck = 'ok' | 'mismatch' | 'unreachable';

const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Audit S4-S3: after the hub exits (idle, replaced, killed), anything that later listens on its port would
 * receive what this tab sends. Before (re)connecting and before every message, the tab asks the server to
 * prove it knows the token: HMAC-SHA256(token, `challenge|port|pid|version`) over a fresh challenge, bound
 * to the port this page was loaded from (the same proof /cc checks). 'mismatch' for any answer without a
 * valid proof; 'unreachable' when nothing answered (the hub may be restarting).
 */
export async function verifyHub(): Promise<HubCheck> {
  if (pairing) await pairing;
  const subtle = globalThis.crypto?.subtle;
  if (!token || !subtle) return 'mismatch'; // 127.0.0.1 is a secure context: WebCrypto is always there
  const challenge = hex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  let res: Response;
  try {
    res = await fetch(`/api/health?challenge=${challenge}`, { cache: 'no-store' });
  } catch {
    return 'unreachable';
  }
  let j: { ok?: unknown; pid?: unknown; version?: unknown; proof?: unknown };
  try {
    j = (await res.json()) as typeof j;
  } catch {
    return 'mismatch';
  }
  if (!res.ok || j?.ok !== true || typeof j.pid !== 'number' || typeof j.version !== 'string' || typeof j.proof !== 'string') return 'mismatch';
  const port = Number(window.location.port || (window.location.protocol === 'https:' ? 443 : 80));
  const enc = new TextEncoder();
  try {
    const key = await subtle.importKey('raw', enc.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const want = hex(await subtle.sign('HMAC', key, enc.encode(`${challenge}|${port}|${j.pid}|${j.version}`)));
    return want === j.proof ? 'ok' : 'mismatch';
  } catch {
    return 'mismatch';
  }
}

export const getSessions = () => request<SessionsResponse>('/api/sessions');
export const getEvents = (id: string) => request<ChatEvent[]>(`/api/sessions/${encodeURIComponent(id)}/events`);
/** Never POSTs to a server that cannot prove it is the hub (see verifyHub). */
export async function sendMessage(id: string, text: string): Promise<{ id: string }> {
  const check = await verifyHub();
  if (check === 'mismatch') {
    dropToken();
    throw new ApiError(401);
  }
  if (check === 'unreachable') throw new ApiError(0);
  return request<{ id: string }>(`/api/sessions/${encodeURIComponent(id)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}
/**
 * Uploads one file for the session's next message; resolves to its absolute path on the hub machine.
 * Raw body with the browser's type; the name travels URI-encoded in X-File-Name. Like sendMessage, the
 * file is never POSTed to a server that cannot prove it is the hub.
 */
export async function uploadAttachment(sid: string, file: File): Promise<string> {
  if (pairing) await pairing;
  const check = await verifyHub();
  if (check === 'mismatch') {
    dropToken();
    throw new ApiError(401);
  }
  if (check === 'unreachable') throw new ApiError(0);
  const res = await fetch(`/api/sessions/${encodeURIComponent(sid)}/attachments`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name),
      Authorization: `Bearer ${token ?? ''}`,
    },
    body: file,
  });
  if (res.status === 401) dropToken();
  if (!res.ok) throw new ApiError(res.status, await errorCode(res));
  const j = (await res.json()) as { path?: unknown };
  if (typeof j?.path !== 'string') throw new ApiError(500);
  return j.path;
}
const questionPath = (sid: string, toolUseId: string) =>
  `/api/sessions/${encodeURIComponent(sid)}/questions/${encodeURIComponent(toolUseId)}`;
export async function answerQuestion(sid: string, toolUseId: string, answers: Record<string, string>): Promise<void> {
  await request<unknown>(questionPath(sid, toolUseId), { method: 'POST', body: JSON.stringify({ answers }) });
}
export async function releaseQuestion(sid: string, toolUseId: string): Promise<void> {
  await request<unknown>(questionPath(sid, toolUseId), { method: 'POST', body: JSON.stringify({ release: true }) });
}
export const renameSession = (sid: string, name: string) =>
  request<{ name: string }>(`/api/sessions/${encodeURIComponent(sid)}/name`, { method: 'PUT', body: JSON.stringify({ name }) });
/** Takes the session out of the app; an active one is disconnected (a later /cc brings it back). */
export async function removeSession(sid: string): Promise<void> {
  await request<unknown>(`/api/sessions/${encodeURIComponent(sid)}/remove`, { method: 'POST' });
}
/** Resumes an ended session in the background (spec 2026-11-24-background-sessions); 202 once started. */
export async function resumeSession(sid: string): Promise<void> {
  await request<unknown>(`/api/sessions/${encodeURIComponent(sid)}/resume`, { method: 'POST' });
}
/**
 * Opens the system terminal running `claude attach` on a background session. Rejects with ApiError: 409
 * (code `not-background`, `session-disconnected` or `folder-missing`), 502 (code `no-terminal` or `spawn-failed`).
 */
export async function openTerminal(sid: string): Promise<void> {
  await request<unknown>(`/api/sessions/${encodeURIComponent(sid)}/open-terminal`, { method: 'POST' });
}
// Stop, restart and remove a background session (spec 2026-11-26-stop-respawn-rm). Each rejects with ApiError:
// 409 (code `not-background`, `session-disconnected` or `busy`), 503 (lookup failed), 502 (code `claude-failed`,
// with claude's own words in `detail`).
const sessionAction = (sid: string, action: 'stop' | 'respawn' | 'rm') =>
  request<unknown>(`/api/sessions/${encodeURIComponent(sid)}/${action}`, { method: 'POST' });
/** `claude stop`: the session ends (it can be resumed later). */
export async function stopSession(sid: string): Promise<void> {
  await sessionAction(sid, 'stop');
}
/** `claude respawn`: restarts the session on the current Claude Code version. */
export async function respawnSession(sid: string): Promise<void> {
  await sessionAction(sid, 'respawn');
}
/** `claude rm`: removes the background session (and its worktree when safe) and takes it out of the app. */
export async function rmSession(sid: string): Promise<void> {
  await sessionAction(sid, 'rm');
}
/** Background sessions Claude Code lists that no longer run. */
export async function listStoppedBackground(): Promise<StoppedBackground[]> {
  return (await request<{ sessions: StoppedBackground[] }>('/api/background/stopped')).sessions;
}
/** `claude rm` on a stopped background session, by its short id. */
export async function rmStoppedBackground(bgId: string): Promise<void> {
  await request<unknown>(`/api/background/${encodeURIComponent(bgId)}/rm`, { method: 'POST' });
}
/**
 * Types a slash command into a background session. Rejects with ApiError: 409 busy, 501 Windows, 404 not a
 * background session. Like sendMessage, never POSTs to a server that cannot prove it is the hub.
 */
export async function sendCommand(sid: string, text: string): Promise<void> {
  const check = await verifyHub();
  if (check === 'mismatch') {
    dropToken();
    throw new ApiError(401);
  }
  if (check === 'unreachable') throw new ApiError(0);
  await request<unknown>(`/api/sessions/${encodeURIComponent(sid)}/command`, { method: 'POST', body: JSON.stringify({ text }) });
}
/** Pins or unpins the conversation at the top of the list, for every window. */
export async function pinSession(sid: string, pinned: boolean): Promise<void> {
  await request<unknown>(`/api/sessions/${encodeURIComponent(sid)}/pin`, { method: 'PUT', body: JSON.stringify({ pinned }) });
}
/** Disconnects an active session like /cc off; it stays in the list as disconnected. */
export async function disconnectSession(sid: string): Promise<void> {
  await request<unknown>(`/api/sessions/${encodeURIComponent(sid)}/disconnect`, { method: 'POST' });
}
const backgroundPath = (sid: string) => `/api/sessions/${encodeURIComponent(sid)}/background`;
/** Sets a preset background (ids only) or none. */
export async function setBackground(sid: string, bg: BackgroundPreset | null): Promise<void> {
  await request<unknown>(backgroundPath(sid), { method: 'PUT', body: JSON.stringify(bg) });
}
/** Uploads the raw image (the hub checks its bytes and the 5 MB cap). Rejects with ApiError (413, 415…). */
export async function uploadBackgroundImage(sid: string, file: Blob): Promise<void> {
  if (pairing) await pairing;
  const res = await fetch(`${backgroundPath(sid)}-image`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream', Authorization: `Bearer ${token ?? ''}` },
    body: file,
  });
  if (res.status === 401) dropToken();
  if (!res.ok) throw new ApiError(res.status, await errorCode(res));
}
/** The background image, fetched with the token (an <img> or CSS url() could not send it): show it from a blob: URL. */
export async function getBackgroundImage(sid: string): Promise<Blob> {
  if (pairing) await pairing;
  const res = await fetch(`${backgroundPath(sid)}-image`, { headers: { Authorization: `Bearer ${token ?? ''}` } });
  if (res.status === 401) dropToken();
  if (!res.ok) throw new ApiError(res.status);
  return res.blob();
}
/**
 * A Markdown file or an image of the session, for the side panel (fetched with the token: show an image
 * from a blob: URL). Rejects with ApiError (`code`: file-not-found, file-outside, file-type, file-too-large…).
 */
export async function getSessionFile(sid: string, path: string): Promise<Blob> {
  if (pairing) await pairing;
  const res = await fetch(`/api/sessions/${encodeURIComponent(sid)}/file?path=${encodeURIComponent(path)}`, {
    headers: { Authorization: `Bearer ${token ?? ''}` },
  });
  if (res.status === 401) dropToken();
  if (!res.ok) throw new ApiError(res.status, await errorCode(res));
  return res.blob();
}
/** Which of the paths (cited in the conversation) the side panel can open. */
export async function filesExist(sid: string, paths: string[]): Promise<string[]> {
  return (await request<{ exists: string[] }>(`/api/sessions/${encodeURIComponent(sid)}/files/exists`, { method: 'POST', body: JSON.stringify({ paths }) })).exists;
}
/** The side panel's loaders bound to one session (see components/SidePanel). */
export function panelApi(sid: string) {
  return {
    file: (path: string) => getSessionFile(sid, path),
    filesExist: (paths: string[]) => filesExist(sid, paths),
    subagents: async () => (await request<{ subagents: SubagentInfo[] }>(`/api/sessions/${encodeURIComponent(sid)}/subagents`)).subagents,
    subagentEvents: (id: string) => request<ChatEvent[]>(`/api/sessions/${encodeURIComponent(sid)}/subagents/${encodeURIComponent(id)}/events`),
    screen: async () => (await request<{ text: string }>(`/api/sessions/${encodeURIComponent(sid)}/screen`)).text,
  };
}
export const getConfig = () => request<UiConfig>('/api/config');
export const setConfig = (c: Pick<UiConfig, 'language'>) =>
  request<UiConfig>('/api/config', { method: 'PUT', body: JSON.stringify(c) });

/** Reports the app window's size; the next window /cc opens takes it (see useWindowSize). */
export async function saveWindowSize(size: WindowSize): Promise<void> {
  await request<unknown>('/api/window-size', { method: 'PUT', body: JSON.stringify(size) });
}

export type StreamHandlers = { onOpen?: () => void; onError?: () => void };

/** Opens the SSE stream; returns a function that closes it. Reconnecting is the caller's job (see onError). */
export function openStream(onChange: (c: ProviderChange) => void, handlers: StreamHandlers = {}): () => void {
  const es = new EventSource(`/api/stream?token=${encodeURIComponent(token ?? '')}`);
  const handle = (e: MessageEvent) => {
    try {
      onChange(JSON.parse(e.data) as ProviderChange);
    } catch {
      /* ignore malformed frame */
    }
  };
  es.addEventListener('sessions', handle as EventListener);
  es.addEventListener('events', handle as EventListener);
  // /cc asked the open page to show a session: useAppWindow pings at once to learn which one.
  es.addEventListener('focus', () => window.dispatchEvent(new Event(WINDOW_FOCUS_EVENT)));
  // The hub is going away (stopped, or replaced by a newer version): its token dies with it. The page ends
  // (spec 2026-11-27-old-window-after-update); nothing reconnects.
  es.addEventListener('bye', () => {
    es.close();
    byeListeners.forEach((cb) => cb());
    dropToken();
  });
  es.onopen = () => handlers.onOpen?.();
  es.onerror = () => handlers.onError?.();
  return () => es.close();
}

/** Fired on window when the hub says a /cc wants this page to show a session (see useAppWindow). */
export const WINDOW_FOCUS_EVENT = 'acc:window-focus';

export type WindowFocus = { seq: number; sessionId: string } | null;

/**
 * Tells the hub this app page is open (`closing: false`) or closing. /cc opens a new window only when no
 * page is open; otherwise it asks the open page to show its session, which comes back here as `focus`.
 * Closing uses a keepalive request, which still goes out while the page unloads.
 */
export async function pingWindow(id: string, closing = false): Promise<WindowFocus> {
  if (closing) {
    try {
      void fetch('/api/window', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
        body: JSON.stringify({ id, closing: true }),
      }).catch(() => {});
    } catch {
      /* the page is going away anyway */
    }
    return null;
  }
  const r = await request<{ focus?: WindowFocus }>('/api/window', { method: 'POST', body: JSON.stringify({ id }) });
  const f = r?.focus;
  return f && typeof f.seq === 'number' && typeof f.sessionId === 'string' ? f : null;
}
