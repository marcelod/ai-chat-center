import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { assertSessionId, paths } from './paths.js';
import { ensureDir, FILE_MODE, readJson, removeFile, withFsRetry, writeJsonAtomic } from './fsAtomic.js';
import {
  BACKGROUND_COLORS,
  BACKGROUND_GRADIENTS,
  type BackgroundPreset,
  type ChatBackground,
  type ImageBackground,
} from '../shared/background.js';

// Per-session background chosen in the app, in <home>/backgrounds/<sid>.json. An uploaded image sits next
// to it as <sid>-<16 hex>.<ext>: a new name on every upload, so the app knows to fetch it again.

export type ImageExt = 'png' | 'jpg' | 'webp' | 'gif';

const MIME: Record<ImageExt, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

const imageRe = (sid: string) => new RegExp(`^${sid}-[0-9a-f]{16}\\.(png|jpg|webp|gif)$`);

/** Only the hub writes backgrounds: changes to one session run one after the other (no lock file needed). */
const chains = new Map<string, Promise<unknown>>();
function serial<T>(sid: string, fn: () => Promise<T>): Promise<T> {
  const run = (chains.get(sid) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => {});
  chains.set(sid, tail);
  void tail.then(() => {
    if (chains.get(sid) === tail) chains.delete(sid);
  });
  return run;
}

const isPlainObject =(v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A preset from the app: `{kind, value}` with a known id, or null (no background). Images come only by upload. */
export function validBackgroundPreset(v: unknown): { ok: true; value: BackgroundPreset | null } | { ok: false } {
  if (v === null) return { ok: true, value: null };
  if (!isPlainObject(v) || Object.keys(v).length !== 2) return { ok: false };
  if (v.kind === 'color' && (BACKGROUND_COLORS as readonly unknown[]).includes(v.value)) return { ok: true, value: v as BackgroundPreset };
  if (v.kind === 'gradient' && (BACKGROUND_GRADIENTS as readonly unknown[]).includes(v.value)) return { ok: true, value: v as BackgroundPreset };
  return { ok: false };
}

/** The image format from its first bytes (never from a name or a header the client sends), or null. */
export function sniffImage(b: Buffer): ImageExt | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.toString('latin1', 0, 6))) return 'gif';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export async function getBackground(sid: string): Promise<ChatBackground | null> {
  const d = await readJson<unknown>(paths().backgroundFile(sid));
  if (isPlainObject(d) && d.kind === 'image') {
    return typeof d.file === 'string' && imageRe(sid).test(d.file) && Object.keys(d).length === 2 ? { kind: 'image', file: d.file } : null;
  }
  const p = validBackgroundPreset(d);
  return p.ok ? p.value : null;
}

/** Deletes this session's images except `keep` (also cleans up after an interrupted or concurrent upload). */
async function removeImages(sid: string, keep?: string): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(paths().backgroundsDir);
  } catch {
    return;
  }
  const re = imageRe(sid);
  for (const n of names) if (n !== keep && re.test(n)) await removeFile(path.join(paths().backgroundsDir, n)).catch(() => {});
}

/** Sets a preset or none (null); a stored image is deleted. */
export async function setBackground(sid: string, bg: BackgroundPreset | null): Promise<void> {
  const file = paths().backgroundFile(sid); // validates the session id
  await serial(sid, async () => {
    if (bg === null) await removeFile(file);
    else await writeJsonAtomic(file, bg);
    await removeImages(sid);
  });
}

/**
 * Stores `data` as the session's background image, replacing the previous one. Null (nothing changed) when
 * the bytes are not a png, jpeg, webp or gif. The size limit is the caller's (the hub enforces it while reading).
 */
export async function saveBackgroundImage(sid: string, data: Buffer): Promise<ImageBackground | null> {
  const file = paths().backgroundFile(sid);
  const ext = sniffImage(data);
  if (!ext) return null;
  return serial(sid, async () => {
    const name = `${sid}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
    const target = path.join(paths().backgroundsDir, name);
    await ensureDir(paths().backgroundsDir);
    const tmp = `${target}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, data, { mode: FILE_MODE });
      await withFsRetry(() => fs.rename(tmp, target));
    } catch (e) {
      await fs.rm(tmp, { force: true });
      throw e;
    }
    const bg: ImageBackground = { kind: 'image', file: name };
    await writeJsonAtomic(file, bg);
    await removeImages(sid, name);
    return bg;
  });
}

/** The current background image, or null when the background is not an image (or the file is gone). */
export async function readBackgroundImage(sid: string): Promise<{ data: Buffer; type: string } | null> {
  const bg = await getBackground(sid);
  if (bg?.kind !== 'image') return null;
  const ext = path.extname(bg.file).slice(1) as ImageExt;
  try {
    return { data: await fs.readFile(path.join(paths().backgroundsDir, bg.file)), type: MIME[ext] };
  } catch {
    return null;
  }
}

/** Removes the setting and any image (a pruned registration). */
export async function clearBackground(sid: string): Promise<void> {
  assertSessionId(sid);
  await serial(sid, async () => {
    await removeFile(paths().backgroundFile(sid));
    await removeImages(sid);
  });
}
