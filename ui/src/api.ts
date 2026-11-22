import type { ChatEvent, ProviderChange, SessionsResponse } from '@shared/types';

export type Language = 'en' | 'pt-BR';
export type UiConfig = { language: Language };

const TOKEN_KEY = 'acc.token';

function readStored(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Reads ?token= on first load, persists it and strips it from the URL. */
function initToken(): string | null {
  let token: string | null = null;
  try {
    const url = new URL(window.location.href);
    token = url.searchParams.get('token');
    if (token) {
      url.searchParams.delete('token');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  } catch {
    /* ignore */
  }
  if (token) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* storage unavailable */
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
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
  authListeners.forEach((cb) => cb());
}

export class ApiError extends Error {
  constructor(public status: number) {
    super(`${status}`);
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
  if (!res.ok) throw new ApiError(res.status);
  return (await res.json()) as T;
}

export const getSessions = () => request<SessionsResponse>('/api/sessions');
export const getEvents = (id: string) => request<ChatEvent[]>(`/api/sessions/${encodeURIComponent(id)}/events`);
export const sendMessage = (id: string, text: string) =>
  request<{ id: string }>(`/api/sessions/${encodeURIComponent(id)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
export const getConfig = () => request<UiConfig>('/api/config');
export const setConfig = (c: UiConfig) =>
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
