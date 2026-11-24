import os from 'node:os';
import path from 'node:path';

export interface Paths {
  home: string;
  token: string;
  /** Per-install secret that signs inbox messages (see secret.ts). */
  secret: string;
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
  /** Origin ('app' | 'terminal') of the running turn (see turn.ts). */
  turnFile: (sid: string) => string;
  /** Ids of the last messages delivered to a session (replay protection, see delivered.ts). */
  deliveredFile: (sid: string) => string;
  /** Pending AskUserQuestion questions and their answers (see questions.ts). */
  questionsDir: (sid: string) => string;
  /** Custom display name chosen in the app (see names.ts). */
  namesFile: (sid: string) => string;
  /** Per-session info recorded by the hooks: effort level (see meta.ts). */
  metaFile: (sid: string) => string;
  /** Per-session background settings and uploaded background images (see background.ts). */
  backgroundsDir: string;
  backgroundFile: (sid: string) => string;
  /** Written by the hub while an app tab is open (see presence.ts). */
  presenceFile: string;
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
    secret: path.join(home, 'install-secret'),
    hubJson: path.join(home, 'hub.json'),
    config: path.join(home, 'config.json'),
    sessionsDir: path.join(home, 'sessions'),
    inboxDir: (sid) => (assertSessionId(sid), path.join(home, 'inbox', sid)),
    sessionLock: (sid) => (assertSessionId(sid), path.join(home, 'sessions', `${sid}.lock`)),
    waiterLock: (sid) => (assertSessionId(sid), path.join(home, 'waiters', `${sid}.lock`)),
    waitingFile: (sid) => (assertSessionId(sid), path.join(home, 'waiting', `${sid}.json`)),
    busyFile: (sid) => (assertSessionId(sid), path.join(home, 'busy', sid)),
    turnFile: (sid) => (assertSessionId(sid), path.join(home, 'turns', `${sid}.json`)),
    deliveredFile: (sid) => (assertSessionId(sid), path.join(home, 'delivered', `${sid}.json`)),
    questionsDir: (sid) => (assertSessionId(sid), path.join(home, 'questions', sid)),
    namesFile: (sid) => (assertSessionId(sid), path.join(home, 'names', `${sid}.json`)),
    metaFile: (sid) => (assertSessionId(sid), path.join(home, 'meta', `${sid}.json`)),
    backgroundsDir: path.join(home, 'backgrounds'),
    backgroundFile: (sid) => (assertSessionId(sid), path.join(home, 'backgrounds', `${sid}.json`)),
    presenceFile: path.join(home, 'app-presence.json'),
    logDir: path.join(home, 'logs'),
  };
}
