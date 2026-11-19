import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { METHODOLOGY } from './methodology';
import { isOperator, OPERATOR_PUBKEY, seesSection, seesUnreleased, visibleTable } from './unreleased';
import {
	addressOf,
	pageTitle,
	resolveSlug,
	slugAddresses,
	slugTableProblems,
	type SlugTable
} from './slug-table';
import { MARKETPLACES_SLUGS } from './slug-tables/marketplaces';
import { SLUG_TABLES } from './slug-tables';
import { MARKETPLACES } from './markets/links';

// What is still in development is visible to the operator's own session and to NOBODY else -
// not to an anonymous visitor and not to another logged-in one (the operator's call,
// 2026-10-24). This file pins the decision and the table filter; the two places the filter is
// applied are pinned in src/routes/(app)/domain-loads.test.ts (the loads) and
// src/lib/seo/sitemap.test.ts (the sitemap).

const OTHER = 'f'.repeat(64);

// A seller and an event, for building the outbound links the leak check greps for.
const PK = '2e7afe3f9af8c3dc90d6e8acaf5d7aa926a54f0c22f1c555707309c059fe831b';
const ID = '49a1d8111ed72770793c7a5756c43a65ac833654c4a0aba14b1707e104428194';

const SHOP: SlugTable = {
	path: '/shop',
	pills: [
		{ slug: 'overview', label: 'Overview' },
		{ slug: 'deals', label: 'Deals' }
	],
	sections: {
		prices: { pill: 'deals', elementId: 'shop-prices', title: 'Prices' },
		returns: { pill: 'deals', elementId: 'shop-returns', title: 'Returns', unreleased: true }
	},
	former: { 'price-list': 'prices', refunds: 'returns' },
	retired: {},
	ownRoutes: []
};

/** The pill shape, which is NOT supported: the filter is ready for it and slugTableProblems
 *  refuses it, because every domain page draws its pill bar from the whole table in the
 *  browser ($lib/unreleased's header). Its own fixture, so SHOP above stays a sound table. */
const SHOP_WITH_HIDDEN_PILL: SlugTable = {
	...SHOP,
	pills: [...SHOP.pills, { slug: 'trials', label: 'Trials', unreleased: true }]
};

describe('who sees what is still in development', () => {
	it('is the operator, and nobody else', () => {
		expect(seesUnreleased({ pubkey: OPERATOR_PUBKEY })).toBe(true);
		expect(seesUnreleased({ pubkey: OTHER })).toBe(false);
		expect(seesUnreleased(null)).toBe(false);
		expect(seesUnreleased(undefined)).toBe(false);
		expect(seesUnreleased({})).toBe(false);
	});

	it('takes the same key in another case, since it is the same person', () => {
		expect(seesUnreleased({ pubkey: OPERATOR_PUBKEY.toUpperCase() })).toBe(true);
	});

	it('matches the whole key and nothing less', () => {
		for (const near of [
			OPERATOR_PUBKEY.slice(0, 63),
			OPERATOR_PUBKEY + 'a',
			OPERATOR_PUBKEY.slice(1),
			' ' + OPERATOR_PUBKEY,
			OPERATOR_PUBKEY + ' ',
			'',
			// one character different, which is a different person
			OPERATOR_PUBKEY.slice(0, 63) + (OPERATOR_PUBKEY.endsWith('0') ? '1' : '0')
		]) {
			expect(seesUnreleased({ pubkey: near }), JSON.stringify(near)).toBe(false);
		}
	});

	it('is a 64-character hex pubkey, the form the session cookie carries', () => {
		expect(OPERATOR_PUBKEY).toMatch(/^[0-9a-f]{64}$/);
	});

	it('is the same rule that makes a session the operator for analytics and the log tag', () => {
		for (const viewer of [{ pubkey: OPERATOR_PUBKEY }, { pubkey: OTHER }, null, undefined, {}]) {
			expect(seesUnreleased(viewer), JSON.stringify(viewer)).toBe(isOperator(viewer));
		}
	});
});

describe('whether a reader gets one section, data and all', () => {
	// The gate the DATA hangs on, and the reason it reads the table rather than the session
	// alone: releasing a section must be one edit, not two in two files.
	it('is the flag, and the flag alone', () => {
		expect(seesSection(SHOP, 'returns', null)).toBe(false);
		expect(seesSection(SHOP, 'returns', { pubkey: OTHER })).toBe(false);
		expect(seesSection(SHOP, 'returns', { pubkey: OPERATOR_PUBKEY })).toBe(true);
		// the released section beside it: everybody, logged in or not
		expect(seesSection(SHOP, 'prices', null)).toBe(true);
		expect(seesSection(SHOP, 'prices', { pubkey: OTHER })).toBe(true);
	});

	it('releases the section the moment the flag comes off, for everyone at once', () => {
		const released: SlugTable = {
			...SHOP,
			sections: { ...SHOP.sections, returns: { ...SHOP.sections.returns, unreleased: undefined } }
		};
		expect(seesSection(released, 'returns', null)).toBe(true);
		expect(slugAddresses(visibleTable(released, false))).toContain('/shop/returns');
	});

	it('does not call an unknown slug hidden', () => {
		// "may they see it" for something that does not exist cannot be "no, it is secret" - and
		// a typo in a caller must not quietly hide a section's data from everybody.
		expect(seesSection(SHOP, 'no-such-thing', null)).toBe(true);
		expect(seesSection(SHOP, 'constructor', null)).toBe(true);
	});

	it('is what /marketplaces hangs its listing read on', () => {
		expect(seesSection(MARKETPLACES_SLUGS, 'recent-listings', null)).toBe(false);
		expect(seesSection(MARKETPLACES_SLUGS, 'recent-listings', { pubkey: OPERATOR_PUBKEY })).toBe(
			true
		);
		expect(seesSection(MARKETPLACES_SLUGS, 'methodology', null)).toBe(true);
	});
});

describe('the table a reader sees', () => {
	it("is the whole table for the operator, unchanged and not even copied", () => {
		expect(visibleTable(SHOP, true)).toBe(SHOP);
		expect(visibleTable(MARKETPLACES_SLUGS, true)).toBe(MARKETPLACES_SLUGS);
	});

	it('is the same object when the domain has nothing in development', () => {
		const plain = { ...SHOP, pills: SHOP.pills.slice(0, 2), sections: {}, former: {} };
		expect(visibleTable(plain, false)).toBe(plain);
	});

	it('drops an unreleased section for everyone else', () => {
		const seen = visibleTable(SHOP, false);
		expect(Object.keys(seen.sections)).toEqual(['prices']);
		expect(slugAddresses(seen)).toEqual(['/shop/deals', '/shop/prices']);
	});

	it('is ready for a pill, which is refused until the pages are', () => {
		// The filter does drop one, so the server's answer and the sitemap would follow...
		expect(visibleTable(SHOP_WITH_HIDDEN_PILL, false).pills.map((p) => p.slug)).toEqual([
			'overview',
			'deals'
		]);
		expect(slugAddresses(visibleTable(SHOP_WITH_HIDDEN_PILL, false))).not.toContain('/shop/trials');
		// ...and the pages do not, so the flag on a pill is a slug-table PROBLEM rather than a
		// feature: a hidden pill would still be drawn in the pill bar, and its panel would paint
		// from an old `#` link before the server's answer bounced it.
		expect(slugTableProblems(SHOP_WITH_HIDDEN_PILL)).toEqual([
			'pill "trials" cannot be unreleased yet: the pill bar reads the whole table in the browser'
		]);
	});

	it('drops a former slug that points at one, so it cannot 308 at a 302', () => {
		// A redirect to an address that then redirects to the domain is a trail: it tells the
		// reader something is there. The target is gone for them, so the old name is too.
		expect(Object.keys(visibleTable(SHOP, false).former)).toEqual(['price-list']);
		expect(resolveSlug(visibleTable(SHOP, false), 'refunds')).toEqual({
			kind: 'redirect',
			status: 302,
			location: '/shop#gone'
		});
	});

	it("answers an unreleased slug exactly as it answers a word nobody has ever used", () => {
		const seen = visibleTable(SHOP, false);
		for (const slug of ['returns', 'no-such-thing']) {
			expect(resolveSlug(seen, slug), slug).toEqual({
				kind: 'redirect',
				status: 302,
				location: '/shop#gone'
			});
		}
		// and for the operator it is a page
		expect(resolveSlug(SHOP, 'returns').kind).toBe('page');
	});

	it('leaves a sound table sound, so the filter cannot invent a problem', () => {
		expect(slugTableProblems(SHOP)).toEqual([]);
		expect(slugTableProblems(visibleTable(SHOP, false))).toEqual([]);
		for (const t of [MARKETPLACES_SLUGS, visibleTable(MARKETPLACES_SLUGS, false)]) {
			expect(slugTableProblems(t)).toEqual([]);
		}
	});

	it('names no page title for a section the reader does not have', () => {
		const target = { kind: 'page', pill: 'deals', section: 'returns' } as const;
		expect(pageTitle(SHOP, 'Shop', target)).toBe('Shop - Returns');
		// the filtered table cannot name it - and no reader reaches this, because the server
		// answers that address with a redirect before any title is built
		expect(pageTitle(visibleTable(SHOP, false), 'Shop', target)).toBe('Shop - Deals');
	});

	it('refuses an unreleased DEFAULT pill, which would be the domain itself', () => {
		const hiddenDomain = {
			...SHOP,
			pills: [{ ...SHOP.pills[0], unreleased: true as const }, ...SHOP.pills.slice(1)]
		};
		expect(slugTableProblems(hiddenDomain)).toContain(
			'the default pill "overview" is the domain\'s own address, so it cannot be unreleased'
		);
	});
});

describe('the live check and the tables agree', () => {
	// scripts/verify-unreleased.mjs is plain Node and hand-keeps its list, like
	// verify-section-link.mjs's DOMAINS. A list that drifts is worse than no list: the script
	// would pass while examining nothing, which is the failure mode of every "check" that
	// enumerates its own subject. So the drift fails here instead.
	const script = readFileSync('scripts/verify-unreleased.mjs', 'utf8');

	it('names every address a slug table still has in development, and no other', () => {
		const inScript = [...script.matchAll(/^\t\taddress: '([^']+)'/gm)].map((m) => m[1]).sort();
		const inTables = Object.entries(SLUG_TABLES)
			.flatMap(([, t]) =>
				Object.entries(t.sections)
					.filter(([, sec]) => sec.unreleased === true)
					.map(([slug]) => addressOf(t, slug))
					.concat(t.pills.filter((p) => p.unreleased === true).map((p) => addressOf(t, p.slug)))
			)
			.sort();
		expect(inScript).toEqual(inTables);
		expect(inTables.length).toBeGreaterThan(0);
	});

	it('looks for the strings the page would actually leak', () => {
		// The element id, the heading and the preview title are what a leak would carry; if one
		// is renamed in the table and not in the script, the check goes looking for the old one
		// and finds nothing, which reads as a pass.
		const entry = MARKETPLACES_SLUGS.sections['recent-listings'];
		for (const needle of [entry.elementId, entry.title, entry.preview!.title]) {
			expect(script, needle).toContain(needle);
		}
	});

	it('qualifies the outbound-link needles by path, against the real link builders', () => {
		// A BARE HOST is not a usable needle. A `client` tag is a seller-chosen string and the
		// Clients chart on this very pill draws it, so `shopstr.market` alone matched a page with
		// no leak in it - the live pool already carries `bitpopart.com` there, and a check that
		// cries wolf is a check nobody reads. These needles are hand-kept in plain Node, so what
		// they must stay is derived HERE from the builders themselves rather than copied.
		const row = { pubkey: PK, d_tag: 'x', event_id: ID, market_image: true };

		for (const m of MARKETPLACES) {
			// The listing link is the one EVERY drawn row carries, so matching it is what makes a
			// leak catchable at all.
			const url = m.url(row);
			expect(url, m.key).not.toBeNull();
			const { host, pathname } = new URL(url!);
			const qualified = host + '/' + pathname.split('/')[1] + '/';
			expect(script, `${m.key} listing: ${qualified}`).toContain(qualified);
			expect(script, `${m.key}: the bare host is back`).not.toContain(`'${host}'`);
		}

		for (const m of MARKETPLACES) {
			const seller = m.sellerUrl(PK);
			if (!seller) continue;
			const { host, pathname } = new URL(seller);
			const segment = pathname.split('/')[1];
			// Conduit addresses a seller at `/<npub>`, which has no path segment to qualify on -
			// and needs none, since no row draws a seller link without its listing link above.
			if (segment.startsWith('npub1')) continue;
			expect(script, `${m.key} seller: ${host}/${segment}/`).toContain(host + '/' + segment + '/');
		}
	});
});

describe("the section check's list and the tables agree", () => {
	// The same rule for scripts/verify-section-link.mjs's SECTIONS, the sections it walks in a real
	// browser: any reader's, each with a card and an icon. Here because the flag is what decides
	// it: deleting a section's `unreleased` releases it to everyone, and this fails until the live
	// check goes and looks at it. What is counted is not in the list, since it has an icon of its
	// own and a check of its own (scripts/verify-methodology-link.mjs).
	const script = readFileSync('scripts/verify-section-link.mjs', 'utf8');
	const inScript = [
		...script.matchAll(
			/^\t\{ path: '([^']+)', domain: '([^']+)', pill: '([^']+)', pillName: (?:'([^']*)'|"([^"]*)"), id: '([^']+)', name: '([^']+)'/gm
		)
	]
		.map((m) => ({ path: m[1], domain: m[2], pill: m[3], pillName: m[4] ?? m[5], id: m[6], name: m[7] }))
		.sort((a, b) => a.path.localeCompare(b.path));

	it('names every section any reader gets that has an icon of its own, and no other, as the table has it', () => {
		const inTables = Object.values(SLUG_TABLES)
			.flatMap((t) =>
				Object.entries(t.sections)
					.filter(([slug, sec]) => slug !== METHODOLOGY && sec.unreleased !== true)
					.map(([slug, sec]) => ({
						path: addressOf(t, slug),
						domain: t.path,
						pill: sec.pill,
						pillName: t.pills.find((p) => p.slug === sec.pill)?.label,
						id: sec.elementId,
						name: sec.title
					}))
			)
			.sort((a, b) => a.path.localeCompare(b.path));
		expect(inScript).toEqual(inTables);
		expect(inTables.length).toBeGreaterThan(0);
	});

	it('walks only domains it knows the title of, since a section is landed on under its domain', () => {
		const domains = [...script.matchAll(/^\t\{ path: '([^']+)', title: /gm)].map((m) => m[1]);
		for (const { domain } of inScript) expect(domains, domain).toContain(domain);
	});
});

describe('/marketplaces, the one domain with a section in development today', () => {
	it('hides Recent listings, and only that', () => {
		const hidden = Object.entries(MARKETPLACES_SLUGS.sections)
			.filter(([, s]) => s.unreleased)
			.map(([slug]) => slug);
		expect(hidden).toEqual(['recent-listings']);
		expect(MARKETPLACES_SLUGS.pills.some((p) => p.unreleased)).toBe(false);
	});

	it('keeps every other address of the page for everyone', () => {
		const seen = visibleTable(MARKETPLACES_SLUGS, false);
		expect(slugAddresses(seen)).toEqual([
			'/marketplaces/growth',
			'/marketplaces/catalogue',
			'/marketplaces/geography',
			'/marketplaces/shipping',
			'/marketplaces/categories',
			'/marketplaces/methodology'
		]);
		expect(addressOf(MARKETPLACES_SLUGS, 'recent-listings')).toBe('/marketplaces/recent-listings');
	});
});
