import { describe, it, expect } from 'vitest';
import { isRedirect } from '@sveltejs/kit';

import { GET as publisherShim } from './[pubkey=hex64]/+server';
import { GET as appShim } from './[pubkey=hex64]/[d_tag]/+server';

/**
 * The 2026-08-02 restructure moved pubkeys off /zapstore into collection
 * segments of their own:
 *
 *   /zapstore/<pubkey>          -> /zapstore/publishers/<pubkey>
 *   /zapstore/<pubkey>/<d_tag>  -> /zapstore/apps/<pubkey>/<d_tag>
 *
 * Both old shapes were handed out as links before the move, so they survive as
 * redirect shims. These are the only NEW runtime behaviour in that change and
 * three of their properties regress invisibly, so each is pinned here:
 *
 *   1. the status code (308, permanent and method-preserving - see the shims'
 *      comments),
 *   2. d_tag re-encoding, which reads like a redundant line and is not,
 *   3. query-string carry-through, without which a shared ?utm_*= link loses
 *      its GA4 attribution.
 *
 * SvelteKit's redirect() signals by throwing, so every case asserts on the
 * thrown Redirect rather than a return value.
 */

const PUBKEY = '7579076d9aff0a4cfdefa7e2045f2486c7e5d8bc63bfc6b45397233e1bbfcb19';

// The handlers touch only `params` and `url`, so a minimal stand-in is enough.
// `handler` is deliberately `unknown`: the two shims have DIFFERENT generated
// RouteParams (one has d_tag, one does not), so no single RequestHandler type
// accepts both. The structural cast below is the honest narrowing.
type MinimalHandler = (event: { params: Record<string, string>; url: URL }) => unknown;

function call(
	handler: unknown,
	params: Record<string, string>,
	search = ''
): { status: number; location: string } {
	try {
		(handler as MinimalHandler)({
			params,
			url: new URL(`https://nostrolo.gy/zapstore/whatever${search}`)
		});
	} catch (e) {
		if (isRedirect(e)) return { status: e.status, location: e.location };
		throw e;
	}
	throw new Error('handler returned without redirecting');
}

describe('legacy /zapstore/<pubkey> redirect', () => {
	it('sends 308 to the publishers collection', () => {
		expect(call(publisherShim, { pubkey: PUBKEY })).toEqual({
			status: 308,
			location: `/zapstore/publishers/${PUBKEY}`
		});
	});

	it('carries the query string across', () => {
		expect(call(publisherShim, { pubkey: PUBKEY }, '?utm_source=nostr&utm_campaign=launch').location).toBe(
			`/zapstore/publishers/${PUBKEY}?utm_source=nostr&utm_campaign=launch`
		);
	});
});

describe('legacy /zapstore/<pubkey>/<d_tag> redirect', () => {
	it('sends 308 to the apps collection, keeping both identity segments', () => {
		expect(call(appShim, { pubkey: PUBKEY, d_tag: 'com.greenart7c3.nostrsigner' })).toEqual({
			status: 308,
			location: `/zapstore/apps/${PUBKEY}/com.greenart7c3.nostrsigner`
		});
	});

	it('re-encodes a d_tag carrying reserved characters', () => {
		// params.d_tag arrives percent-DECODED, so a raw interpolation would emit
		// a slash that re-parses as a path separator, and a bare space, in the
		// Location header.
		expect(call(appShim, { pubkey: PUBKEY, d_tag: 'a/b c' }).location).toBe(
			`/zapstore/apps/${PUBKEY}/a%2Fb%20c`
		);
	});

	it('carries the query string across', () => {
		expect(
			call(appShim, { pubkey: PUBKEY, d_tag: 'dev.zapstore.app' }, '?ref=abc').location
		).toBe(`/zapstore/apps/${PUBKEY}/dev.zapstore.app?ref=abc`);
	});
});
