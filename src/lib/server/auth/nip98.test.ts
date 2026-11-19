// @vitest-environment node
// NIP-98 (HTTP auth) verification tests.
//
// The highest-value tests in the login: every case here is a way an attacker authenticates as
// someone else if the check is wrong, and several correspond to bugs that shipped in real
// libraries. In particular `rejects a token dated in the future` is the nostr-tools <= 2.24.2
// defect - a one-sided window makes a future-dated token a PERMANENT credential - and it
// passes trivially if someone "simplifies" the two-sided comparison back to
// `now - created_at < maxSkew`.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools/pure';
import { Nip98Error, NIP98_KIND, decodeToken, signedUrlFor, verifyNip98 } from './nip98';

const SK = generateSecretKey();
const PK = getPublicKey(SK);
const URL_UNDER_TEST = 'https://nostrolo.gy/api/auth/login';
const NOW = 1_800_000_000;

function sha256Hex(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

interface SignOpts {
	url?: string;
	method?: string;
	body?: Uint8Array;
	createdAt?: number;
	kind?: number;
	omitPayload?: boolean;
	extraTags?: string[][];
}

function signToken(opts: SignOpts = {}): { token: string; event: Event; body: Uint8Array } {
	const body = opts.body ?? new TextEncoder().encode(JSON.stringify({ nonce: 'n' }));
	const tags: string[][] = [
		['u', opts.url ?? URL_UNDER_TEST],
		['method', opts.method ?? 'POST']
	];
	if (!opts.omitPayload) tags.push(['payload', sha256Hex(body)]);
	for (const t of opts.extraTags ?? []) tags.push(t);
	const event = finalizeEvent(
		{ kind: opts.kind ?? NIP98_KIND, created_at: opts.createdAt ?? NOW, tags, content: '' },
		SK
	);
	return { token: `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}`, event, body };
}

function tokenOf(event: unknown): string {
	return `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}`;
}

function verify(
	t: { token: string; body: Uint8Array },
	over: Partial<Parameters<typeof verifyNip98>[0]> = {}
) {
	return verifyNip98({
		authorization: t.token,
		url: URL_UNDER_TEST,
		method: 'POST',
		body: t.body,
		nowSeconds: NOW,
		...over
	});
}

describe('decodeToken', () => {
	it('accepts standard base64 with padding (what nostr-tools emits)', () => {
		const { event } = signToken();
		expect(decodeToken(tokenOf(event)).id).toBe(event.id);
	});

	it('accepts base64url without padding (what Blossom BUD-11 mandates)', () => {
		// NIP-98 (HTTP auth) says only "base64" and the ecosystem split on the alphabet, so a
		// client choosing either spelling is doing nothing wrong.
		const { event } = signToken();
		const url = Buffer.from(JSON.stringify(event)).toString('base64url');
		expect(decodeToken(`Nostr ${url}`).id).toBe(event.id);
	});

	it('is case-insensitive about the scheme and tolerates extra whitespace', () => {
		const { event } = signToken();
		const b64 = Buffer.from(JSON.stringify(event)).toString('base64');
		expect(decodeToken(`  nostr   ${b64}  `).id).toBe(event.id);
	});

	it.each([
		['undefined header', undefined],
		['empty header', ''],
		['wrong scheme', 'Bearer abc'],
		['scheme with no token', 'Nostr'],
		['not base64-decodable JSON', 'Nostr !!!!'],
		['valid base64 of non-JSON', `Nostr ${Buffer.from('not json').toString('base64')}`],
		['JSON array, not an object', `Nostr ${Buffer.from('[1,2]').toString('base64')}`],
		['JSON null', `Nostr ${Buffer.from('null').toString('base64')}`]
	])('rejects %s', (_label, header) => {
		expect(() => decodeToken(header as string | undefined)).toThrow(Nip98Error);
	});

	it.each([
		['a pubkey that is not 64 hex', { pubkey: 'abc' }, /pubkey/],
		['a numeric pubkey', { pubkey: 42 }, /pubkey/],
		['no signature', { sig: undefined }, /signature/],
		['no id', { id: undefined }, /signature/],
		['tags that are not an array', { tags: 'nope' }, /tags/],
		['content that is not a string', { content: 7 }, /content/]
	])('throws Nip98Error, never a TypeError, for %s', (_label, change, message) => {
		const { event } = signToken();
		const broken = { ...event, ...change };
		expect(() => decodeToken(tokenOf(broken))).toThrow(Nip98Error);
		expect(() => decodeToken(tokenOf(broken))).toThrow(message);
	});
});

describe('verifyNip98', () => {
	it('accepts a correctly signed token and returns the event', () => {
		expect(verify(signToken()).pubkey).toBe(PK);
	});

	it('rejects the wrong kind', () => {
		expect(() => verify(signToken({ kind: 1 }))).toThrow(/kind must be 27235/);
	});

	// --- the clock window, both directions -----------------------------------------

	it('accepts a token at the edge of the past window', () => {
		expect(verify(signToken({ createdAt: NOW - 60 })).pubkey).toBe(PK);
	});

	it('rejects an expired token', () => {
		expect(() => verify(signToken({ createdAt: NOW - 61 }))).toThrow(/expired/);
	});

	it('rejects a token dated in the future', () => {
		// THE regression test. A one-sided `now - created_at < 60` yields a NEGATIVE number
		// here, which satisfies the comparison forever - turning a 60-second token into a
		// permanent credential. This is the exact bug in nostr-tools <= 2.24.2.
		const oneYear = 365 * 24 * 60 * 60;
		expect(() => verify(signToken({ createdAt: NOW + oneYear }))).toThrow(/too far in the future/);
	});

	it('accepts a token at the edge of the future window, since real clocks run fast', () => {
		expect(verify(signToken({ createdAt: NOW + 60 })).pubkey).toBe(PK);
		expect(() => verify(signToken({ createdAt: NOW + 61 }))).toThrow(/too far in the future/);
	});

	it('honours a narrower skew when one is configured', () => {
		expect(() => verify(signToken({ createdAt: NOW - 11 }), { maxSkewSeconds: 10 })).toThrow(
			/expired/
		);
	});

	it('rejects a non-numeric created_at', () => {
		const { event, body } = signToken();
		const broken = { ...event, created_at: 'soon' };
		expect(() => verify({ token: tokenOf(broken), body })).toThrow(/created_at/);
	});

	// --- URL and method binding ------------------------------------------------------

	it('rejects a token signed for a different URL', () => {
		expect(() => verify(signToken({ url: 'https://nostrolo.gy/api/auth/challenge' }))).toThrow(
			/u tag/
		);
	});

	it('rejects a token whose u tag differs only by query string', () => {
		// Exact match per the NIP - "including query parameters". A prefix or origin-only
		// comparison would let a token minted for one endpoint be replayed at another.
		expect(() => verify(signToken({ url: `${URL_UNDER_TEST}?x=1` }))).toThrow(/u tag/);
	});

	it('rejects a missing u tag', () => {
		const { event, body } = signToken();
		const stripped = finalizeEvent(
			{ kind: NIP98_KIND, created_at: NOW, tags: event.tags.filter((t) => t[0] !== 'u'), content: '' },
			SK
		);
		expect(() => verify({ token: tokenOf(stripped), body })).toThrow(/missing the u tag/);
	});

	it('uses the FIRST u tag, so a second one cannot override it', () => {
		expect(verify(signToken({ extraTags: [['u', 'https://evil.example/']] })).pubkey).toBe(PK);
	});

	it('...and a second u tag cannot rescue a wrong first one', () => {
		const t = signToken({ url: 'https://evil.example/', extraTags: [['u', URL_UNDER_TEST]] });
		expect(() => verify(t)).toThrow(/u tag/);
	});

	it('rejects a method mismatch', () => {
		expect(() => verify(signToken({ method: 'GET' }))).toThrow(/method tag/);
	});

	it('rejects a missing method tag', () => {
		const { event, body } = signToken();
		const stripped = finalizeEvent(
			{
				kind: NIP98_KIND,
				created_at: NOW,
				tags: event.tags.filter((t) => t[0] !== 'method'),
				content: ''
			},
			SK
		);
		expect(() => verify({ token: tokenOf(stripped), body })).toThrow(/missing the method tag/);
	});

	it('compares the method case-insensitively', () => {
		expect(verify(signToken({ method: 'post' })).pubkey).toBe(PK);
	});

	// --- payload binding -------------------------------------------------------------

	it('rejects a POST with no payload tag', () => {
		// Stricter than the NIP (which says SHOULD). Without the payload tag the token commits
		// only to (url, method), so a captured token replays against the same endpoint with an
		// attacker-chosen body - which would defeat the nonce, since the nonce is in the body.
		expect(() => verify(signToken({ omitPayload: true }))).toThrow(/missing the payload tag/);
	});

	it('rejects a body that does not match the payload hash', () => {
		const t = signToken();
		const tampered = new TextEncoder().encode(JSON.stringify({ nonce: 'other' }));
		expect(() => verify({ token: t.token, body: tampered })).toThrow(/payload tag/);
	});

	it('hashes RAW BYTES, so differently formatted JSON with the same meaning is rejected', () => {
		// Why nostr-tools' validateEvent is not used: it hashes JSON.stringify(parsedBody), so
		// two serializers that differ in key order or whitespace disagree. Hashing raw bytes
		// makes the check exact - the flip side being that the client must sign what it sends.
		const body = new TextEncoder().encode('{"nonce":"n"}');
		const reformatted = new TextEncoder().encode('{ "nonce": "n" }');
		const t = signToken({ body });
		expect(verify({ token: t.token, body }).pubkey).toBe(PK);
		expect(() => verify({ token: t.token, body: reformatted })).toThrow(/payload tag/);
	});

	it('accepts an uppercase payload hex digest', () => {
		const body = new TextEncoder().encode('{}');
		const event = finalizeEvent(
			{
				kind: NIP98_KIND,
				created_at: NOW,
				tags: [
					['u', URL_UNDER_TEST],
					['method', 'POST'],
					['payload', sha256Hex(body).toUpperCase()]
				],
				content: ''
			},
			SK
		);
		expect(verify({ token: tokenOf(event), body }).pubkey).toBe(PK);
	});

	it('does not require a payload tag for GET', () => {
		const event = finalizeEvent(
			{ kind: NIP98_KIND, created_at: NOW, tags: [['u', URL_UNDER_TEST], ['method', 'GET']], content: '' },
			SK
		);
		expect(
			verifyNip98({
				authorization: tokenOf(event),
				url: URL_UNDER_TEST,
				method: 'GET',
				body: new Uint8Array(),
				nowSeconds: NOW
			}).pubkey
		).toBe(PK);
	});

	// --- signature -------------------------------------------------------------------

	it('rejects a tampered signature', () => {
		const { event, body } = signToken();
		const forged = { ...event, sig: `${'0'.repeat(127)}1` };
		expect(() => verify({ token: tokenOf(forged), body })).toThrow(/signature is invalid/);
	});

	it('rejects a swapped pubkey, so a token cannot be re-attributed', () => {
		// The pubkey is inside the NIP-01 (protocol basics) canonical serialization, so
		// changing it breaks the event id before the signature check even runs. Either way it
		// must never authenticate the substituted key.
		const { event, body } = signToken();
		const forged = { ...event, pubkey: getPublicKey(generateSecretKey()) };
		expect(() => verify({ token: tokenOf(forged), body })).toThrow(Nip98Error);
	});

	it('rejects a tampered tag even with the original signature', () => {
		const { event, body } = signToken();
		const forged = { ...event, tags: [...event.tags, ['extra', 'x']] };
		expect(() => verify({ token: tokenOf(forged), body })).toThrow(/signature is invalid/);
	});

	it('checks cheap fields BEFORE the signature', () => {
		// Ordering is a denial-of-service property: the endpoint is open to anyone, and
		// secp256k1 is the only expensive step. A token with a junk signature AND a wrong kind
		// must fail on the kind, not on the crypto.
		const { event, body } = signToken({ kind: 1 });
		const forged = { ...event, sig: '00' };
		expect(() => verify({ token: tokenOf(forged), body })).toThrow(/kind must be/);
	});
});

describe('signedUrlFor', () => {
	it('builds the URL from the configured origin', () => {
		expect(signedUrlFor('/api/auth/login', 'https://nostrolo.gy')).toBe(URL_UNDER_TEST);
	});

	it('preserves a query string, which the u tag must include', () => {
		expect(signedUrlFor('/x?a=1', 'https://nostrolo.gy')).toBe('https://nostrolo.gy/x?a=1');
	});

	it('takes nothing a request could carry', () => {
		// There is no parameter through which a header could reach this function. That is the
		// entire point; a refactor that adds one should be revisited very carefully.
		expect(signedUrlFor.length).toBe(2);
	});

	it('refuses, through verifyNip98, a token signed for another origin', () => {
		const t = signToken({ url: 'https://evil.example/api/auth/login' });
		expect(() =>
			verifyNip98({
				authorization: t.token,
				url: signedUrlFor('/api/auth/login', 'https://nostrolo.gy'),
				method: 'POST',
				body: t.body,
				nowSeconds: NOW
			})
		).toThrow(/u tag/);
	});
});
