// The login challenge: a stateless signed nonce, made single-use by a small in-memory set.
//
// The nonce is an HMAC over (pubkey, issue time, random salt), so the server keeps no table of
// outstanding challenges. Spent nonces ARE recorded, in memory and only for the nonce's
// lifetime (SpentNonces), so a challenge is genuinely single-use rather than merely
// time-bounded: NIP-98 (HTTP auth) has no replay protection of its own.
//
// SECURITY: a nonce is a bearer credential for the login step. Never log one.

import { randomBytes } from 'node:crypto';
import { hmac, safeEqual } from './mac';

/** Version prefix, so a future format change cannot be confused with this one. */
const NONCE_V = 'n1';

/**
 * Mint a challenge nonce bound to ONE pubkey.
 *
 * Binding matters: an unbound nonce could be requested by an attacker and then used to
 * complete a login for a different key. The pubkey is inside the MAC, so a nonce issued for A
 * is refused outright when presented by B.
 */
export function mintNonce(secret: string, pubkey: string, nowMs: number): string {
	const salt = randomBytes(12).toString('base64url');
	return `${NONCE_V}.${nowMs}.${salt}.${hmac(secret, `${NONCE_V}.${pubkey}.${nowMs}.${salt}`)}`;
}

export type NonceCheck =
	| { ok: true }
	| { ok: false; reason: 'missing' | 'malformed' | 'bad_signature' | 'expired' | 'future' };

export function verifyNonce(
	secret: string,
	pubkey: string,
	nonce: string,
	nowMs: number,
	ttlMs: number
): NonceCheck {
	if (typeof nonce !== 'string' || nonce.length === 0) return { ok: false, reason: 'missing' };
	const parts = nonce.split('.');
	if (parts.length !== 4 || parts[0] !== NONCE_V) return { ok: false, reason: 'malformed' };
	const issuedRaw = parts[1] ?? '';
	const salt = parts[2] ?? '';
	const mac = parts[3] ?? '';
	const issued = Number.parseInt(issuedRaw, 10);
	if (!Number.isFinite(issued)) return { ok: false, reason: 'malformed' };
	// CANONICAL SPELLING ONLY. The MAC is computed over the PARSED number, but the spent set is
	// keyed on the raw string - so without this, "123x", "+123" and " 123" would all verify
	// against one MAC yet count as three different nonces, and single-use would not hold.
	if (String(issued) !== issuedRaw) return { ok: false, reason: 'malformed' };
	const expected = hmac(secret, `${NONCE_V}.${pubkey}.${issued}.${salt}`);
	// MAC before expiry: an attacker must not learn whether a forged nonce carried a plausible
	// timestamp.
	if (!safeEqual(mac, expected)) return { ok: false, reason: 'bad_signature' };
	const age = nowMs - issued;
	if (age > ttlMs) return { ok: false, reason: 'expired' };
	// A nonce from the future can only be our own clock moving backwards (the MAC proves we
	// minted it). Refuse rather than accept a credential we cannot age out.
	if (age < -ttlMs) return { ok: false, reason: 'future' };
	return { ok: true };
}

export type Claim = 'claimed' | 'spent' | 'full';

/**
 * Spent-nonce set, so a challenge is single-use and not merely short-lived.
 *
 * Without it, a captured login request replays freely for the nonce's whole lifetime. Fed by
 * unauthenticated traffic, so it is bounded: entries expire with the nonce, and a hard cap
 * holds the size. The cap must never FORGET an entry that a replay could still use - a
 * captured request stays valid while its signed token does, `protectMs` from the claim - or
 * an attacker who floods the set with logins of their own evicts the victim's nonce and
 * replays it. So the oldest entry is evicted only once it is older than that, and a set full
 * of younger ones refuses new claims ('full', an answer of 503 (service unavailable)): logging
 * in stalls for a minute or two under a flood, and a replay never succeeds.
 * Process-local by design: this app runs as one process, and losing the set on a restart only
 * means outstanding challenges must be fetched again.
 */
export class SpentNonces {
	private readonly seen = new Map<string, number>();

	constructor(
		readonly ttlMs: number,
		readonly protectMs: number,
		readonly maxEntries = 10_000
	) {}

	/** Whether the nonce is already spent. Cheap: checked before any signature is. */
	has(nonce: string, nowMs: number): boolean {
		this.sweep(nowMs);
		return this.seen.has(nonce);
	}

	/** Record the nonce, unless it is already spent or the set is full of entries to keep. */
	claim(nonce: string, nowMs: number): Claim {
		this.sweep(nowMs);
		if (this.seen.has(nonce)) return 'spent';
		if (this.seen.size >= this.maxEntries) {
			// Map preserves insertion order, so the first entry is the oldest claimed.
			const oldest = this.seen.entries().next();
			if (oldest.done || nowMs - oldest.value[1] <= this.protectMs) return 'full';
			this.seen.delete(oldest.value[0]);
		}
		this.seen.set(nonce, nowMs);
		return 'claimed';
	}

	get size(): number {
		return this.seen.size;
	}

	private sweep(nowMs: number): void {
		// A full scan rather than stopping at the first young entry: a backward clock step (an
		// NTP correction) would otherwise leave an out-of-order entry that ends every later sweep
		// early. The set is small and capped, so the scan costs nothing.
		for (const [nonce, at] of this.seen) {
			if (nowMs - at > this.ttlMs) this.seen.delete(nonce);
		}
	}
}
