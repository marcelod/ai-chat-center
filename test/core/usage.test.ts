import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import { readUsage, recordUsage, usageFromStatusInput } from '../../src/core/usage.js';
import { paths } from '../../src/core/paths.js';
import { tmpDir } from '../helpers/tmp.js';

beforeEach(() => {
  process.env.AI_CHAT_CENTER_HOME = tmpDir('acc-');
});

const now = new Date('2026-11-24T12:00:00Z');
const resets = Date.parse('2026-11-24T14:38:00Z') / 1000;

describe('usageFromStatusInput', () => {
  it('reads the 5-hour and 7-day windows (resets_at in Unix seconds)', () => {
    const u = usageFromStatusInput(
      { rate_limits: { five_hour: { used_percentage: 37.25, resets_at: resets }, seven_day: { used_percentage: 12, resets_at: resets + 86400 } } },
      now,
    );
    expect(u).toEqual({
      fiveHour: { usedPercentage: 37.3, resetsAt: '2026-11-24T14:38:00.000Z' },
      sevenDay: { usedPercentage: 12, resetsAt: '2026-11-25T14:38:00.000Z' },
      updatedAt: now.toISOString(),
    });
  });
  it('accepts an ISO date or a numeric string, and clamps the percentage', () => {
    const u = usageFromStatusInput({ rate_limits: { five_hour: { used_percentage: '140', resets_at: '2026-11-24T14:38:00Z' } } }, now);
    expect(u?.fiveHour).toEqual({ usedPercentage: 100, resetsAt: '2026-11-24T14:38:00.000Z' });
    expect(usageFromStatusInput({ rate_limits: { five_hour: { used_percentage: 5, resets_at: String(resets) } } }, now)?.fiveHour?.resetsAt)
      .toBe('2026-11-24T14:38:00.000Z');
  });
  it('is null without rate limits or with unusable values', () => {
    for (const input of [null, {}, { rate_limits: null }, { rate_limits: {} }, { rate_limits: { five_hour: { used_percentage: 'x', resets_at: resets } } },
      { rate_limits: { five_hour: { used_percentage: 5 } } }, { rate_limits: { five_hour: { used_percentage: 5, resets_at: 'soon' } } }]) {
      expect(usageFromStatusInput(input, now)).toBeNull();
    }
  });
});

describe('recordUsage / readUsage', () => {
  const u = (pct: number, at: string) => ({ fiveHour: { usedPercentage: pct, resetsAt: '2026-11-24T14:38:00.000Z' }, updatedAt: at });
  it('writes, reads back, and skips an unchanged value written less than a minute ago', async () => {
    expect(await readUsage()).toBeNull();
    expect(await recordUsage(u(5, '2026-11-24T12:00:00.000Z'))).toBe(true);
    expect(await recordUsage(u(5, '2026-11-24T12:00:30.000Z'))).toBe(false);
    expect(await recordUsage(u(6, '2026-11-24T12:00:31.000Z'))).toBe(true);
    expect(await recordUsage(u(6, '2026-11-24T12:02:00.000Z'))).toBe(true);
    expect(await readUsage()).toEqual(u(6, '2026-11-24T12:02:00.000Z'));
  });
  it('does not trust a tampered file', async () => {
    fs.mkdirSync(paths().home, { recursive: true });
    for (const bad of ['"x"', '[]', '{"updatedAt":"2026-11-24T12:00:00Z"}', '{"fiveHour":{"usedPercentage":5,"resetsAt":"2026-11-24T14:38:00Z"}}',
      '{"fiveHour":{"usedPercentage":500,"resetsAt":"2026-11-24T14:38:00Z"},"updatedAt":"2026-11-24T12:00:00Z"}',
      '{"fiveHour":{"usedPercentage":5,"resetsAt":"<b>"},"updatedAt":"2026-11-24T12:00:00Z"}']) {
      fs.writeFileSync(paths().usageFile, bad);
      expect(await readUsage()).toBeNull();
    }
  });
});
