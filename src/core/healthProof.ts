import crypto from 'node:crypto';

/** `GET /api/health?challenge=<32 lowercase hex>` */
export const CHALLENGE_RE = /^[0-9a-f]{32}$/;

export const newChallenge = (): string => crypto.randomBytes(16).toString('hex');

/**
 * Proof that a hub knows the token: HMAC-SHA256(token, `${challenge}|${port}|${pid}|${version}`), hex.
 * `port` is the port the hub itself listens on, so a squatter that relays the challenge to the real hub
 * gets a proof for the real port, which fails against the squatter's port. It also covers the pid and
 * the version, so a caller may act on them (stop an older hub) only once proven.
 */
export function healthProof(token: string, challenge: string, port: number, pid: number, version: string): string {
  return crypto.createHmac('sha256', token).update(`${challenge}|${port}|${pid}|${version}`).digest('hex');
}

/** Constant-time check of a proof received from a hub, against the port the caller actually dialed. */
export function proofMatches(
  token: string,
  challenge: string,
  port: number,
  answer: { pid: number; version: string; proof: string },
): boolean {
  const want = Buffer.from(healthProof(token, challenge, port, answer.pid, answer.version));
  const got = Buffer.from(String(answer.proof));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
