// The session cookie: minted by POST /api/auth/login ($lib/server/auth/handlers), verified on
// every request by hooks.server.ts.
//
// FORMAT: `s2.<pubkey>.<expiresAt>.<mac>` - the pubkey as 64 lowercase hex, an absolute expiry
// in epoch milliseconds, and an HMAC-SHA256 (base64url) over everything before it. Stateless
// on purpose: login adds no table, and the price is that a session cannot be revoked before
// it expires - rotating AUTH_SESSION_SECRET (./config) logs everyone out at once, which is the
// answer to a leak.
//
// WHY THE IDENTITY IS RESOLVED ON THE SERVER AT ALL: the nav has to render the right thing in
// the SERVER-RENDERED HTML (no logged-out flash on every page load), and the operator's
// unreleased sections ($lib/unreleased) are decided from it. A readable cookie would be
// forgeable; a signed one is checked here in microseconds.
//
// SECURITY: the cookie is a bearer credential and the secret mints them. Neither is ever
// logged.

import { hmac, safeEqual } from './mac';

/**
 * Version prefix. A cookie in any other format is refused, so a format change can never be read
 * as this one; changing the format logs everyone out, once.
 */
const SESSION_V = 's2';

export interface SessionClaims {
	pubkey: string;
	/** Absolute expiry, epoch ms. */
	expiresAt: number;
}

export type SessionResult =
	| { ok: true; claims: SessionClaims }
	| { ok: false; reason: 'missing' | 'malformed' | 'bad_signature' | 'expired' | 'unconfigured' };

/**
 * A Set-Cookie header with the attributes every cookie of ours carries - the session and the
 * operator marker alike, set and cleared (Max-Age=0) alike, since a clear whose attributes
 * differ leaves the original in place. Secure ALWAYS, even on plain-http localhost: SvelteKit's
 * own cookie helper drops it there, and a browser silently discards a `__Host-` cookie without
 * it. SameSite=Lax rather than Strict, because the cookie must ride along when someone follows a
 * link to the site from elsewhere, or they arrive looking logged out; Lax still withholds it
 * from the cross-site POST a forgery would need.
 */
export function cookieHeader(name: string, value: string, maxAgeSeconds: number): string {
	return `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax; Secure`;
}

/** Mint the session cookie's value. `secret` must come from ./config's sessionSecret(). */
export function mintSessionCookie(secret: string, claims: SessionClaims): string {
	const body = `${SESSION_V}.${claims.pubkey}.${claims.expiresAt}`;
	return `${body}.${hmac(secret, body)}`;
}

export function verifySessionCookie(
	secret: string | undefined,
	cookie: string | undefined,
	nowMs: number
): SessionResult {
	// An unset secret means the deployment is not configured for login. Report it distinctly
	// rather than as 'bad_signature': "the deployment is missing a setting" and "someone is
	// forging cookies" need completely different fixes.
	if (typeof secret !== 'string' || secret === '') return { ok: false, reason: 'unconfigured' };
	if (typeof cookie !== 'string' || cookie === '') return { ok: false, reason: 'missing' };

	const parts = cookie.split('.');
	if (parts.length !== 4 || parts[0] !== SESSION_V) return { ok: false, reason: 'malformed' };
	const pubkey = parts[1] ?? '';
	const expiresRaw = parts[2] ?? '';
	const mac = parts[3] ?? '';
	const expiresAt = Number.parseInt(expiresRaw, 10);
	if (!Number.isFinite(expiresAt)) return { ok: false, reason: 'malformed' };
	// Canonical spelling only: "+123" or "0123" parse to the same number, and two spellings of
	// one cookie are the kind of slack that becomes a bug once anything keys on the string.
	if (String(expiresAt) !== expiresRaw) return { ok: false, reason: 'malformed' };
	if (!/^[0-9a-f]{64}$/.test(pubkey)) return { ok: false, reason: 'malformed' };

	const expected = hmac(secret, `${SESSION_V}.${pubkey}.${expiresAt}`);
	if (!safeEqual(mac, expected)) return { ok: false, reason: 'bad_signature' };
	if (nowMs >= expiresAt) return { ok: false, reason: 'expired' };

	return { ok: true, claims: { pubkey, expiresAt } };
}
