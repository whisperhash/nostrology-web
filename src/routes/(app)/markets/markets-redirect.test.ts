import { describe, it, expect } from 'vitest';
import { isRedirect } from '@sveltejs/kit';

import { GET } from './+server';

/**
 * /markets -> /marketplaces. The URL was handed out while the page was unlinked, so it
 * survives as a redirect. Pinned: the permanent, method-preserving status (308 - see
 * the shim's comment) and the query-string carry-through, without which a shared
 * ?utm_*= link loses its GA4 attribution.
 */
type MinimalHandler = (event: { url: URL }) => unknown;

function call(search = ''): { status: number; location: string } {
	try {
		(GET as unknown as MinimalHandler)({ url: new URL(`https://nostrolo.gy/markets${search}`) });
	} catch (e) {
		if (isRedirect(e)) return { status: e.status, location: e.location };
		throw e;
	}
	throw new Error('handler returned without redirecting');
}

describe('legacy /markets redirect', () => {
	it('sends 308 to /marketplaces', () => {
		expect(call()).toEqual({ status: 308, location: '/marketplaces' });
	});

	it('carries the query string across', () => {
		expect(call('?utm_source=nostr&utm_campaign=launch').location).toBe(
			'/marketplaces?utm_source=nostr&utm_campaign=launch'
		);
	});
});
