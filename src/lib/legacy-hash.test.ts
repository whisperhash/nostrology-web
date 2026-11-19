import { describe, expect, it, vi } from 'vitest';

import { legacyAddress, reload } from './legacy-hash';
import type { SlugTable } from './slug-table';
import { GIT_SLUGS } from './slug-tables/git';

// Old /<domain>#<pill> and /<domain>#methodology links ($lib/legacy-hash): what each meant.
// What the page then does with it is held in each page's own tests.

const SHOP: SlugTable = {
	path: '/shop',
	pills: [
		{ slug: 'overview', label: 'Overview' },
		{ slug: 'deals', label: 'Deals' }
	],
	sections: { prices: { pill: 'deals', elementId: 'shop-prices', title: 'Prices' } },
	former: { 'price-list': 'prices' },
	retired: { refunds: { pill: 'deals', title: 'Refunds' } },
	ownRoutes: ['items']
};

describe('legacyAddress', () => {
	it("sends an old pill or section hash to that slug's address", () => {
		expect(legacyAddress(SHOP, '#deals')).toBe('/shop/deals');
		expect(legacyAddress(SHOP, '#prices')).toBe('/shop/prices');
		// the default pill's address is the domain's own
		expect(legacyAddress(SHOP, '#overview')).toBe('/shop');
	});

	it("reads /git's old links as they were written", () => {
		expect(legacyAddress(GIT_SLUGS, '#hosting')).toBe('/git/hosting');
		expect(legacyAddress(GIT_SLUGS, '#methodology')).toBe('/git/methodology');
	});

	it('names nothing for any other hash: no old link was ever anything else', () => {
		for (const hash of ['', '#', '#gone', '#nope', '#price-list', '#refunds', '#items', '#Deals', '#constructor', '#a#deals'])
			expect(legacyAddress(SHOP, hash), hash).toBeNull();
	});

	it('takes the hash with or without its #', () => {
		expect(legacyAddress(SHOP, 'deals')).toBe('/shop/deals');
	});
});

describe('reload.at', () => {
	it("loads the address afresh in place of the old link's entry, so Back never lands on it", () => {
		// `replace`, never `assign`: an `assign` would leave the browser's own `#` entry behind,
		// and Back from the address would return to it (fresh-context review, 2026-10-19)
		const location = { replace: vi.fn() };
		reload.at('/git/hosting?x=1', location);
		expect(location.replace).toHaveBeenCalledTimes(1);
		expect(location.replace).toHaveBeenCalledWith('/git/hosting?x=1');
	});
});
