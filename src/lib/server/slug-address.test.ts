import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';

import type { SlugTable } from '$lib/slug-table';
import { answerAddress, redirectsAway } from './slug-address';

// A domain page's address, answered on the server. The rules themselves are pinned in
// src/lib/slug-table.test.ts; this pins what the two loads do with them, and each domain's
// loads are pinned on top in src/routes/(app)/domain-loads.test.ts.

const SHOP: SlugTable = {
	path: '/shop',
	pills: [
		{ slug: 'overview', label: 'Overview' },
		{ slug: 'deals', label: 'Deals' }
	],
	sections: { prices: { pill: 'deals', elementId: 'shop-prices', title: 'Prices' } },
	former: { 'price-list': 'prices' },
	retired: { refunds: { pill: 'deals', title: 'Refunds' } },
	ownRoutes: []
};

function answer(path: string) {
	const setHeaders = vi.fn();
	try {
		return { target: answerAddress(SHOP, new URL('https://site.test' + path), setHeaders), setHeaders };
	} catch (e) {
		if (isRedirect(e)) return { redirect: { status: e.status, location: e.location }, setHeaders };
		throw e;
	}
}

describe('answerAddress', () => {
	it.each([
		['/shop', { kind: 'page', pill: 'overview' }],
		['/shop/deals', { kind: 'page', pill: 'deals' }],
		['/shop/prices', { kind: 'page', pill: 'deals', section: 'prices' }],
		['/shop/refunds', { kind: 'retired', pill: 'deals', title: 'Refunds' }]
	])('%s: the target, and no header of its own', (path, target) => {
		const r = answer(path);
		expect(r.target).toEqual(target);
		expect(r.setHeaders).not.toHaveBeenCalled();
	});

	it.each([
		['/shop/overview', 308, 'permanent redirect', '/shop'],
		['/shop/price-list', 308, 'permanent redirect', '/shop/prices'],
		['/shop/nope', 302, 'found', '/shop#gone'],
		['/shop/constructor', 302, 'found', '/shop#gone'],
		['/shop/price-list?utm_source=nostr', 308, 'permanent redirect', '/shop/prices?utm_source=nostr'],
		['/shop/nope?utm_source=nostr', 302, 'found', '/shop?utm_source=nostr#gone']
	])('%s: %i (%s) to %s, keeping the query, never cached', (path, status, _, location) => {
		const r = answer(path);
		expect(r.redirect).toEqual({ status, location });
		expect(r.setHeaders).toHaveBeenCalledWith({ 'cache-control': 'no-store' });
	});
});

describe('redirectsAway', () => {
	it('is true exactly where answerAddress redirects', () => {
		for (const path of ['/shop/overview', '/shop/price-list', '/shop/nope', '/shop/constructor'])
			expect(redirectsAway(SHOP, path), path).toBe(true);
		for (const path of ['/shop', '/shop/deals', '/shop/prices', '/shop/refunds'])
			expect(redirectsAway(SHOP, path), path).toBe(false);
	});
});
