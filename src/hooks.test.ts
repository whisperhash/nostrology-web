import { describe, expect, it, vi } from 'vitest';

// The real slug tables, plus a made-up domain with a route of its own, so the one rule no real
// table exercises yet - never reroute a slug that has its own route - is held too.
vi.mock('$lib/slug-tables', async (importOriginal) => {
	const real = await importOriginal<typeof import('$lib/slug-tables')>();
	return {
		SLUG_TABLES: {
			...real.SLUG_TABLES,
			shop: {
				path: '/shop',
				pills: [
					{ slug: 'overview', label: 'Overview' },
					{ slug: 'deals', label: 'Deals' }
				],
				sections: {},
				former: {},
				retired: {},
				ownRoutes: ['items']
			}
		}
	};
});

import { reroute } from './hooks';

const at = (path: string) => reroute({ url: new URL(`https://site.test${path}`), fetch } as never);

describe('reroute', () => {
	it('renders /<domain>/<slug> with the domain page, the address unchanged', () => {
		expect(at('/git/zaps')).toBe('/git');
		expect(at('/git/collaboration')).toBe('/git');
		expect(at('/git/methodology')).toBe('/git');
		expect(at('/marketplaces/geography')).toBe('/marketplaces');
		expect(at('/marketplaces/methodology')).toBe('/marketplaces');
		expect(at('/routstr/providers')).toBe('/routstr');
		// a slug the table does not know is the page's to answer, with a 302 (found) - never a
		// 404 (not found) - and so is one every object inherits (resolveSlug reads own keys only)
		expect(at('/git/no-such-section')).toBe('/git');
		expect(at('/git/constructor')).toBe('/git');
	});

	it('lets a trailing slash through, for SvelteKit to answer 308 (permanent redirect)', () => {
		expect(at('/git/zaps/')).toBe('/git');
	});

	it('leaves the domain itself, and anything that is not one slug, to the router', () => {
		for (const path of ['/git', '/git/', '/git/a/b', '/git/zaps/extra', '/git/.env', '/git/wp-login.php', '/git/Zaps', '/git/clone_hosts'])
			expect(at(path), path).toBeUndefined();
	});

	it('renders an unknown slug under /zapstore or /nutzaps with the domain page, for its 302 (found)', () => {
		expect(at('/zapstore/no-such-pill')).toBe('/zapstore');
		expect(at('/zapstore/overview')).toBe('/zapstore');
		expect(at('/nutzaps/no-such-pill')).toBe('/nutzaps');
		// a collection with no page at its own address is a slug like any other
		expect(at('/zapstore/publishers')).toBe('/zapstore');
	});

	it('leaves a pill built as a page of its own, a collection and an old ID address to their own routes', () => {
		const PUBKEY = '7579076d9aff0a4cfdefa7e2045f2486c7e5d8bc63bfc6b45397233e1bbfcb19';
		for (const path of ['/zapstore/leaderboards', '/zapstore/apps', `/zapstore/${PUBKEY}`, '/nutzaps/mints', `/zapstore/publishers/${PUBKEY}`])
			expect(at(path), path).toBeUndefined();
	});

	it('leaves domains with no slug table alone', () => {
		for (const path of ['/relays/relay.damus.io', '/relays/localhost', '/lightning/nope', '/data/git'])
			expect(at(path), path).toBeUndefined();
	});

	it('finds no slug table in what every object inherits: those stay a 404 (not found)', () => {
		// a plain lookup found Object's constructor as a domain, and reroute threw: a 500 (internal
		// server error) until 2026-10-19
		for (const path of ['/constructor/abc', '/__proto__/abc', '/toString/abc', '/hasOwnProperty/x', '/valueOf/y'])
			expect(at(path), path).toBeUndefined();
	});

	it('never reroutes a slug that is a route of its own', () => {
		expect(at('/shop/deals')).toBe('/shop');
		expect(at('/shop/items')).toBeUndefined();
	});
});
