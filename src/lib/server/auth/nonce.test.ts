// @vitest-environment node
// Challenge-nonce tests. A nonce is a bearer credential for the login step, so the properties
// under test are: an attacker cannot forge one, cannot extend its life, cannot move it to
// another identity, and cannot spend it twice.

import { describe, expect, it } from 'vitest';
import { safeEqual } from './mac';
import { SpentNonces, mintNonce, verifyNonce } from './nonce';

const SECRET = 'test-secret-value-that-is-long-enough-xx';
const OTHER_SECRET = 'a-different-secret-value-long-enough-yy';
const PK = 'a'.repeat(64);
const OTHER_PK = 'b'.repeat(64);
const NOW = 1_800_000_000_000;
const TTL = 5 * 60 * 1000;

describe('safeEqual', () => {
	it('matches equal strings and rejects different ones', () => {
		expect(safeEqual('abc', 'abc')).toBe(true);
		expect(safeEqual('abc', 'abd')).toBe(false);
	});

	it('returns false rather than throwing on a length mismatch', () => {
		// timingSafeEqual throws on unequal lengths; letting that escape would make the
		// comparison a length oracle AND a 500 (internal server error).
		expect(safeEqual('abc', 'abcd')).toBe(false);
		expect(safeEqual('', 'x')).toBe(false);
	});
});

describe('challenge nonce', () => {
	it('round-trips for the pubkey it was minted for', () => {
		expect(verifyNonce(SECRET, PK, mintNonce(SECRET, PK, NOW), NOW, TTL)).toEqual({ ok: true });
	});

	it('is bound to ONE pubkey', () => {
		// Without binding, an attacker could request a challenge and use it to complete a login
		// for somebody else's key.
		expect(verifyNonce(SECRET, OTHER_PK, mintNonce(SECRET, PK, NOW), NOW, TTL)).toEqual({
			ok: false,
			reason: 'bad_signature'
		});
	});

	it('is rejected under a different secret', () => {
		expect(verifyNonce(OTHER_SECRET, PK, mintNonce(SECRET, PK, NOW), NOW, TTL)).toEqual({
			ok: false,
			reason: 'bad_signature'
		});
	});

	it('expires', () => {
		expect(verifyNonce(SECRET, PK, mintNonce(SECRET, PK, NOW), NOW + TTL + 1, TTL)).toEqual({
			ok: false,
			reason: 'expired'
		});
	});

	it('is still valid at the edge of its window', () => {
		expect(verifyNonce(SECRET, PK, mintNonce(SECRET, PK, NOW), NOW + TTL, TTL).ok).toBe(true);
	});

	it('rejects a nonce from the future', () => {
		expect(verifyNonce(SECRET, PK, mintNonce(SECRET, PK, NOW), NOW - TTL - 1, TTL)).toEqual({
			ok: false,
			reason: 'future'
		});
	});

	it('checks the MAC before the clock', () => {
		// An attacker must not learn whether a forged nonce had a plausible timestamp - that
		// would let them search the timestamp space separately.
		expect(verifyNonce(SECRET, PK, 'n1.1.salt.notavalidmac', NOW + 10 * TTL, TTL)).toEqual({
			ok: false,
			reason: 'bad_signature'
		});
	});

	it('rejects a tampered timestamp', () => {
		const parts = mintNonce(SECRET, PK, NOW).split('.');
		parts[1] = String(NOW + 10 * TTL);
		expect(verifyNonce(SECRET, PK, parts.join('.'), NOW, TTL).ok).toBe(false);
	});

	it('rejects a tampered salt', () => {
		const parts = mintNonce(SECRET, PK, NOW).split('.');
		parts[2] = 'AAAAAAAAAAAAAAAA';
		expect(verifyNonce(SECRET, PK, parts.join('.'), NOW, TTL)).toEqual({
			ok: false,
			reason: 'bad_signature'
		});
	});

	it.each([
		['empty', '', 'missing'],
		['wrong version', 'n0.1.s.m', 'malformed'],
		['too few parts', 'n1.1.s', 'malformed'],
		['too many parts', 'n1.1.s.m.extra', 'malformed'],
		['non-numeric timestamp', 'n1.abc.s.m', 'malformed']
	])('rejects a %s nonce as %s', (_l, nonce, reason) => {
		expect(verifyNonce(SECRET, PK, nonce, NOW, TTL)).toEqual({ ok: false, reason });
	});

	it('accepts ONLY the canonical spelling of its timestamp', () => {
		// The MAC covers the PARSED number, so without an explicit round-trip check "123x",
		// "+123" and " 123" all verify against the same MAC - while the spent set keys on the
		// raw string, making them independently claimable spellings of one challenge.
		const nonce = mintNonce(SECRET, PK, NOW);
		const parts = nonce.split('.');
		for (const variant of [`${parts[1]}x`, `+${parts[1]}`, ` ${parts[1]}`, `0${parts[1]}`]) {
			const respelled = [parts[0], variant, parts[2], parts[3]].join('.');
			expect(verifyNonce(SECRET, PK, respelled, NOW, TTL)).toEqual({
				ok: false,
				reason: 'malformed'
			});
		}
		expect(verifyNonce(SECRET, PK, nonce, NOW, TTL).ok).toBe(true);
	});

	it('mints a distinct nonce each call, even within the same millisecond', () => {
		// The random salt, not the clock, is what makes it unique.
		expect(mintNonce(SECRET, PK, NOW)).not.toBe(mintNonce(SECRET, PK, NOW));
	});
});

describe('SpentNonces', () => {
	const PROTECT = 150_000;

	it('permits the first claim and refuses the second', () => {
		const spent = new SpentNonces(TTL, PROTECT);
		expect(spent.has('n', NOW)).toBe(false);
		expect(spent.claim('n', NOW)).toBe('claimed');
		expect(spent.has('n', NOW)).toBe(true);
		expect(spent.claim('n', NOW)).toBe('spent');
	});

	it('forgets entries once they are older than the nonce lifetime, when the nonce is dead too', () => {
		const spent = new SpentNonces(TTL, PROTECT);
		spent.claim('n', NOW);
		expect(spent.claim('n', NOW + TTL)).toBe('spent');
		expect(spent.claim('n', NOW + TTL + 1)).toBe('claimed');
		expect(spent.size).toBe(1);
	});

	it('never evicts an entry a replay could still use: a full set of young entries refuses', () => {
		// The attack: flood the set with one's own logins until the victim's spent nonce is
		// evicted, then replay the victim's captured request while its token is still valid.
		const spent = new SpentNonces(TTL, PROTECT, 3);
		expect(spent.claim('victim', NOW)).toBe('claimed');
		expect(spent.claim('a1', NOW + 1)).toBe('claimed');
		expect(spent.claim('a2', NOW + 2)).toBe('claimed');
		expect(spent.claim('a3', NOW + 3)).toBe('full');
		expect(spent.claim('victim', NOW + 4)).toBe('spent');
		expect(spent.size).toBe(3);
	});

	it('evicts the oldest entry once it is past the replay window, and only then', () => {
		const spent = new SpentNonces(TTL, PROTECT, 2);
		spent.claim('old', NOW);
		spent.claim('b', NOW + PROTECT);
		expect(spent.claim('c', NOW + PROTECT)).toBe('full'); // 'old' is exactly PROTECT old
		expect(spent.claim('c', NOW + PROTECT + 1)).toBe('claimed'); // now it may go
		expect(spent.has('old', NOW + PROTECT + 1)).toBe(false);
		expect(spent.has('b', NOW + PROTECT + 1)).toBe(true);
	});

	it('stays bounded under sustained traffic', () => {
		const spent = new SpentNonces(TTL, PROTECT, 10);
		for (let i = 0; i < 500; i += 1) spent.claim(`n${i}`, NOW + i * (PROTECT + 1));
		expect(spent.size).toBeLessThanOrEqual(10);
	});

	it('keeps sweeping past an entry left out of order by a backward clock step', () => {
		const spent = new SpentNonces(TTL, PROTECT);
		spent.claim('late', NOW + 1000);
		spent.claim('early', NOW); // the clock stepped back
		// Both are expired by now; a sweep that stopped at the first young entry would keep one.
		spent.claim('probe', NOW + 1000 + TTL + 1);
		expect(spent.size).toBe(1);
	});
});
