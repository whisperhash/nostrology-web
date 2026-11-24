import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// Every domain page with a slug table splits its server load in two
// ($lib/server/slug-address): the page load answers the address, the layout load fetches the
// document. This pins both, for each domain, through the real load files: the target, each
// redirect (uncached, the query kept, the database never asked), and the one property the
// split exists for - the layout load reads the address only untracked, so a pill click (a
// move between the page's own addresses) never runs it again and never re-sends the document.
// The rules themselves are pinned in src/lib/slug-table.test.ts.

const db = vi.hoisted(() => ({
	getNgitPage: vi.fn(),
	getMarketplacesSnapshot: vi.fn(),
	// /marketplaces' layout load fetches the Recent listings rows beside the snapshot.
	getMarketplacesRecentListings: vi.fn(),
	getRoutstrSnapshot: vi.fn(),
	// /zapstore's and /nutzaps' overview pages
	getZapstoreAppsCumulativeDaily: vi.fn(),
	getZapstoreNativeShareDaily: vi.fn(),
	getZapstoreZapsAggregateDaily: vi.fn(),
	getZapstoreAppReleasesDaily: vi.fn(),
	getNutzapsDailySeries: vi.fn(),
	getNutzapsUsersMonthly: vi.fn(),
	ACTIVE_USERS_1Y_WINDOW_SECONDS: 365 * 86400
}));
vi.mock('$lib/db/postgres', () => db);
// /git's real slug table, plus a former and a retired slug (no table has either yet), so that
// every rule is reached through a real load.
vi.mock('$lib/slug-tables/git', async (importOriginal) => {
	const real = (await importOriginal()) as typeof import('$lib/slug-tables/git');
	return {
		GIT_SLUGS: {
			...real.GIT_SLUGS,
			former: { 'zap-list': 'zaps' },
			retired: { 'old-stars': { pill: 'collaboration', title: 'Old stars' } }
		}
	};
});

import * as gitLayout from './git/+layout.server';
import * as gitPage from './git/+page.server';
import * as marketsLayout from './marketplaces/+layout.server';
import * as marketsPage from './marketplaces/+page.server';
import * as routstrLayout from './routstr/+layout.server';
import * as routstrPage from './routstr/+page.server';
import * as zapstorePage from './zapstore/(shell)/+page.server';
import * as nutzapsPage from './nutzaps/(shell)/+page.server';
import { OPERATOR, run, type Load } from './load-event.test-helper';
import { LISTING } from './marketplaces/fixture';

// THE CASES BELOW RUN AS THE OPERATOR (run's default), because a section still in development
// answers differently for everyone else ($lib/unreleased): a visitor's load reads none of its data
// and its address is not a slug at all. Running the shared cases as the operator keeps them
// pinning the whole page whatever is in development. The gate itself is held with a fixture flag
// in domain-loads.gating.test.ts, and what a visitor gets from /marketplaces is the describe block
// at the end of this file.

const DOMAINS = [
	{
		domain: '/git',
		layout: gitLayout.load as Load,
		page: gitPage.load as Load,
		fetch: db.getNgitPage,
		fetched: { snapshot: { generated_utc: 'fixture' }, listsFrom: 'table' },
		data: { snapshot: { generated_utc: 'fixture' }, listsFrom: 'table' },
		pill: 'hosting'
	},
	{
		domain: '/marketplaces',
		layout: marketsLayout.load as Load,
		page: marketsPage.load as Load,
		fetch: db.getMarketplacesSnapshot,
		fetched: { generated_at: 'fixture' },
		// Two reads, in parallel: the snapshot document and the Recent listings rows. The
		// rows are then cut to the ones a marketplace can show ($lib/markets/recent); this
		// fixture has no coordinate at all, so none can address it and the cut empties the
		// list.
		also: db.getMarketplacesRecentListings,
		alsoFetched: [{ title: 'fixture' }],
		data: { snapshot: { generated_at: 'fixture' }, recent: [] },
		pill: 'catalogue'
	},
	{
		domain: '/routstr',
		layout: routstrLayout.load as Load,
		page: routstrPage.load as Load,
		fetch: db.getRoutstrSnapshot,
		fetched: { generated_at: 'fixture' },
		data: { snapshot: { generated_at: 'fixture' } },
		pill: 'providers'
	}
];

beforeEach(() => {
	for (const d of DOMAINS) {
		d.fetch.mockReset().mockResolvedValue(d.fetched);
		if ('also' in d) (d.also as Mock).mockReset().mockResolvedValue(d.alsoFetched);
	}
});

describe.each(DOMAINS)('$domain', (d) => {
	const { pill } = d;

	it('the layout load fetches the document for each address of the page, reading the address untracked', async () => {
		for (const path of [d.domain, `${d.domain}/${pill}`, `${d.domain}/methodology`]) {
			const r = await run(d.layout, path);
			// /marketplaces also returns the instant it read its rows, so the page and the cut
			// ask "has this expired?" of ONE clock rather than two (+layout.server.ts). It is a
			// timestamp, so it is checked for shape and dropped before the deep comparison.
			const data = r.data as Record<string, unknown> | undefined;
			if (data && 'recentAt' in data) {
				expect(typeof data.recentAt, path).toBe('number');
				expect(data.recentAt as number, path).toBeGreaterThan(1.7e12);
				delete data.recentAt;
			}
			expect(r.data, path).toEqual(d.data);
			expect(r.reads.length, path).toBeGreaterThan(0);
			expect(r.reads.filter((x) => x.tracked).map((x) => x.key), path).toEqual([]);
		}
		expect(d.fetch).toHaveBeenCalledTimes(3);
		if ('also' in d) expect(d.also as Mock).toHaveBeenCalledTimes(3);
	});

	it('the layout load fetches nothing for an address the page load redirects', async () => {
		for (const path of [`${d.domain}/overview`, `${d.domain}/no-such`, `${d.domain}/constructor`]) {
			const r = await run(d.layout, path);
			expect(r.data, path).toEqual({});
		}
		expect(d.fetch).not.toHaveBeenCalled();
		// Every read the layout does, not just the document's: a redirect must cost the
		// database nothing at all.
		if ('also' in d) expect(d.also as Mock).not.toHaveBeenCalled();
	});

	it('the page load answers the address, tracked, and never asks the database', async () => {
		const cases: [string, unknown][] = [
			[d.domain, { kind: 'page', pill: 'overview' }],
			[`${d.domain}/${pill}`, { kind: 'page', pill }],
			[`${d.domain}/methodology`, { kind: 'page', pill: 'overview', section: 'methodology' }]
		];
		for (const [path, target] of cases) {
			const r = await run(d.page, path);
			expect(r.data, path).toEqual({ target });
			expect(r.setHeaders, path).not.toHaveBeenCalled();
			// tracked: the router runs this load again on every move between the page's addresses
			expect(r.reads.some((x) => x.tracked), path).toBe(true);
		}
		expect(d.fetch).not.toHaveBeenCalled();
	});

	it.each([
		['overview', 308, 'permanent redirect', ''],
		['no-such', 302, 'found', '#gone'],
		['constructor', 302, 'found', '#gone'],
		['no-such?utm_source=nostr', 302, 'found', '?utm_source=nostr#gone'],
		['overview?utm_source=nostr', 308, 'permanent redirect', '?utm_source=nostr']
	])('the page load answers /<domain>/%s with a %i (%s), never cached, and the database is not asked', async (slug, status, _, rest) => {
		const r = await run(d.page, `${d.domain}/${slug}`);
		expect(r.redirect).toEqual({ status, location: d.domain + rest });
		expect(r.setHeaders).toHaveBeenCalledWith({ 'cache-control': 'no-store' });
		expect(d.fetch).not.toHaveBeenCalled();
	});
});

describe('/git, with a former and a retired slug', () => {
	it('sends a former slug to the current one, and opens a retired one on its last pill', async () => {
		const former = await run(gitPage.load as Load, '/git/zap-list');
		expect(former.redirect).toEqual({ status: 308, location: '/git/zaps' });
		const retired = await run(gitPage.load as Load, '/git/old-stars');
		expect(retired.data).toEqual({ target: { kind: 'retired', pill: 'collaboration', title: 'Old stars' } });
		// a retired slug is a page: the layout fetches its document
		const layout = await run(gitLayout.load as Load, '/git/old-stars');
		expect(layout.data).toEqual(DOMAINS[0].data);
	});
});

// /zapstore and /nutzaps: each pill is a page of its own, so there is nothing to split. Their
// overview pages answer the address first, in the one load, before the database is asked.
describe.each([
	{
		domain: '/zapstore',
		load: zapstorePage.load as Load,
		fetches: [db.getZapstoreAppsCumulativeDaily, db.getZapstoreNativeShareDaily, db.getZapstoreZapsAggregateDaily, db.getZapstoreAppReleasesDaily]
	},
	{ domain: '/nutzaps', load: nutzapsPage.load as Load, fetches: [db.getNutzapsDailySeries, db.getNutzapsUsersMonthly] }
])('$domain overview', ({ domain, load, fetches }) => {
	beforeEach(() => {
		for (const f of fetches) f.mockReset().mockResolvedValue({});
	});

	it("answers the domain's own address with its data and the default pill", async () => {
		const r = await run(load, domain);
		expect((r.data as { target: unknown }).target).toEqual({ kind: 'page', pill: 'overview' });
		for (const f of fetches) expect(f).toHaveBeenCalled();
		expect(r.setHeaders).not.toHaveBeenCalled();
	});

	it.each([
		['overview', 308, 'permanent redirect', ''],
		['no-such', 302, 'found', '#gone'],
		['constructor', 302, 'found', '#gone']
	])('answers /<domain>/%s with a %i (%s), never cached, and the database is not asked', async (slug, status, _, rest) => {
		const r = await run(load, `${domain}/${slug}`);
		expect(r.redirect).toEqual({ status, location: domain + rest });
		expect(r.setHeaders).toHaveBeenCalledWith({ 'cache-control': 'no-store' });
		for (const f of fetches) expect(f).not.toHaveBeenCalled();
	});
});

// --- Recent listings, for every reader (the operator's call, 2026-11-24) ----------------------
// What the gate does to a section in development is held with a fixture flag in
// domain-loads.gating.test.ts; these pin what the real table says of Recent listings: both loads
// answer every reader as they answer the operator, rows and all.
describe('/marketplaces, Recent listings for every reader', () => {
	const SECTION = '/marketplaces/recent-listings';
	const OTHER = { pubkey: 'f'.repeat(64) };
	const READERS = [null, OTHER, OPERATOR];
	// A row that survives the cut, so that a reader sent an emptied copy of the rows differs from
	// one sent the rows: with the shared cases' row, which the cut drops, every reader gets [].
	beforeEach(() => {
		db.getMarketplacesRecentListings.mockResolvedValue([LISTING]);
	});

	it('reads the listings for every reader, and sends every reader the rows', async () => {
		for (const session of READERS) {
			db.getMarketplacesRecentListings.mockClear();
			const data = (await run(marketsLayout.load as Load, '/marketplaces', session)).data as Record<string, unknown>;
			expect(db.getMarketplacesRecentListings, JSON.stringify(session)).toHaveBeenCalledTimes(1);
			expect(Object.keys(data).sort(), JSON.stringify(session)).toEqual(['recent', 'recentAt', 'snapshot']);
			expect(data.recent, JSON.stringify(session)).toEqual([LISTING]);
		}
	});

	it("answers the section's address for every reader with the page, opened at the section", async () => {
		for (const session of READERS) {
			const r = await run(marketsPage.load as Load, SECTION, session);
			expect(r.data, JSON.stringify(session)).toEqual({
				target: { kind: 'page', pill: 'catalogue', section: 'recent-listings' }
			});
			expect(r.setHeaders, JSON.stringify(session)).not.toHaveBeenCalled();
			// and the layout sends the document and the rows there, as at any page address
			db.getMarketplacesRecentListings.mockClear();
			const l = await run(marketsLayout.load as Load, SECTION, session);
			expect((l.data as Record<string, unknown>).recent, JSON.stringify(session)).toEqual([LISTING]);
			expect(db.getMarketplacesRecentListings, JSON.stringify(session)).toHaveBeenCalledTimes(1);
		}
	});
});
