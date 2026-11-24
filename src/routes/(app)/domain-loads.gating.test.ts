import { beforeEach, describe, expect, it, vi } from 'vitest';

// THE GATE ON A DOMAIN PAGE'S TWO SERVER LOADS, held with a FIXTURE FLAG ($lib/unreleased).
//
// This file marks Recent listings, the section the gate was built for, in development in a
// stand-in for /marketplaces' slug table, and runs the REAL load files against it. So the gate
// stays proved whatever the real tables hold, including when they hold nothing in development -
// the way a fixture entry proves the nav's in src/lib/nav.gating.test.ts. What every reader gets
// from the real tables, and the loads' other rules, are domain-loads.test.ts's.
//
// A section in development is visible to the operator's own session and to nobody else - not
// to an anonymous visitor and not to another logged-in one (the operator's call, 2026-10-24). The
// gate has to hold in BOTH loads, for different reasons: the page load decides whether the
// section's address is a slug at all, and the layout load decides whether anyone else's browser
// is ever sent a row.

const db = vi.hoisted(() => ({
	getNgitPage: vi.fn(),
	getMarketplacesSnapshot: vi.fn(),
	getMarketplacesRecentListings: vi.fn(),
	getRoutstrSnapshot: vi.fn()
}));
vi.mock('$lib/db/postgres', () => db);
// The real table with ONE change: Recent listings in development. Every importer gets this copy -
// the two load files, and $lib/slug-tables, whose SLUG_TABLES the generic cases below walk -
// which the first case checks.
vi.mock('$lib/slug-tables/marketplaces', async (importOriginal) => {
	const real = (await importOriginal()) as typeof import('$lib/slug-tables/marketplaces');
	const t = real.MARKETPLACES_SLUGS;
	return {
		...real,
		MARKETPLACES_SLUGS: {
			...t,
			sections: { ...t.sections, 'recent-listings': { ...t.sections['recent-listings'], unreleased: true } }
		}
	};
});

import * as gitLayout from './git/+layout.server';
import * as gitPage from './git/+page.server';
import * as marketsLayout from './marketplaces/+layout.server';
import * as marketsPage from './marketplaces/+page.server';
import * as routstrLayout from './routstr/+layout.server';
import * as routstrPage from './routstr/+page.server';
import { own, routedElsewhere, slugAddresses, slugIn, slugTableProblems } from '$lib/slug-table';
import { SLUG_TABLES } from '$lib/slug-tables';
import { MARKETPLACES_SLUGS } from '$lib/slug-tables/marketplaces';
import { OPERATOR_PUBKEY } from '$lib/unreleased';
import { OPERATOR, run, type Load } from './load-event.test-helper';
import { LISTING } from './marketplaces/fixture';

const SECTION = '/marketplaces/recent-listings';
const OTHER = { pubkey: 'f'.repeat(64) };
const SNAPSHOT = { generated_at: 'fixture' };
/** The fixture's section, and what its flag takes out of a visitor's document: the rows and the
 *  instant they were read (the cases below pin both). The generic data case holds these apart, so
 *  that this section cannot stand in for another one in development on the same page. */
const FIXTURE = { domain: '/marketplaces', slug: 'recent-listings', keys: ['recent', 'recentAt'] };

/** Every domain page whose loads answer an address under the domain. The first case below holds
 *  this list to the slug tables, so a new such domain is walked by the generic cases or fails. */
const DOMAINS = [
	{ domain: '/git', layout: gitLayout.load as Load, page: gitPage.load as Load },
	{ domain: '/marketplaces', layout: marketsLayout.load as Load, page: marketsPage.load as Load },
	{ domain: '/routstr', layout: routstrLayout.load as Load, page: routstrPage.load as Load }
];

beforeEach(() => {
	db.getNgitPage.mockReset().mockResolvedValue({ snapshot: { generated_utc: 'fixture' }, listsFrom: 'table' });
	db.getMarketplacesSnapshot.mockReset().mockResolvedValue(SNAPSHOT);
	db.getMarketplacesRecentListings.mockReset().mockResolvedValue([LISTING]);
	db.getRoutstrSnapshot.mockReset().mockResolvedValue({ generated_at: 'fixture' });
});

describe('the fixture', () => {
	it('is the real table with Recent listings in development, and the table every reader of it gets', () => {
		expect(MARKETPLACES_SLUGS.sections['recent-listings'].unreleased).toBe(true);
		expect(SLUG_TABLES.marketplaces).toBe(MARKETPLACES_SLUGS);
		expect(slugTableProblems(MARKETPLACES_SLUGS)).toEqual([]);
	});

	it('walks the loads of every domain whose page answers more than its own address', () => {
		// As slug-addresses.ssr.test.ts holds its pages: a domain whose page answers a slug's
		// address could gate a section there, so its loads belong in DOMAINS below.
		const answers = Object.entries(SLUG_TABLES)
			.filter(([, t]) => slugAddresses(t).some((a) => !routedElsewhere(t, slugIn(a, t.path)!)))
			.map(([, t]) => t.path)
			.sort();
		expect(DOMAINS.map((d) => d.domain).sort()).toEqual(answers);
	});
});

describe('/marketplaces, with Recent listings in development', () => {
	it('reads no listings at all for a visitor, and sends none', async () => {
		for (const session of [null, OTHER, { pubkey: OPERATOR_PUBKEY.slice(0, 63) }]) {
			const r = await run(marketsLayout.load as Load, '/marketplaces', session);
			expect(r.data, JSON.stringify(session)).toEqual({ snapshot: SNAPSHOT });
			expect(db.getMarketplacesRecentListings).not.toHaveBeenCalled();
		}
	});

	it('reads them for the operator, and says when it read them', async () => {
		const r = await run(marketsLayout.load as Load, '/marketplaces', OPERATOR);
		expect(db.getMarketplacesRecentListings).toHaveBeenCalledTimes(1);
		expect(Object.keys(r.data as object).sort()).toEqual(['recent', 'recentAt', 'snapshot']);
		expect((r.data as { recent: unknown[] }).recent).toEqual([LISTING]);
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
		expect(layout.data).toEqual({ snapshot: SNAPSHOT });
		expect(db.getMarketplacesRecentListings).not.toHaveBeenCalled();
	});
});

// --- the same two properties, generically, so the NEXT section is held with no new test ------
// Both cases walk the slug tables every load reads - the real ones, with the fixture's flag on
// /marketplaces - so a section marked `unreleased` in any domain whose loads this file imports is
// covered the day the flag is set. That is the gap a review found when the cases above were the
// only ones: a new domain that forgot `visibleTable` or `seesSection` would have failed nothing.
describe('every domain page with a section in development', () => {
	it('redirects a visitor away from EVERY address its table has in development', async () => {
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
		// at least the fixture's: a walk that found nothing would pass while checking nothing
		expect(checked).toBeGreaterThan(0);
	});

	it('sends a visitor LESS than it sends the operator, wherever a table has one', async () => {
		// The data half, generically: a gated section's rows must be ABSENT from a visitor's
		// document, not present and empty. So the visitor's data has strictly fewer keys, and each
		// key it does have carries what the operator's does: a domain that forgot the gate sends
		// them both the same keys and fails on the count, and one that sends the visitor an emptied
		// copy fails on the value - which the count alone let through for /marketplaces, whose
		// operator is also sent the instant the rows were read.
		// The fixture's own keys are held apart: absent for a visitor, and out of the count. Left in
		// it, they would make the count pass for any other section in development on its page,
		// gated or not.
		let checked = 0;
		for (const d of DOMAINS) {
			const t = own(SLUG_TABLES, d.domain.slice(1));
			if (!t) continue;
			const flagged = Object.keys(t.sections).filter((slug) => t.sections[slug].unreleased === true);
			if (flagged.length === 0) continue;
			checked += 1;
			const anon = (await run(d.layout, d.domain, null)).data as Record<string, unknown>;
			const op = (await run(d.layout, d.domain, OPERATOR)).data as Record<string, unknown>;
			const fixtureKeys = d.domain === FIXTURE.domain ? FIXTURE.keys : [];
			for (const key of fixtureKeys) {
				expect(op, `${d.domain}: ${key}`).toHaveProperty(key);
				expect(anon, `${d.domain}: ${key}`).not.toHaveProperty(key);
			}
			if (flagged.some((slug) => d.domain !== FIXTURE.domain || slug !== FIXTURE.slug)) {
				const rest = Object.keys(op).filter((key) => !fixtureKeys.includes(key));
				expect(Object.keys(anon).length, d.domain).toBeLessThan(rest.length);
			}
			for (const key of Object.keys(anon)) expect(anon[key], `${d.domain}: ${key}`).toEqual(op[key]);
		}
		expect(checked).toBeGreaterThan(0);
	});
});
