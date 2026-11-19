import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
	addressOf,
	defaultPill,
	isPill,
	keepQuery,
	own,
	pageTitle,
	pillAt,
	resolveSlug,
	routedElsewhere,
	SLUG,
	slugAddresses,
	slugIn,
	slugTableProblems,
	type SlugTable
} from './slug-table';
import { SLUG_TABLES } from './slug-tables';

// The rules for /<domain>/<slug> (agreed with the operator, 2026-10-19), on a slug table made
// up for the test so every kind of slug is present, then the real slug tables held to them.

const SHOP: SlugTable = {
	path: '/shop',
	pills: [
		{ slug: 'overview', label: 'Overview' },
		{ slug: 'deals', label: 'Deals' },
		{ slug: 'sellers', label: 'Who sells' }
	],
	sections: {
		prices: {
			pill: 'deals',
			elementId: 'shop-prices',
			title: 'Prices',
			preview: { title: 'Prices', description: 'What things cost.' }
		}
	},
	former: { 'price-list': 'prices', 'top-sellers': 'sellers', home: 'overview' },
	retired: { refunds: { pill: 'sellers', title: 'Refunds' } },
	ownRoutes: ['items']
};

describe('slugIn', () => {
	it('reads the one slug after the domain, and none from the bare domain', () => {
		expect(slugIn('/shop', '/shop')).toBeUndefined();
		expect(slugIn('/shop/', '/shop')).toBeUndefined();
		expect(slugIn('/shop/prices', '/shop')).toBe('prices');
		expect(slugIn('/shop/prices/', '/shop')).toBe('prices');
		// another domain that merely starts with the same letters is not this one
		expect(slugIn('/shopping/prices', '/shop')).toBeUndefined();
	});
});

describe('resolveSlug', () => {
	it('opens the default pill at the bare address', () => {
		expect(resolveSlug(SHOP, undefined)).toEqual({ kind: 'page', pill: 'overview' });
	});
	it("gives the default pill one address, the domain's own: 308 (permanent redirect)", () => {
		expect(resolveSlug(SHOP, 'overview')).toEqual({ kind: 'redirect', status: 308, location: '/shop' });
	});
	it('opens a pill by its slug', () => {
		expect(resolveSlug(SHOP, 'sellers')).toEqual({ kind: 'page', pill: 'sellers' });
	});
	it('opens a section on the pill it sits on today', () => {
		expect(resolveSlug(SHOP, 'prices')).toEqual({ kind: 'page', pill: 'deals', section: 'prices' });
	});
	it('sends a former slug to the current one with a 308 (permanent redirect), the default pill to the bare address', () => {
		expect(resolveSlug(SHOP, 'price-list')).toEqual({ kind: 'redirect', status: 308, location: '/shop/prices' });
		expect(resolveSlug(SHOP, 'top-sellers')).toEqual({ kind: 'redirect', status: 308, location: '/shop/sellers' });
		expect(resolveSlug(SHOP, 'home')).toEqual({ kind: 'redirect', status: 308, location: '/shop' });
	});
	it('opens a recorded retired section on its last pill, with its title for the note', () => {
		expect(resolveSlug(SHOP, 'refunds')).toEqual({ kind: 'retired', pill: 'sellers', title: 'Refunds' });
	});
	it('sends any other slug to the domain with a 302 (found) and #gone - never a 404 (not found)', () => {
		for (const slug of ['nope', 'prices-2024', 'zaps'])
			expect(resolveSlug(SHOP, slug), slug).toEqual({ kind: 'redirect', status: 302, location: '/shop#gone' });
	});
	// Every object inherits `constructor`, and it is slug-shaped: a plain lookup found Object's
	// constructor as a section, and /git/constructor answered 500 (internal server error) until
	// 2026-10-19. Each record the resolver reads is held to the same rule.
	it('knows only the slugs the table itself holds, never what every object inherits', () => {
		expect(resolveSlug(SHOP, 'constructor')).toEqual({ kind: 'redirect', status: 302, location: '/shop#gone' });
		const hollow: SlugTable = { ...SHOP, sections: {}, former: {}, retired: {} };
		for (const slug of ['constructor', 'prices', 'refunds', 'price-list'])
			expect(resolveSlug(hollow, slug), slug).toEqual({ kind: 'redirect', status: 302, location: '/shop#gone' });
	});
});

describe('keepQuery', () => {
	it("keeps the request's query on a redirect, ahead of any hash", () => {
		expect(keepQuery('/shop', '')).toBe('/shop');
		expect(keepQuery('/shop', '?utm_source=nostr')).toBe('/shop?utm_source=nostr');
		expect(keepQuery('/shop#gone', '?utm_source=nostr')).toBe('/shop?utm_source=nostr#gone');
		expect(keepQuery('/shop/prices', '?a=1&b=2')).toBe('/shop/prices?a=1&b=2');
	});
});

describe('addressOf', () => {
	it('is the bare domain for the default pill and /<domain>/<slug> otherwise', () => {
		expect(addressOf(SHOP, 'overview')).toBe('/shop');
		expect(addressOf(SHOP, 'prices')).toBe('/shop/prices');
	});
});

describe('SLUG', () => {
	it('takes lowercase words joined by single hyphens, nothing else', () => {
		for (const ok of ['zaps', 'clone-hosts', 'top-20', 'a1-b2']) expect(SLUG.test(ok), ok).toBe(true);
		// no dot, ever: that is how /relays tells a relay's own page (/relays/relay.damus.io) from a slug
		for (const bad of ['Zaps', 'clone_hosts', 'a--b', '-a', 'a-', '.env', 'a.b', 'relay.damus.io', '', 'a/b'])
			expect(SLUG.test(bad), bad).toBe(false);
	});
});

describe('defaultPill and isPill', () => {
	it('takes the first pill as the default one, and knows the pills by slug only', () => {
		expect(defaultPill(SHOP)).toBe('overview');
		expect(isPill(SHOP, 'sellers')).toBe(true);
		for (const not of ['Who sells', 'prices', 'items', 'constructor']) expect(isPill(SHOP, not), not).toBe(false);
	});
});

describe('own', () => {
	it('reads a key the record holds, and nothing it inherits', () => {
		expect(own(SHOP.sections, 'prices')).toBe(SHOP.sections.prices);
		for (const inherited of ['constructor', 'toString', '__proto__', 'hasOwnProperty'])
			expect(own(SHOP.sections, inherited), inherited).toBeUndefined();
	});
});

describe('slugAddresses', () => {
	it("lists every pill but the default one, then every section - never a former or retired slug, nor the domain's own address", () => {
		expect(slugAddresses(SHOP)).toEqual(['/shop/deals', '/shop/sellers', '/shop/prices']);
	});
	it('is empty for a domain whose only address is its own', () => {
		expect(slugAddresses({ ...SHOP, pills: [SHOP.pills[0]], sections: {}, former: {}, retired: {} })).toEqual([]);
	});
});

describe('pageTitle', () => {
	const base = 'Nostrology - Shop';
	it("names the pill an address opens, and leaves the default pill's address the domain's title", () => {
		expect(pageTitle(SHOP, base, undefined)).toBe(base);
		expect(pageTitle(SHOP, base, { kind: 'page', pill: 'overview' })).toBe(base);
		expect(pageTitle(SHOP, base, { kind: 'page', pill: 'sellers' })).toBe('Nostrology - Shop - Who sells');
	});
	it("names a section by its own title, over its pill's", () => {
		expect(pageTitle(SHOP, base, { kind: 'page', pill: 'deals', section: 'prices' })).toBe('Nostrology - Shop - Prices');
	});
	it("names a retired section's pill: the address is moved to it at once", () => {
		expect(pageTitle(SHOP, base, { kind: 'retired', pill: 'sellers', title: 'Refunds' })).toBe('Nostrology - Shop - Who sells');
	});
	it('falls back to the pill, then to the domain, for a slug the table does not hold', () => {
		expect(pageTitle(SHOP, base, { kind: 'page', pill: 'deals', section: 'constructor' })).toBe('Nostrology - Shop - Deals');
		expect(pageTitle(SHOP, base, { kind: 'page', pill: 'nowhere' })).toBe(base);
	});
});

describe('routedElsewhere', () => {
	const STORE: SlugTable = {
		...SHOP,
		pills: [
			{ slug: 'overview', label: 'Overview' },
			{ slug: 'charts', label: 'Charts', ownRoute: true }
		],
		ownShapes: { digits: (w) => /^[0-9]+$/.test(w) }
	};
	it('is a collection, a pill built as a page of its own, or a word of an own route\'s shape', () => {
		expect(routedElsewhere(STORE, 'items')).toBe(true);
		expect(routedElsewhere(STORE, 'charts')).toBe(true);
		expect(routedElsewhere(STORE, '1234')).toBe(true);
	});
	it("leaves every other word to the domain's page", () => {
		for (const word of ['overview', 'prices', 'nope', 'refunds', 'a1'])
			expect(routedElsewhere(STORE, word), word).toBe(false);
	});
});

describe('pillAt', () => {
	it("is the pill the server's answer names: a pill's, a section's, a retired section's", () => {
		expect(pillAt(SHOP, '/shop')).toBe('overview');
		expect(pillAt(SHOP, '/shop/deals')).toBe('deals');
		expect(pillAt(SHOP, '/shop/prices')).toBe('deals');
		expect(pillAt(SHOP, '/shop/refunds')).toBe('sellers');
	});
	it('is the default pill at an address the server redirects', () => {
		for (const path of ['/shop/overview', '/shop/price-list', '/shop/nope', '/shop/constructor'])
			expect(pillAt(SHOP, path), path).toBe('overview');
	});
});

describe('slugTableProblems', () => {
	it('finds nothing wrong with a sound slug table', () => {
		expect(slugTableProblems(SHOP)).toEqual([]);
	});
	it('names each mistake', () => {
		const bad: SlugTable = {
			...SHOP,
			pills: [
				{ slug: 'overview', label: 'Overview' },
				{ slug: 'deals', label: 'Deals' },
				{ slug: 'Bad_Name', label: 'Bad' },
				{ slug: 'blank', label: ' ' }
			],
			sections: {
				deals: { ...SHOP.sections.prices },
				lost: { ...SHOP.sections.prices, pill: 'nowhere' }
			},
			former: { stale: 'missing' },
			retired: { old: { pill: 'gone-pill', title: 'Old' } }
		};
		const problems = slugTableProblems(bad);
		expect(problems).toContain('pill "Bad_Name" is not a slug (lowercase words joined by hyphens)');
		expect(problems).toContain('pill "blank" has no label');
		expect(problems).toContain('"deals" is both a pill and a section');
		expect(problems).toContain('section "lost" sits on "nowhere", which is not a pill');
		expect(problems).toContain('former slug "stale" points at "missing", which is neither a pill nor a section');
		expect(problems).toContain('retired "old" names "gone-pill", which is not a pill');
	});
	it('wants a pill: the first is the default one', () => {
		expect(slugTableProblems({ ...SHOP, pills: [], sections: {}, former: {}, retired: {} })).toEqual([
			'no pills: the first pill is the default one'
		]);
	});
	it('holds former slugs and routes of its own to the same shape, and to no clash with any other slug', () => {
		const problems = slugTableProblems({
			...SHOP,
			former: { Old_Prices: 'prices', deals: 'prices' },
			ownRoutes: ['prices', 'Items']
		});
		expect(problems).toContain('former slug "Old_Prices" is not a slug (lowercase words joined by hyphens)');
		expect(problems).toContain('"deals" is both a pill and a former slug');
		expect(problems).toContain('"prices" is both a section and a route of its own');
		expect(problems).toContain('route of its own "Items" is not a slug (lowercase words joined by hyphens)');
	});
	it('wants the default pill to be the domain page itself, never a route of its own', () => {
		expect(slugTableProblems({ ...SHOP, pills: [{ slug: 'overview', label: 'Overview', ownRoute: true }, ...SHOP.pills.slice(1)] })).toContain(
			'the default pill "overview" is the domain page itself, never a route of its own'
		);
	});
	it('keeps sections, retired ones too, off a pill that is a page of its own: their addresses render the domain page', () => {
		const problems = slugTableProblems({
			...SHOP,
			pills: [SHOP.pills[0], { ...SHOP.pills[1], ownRoute: true }, SHOP.pills[2]],
			retired: { refunds: { pill: 'deals', title: 'Refunds' } }
		});
		expect(problems).toContain('section "prices" sits on "deals", a page of its own');
		expect(problems).toContain('retired "refunds" names "deals", a page of its own');
		// a former slug is a redirect to the pill's own address, which is fine
		expect(problems.filter((p) => p.includes('former'))).toEqual([]);
	});
	it("holds every slug clear of an own route's shape, which would take it first", () => {
		const problems = slugTableProblems({ ...SHOP, ownShapes: { short: (w) => w.length <= 5 } });
		expect(problems).toContain('"deals" has the shape of the short route');
		expect(problems).toContain('"items" has the shape of the short route');
		expect(problems).not.toContain('"overview" has the shape of the short route');
	});
	it('reserves `gone`: it marks the redirect for an unknown slug', () => {
		expect(slugTableProblems({ ...SHOP, sections: { ...SHOP.sections, gone: { ...SHOP.sections.prices } } })).toContain(
			'"gone" is reserved: it marks the redirect for an unknown slug'
		);
	});
	it('holds a former slug to a pill or section the table itself holds', () => {
		expect(slugTableProblems({ ...SHOP, former: { old: 'constructor' } })).toContain(
			'former slug "old" points at "constructor", which is neither a pill nor a section'
		);
	});
});

describe('every real slug table', () => {
	// Not `new URL('../routes', import.meta.url)`: Vite rewrites that form into an asset URL.
	const ROUTES = resolve(dirname(fileURLToPath(import.meta.url)), '../routes');

	/** The child folders of `dir`, looking through route groups, which add nothing to an address. */
	const children = (dir: string): string[] =>
		readdirSync(dir, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.flatMap((e) => (e.name.startsWith('(') ? children(join(dir, e.name)).map((c) => join(e.name, c)) : [e.name]));
	/** Every folder that serves /<domain>, in whatever route group. */
	const domainDirs = (domain: string): string[] =>
		children(ROUTES)
			.filter((c) => c.split('/').at(-1) === domain)
			.map((c) => join(ROUTES, c));
	/** A folder's own segment, without the route groups it was reached through. */
	const segment = (child: string) => child.split('/').at(-1)!;
	/** Whether a folder answers at its own address: a page or an endpoint in it, or in a route
	 * group inside it. /zapstore/publishers holds only its detail pages, so it does not. */
	const servesItself = (dir: string): boolean =>
		readdirSync(dir).some(
			(f) => /^\+(page|server)\./.test(f) || (f.startsWith('(') && statSync(join(dir, f)).isDirectory() && servesItself(join(dir, f)))
		);

	it.each(Object.entries(SLUG_TABLES))('%s is sound', (_, t) => {
		expect(slugTableProblems(t)).toEqual([]);
	});

	it.each(Object.entries(SLUG_TABLES))('%s is keyed by its own first segment', (domain, t) => {
		expect(t.path).toBe(`/${domain}`);
	});

	// src/hooks.ts reroutes every slug under a domain except these, so a route of its own
	// missing from `ownRoutes` would be swallowed by the domain's page; and a folder listed
	// there with no page at its own address would answer its word with a 404 (not found),
	// where any other slug gets the 302 (found) and the note.
	it.each(Object.entries(SLUG_TABLES))('%s lists exactly the routes of its own it has', (domain, t) => {
		const dirs = domainDirs(domain);
		expect(dirs.length, `the folder serving /${domain}`).toBe(1);
		expect(existsSync(dirs[0])).toBe(true);
		// a folder may appear twice through route groups (/nutzaps/mints is a pill page in (shell)
		// and the collection of the mint pages beside it)
		const words = children(dirs[0]).filter((c) => !segment(c).startsWith('['));
		const own = [...new Set(words.filter((c) => servesItself(join(dirs[0], c))).map(segment))];
		const declared = [...t.ownRoutes, ...t.pills.filter((p) => p.ownRoute).map((p) => p.slug)];
		expect(own.sort()).toEqual(declared.sort());
	});

	// A parameter folder (`[repo]`, `[[x]]`, `[...rest]`) directly under a domain would take
	// every slug - an npub is slug-shaped too - and the reroute would send them all to the
	// domain's page instead. A domain with a slug table keeps its identifiers under a collection.
	// The one exception is a folder whose param matcher the table names in `ownShapes`, so the
	// reroute leaves its words alone: /zapstore/[pubkey=hex64], the old address of a
	// publisher's page, kept as a redirect.
	it.each(Object.entries(SLUG_TABLES))('%s has no parameter folder directly under it but those it names', (domain, t) => {
		for (const dir of domainDirs(domain)) {
			const params = children(dir).map(segment).filter((c) => c.startsWith('['));
			for (const folder of params) {
				const matcher = /^\[[a-z_]+=([a-z0-9_]+)\]$/.exec(folder)?.[1];
				expect(matcher && Object.hasOwn(t.ownShapes ?? {}, matcher), `${domain}/${folder}`).toBe(true);
			}
		}
	});

	// and the other way: a shape whose folder went would leave its words a 404 (not found),
	// never rerouted, where any other slug gets the 302 (found) and the note
	it.each(Object.entries(SLUG_TABLES))('%s names no own shape without its parameter folder', (domain, t) => {
		const matchers = domainDirs(domain).flatMap((dir) =>
			children(dir)
				.map(segment)
				.map((folder) => /^\[[a-z_]+=([a-z0-9_]+)\]$/.exec(folder)?.[1])
				.filter((m): m is string => !!m)
		);
		for (const name of Object.keys(t.ownShapes ?? {})) expect(matchers, `${domain}: ${name}`).toContain(name);
	});

	it('names each own shape by the param matcher that routes it', async () => {
		for (const [domain, t] of Object.entries(SLUG_TABLES))
			for (const [name, matches] of Object.entries(t.ownShapes ?? {})) {
				const { match } = await import(`../params/${name}.ts`);
				expect(matches, `${domain}: ${name}`).toBe(match);
			}
	});
});
