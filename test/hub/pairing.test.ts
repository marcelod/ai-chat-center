import { describe, expect, it } from 'vitest';
import { createPairing } from '../../src/hub/pairing.js';

describe('pairing codes', () => {
  it('issues 32 random bytes in hex, each redeemable once', () => {
    const p = createPairing();
    const a = p.issue();
    const b = p.issue();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).not.toBe(a);
    expect(p.redeem(a)).toBe(true);
    expect(p.redeem(a)).toBe(false);
    expect(p.redeem(b)).toBe(true);
  });
  it('rejects unknown, malformed and non-string codes', () => {
    const p = createPairing();
    const a = p.issue();
    expect(p.redeem('f'.repeat(64))).toBe(false);
    expect(p.redeem(a.toUpperCase())).toBe(false);
    expect(p.redeem(a.slice(1))).toBe(false);
    expect(p.redeem('')).toBe(false);
    expect(p.redeem(undefined as unknown as string)).toBe(false);
    expect(p.redeem({} as unknown as string)).toBe(false);
    expect(p.redeem(a)).toBe(true); // failed attempts do not consume a valid code
  });
  it('expires a code after 60 s', () => {
    let t = 1_000_000;
    const p = createPairing(() => t);
    const a = p.issue();
    const b = p.issue();
    t += 59_999;
    expect(p.redeem(a)).toBe(true);
    t += 1;
    expect(p.redeem(b)).toBe(false);
  });
  it('keeps at most 5 pending codes: the oldest goes', () => {
    const p = createPairing();
    const codes = Array.from({ length: 6 }, () => p.issue());
    expect(p.redeem(codes[0])).toBe(false);
    for (const c of codes.slice(1)) expect(p.redeem(c)).toBe(true);
  });
});
