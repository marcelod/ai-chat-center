import crypto from 'node:crypto';

/** `GET /api/health?challenge=<32 lowercase hex>` */
export const CHALLENGE_RE = /^[0-9a-f]{32}$/;

export const newChallenge = (): string => crypto.randomBytes(16).toString('hex');

/**
 * Proof that a hub knows the token: HMAC-SHA256(token, `${challenge}.${pid}.${version}`), hex.
 * It covers the pid and the version, so a caller may act on them (stop an older hub) only once proven.
 */
export function healthProof(token: string, challenge: string, pid: number, version: string): string {
  return crypto.createHmac('sha256', token).update(`${challenge}.${pid}.${version}`).digest('hex');
}

/** Constant-time check of a proof received from a hub. */
export function proofMatches(token: string, challenge: string, answer: { pid: number; version: string; proof: string }): boolean {
  const want = Buffer.from(healthProof(token, challenge, answer.pid, answer.version));
  const got = Buffer.from(String(answer.proof));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
