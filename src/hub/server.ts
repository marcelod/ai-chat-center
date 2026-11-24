import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Provider } from './provider.js';
import { SessionDisconnectedError, SessionProtocolError } from './provider.js';
import type { ProviderChange } from '../shared/types.js';
import { assertSessionId } from '../core/paths.js';
import { loadConfig, saveConfig, type Lang } from '../core/config.js';
import { writePresence } from '../core/presence.js';
import { assertToolUseId, getPending, validAnswers, writeAnswer, type AnswerFile } from '../core/questions.js';
import { setDisplayName, validDisplayName } from '../core/names.js';
import { setPinned } from '../core/pins.js';
import { readBackgroundImage, saveBackgroundImage, setBackground, validBackgroundPreset } from '../core/background.js';
import { BACKGROUND_IMAGE_MAX } from '../shared/background.js';
import { getRegistration, isActive, markDisconnected, markRemoved } from '../core/registry.js';
import { VERSION } from '../core/version.js';
import { CHALLENGE_RE, healthProof } from '../core/healthProof.js';
import { createPairing } from './pairing.js';

export interface HubOptions {
  provider: Provider;
  token: string;
  port: number;
  staticDir: string;
  pollMs?: number;
  log?: (msg: string) => void;
  /** For tests: the clock of the window pings. */
  now?: () => number;
}

const MAX_BODY = 64 * 1024;
const MAX_TEXT = 32_000;
const HEARTBEAT_MS = 15_000;
/**
 * An app page pings `/api/window` every WINDOW_PING_MS, hidden or not (a hidden page closes its stream).
 * Chrome throttles the timers of a hidden page to about once a minute, so a page counts as open while
 * its last ping is younger than WINDOW_FRESH_MS. A page that closes says so (keepalive POST on pagehide).
 */
export const WINDOW_FRESH_MS = 150_000;
const MAX_WINDOWS = 20;
const WINDOW_ID_RE = /^[0-9a-f]{32}$/;
const LANGS: Lang[] = ['en', 'pt-BR'];

const CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'";

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const FALLBACK_PAGE =
  '<!doctype html><html><head><meta charset="utf-8"><title>AI Chat Center</title></head><body><h1>UI not built</h1><p>Run the build to generate the web UI.</p></body></html>';

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function tokenOk(given: string | null | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Reads at most `max` bytes: over that (declared or while streaming) the rest is discarded and it fails with 413. */
function readRawBody(req: http.IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > max) {
      req.resume();
      return reject(new HttpError(413, 'body too large'));
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c: Buffer) => {
      if (tooBig) return;
      size += c.length;
      if (size > max) {
        tooBig = true;
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => (tooBig ? reject(new HttpError(413, 'body too large')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return (await readRawBody(req, MAX_BODY)).toString('utf8');
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const ct = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (ct !== 'application/json') {
    req.resume();
    throw new HttpError(415, 'content-type must be application/json');
  }
  const raw = await readBody(req);
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

export async function createHub(
  opts: HubOptions,
): Promise<{ url: string; clients(): number; windows(): number; close(): Promise<void>; server: http.Server }> {
  const { provider, token, staticDir } = opts;
  const pollMs = opts.pollMs ?? 500;
  const log = opts.log ?? (() => {});
  let port = opts.port;

  const pairing = createPairing();
  const now = opts.now ?? Date.now;
  /** App pages alive: page id -> last ping. Map keeps insertion order (oldest first). */
  const windows = new Map<string, number>();
  /** The last "show this session" request from /cc, for the open pages to pick up on their next ping. */
  let focus: { seq: number; sessionId: string } | null = null;
  const liveWindows = () => {
    const t = now();
    for (const [id, at] of windows) if (t - at >= WINDOW_FRESH_MS) windows.delete(id);
    return windows.size;
  };
  const clients = new Set<http.ServerResponse>();
  let pollTimer: NodeJS.Timeout | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  let closed = false;

  const publishPresence = () => {
    writePresence(clients.size).catch((e) => log(`presence write failed: ${(e as Error).message}`));
  };
  const fanOut = (c: ProviderChange) => {
    const frame = `event: ${c.type}\ndata: ${JSON.stringify(c)}\n\n`;
    for (const r of clients) r.write(frame);
  };
  let pollGen = 0;
  let inFlight: Promise<void> | null = null;
  const POLL_TIMEOUT_MS = 10_000;
  const schedulePoll = (gen: number) => {
    pollTimer = setTimeout(async () => {
      if (gen !== pollGen) return;
      // Never overlap polls, even across generations: wait for any in-flight poll first.
      while (inFlight) {
        await inFlight;
        if (gen !== pollGen) return;
      }
      let changes: ProviderChange[] = [];
      let timer: NodeJS.Timeout | undefined;
      try {
        const real = Promise.resolve().then(() => provider.poll());
        const tracked: Promise<void> = real.then(
          () => {},
          () => {},
        ).finally(() => {
          if (inFlight === tracked) inFlight = null;
        });
        inFlight = tracked;
        const timeout = new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), POLL_TIMEOUT_MS);
        });
        const r = await Promise.race([real, timeout]);
        if (r === null) log('poll timed out');
        else changes = r;
      } catch (e) {
        log(`poll failed: ${(e as Error).message}`);
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (gen !== pollGen) return;
      for (const c of changes) fanOut(c);
      if (clients.size > 0 && !closed) schedulePoll(gen);
      else pollTimer = null;
    }, pollMs);
  };
  const startTimers = () => {
    if (pollTimer || heartbeat) return;
    schedulePoll(++pollGen);
    heartbeat = setInterval(() => {
      for (const r of clients) r.write(': heartbeat\n\n');
      publishPresence();
    }, HEARTBEAT_MS);
  };
  const stopTimers = () => {
    pollGen++;
    if (pollTimer) clearTimeout(pollTimer);
    if (heartbeat) clearInterval(heartbeat);
    pollTimer = heartbeat = null;
  };

  const sendJson = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  const serveStatic = async (req: http.IncomingMessage, res: http.ServerResponse, pathname: string) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 404, { error: 'not found' });
    let rel: string;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return sendJson(res, 404, { error: 'not found' });
    }
    if (rel.includes('\0')) return sendJson(res, 404, { error: 'not found' });
    const root = path.resolve(staticDir);
    const target = path.resolve(root, '.' + path.sep + rel);
    if (target !== root && !target.startsWith(root + path.sep)) return sendJson(res, 404, { error: 'not found' });

    const send = async (file: string): Promise<boolean> => {
      try {
        const st = await fs.stat(file);
        if (!st.isFile()) return false;
        const data = await fs.readFile(file);
        const ext = path.extname(file).toLowerCase();
        const type = MIME[ext] ?? 'application/octet-stream';
        const headers: Record<string, string | number> = { 'Content-Type': type, 'Content-Length': data.length };
        if (ext === '.html') headers['Content-Security-Policy'] = CSP;
        res.writeHead(200, headers);
        res.end(req.method === 'HEAD' ? undefined : data);
        return true;
      } catch {
        return false;
      }
    };

    let rootExists = true;
    try {
      rootExists = (await fs.stat(root)).isDirectory();
    } catch {
      rootExists = false;
    }
    const accepts = String(req.headers.accept ?? '').includes('text/html');
    const spaEligible = req.method === 'GET' && accepts && path.extname(pathname) === '';
    const isRoot = pathname === '/';
    if (!rootExists) {
      if (isRoot || spaEligible) {
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Security-Policy': CSP });
        return void res.end(FALLBACK_PAGE);
      }
      return sendJson(res, 404, { error: 'not found' });
    }
    if (target !== root && (await send(target))) return;
    if (isRoot || spaEligible) {
      if (await send(path.join(root, 'index.html'))) return;
    }
    sendJson(res, 404, { error: 'not found' });
  };

  const handleApi = async (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => {
    const p = url.pathname;
    const method = req.method ?? 'GET';
    if (p === '/api/health' && method === 'GET') {
      // Unauthenticated: reveals nothing but the version. With a challenge it proves knowledge of the
      // token, so ensureHub never hands the token URL to an impostor on this port. The proof binds the
      // port this server listens on: relayed through another port, it no longer verifies.
      const challenge = url.searchParams.get('challenge');
      if (challenge === null) return sendJson(res, 200, { ok: true, version: VERSION });
      if (!CHALLENGE_RE.test(challenge)) throw new HttpError(400, 'invalid challenge');
      const proof = healthProof(token, challenge, port, process.pid, VERSION);
      return sendJson(res, 200, { ok: true, version: VERSION, pid: process.pid, proof });
    }

    if (p === '/api/pair' && method === 'POST') {
      // Unauthenticated, like health, but behind the same Origin/Host check and body limit as every route:
      // trades a one-time code from /api/pair-code for the token (a window opened at #pair=<code>).
      const body = (await readJsonBody(req)) as { code?: unknown } | null;
      const code = body && typeof body === 'object' && !Array.isArray(body) ? body.code : undefined;
      if (typeof code !== 'string' || !pairing.redeem(code)) throw new HttpError(400, 'invalid code');
      return sendJson(res, 200, { token });
    }

    const bearer = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1];
    const given = p === '/api/stream' ? (bearer ?? url.searchParams.get('token')) : bearer;
    if (!tokenOk(given, token)) return sendJson(res, 401, { error: 'unauthorized' });

    if (p === '/api/stream' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      clients.add(res);
      startTimers();
      publishPresence();
      res.on('close', () => {
        clients.delete(res);
        if (!closed) publishPresence();
        if (clients.size === 0) stopTimers();
      });
      return;
    }
    if (p === '/api/pair-code' && method === 'POST') {
      // /cc asks this before opening a window. With an app page already open, no window is needed: that
      // page is asked to show the session instead (`{live: true}`, no code), so only one window stays open.
      // The body is optional (older hooks send none).
      const json = String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json');
      const body = (json ? await readJsonBody(req) : (req.resume(), null)) as { sessionId?: unknown } | null;
      const sid = body && typeof body === 'object' && !Array.isArray(body) ? body.sessionId : undefined;
      if (liveWindows() > 0) {
        if (typeof sid === 'string') {
          try {
            assertSessionId(sid);
            focus = { seq: (focus?.seq ?? 0) + 1, sessionId: sid };
            // A visible page holds a stream: tell it now instead of at its next ping (up to 20 s later).
            for (const r of clients) r.write('event: focus\ndata: {}\n\n');
          } catch {
            /* no valid session to show: the open page stays as it is */
          }
        }
        return sendJson(res, 200, { live: true });
      }
      return sendJson(res, 200, { code: pairing.issue() });
    }
    if (p === '/api/window' && method === 'POST') {
      const body = (await readJsonBody(req)) as { id?: unknown; closing?: unknown } | null;
      const id = body && typeof body === 'object' && !Array.isArray(body) ? body.id : undefined;
      if (typeof id !== 'string' || !WINDOW_ID_RE.test(id)) throw new HttpError(400, 'invalid window id');
      windows.delete(id);
      if (body!.closing !== true) {
        liveWindows();
        while (windows.size >= MAX_WINDOWS) windows.delete(windows.keys().next().value as string);
        windows.set(id, now());
      }
      return sendJson(res, 200, { focus });
    }
    if (p === '/api/sessions' && method === 'GET') return sendJson(res, 200, await provider.listSessions());
    if (p === '/api/config' && method === 'GET') return sendJson(res, 200, await loadConfig());
    if (p === '/api/config' && method === 'PUT') {
      const body = (await readJsonBody(req)) as { language?: unknown } | null;
      if (!body || typeof body !== 'object' || !LANGS.includes(body.language as Lang)) throw new HttpError(400, 'invalid language');
      await saveConfig({ language: body.language as Lang });
      return sendJson(res, 200, { language: body.language });
    }
    const m = /^\/api\/sessions\/([^/]+)\/(events|messages|name|pin|disconnect|remove|background|background-image|questions\/([^/]+))$/.exec(p);
    if (m) {
      let sid: string;
      try {
        sid = decodeURIComponent(m[1]);
      } catch {
        throw new HttpError(404, 'not found');
      }
      try {
        assertSessionId(sid);
      } catch {
        throw new HttpError(404, 'not found');
      }
      if (m[3] !== undefined && method === 'POST') {
        let toolUseId: string;
        try {
          toolUseId = decodeURIComponent(m[3]);
          assertToolUseId(toolUseId);
        } catch {
          req.resume();
          throw new HttpError(400, 'invalid tool use id');
        }
        if (!(await loadConfig()).answersFromApp) {
          req.resume();
          throw new HttpError(403, 'answers from the app are off');
        }
        const body = (await readJsonBody(req)) as { answers?: unknown; release?: unknown } | null;
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid body');
        const hasRelease = Object.hasOwn(body, 'release');
        const hasAnswers = Object.hasOwn(body, 'answers');
        if (hasRelease === hasAnswers) throw new HttpError(400, 'invalid body');
        // A pending question of a session that is no longer connected is stale: nothing will read the answer.
        const reg = await getRegistration(sid);
        if (!reg || !isActive(reg)) throw new HttpError(404, 'no such pending question');
        const pending = await getPending(sid);
        let answer: AnswerFile;
        if (hasRelease) {
          if (body.release !== true) throw new HttpError(400, 'invalid body');
          if (!pending || pending.toolUseId !== toolUseId) throw new HttpError(404, 'no such pending question');
          answer = { release: true };
        } else {
          if (!pending || pending.toolUseId !== toolUseId) throw new HttpError(404, 'no such pending question');
          const answers = validAnswers(pending.questions, body.answers);
          if (!answers) throw new HttpError(400, 'invalid answers');
          answer = { answers };
        }
        const r = await writeAnswer(sid, toolUseId, answer);
        if (r === 'not-found') throw new HttpError(404, 'no such pending question');
        if (r === 'conflict') throw new HttpError(409, 'already answered');
        return sendJson(res, 202, { ok: true });
      }
      if (m[2] === 'name' && method === 'PUT') {
        const body = (await readJsonBody(req)) as { name?: unknown } | null;
        const name = body && typeof body === 'object' && !Array.isArray(body) ? validDisplayName(body.name) : null;
        if (name === null) throw new HttpError(400, 'invalid name');
        const reg = await getRegistration(sid);
        if (!reg) throw new HttpError(404, 'no such session');
        await setDisplayName(sid, name);
        let shown = name;
        if (!shown) shown = (await provider.listSessions()).connected.find((s) => s.sessionId === sid)?.name ?? path.basename(reg.cwd);
        return sendJson(res, 200, { name: shown });
      }
      if (m[2] === 'pin' && method === 'PUT') {
        const body = (await readJsonBody(req)) as { pinned?: unknown } | null;
        if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.pinned !== 'boolean') throw new HttpError(400, 'invalid body');
        if (!(await getRegistration(sid))) throw new HttpError(404, 'no such session');
        await setPinned(sid, body.pinned);
        fanOut({ type: 'sessions' });
        return sendJson(res, 200, { pinned: body.pinned });
      }
      if (m[2] === 'disconnect' && method === 'POST') {
        // Like /cc off, from the app: the session keeps running in the terminal and stays in the list.
        req.resume();
        const reg = await getRegistration(sid);
        if (!reg) throw new HttpError(404, 'no such session');
        if (!isActive(reg)) throw new HttpError(409, 'already disconnected');
        await markDisconnected(sid, 'off');
        fanOut({ type: 'sessions' });
        return sendJson(res, 200, { ok: true });
      }
      if (m[2] === 'remove' && method === 'POST') {
        // Takes the session out of the app (spec 2026-11-24-chat-menu-remove): an active one is disconnected.
        req.resume();
        if (!(await markRemoved(sid))) throw new HttpError(404, 'no such session');
        // Every open page drops it now, not at the next poll.
        fanOut({ type: 'sessions' });
        return sendJson(res, 200, { ok: true });
      }
      if (m[2] === 'background' && method === 'PUT') {
        // Preset ids only (never CSS from the client); null clears. Images come by the upload route below.
        const v = validBackgroundPreset(await readJsonBody(req));
        if (!v.ok) throw new HttpError(400, 'invalid background');
        if (!(await getRegistration(sid))) throw new HttpError(404, 'no such session');
        await setBackground(sid, v.value);
        fanOut({ type: 'sessions' });
        return sendJson(res, 200, { background: v.value });
      }
      if (m[2] === 'background-image' && method === 'POST') {
        if (!(await getRegistration(sid))) {
          req.resume();
          throw new HttpError(404, 'no such session');
        }
        const data = await readRawBody(req, BACKGROUND_IMAGE_MAX);
        const background = await saveBackgroundImage(sid, data); // the format comes from the bytes, not the headers
        if (!background) throw new HttpError(415, 'png, jpeg, webp or gif only');
        fanOut({ type: 'sessions' });
        return sendJson(res, 200, { background });
      }
      if (m[2] === 'background-image' && method === 'GET') {
        const img = await readBackgroundImage(sid);
        if (!img) throw new HttpError(404, 'no background image');
        res.writeHead(200, { 'Content-Type': img.type, 'Content-Length': img.data.length });
        return void res.end(img.data);
      }
      if (m[2] === 'events' && method === 'GET') return sendJson(res, 200, await provider.events(sid));
      if (m[2] === 'messages' && method === 'POST') {
        const body = (await readJsonBody(req)) as { text?: unknown } | null;
        const text = body && typeof body === 'object' ? body.text : undefined;
        if (typeof text !== 'string' || text.trim() === '' || text.length > MAX_TEXT) throw new HttpError(400, 'invalid text');
        const { id } = await provider.send(sid, text);
        return sendJson(res, 202, { id });
      }
    }
    sendJson(res, 404, { error: 'not found' });
  };

  const server = http.createServer(async (req, res) => {
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    const allowedOrigins = allowedHosts.map((h) => `http://${h}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const rawUrl = req.url ?? '';
      let url: URL;
      try {
        if (!rawUrl.startsWith('/')) throw new Error('bad url');
        url = new URL(rawUrl, `http://127.0.0.1:${port}`);
      } catch {
        return sendJson(res, 400, { error: 'bad request' });
      }
      const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');
      if (isApi) res.setHeader('Cache-Control', 'no-store');

      const origin = req.headers.origin;
      if (!allowedHosts.includes(String(req.headers.host ?? '')) || (origin !== undefined && !allowedOrigins.includes(origin))) {
        return sendJson(res, 403, { error: 'forbidden' });
      }
      if (isApi) await handleApi(req, res, url);
      else await serveStatic(req, res, url.pathname);
    } catch (e) {
      if (res.headersSent) return void res.end();
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
      if (e instanceof SessionDisconnectedError) return sendJson(res, 409, { error: 'session disconnected', code: 'session-disconnected' });
      if (e instanceof SessionProtocolError) {
        return sendJson(res, 409, { error: `session runs ${e.direction === 'older' ? 'an older' : 'a newer'} version`, code: `session-${e.direction}-version` });
      }
      log(`request failed: ${(e as Error).stack ?? (e as Error).message}`.split(token).join('[redacted]'));
      sendJson(res, 500, { error: 'internal error' });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  port = (server.address() as AddressInfo).port;
  // After listen, an error emitted on the server (EMFILE on accept, say) must not crash the hub: log it
  // and keep serving.
  server.on('error', (e: NodeJS.ErrnoException) => log(`server error: ${e.code ?? ''} ${e.message}`));

  return {
    url: `http://127.0.0.1:${port}`,
    clients: () => clients.size,
    windows: () => liveWindows(),
    server,
    close: () =>
      new Promise<void>((resolve) => {
        closed = true;
        stopTimers();
        for (const r of clients) r.end();
        clients.clear();
        writePresence(0).catch(() => {}).finally(() => {
          server.close(() => resolve());
          server.closeAllConnections();
        });
      }),
  };
}
