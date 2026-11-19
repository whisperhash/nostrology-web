// @vitest-environment node
// Session-cookie tests. The cookie is a bearer credential for an identity, so the properties
// under test are: nobody without the key can mint one, nobody can extend one or move it to
// another pubkey, and the format cannot change by accident.

import { describe, expect, it } from 'vitest';
import { mintSessionCookie, verifySessionCookie } from './cookie';

const SECRET = 'cookie-test-secret-that-is-long-enough-x';
const OTHER_SECRET = 'cookie-test-other-secret-long-enough-yy';
const PK = 'a'.repeat(63) + 'b';
const OTHER_PK = 'c'.repeat(64);
const NOW = 1_800_000_000_000;
const CLAIMS = { pubkey: PK, expiresAt: NOW + 60_000 };

describe('mintSessionCookie / verifySessionCookie', () => {
	it('round-trips its claims', () => {
		expect(verifySessionCookie(SECRET, mintSessionCookie(SECRET, CLAIMS), NOW)).toEqual({
			ok: true,
			claims: CLAIMS
		});
	});

	it('is pinned byte for byte, so a format change is a decision and not an accident', () => {
		// Changing what a cookie looks like logs every visitor out. Regenerate this vector only
		// for an intentional format revision, and bump SESSION_V when you do.
		expect(
			mintSessionCookie('pinned-vector-secret-at-least-32-chars', {
				pubkey: PK,
				expiresAt: 1900000000000
			})
		).toBe(PINNED);
	});

	it('uses base64url for the MAC, so the value needs no percent-encoding', () => {
		expect(mintSessionCookie(SECRET, CLAIMS)).toMatch(/^[A-Za-z0-9._-]+$/);
	});

	it('reports an unset secret as unconfigured, distinct from a bad signature', () => {
		// "The deployment is missing a setting" and "someone is forging cookies" need
		// completely different fixes.
		const cookie = mintSessionCookie(SECRET, CLAIMS);
		expect(verifySessionCookie(undefined, cookie, NOW)).toEqual({ ok: false, reason: 'unconfigured' });
		expect(verifySessionCookie('', cookie, NOW)).toEqual({ ok: false, reason: 'unconfigured' });
	});

	it('rejects a cookie signed with another secret', () => {
		expect(verifySessionCookie(OTHER_SECRET, mintSessionCookie(SECRET, CLAIMS), NOW)).toEqual({
			ok: false,
			reason: 'bad_signature'
		});
	});

	it('rejects a substituted pubkey', () => {
		const parts = mintSessionCookie(SECRET, CLAIMS).split('.');
		parts[1] = OTHER_PK;
		expect(verifySessionCookie(SECRET, parts.join('.'), NOW)).toEqual({
			ok: false,
			reason: 'bad_signature'
		});
	});

	it('rejects an extended expiry', () => {
		const parts = mintSessionCookie(SECRET, CLAIMS).split('.');
		parts[2] = String(NOW + 10 ** 12);
		expect(verifySessionCookie(SECRET, parts.join('.'), NOW)).toEqual({
			ok: false,
			reason: 'bad_signature'
		});
	});

	it('expires exactly at expiresAt', () => {
		const cookie = mintSessionCookie(SECRET, CLAIMS);
		expect(verifySessionCookie(SECRET, cookie, CLAIMS.expiresAt - 1).ok).toBe(true);
		expect(verifySessionCookie(SECRET, cookie, CLAIMS.expiresAt)).toEqual({
			ok: false,
			reason: 'expired'
		});
	});

	it('refuses a cookie of any other version or shape', () => {
		// A cookie whose format differs is refused outright, never read as this one: the MAC
		// input differs too, so no other format can be made to verify here.
		const legacy = `s1.${PK}.1.${NOW + 60_000}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
		expect(verifySessionCookie(SECRET, legacy, NOW)).toEqual({ ok: false, reason: 'malformed' });
	});

	it.each([
		['missing', undefined, 'missing'],
		['empty', '', 'missing'],
		['wrong version', `s9.${PK}.${NOW + 1000}.m`, 'malformed'],
		['too few parts', `s2.${PK}.${NOW + 1000}`, 'malformed'],
		['too many parts', `s2.${PK}.1.${NOW + 1000}.m`, 'malformed'],
		['non-hex pubkey', `s2.${'z'.repeat(64)}.${NOW + 1000}.m`, 'malformed'],
		['uppercase pubkey', `s2.${'A'.repeat(64)}.${NOW + 1000}.m`, 'malformed'],
		['short pubkey', `s2.abc.${NOW + 1000}.m`, 'malformed'],
		['non-numeric expiry', `s2.${PK}.soon.m`, 'malformed'],
		['non-canonical expiry', `s2.${PK}.+${NOW + 1000}.m`, 'malformed'],
		['zero-padded expiry', `s2.${PK}.0${NOW + 1000}.m`, 'malformed']
	])('rejects a %s cookie', (_l, cookie, reason) => {
		expect(verifySessionCookie(SECRET, cookie as string | undefined, NOW)).toEqual({
			ok: false,
			reason
		});
	});
});

const PINNED =
	's2.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab.1900000000000.9jZjv8zgeI86V65QbkTYpqXRu93HErcjoHZRXrpEjwM';
