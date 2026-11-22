import os from 'node:os';
import path from 'node:path';

export interface Paths {
  home: string;
  token: string;
  hubJson: string;
  config: string;
  sessionsDir: string;
  inboxDir: (sid: string) => string;
  waiterLock: (sid: string) => string;
  /** Short lock around read-modify-write of a registration. */
  sessionLock: (sid: string) => string;
  waitingFile: (sid: string) => string;
  /** Present while a turn is running (set on every prompt submit, cleared by the Stop waiter; see busy.ts). */
  busyFile: (sid: string) => string;
  logDir: string;
}

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** Session ids end up in file paths: reject anything that could traverse directories. */
export function assertSessionId(sid: string): void {
  if (typeof sid !== 'string' || !SESSION_ID_RE.test(sid)) {
    throw new Error(`Invalid session id: ${JSON.stringify(sid)}`);
  }
}

export function paths(): Paths {
  const home = path.resolve(process.env.AI_CHAT_CENTER_HOME ?? path.join(os.homedir(), '.ai-chat-center'));
  return {
    home,
    token: path.join(home, 'token'),
    hubJson: path.join(home, 'hub.json'),
    config: path.join(home, 'config.json'),
    sessionsDir: path.join(home, 'sessions'),
    inboxDir: (sid) => (assertSessionId(sid), path.join(home, 'inbox', sid)),
    sessionLock: (sid) => (assertSessionId(sid), path.join(home, 'sessions', `${sid}.lock`)),
    waiterLock: (sid) => (assertSessionId(sid), path.join(home, 'waiters', `${sid}.lock`)),
    waitingFile: (sid) => (assertSessionId(sid), path.join(home, 'waiting', `${sid}.json`)),
    busyFile: (sid) => (assertSessionId(sid), path.join(home, 'busy', sid)),
    logDir: path.join(home, 'logs'),
  };
}
