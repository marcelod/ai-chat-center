// The account's rate-limit usage (the 5-hour and 7-day windows). Only Claude Code's status line input carries
// it (`rate_limits`), so the status line wrapper (statusline.ts) records it here and the hub shows it in the app.
import type { Usage, UsageWindow } from '../shared/types.js';
import { paths } from './paths.js';
import { readJson, writeJsonAtomic } from './fsAtomic.js';

/** resets_at comes as Unix seconds; an ISO date is accepted too. Anything else is no date. */
function toIso(v: unknown): string | null {
  let ms: number;
  if (typeof v === 'number') ms = v < 1e12 ? v * 1000 : v;
  else if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) ms = Number(v) * 1000;
  else if (typeof v === 'string') ms = Date.parse(v);
  else return null;
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

function toWindow(raw: unknown): UsageWindow | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { used_percentage?: unknown; resets_at?: unknown };
  const pct = typeof r.used_percentage === 'string' ? Number(r.used_percentage) : r.used_percentage;
  const resetsAt = toIso(r.resets_at);
  if (typeof pct !== 'number' || !Number.isFinite(pct) || resetsAt === null) return undefined;
  return { usedPercentage: Math.min(100, Math.max(0, Math.round(pct * 10) / 10)), resetsAt };
}

/** The usage in a status line input, or null when it carries none (API key users, older Claude Code). */
export function usageFromStatusInput(input: unknown, now = new Date()): Usage | null {
  const limits = (input as { rate_limits?: { five_hour?: unknown; seven_day?: unknown } } | null)?.rate_limits;
  if (!limits || typeof limits !== 'object') return null;
  const fiveHour = toWindow(limits.five_hour);
  const sevenDay = toWindow(limits.seven_day);
  if (!fiveHour && !sevenDay) return null;
  return { ...(fiveHour ? { fiveHour } : {}), ...(sevenDay ? { sevenDay } : {}), updatedAt: now.toISOString() };
}

const sameWindow = (a?: UsageWindow, b?: UsageWindow) =>
  a?.usedPercentage === b?.usedPercentage && a?.resetsAt === b?.resetsAt;

/** How long an unchanged value is not rewritten: the status line runs often, the app only needs "still current". */
const REWRITE_AFTER_MS = 60_000;

/** Records the usage unless the file already says the same and is recent (keeps disk writes rare). */
export async function recordUsage(u: Usage): Promise<boolean> {
  const prev = await readUsage();
  if (
    prev &&
    sameWindow(prev.fiveHour, u.fiveHour) &&
    sameWindow(prev.sevenDay, u.sevenDay) &&
    Date.parse(u.updatedAt) - Date.parse(prev.updatedAt) < REWRITE_AFTER_MS
  )
    return false;
  await writeJsonAtomic(paths().usageFile, u);
  return true;
}

/** The recorded usage, re-validated (the file is outside the hub's control). */
export async function readUsage(): Promise<Usage | null> {
  const d = await readJson<{ fiveHour?: unknown; sevenDay?: unknown; updatedAt?: unknown }>(paths().usageFile);
  if (!d || typeof d !== 'object' || typeof d.updatedAt !== 'string' || Number.isNaN(Date.parse(d.updatedAt))) return null;
  const valid = (w: unknown): UsageWindow | undefined => {
    if (!w || typeof w !== 'object') return undefined;
    const { usedPercentage, resetsAt } = w as { usedPercentage?: unknown; resetsAt?: unknown };
    if (typeof usedPercentage !== 'number' || !Number.isFinite(usedPercentage) || usedPercentage < 0 || usedPercentage > 100) return undefined;
    if (typeof resetsAt !== 'string' || Number.isNaN(Date.parse(resetsAt))) return undefined;
    return { usedPercentage, resetsAt: new Date(resetsAt).toISOString() };
  };
  const fiveHour = valid(d.fiveHour);
  const sevenDay = valid(d.sevenDay);
  if (!fiveHour && !sevenDay) return null;
  return { ...(fiveHour ? { fiveHour } : {}), ...(sevenDay ? { sevenDay } : {}), updatedAt: new Date(d.updatedAt).toISOString() };
}
