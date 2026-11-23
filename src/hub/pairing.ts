import crypto from 'node:crypto';

/** How long a pairing code stays valid, and how many may be pending at once (the oldest goes first). */
export const PAIR_TTL_MS = 60_000;
export const MAX_PENDING = 5;
const CODE_RE = /^[0-9a-f]{64}$/;

export interface Pairing {
  /** A fresh one-time code: 32 random bytes in hex. */
  issue(): string;
  /** True (and the code is spent) when `code` was issued, is unspent and has not expired. */
  redeem(code: string): boolean;
}

/**
 * One-time pairing codes, kept in memory only. They let a window be opened at `#pair=<code>` instead of
 * `#token=<token>`, so the token never sits on a process command line (readable through `ps`).
 */
export function createPairing(now: () => number = Date.now): Pairing {
  const pending = new Map<string, number>(); // code -> expiry; Map keeps insertion order (oldest first)

  const prune = () => {
    const t = now();
    for (const [c, exp] of pending) if (exp <= t) pending.delete(c);
  };

  return {
    issue() {
      prune();
      while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value as string);
      const code = crypto.randomBytes(32).toString('hex');
      pending.set(code, now() + PAIR_TTL_MS);
      return code;
    },
    redeem(code) {
      prune();
      if (typeof code !== 'string' || !CODE_RE.test(code)) return false;
      // Compare against every pending code in constant time, without stopping at the first match.
      const given = Buffer.from(code);
      let match: string | null = null;
      for (const c of pending.keys()) {
        if (crypto.timingSafeEqual(given, Buffer.from(c))) match = c;
      }
      if (match === null) return false;
      pending.delete(match);
      return true;
    },
  };
}
