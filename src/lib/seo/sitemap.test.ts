import { describe, it, expect } from 'vitest';
import { NAV_ITEMS } from '$lib/nav';
import { slugAddresses, type SlugTable } from '$lib/slug-table';
import { SLUG_TABLES } from '$lib/slug-tables';
import { visibleTable } from '$lib/unreleased';
import {
	appPath,
	dataPaths,
	isHiddenPath,
	MAX_URLS,
	publisherPath,
	sitemapPaths,
	sitemapXml,
	slugTablePaths,
	STATIC_PATHS
} from './sitemap';

const PK = '7579076d9aff0a4cfdefa7e2045f2486c7e5d8bc63bfc6b45397233e1bbfcb19';
const PK2 = '78ce6faa72264387284e647ba6938995735ec8c7d5c5a65737e55130f026307d';

const INPUTS = {
	apps: [
		{ pubkey: PK, d_tag: 'com.greenart7c3.nostrsigner' },
		{ pubkey: PK2, d_tag: 'a/b c&d' }
	],
	publishers: [PK, PK2],
	mintHrefs: ['/nutzaps/mints/mint.minibits.cash/Bitcoin', '/nutzaps/mints/8333.space:3338'],
	dataPaths: dataPaths(
		['zapstore', 'routstr', 'nutzaps'],
		[
			{ domain: 'zapstore', name: 'zap_count' },
			{ domain: 'routstr', name: 'network_activity' },
			{ domain: 'zapstore', name: 'app_catalog' }
		]
	)
};

/**
 * The sitemap lists URLs whether or not anything links to them, so it is the one place
 * that could quietly publish a page kept hidden on purpose (/wip,
 * /routstr, the /zapstore/apps index, /relays and everything under it). These
 * tests pin both directions of the rule - nothing hidden gets in, and nothing public
 * is swept out by a rule that is too broad.
 */
describe('isHiddenPath', () => {
	it.each([
		'/wip',
		'/wip/',
		'/wip?x=1',
		'/routstr',
		'/routstr/anything',
		'/relays',
		'/relays/',
		'/relays/relay.damus.io',
		'/relays/wss%3A%2F%2Fnos.lol',
		'/zapstore/apps',
		'/zapstore/apps/',
		'/zapstore/apps?sort=name'
	])('hides %s', (p) => {
		expect(isHiddenPath(p)).toBe(true);
	});

	it.each([
		// Every app page lives UNDER the hidden index: a prefix rule would drop them all.
		`/zapstore/apps/${PK}/com.greenart7c3.nostrsigner`,
		// The public registry pages of the Routstr MCP domain: a substring rule would drop them.
		'/data/routstr',
		'/data/routstr/network_activity',
		// /git left the hidden set on 2026-10-15, when it joined the nav.
		'/git',
		'/git/',
		'/git#hosting',
		'/data/git',
		// Look-alikes that merely START with a hidden name, without a / boundary.
		'/airplane',
		'/aim',
		'/relaysx',
		'/wipe',
		'/routstrx',
		'/gitx',
		'/github',
		'/zapstore/appsx',
		'/',
		'/zapstore',
		'/data'
	])('keeps %s', (p) => {
		expect(isHiddenPath(p)).toBe(false);
	});
});

describe('sitemapPaths', () => {
	it('lists the nav pages, the registry pages, every publisher, app and listed mint', () => {
		const paths = sitemapPaths(INPUTS);
		for (const p of STATIC_PATHS) expect(paths).toContain(p);
		expect(paths).toContain(publisherPath(PK));
		expect(paths).toContain(publisherPath(PK2));
		expect(paths).toContain(appPath(PK, 'com.greenart7c3.nostrsigner'));
		expect(paths).toContain('/nutzaps/mints/8333.space:3338');
		expect(paths).toContain('/data/routstr/network_activity');
		expect(paths).toContain('/data/zapstore/app_catalog');
	});

	it('lists every page the nav links to that is not hidden', () => {
		// STATIC_PATHS is kept by hand; a surface that joins the nav (as /git did on 2026-10-15)
		// must join it too.
		const paths = sitemapPaths(INPUTS);
		const linked = NAV_ITEMS.map((i) => i.href).filter((h) => !isHiddenPath(h));
		expect(linked).toContain('/git');
		for (const h of linked) expect(paths).toContain(h);
	});

	it('never lists a hidden path, whatever the inputs carry', () => {
		const poisoned = {
			...INPUTS,
			dataPaths: [...INPUTS.dataPaths, '/wip', '/routstr', '/relays/x', '/zapstore/apps']
		};
		const paths = sitemapPaths(poisoned);
		for (const p of paths) expect(isHiddenPath(p)).toBe(false);
		for (const hidden of ['/wip', '/routstr', '/relays', '/zapstore/apps']) {
			expect(paths).not.toContain(hidden);
		}
		expect(paths.some((p) => p.startsWith('/relays'))).toBe(false);
	});

	it('names each app page the way the site links it (d-tag percent-encoded)', () => {
		expect(appPath(PK2, 'a/b c&d')).toBe(`/zapstore/apps/${PK2}/a%2Fb%20c%26d`);
	});

	it('canonicalises the lead /data domain to /data itself, not /data/<lead>', () => {
		expect(INPUTS.dataPaths).not.toContain('/data/zapstore');
		expect(INPUTS.dataPaths).toContain('/data/routstr');
		expect(INPUTS.dataPaths).toContain('/data/nutzaps');
	});

	it('drops malformed publisher keys and empty d-tags instead of emitting broken URLs', () => {
		const paths = sitemapPaths({
			...INPUTS,
			apps: [{ pubkey: 'nothex', d_tag: 'x' }, { pubkey: PK, d_tag: '' }],
			publishers: ['NOTHEX']
		});
		expect(paths.some((p) => p.includes('nothex') || p.includes('NOTHEX'))).toBe(false);
		expect(paths).not.toContain(`/zapstore/apps/${PK}/`);
	});

	it('lists each URL once', () => {
		const paths = sitemapPaths({ ...INPUTS, publishers: [PK, PK, PK2] });
		expect(new Set(paths).size).toBe(paths.length);
	});
});

// Since 2026-10-19 the pill and section addresses of every domain with a slug table are the
// canonical form, and indexed (the operator: "This is the new canonical form that should be
// indexed"). They come from the slug tables, so these hold the list to the tables both ways:
// every address of a public domain is in it, and nothing else from a table is.
describe('slug table addresses', () => {
	const SHOP: SlugTable = {
		path: '/shop',
		pills: [
			{ slug: 'overview', label: 'Overview' },
			{ slug: 'deals', label: 'Deals' }
		],
		sections: { prices: { pill: 'deals', elementId: 'shop-prices', title: 'Prices' } },
		former: { 'price-list': 'prices', home: 'overview' },
		retired: { refunds: { pill: 'deals', title: 'Refunds' } },
		ownRoutes: ['items']
	};

	it("lists every pill and section address of every domain with a slug table, leaving out only a hidden domain's", () => {
		const paths = sitemapPaths(INPUTS);
		let listed = 0;
		for (const [domain, t] of Object.entries(SLUG_TABLES)) {
			// the anonymous reader's view of each table, which is what a sitemap is: a pill or
			// section still in development is not an address anyone but the operator has
			// ($lib/unreleased), and the test below pins its absence from here
			for (const address of slugAddresses(visibleTable(t, false))) {
				const hidden = isHiddenPath(address);
				expect(paths.includes(address), `${domain}: ${address}`).toBe(!hidden);
				// a domain is hidden or public as a whole: never some of its addresses
				expect(hidden, address).toBe(isHiddenPath(t.path));
				if (!hidden) listed += 1;
			}
		}
		expect(listed).toBeGreaterThan(0);
	});

	it('lists the addresses the operator asked for, and keeps hidden /routstr out', () => {
		const paths = sitemapPaths(INPUTS);
		for (const p of ['/git/repositories', '/git/hosting', '/git/maintainers', '/git/collaboration', '/git/zaps', '/git/methodology'])
			expect(paths).toContain(p);
		// Recent listings since the operator's call of 2026-11-24 released it
		for (const p of ['/marketplaces/growth', '/marketplaces/catalogue', '/marketplaces/geography', '/marketplaces/shipping', '/marketplaces/categories', '/marketplaces/recent-listings', '/marketplaces/methodology'])
			expect(paths).toContain(p);
		// pills built as pages of their own, listed from their slug tables
		for (const p of ['/zapstore/leaderboards', '/nutzaps/mints']) expect(paths).toContain(p);
		expect(paths.some((p) => p.startsWith('/routstr'))).toBe(false);
	});

	it('leaves out a section still in development, wherever the slug table puts one', () => {
		// Its address answers a visitor with a 302 (found) to the domain, so listing it would put
		// a redirect in the sitemap and tell every crawler that something is there. A fixture
		// table carries one, so this holds whatever the real tables do.
		const inDevelopment: SlugTable = {
			...SHOP,
			sections: { ...SHOP.sections, returns: { pill: 'deals', elementId: 'shop-returns', title: 'Returns', unreleased: true } }
		};
		expect(slugTablePaths({ shop: inDevelopment })).toEqual(['/shop/deals', '/shop/prices']);
		expect(sitemapPaths({ ...INPUTS, slugTables: { shop: inDevelopment } })).not.toContain('/shop/returns');
		// and it is in the operator's view of the same table, so this is the gate and not a typo
		expect(slugAddresses(inDevelopment)).toContain('/shop/returns');
		// the pill shape is not supported and slugTableProblems refuses it; that it would be
		// filtered here too is pinned in src/lib/unreleased.test.ts
	});

	it("names each default pill once, by the domain's own address - never /<domain>/<default pill>", () => {
		const paths = sitemapPaths(INPUTS);
		for (const t of Object.values(SLUG_TABLES)) {
			expect(paths).not.toContain(`${t.path}/${t.pills[0].slug}`);
			if (!isHiddenPath(t.path)) expect(paths.filter((p) => p === t.path)).toHaveLength(1);
		}
	});

	it('lists no former or retired slug: they are not pages of their own', () => {
		expect(slugTablePaths({ shop: SHOP })).toEqual(['/shop/deals', '/shop/prices']);
		const paths = sitemapPaths({ ...INPUTS, slugTables: { shop: SHOP } });
		for (const p of ['/shop/price-list', '/shop/home', '/shop/refunds', '/shop/items', '/shop/overview'])
			expect(paths, p).not.toContain(p);
	});

	it("lists a domain's addresses the day it leaves the hidden set, and not before", () => {
		expect(sitemapPaths({ ...INPUTS, slugTables: { shop: SHOP } })).toContain('/shop/deals');
		const hidden = { ...SHOP, path: '/wip' };
		expect(sitemapPaths({ ...INPUTS, slugTables: { wip: hidden } }).some((p) => p.startsWith('/wip'))).toBe(false);
	});

	it('is built in a fixed order: the static pages, then each table\'s addresses in its own order', () => {
		const paths = sitemapPaths(INPUTS);
		expect(paths.slice(0, STATIC_PATHS.length)).toEqual([...STATIC_PATHS]);
		// then every non-hidden table's addresses, table by table, each its pills then its sections
		const tables = Object.values(SLUG_TABLES).flatMap((t) => slugAddresses(visibleTable(t, false))).filter((p) => !isHiddenPath(p) && !STATIC_PATHS.includes(p as never));
		expect(paths.slice(STATIC_PATHS.length, STATIC_PATHS.length + tables.length)).toEqual(tables);
		expect(paths.filter((p) => p.startsWith('/git/'))).toEqual(slugAddresses(visibleTable(SLUG_TABLES.git, false)));
	});
});

describe('sitemapXml', () => {
	it('is a sitemaps.org urlset with absolute, XML-escaped locations', () => {
		const xml = sitemapXml('https://nostrolo.gy', ['/', "/q?a=1&b='x'"]);
		expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
		expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
		expect(xml).toContain('<url><loc>https://nostrolo.gy/</loc></url>');
		expect(xml).toContain('<loc>https://nostrolo.gy/q?a=1&amp;b=&apos;x&apos;</loc>');
		expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
	});

	it('refuses to exceed the per-file URL limit rather than truncating silently', () => {
		const many = Array.from({ length: MAX_URLS + 1 }, (_, i) => `/p${i}`);
		expect(() => sitemapXml('https://nostrolo.gy', many)).toThrow(/limit/);
	});
});
