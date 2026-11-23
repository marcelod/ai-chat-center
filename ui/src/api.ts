import type { ChatEvent, ProviderChange, SessionsResponse } from '@shared/types';

export type Language = 'en' | 'pt-BR';
export type UiConfig = { language: Language; answersFromApp: boolean };

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

/**
 * Reads the token on first load from the fragment (`#token=`, printed by /cc since 0.2.2: never sent to
 * the server, less likely to persist) or, for links printed by 0.2.1 and earlier, from `?token=`. Keeps
 * it for this tab and clears it from the URL either way. (`?token=` is accepted during 0.2.x only.)
 */
function initToken(): string | null {
  try {
    localStorage.removeItem(TOKEN_KEY); // left by 0.1.x
  } catch {
    /* storage unavailable */
  }
  let token: string | null = null;
  try {
    const url = new URL(window.location.href);
    const frag = new URLSearchParams(url.hash.replace(/^#/, ''));
    const fromHash = frag.get('token');
    const fromQuery = url.searchParams.get('token');
    token = fromHash || fromQuery;
    if (fromHash !== null || fromQuery !== null) {
      frag.delete('token');
      url.searchParams.delete('token');
      const hash = frag.toString();
      window.history.replaceState(null, '', url.pathname + url.search + (hash ? `#${hash}` : ''));
    }
  } catch {
    /* ignore */
  }
  if (token) {
    try {
      storage()?.setItem(TOKEN_KEY, token);
    } catch {
      /* storage unavailable: the token lives in memory only */
    }
    return token;
  }
  return readStored();
}

let token: string | null = initToken();

export function hasToken(): boolean {
  if (!token) token = initToken();
  return Boolean(token);
}

const authListeners = new Set<() => void>();

/** Subscribes to token loss (a 401 from the hub). Returns an unsubscribe function. */
export function onAuthLost(cb: () => void): () => void {
  authListeners.add(cb);
  return () => authListeners.delete(cb);
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
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token ?? ''}`,
    },
  });
  if (res.status === 401) dropToken();
  if (!res.ok) throw new ApiError(res.status, await errorCode(res));
  return (await res.json()) as T;
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
export const getConfig = () => request<UiConfig>('/api/config');
export const setConfig = (c: Pick<UiConfig, 'language'>) =>
  request<UiConfig>('/api/config', { method: 'PUT', body: JSON.stringify(c) });

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
  es.onopen = () => handlers.onOpen?.();
  es.onerror = () => handlers.onError?.();
  return () => es.close();
}
