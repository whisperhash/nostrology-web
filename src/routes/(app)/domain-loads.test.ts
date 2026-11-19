import { isRedirect } from '@sveltejs/kit';
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
import { OPERATOR_PUBKEY } from '$lib/unreleased';
import { own } from '$lib/slug-table';
import { SLUG_TABLES } from '$lib/slug-tables';

type Load = (event: never) => unknown;

/**
 * THE CASES BELOW RUN AS THE OPERATOR, because /marketplaces' loads answer differently for
 * everyone else: Recent listings is still in development, so a visitor's load reads no
 * listings and the section's address is not a slug at all ($lib/unreleased). Running the
 * shared cases as the operator keeps them pinning the whole page; the gate itself has its own
 * describe block at the end of this file, which runs as everybody else.
 */
const OPERATOR = { pubkey: OPERATOR_PUBKEY };

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

/** A load event at `path`, recording every read of the address and whether SvelteKit would
 * have tracked it: a read is untracked only inside `untrack`. Any property counts (SvelteKit
 * tracks pathname, search, searchParams, href, toString, toJSON...), not a chosen few. */
function eventAt(path: string, session: { pubkey: string } | null = OPERATOR) {
	const real = new URL('https://site.test' + path);
	const reads: { key: string; tracked: boolean }[] = [];
	let untracked = 0;
	const url = new Proxy(real, {
		get(target, key) {
			if (typeof key === 'string') reads.push({ key, tracked: untracked === 0 });
			const v = Reflect.get(target, key, target);
			return typeof v === 'function' ? v.bind(target) : v;
		}
	});
	const untrack = <T>(fn: () => T): T => {
		untracked += 1;
		try {
			return fn();
		} finally {
			untracked -= 1;
		}
	};
	const setHeaders = vi.fn();
	return { event: { url, untrack, setHeaders, locals: { session } } as never, reads, setHeaders };
}

type Run = ReturnType<typeof eventAt> & { data?: unknown; redirect?: { status: number; location: string } };
async function run(load: Load, path: string, session?: { pubkey: string } | null): Promise<Run> {
	const e = session === undefined ? eventAt(path) : eventAt(path, session);
	try {
		return { data: await load(e.event), ...e };
	} catch (err) {
		if (isRedirect(err)) return { redirect: { status: err.status, location: err.location }, ...e };
		throw err;
	}
}

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

// --- Recent listings is still in development: who the loads answer for -----------------------
// The section is visible to the operator's own session and to nobody else (the operator's call,
// 2026-10-24). The gate has to hold in BOTH loads, for different reasons: the page load decides
// whether the section's address is a slug at all, and the layout load decides whether anyone
// else's browser is ever sent a listing. $lib/unreleased has the rule; these are the two places
// it is applied.
describe('/marketplaces, Recent listings while it is in development', () => {
	const SECTION = '/marketplaces/recent-listings';
	const OTHER = { pubkey: 'f'.repeat(64) };

	it('reads no listings at all for a visitor, and sends none', async () => {
		for (const session of [null, OTHER, { pubkey: OPERATOR_PUBKEY.slice(0, 63) }]) {
			const r = await run(marketsLayout.load as Load, '/marketplaces', session);
			expect(r.data, JSON.stringify(session)).toEqual({ snapshot: { generated_at: 'fixture' } });
			expect(db.getMarketplacesRecentListings).not.toHaveBeenCalled();
		}
	});

	it('reads them for the operator, and says when it read them', async () => {
		const r = await run(marketsLayout.load as Load, '/marketplaces', OPERATOR);
		expect(db.getMarketplacesRecentListings).toHaveBeenCalledTimes(1);
		expect(Object.keys(r.data as object).sort()).toEqual(['recent', 'recentAt', 'snapshot']);
	});

	it('takes the pubkey in either case, since the same key is the same person', async () => {
		const r = await run(marketsLayout.load as Load, '/marketplaces', {
			pubkey: OPERATOR_PUBKEY.toUpperCase()
		});
		expect(db.getMarketplacesRecentListings).toHaveBeenCalledTimes(1);
		expect(r.data).toHaveProperty('recent');
	});

	it("answers the section's address for a visitor exactly as it answers a word nobody has used", async () => {
		for (const session of [null, OTHER]) {
			const r = await run(marketsPage.load as Load, SECTION, session);
			expect(r.redirect, JSON.stringify(session)).toEqual({
				status: 302,
				location: '/marketplaces#gone'
			});
			expect(r.setHeaders).toHaveBeenCalledWith({ 'cache-control': 'no-store' });
			// and the document is not fetched for it either
			const l = await run(marketsLayout.load as Load, SECTION, session);
			expect(l.data).toEqual({});
			expect(db.getMarketplacesSnapshot).not.toHaveBeenCalled();
			expect(db.getMarketplacesRecentListings).not.toHaveBeenCalled();
		}
	});

	it("answers the section's address for the operator", async () => {
		const r = await run(marketsPage.load as Load, SECTION, OPERATOR);
		expect(r.data).toEqual({
			target: { kind: 'page', pill: 'catalogue', section: 'recent-listings' }
		});
		expect(r.setHeaders).not.toHaveBeenCalled();
	});

	// --- and the same two properties, generically, so the NEXT one is held with no new test ---
	// Both cases below walk the real slug tables, so a second section marked `unreleased` in any
	// domain whose loads this file already imports is covered the day the flag is set - which is
	// the gap a review found: the cases above are hand-written for /marketplaces, and a new
	// domain that forgot `visibleTable` or `seesSection` would fail nothing.

	it('redirects a visitor away from EVERY address its table still has in development', async () => {
		let checked = 0;
		for (const d of DOMAINS) {
			const t = own(SLUG_TABLES, d.domain.slice(1));
			if (!t) continue;
			for (const [slug, section] of Object.entries(t.sections)) {
				if (section.unreleased !== true) continue;
				checked += 1;
				const r = await run(d.page, `${d.domain}/${slug}`, null);
				expect(r.redirect, `${d.domain}/${slug}`).toEqual({
					status: 302,
					location: `${d.domain}#gone`
				});
			}
		}
		expect(checked, 'no domain has a section in development - delete this case').toBeGreaterThan(0);
	});

	it('sends a visitor LESS than it sends the operator, wherever a table has one', async () => {
		// The data half, generically: a gated section's rows must be ABSENT from a visitor's
		// document, not present and empty, so the visitor's data has strictly fewer keys. A
		// domain that forgot the gate sends them both the same thing and fails here.
		let checked = 0;
		for (const d of DOMAINS) {
			const t = own(SLUG_TABLES, d.domain.slice(1));
			if (!t || !Object.values(t.sections).some((section) => section.unreleased === true)) continue;
			checked += 1;
			const anon = Object.keys((await run(d.layout, d.domain, null)).data as object);
			const op = Object.keys((await run(d.layout, d.domain, OPERATOR)).data as object);
			expect(anon.length, d.domain).toBeLessThan(op.length);
			expect(op, d.domain).toEqual(expect.arrayContaining(anon));
		}
		expect(checked).toBeGreaterThan(0);
	});

	it('leaves every other address of the page alone for a visitor', async () => {
		for (const path of ['/marketplaces', '/marketplaces/catalogue', '/marketplaces/categories', '/marketplaces/methodology']) {
			const r = await run(marketsPage.load as Load, path, null);
			expect(r.redirect, path).toBeUndefined();
			expect(r.data, path).toHaveProperty('target');
		}
	});

	it("answers Categories' address for a visitor with the page, and sends no listing with it", async () => {
		// A section that is for everyone, on the same pill as the one that is not (2026-11-04).
		const page = await run(marketsPage.load as Load, '/marketplaces/categories', null);
		expect(page.data).toEqual({ target: { kind: 'page', pill: 'catalogue', section: 'categories' } });
		const layout = await run(marketsLayout.load as Load, '/marketplaces/categories', null);
		expect(layout.data).toEqual({ snapshot: { generated_at: 'fixture' } });
		expect(db.getMarketplacesRecentListings).not.toHaveBeenCalled();
	});
});
