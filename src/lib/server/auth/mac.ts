// HMAC-SHA256 and a constant-time compare, shared by the challenge nonce (./nonce) and the
// session cookie (./cookie). Both values are bearer credentials: nothing here, and nothing
// built from it, is ever logged.

import { createHmac, timingSafeEqual } from 'node:crypto';

/** HMAC-SHA256 of `message` under `secret`, base64url: no padding, nothing to percent-encode. */
export function hmac(secret: string, message: string): string {
	return createHmac('sha256', secret).update(message).digest('base64url');
}

/**
 * Constant-time compare of two ASCII strings.
 *
 * A plain `===` on a MAC leaks its prefix through timing. Node's timingSafeEqual throws on a
 * length mismatch, which would itself be a length oracle (and a 500 (internal server error)),
 * so unequal lengths short-circuit to false. That is safe because every MAC compared here
 * has a fixed length, so a length mismatch is never a near miss.
 */
export function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a, 'utf8');
	const bb = Buffer.from(b, 'utf8');
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}
