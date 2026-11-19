// NIP-98 (HTTP auth) token verification - kind-27235 (NIP-98 HTTP auth) events - for the
// login endpoint, POST /api/auth/login.
//
// Hand-rolled rather than taken from a library, deliberately. `nostr-tools/nip98`'s
// validateEvent() is close but wrong for us in three ways, each of which is a real defect at
// this call site:
//
//  1. It hashes `JSON.stringify(parsedBody)` for the `payload` tag, i.e. a RE-SERIALIZED
//     object. Key order and whitespace then have to match byte for byte between two JSON
//     implementations. We hash the RAW REQUEST BYTES, which is what the tag is supposed to
//     commit to and the only form that cannot drift.
//  2. Its `created_at` window was one-sided until 2.24.3 (`now - created_at < 60`, no abs()),
//     so a future-dated token authenticated forever. 2.25.0 fixed it, but the check is four
//     lines and we would rather own it than depend on an upstream decision for an auth
//     primitive.
//  3. It has no replay defence at all (NIP-98 specifies no nonce), and no notion of the
//     public URL behind a reverse proxy.
//
// The signature check itself is delegated to nostr-tools' verifyEvent, the audited BIP-340
// path: re-implementing schnorr verification would be reckless.
//
// SECURITY: an unauthenticated caller reaches this code at will - anyone can make a keypair
// and sign a well-formed token. Every check therefore runs before anything expensive, the
// caller caps the body, and no branch here logs the token.

import { createHash } from 'node:crypto';
import { verifyEvent, type Event } from 'nostr-tools/pure';
import { MAX_SKEW_SECONDS } from './config';

/** kind-27235 (NIP-98 HTTP auth). */
export const NIP98_KIND = 27235;

export class Nip98Error extends Error {}

export interface Nip98VerifyInput {
	/** Raw `Authorization` header value, expected to be `Nostr <base64>`. */
	authorization: string | undefined;
	/** The absolute URL the CLIENT signed: see signedUrlFor(), never a request-derived one. */
	url: string;
	/** HTTP method, compared case-insensitively. */
	method: string;
	/** Raw request body bytes, exactly as received. Empty for GET. */
	body: Uint8Array;
	nowSeconds: number;
	maxSkewSeconds?: number;
}

function tagValue(event: Event, name: string): string | undefined {
	// First occurrence wins, matching every other implementation. A duplicate tag is not an
	// error in NIP-01 (protocol basics), so we must not reject on it - but a SECOND `u` tag
	// must not override the first either, which is why this is a find() and not a filter.
	const tag = event.tags.find((t) => Array.isArray(t) && t[0] === name);
	return typeof tag?.[1] === 'string' ? tag[1] : undefined;
}

/**
 * Decode `Authorization: Nostr <base64>` into an event.
 *
 * NIP-98 (HTTP auth) says only "base64", and the ecosystem disagrees about the alphabet:
 * nostr-tools emits standard base64 WITH padding, Blossom BUD-11 mandates base64url WITHOUT
 * padding, and at least one server accepts only the latter. A client that picks either is not
 * doing anything wrong, so both are normalized rather than refused.
 */
export function decodeToken(authorization: string | undefined): Event {
	if (typeof authorization !== 'string' || authorization.length === 0) {
		throw new Nip98Error('missing Authorization header');
	}
	const match = /^Nostr\s+(.+)$/i.exec(authorization.trim());
	const encoded = match?.[1];
	if (encoded === undefined) {
		throw new Nip98Error('Authorization header must use the Nostr scheme');
	}
	const normalized = encoded.trim().replace(/-/g, '+').replace(/_/g, '/');
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
	} catch {
		throw new Nip98Error('Authorization token is not valid base64 JSON');
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Nip98Error('Authorization token is not a Nostr event');
	}
	// Structural validation before the cast. Without it a token whose `tags` is not an array
	// makes tagValue() throw a raw TypeError, and this function's contract ("throws
	// Nip98Error") would be false for every caller.
	const event = parsed as Partial<Event>;
	if (typeof event.pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(event.pubkey)) {
		throw new Nip98Error('event pubkey is missing or malformed');
	}
	if (typeof event.sig !== 'string' || typeof event.id !== 'string') {
		throw new Nip98Error('event id or signature is missing');
	}
	if (!Array.isArray(event.tags)) {
		throw new Nip98Error('event tags must be an array');
	}
	if (typeof event.content !== 'string') {
		throw new Nip98Error('event content must be a string');
	}
	return parsed as Event;
}

/**
 * Verify a decoded token against the request it claims to authorize.
 *
 * Order matters: cheap structural checks first, the signature LAST. The signature is the only
 * expensive operation here and the endpoint is reachable by anyone, so a garbage token must be
 * refused without ever reaching secp256k1. (Blossom's server does the same, for the same
 * stated reason.)
 *
 * Returns the verified event; throws Nip98Error with a caller-safe message otherwise.
 */
export function verifyNip98(input: Nip98VerifyInput): Event {
	const maxSkew = input.maxSkewSeconds ?? MAX_SKEW_SECONDS;
	const event = decodeToken(input.authorization);

	if (event.kind !== NIP98_KIND) {
		throw new Nip98Error(`event kind must be ${NIP98_KIND}`);
	}
	if (typeof event.created_at !== 'number' || !Number.isFinite(event.created_at)) {
		throw new Nip98Error('event created_at is missing or not a number');
	}

	// BOTH directions. A one-sided `now - created_at < maxSkew` is satisfied forever by a
	// future-dated event, which turns a 60-second token into a permanent credential - exactly
	// the bug shipped in nostr-tools <= 2.24.2.
	const skew = input.nowSeconds - event.created_at;
	if (skew > maxSkew) throw new Nip98Error('token expired');
	if (skew < -maxSkew) throw new Nip98Error('token is dated too far in the future');

	const u = tagValue(event, 'u');
	if (u === undefined) throw new Nip98Error('event is missing the u tag');
	// Exact match, per NIP-98 ("MUST be exactly the same as the absolute request URL,
	// including query parameters"). Loosening it would let a token minted for one endpoint be
	// replayed against another.
	if (u !== input.url) throw new Nip98Error('u tag does not match the request URL');

	const method = tagValue(event, 'method');
	if (method === undefined) throw new Nip98Error('event is missing the method tag');
	if (method.toLowerCase() !== input.method.toLowerCase()) {
		throw new Nip98Error('method tag does not match the request method');
	}

	// The payload tag is REQUIRED for bodied methods, which is stricter than the NIP (a client
	// SHOULD send it). Without it a token commits only to (url, method), so a captured one
	// replays against the same endpoint with a body of the attacker's choosing - and the
	// nonce that makes login single-use travels IN the body.
	const bodied = ['post', 'put', 'patch'].includes(input.method.toLowerCase());
	if (bodied) {
		const payload = tagValue(event, 'payload');
		if (payload === undefined) {
			throw new Nip98Error('event is missing the payload tag');
		}
		const digest = createHash('sha256').update(input.body).digest('hex');
		if (payload.toLowerCase() !== digest) {
			throw new Nip98Error('payload tag does not match the request body hash');
		}
	}

	// Signature last, per the ordering note above. verifyEvent also recomputes and checks the
	// event id, so a substituted pubkey fails here rather than authenticating someone else.
	if (!verifyEvent(event)) {
		throw new Nip98Error('event signature is invalid');
	}
	return event;
}

/**
 * The absolute URL the client must have signed, for the `u`-tag comparison.
 *
 * DERIVED FROM CONFIGURATION ONLY - the site's `ORIGIN` - and never from the request. Behind
 * Caddy, rebuilding it from `X-Forwarded-Host` / `X-Forwarded-Proto` would be a full
 * authentication bypass: Caddy's reverse_proxy sets those headers only when they are ABSENT,
 * so a client-sent value passes straight through. Since the `u` tag is the ONLY thing binding
 * a signed token to this site, an attacker could have a visitor sign a token for their own
 * origin, replay it here with that origin in the header, and be issued the visitor's session.
 * There is exactly one public origin and it is already configuration, so nothing is lost by
 * pinning it. If the site is ever served on several origins, allowlist them explicitly.
 */
export function signedUrlFor(path: string, publicOrigin: string): string {
	return new URL(path, publicOrigin).toString();
}
