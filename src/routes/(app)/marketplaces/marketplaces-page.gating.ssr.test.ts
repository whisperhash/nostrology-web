// @vitest-environment node
//
// THE PAGE'S HALF OF THE GATE, held with a FIXTURE FLAG ($lib/unreleased): at the address of a
// section still in development the page carries noindex. That address is the operator's own view
// of the section - nobody else is served the page there at all, since +page.server.ts answers
// them a 302 (found) - so this is the belt under that gate: if it were ever lost, the leaked 200
// (ok) would at least not be indexed under a heading no other reader can reach.
//
// This marks Recent listings, the section the gate was built for, in development in a stand-in
// for /marketplaces' slug table, as domain-loads.gating.test.ts does for the server loads, so
// the page's half stays proved whatever the real table holds. The page as the real table
// serves it is marketplaces-page.ssr.test.ts's.
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';

// The real table with ONE change: Recent listings in development.
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
// Every page renders <SocialMeta>, which reads $page; a page rendered on its own has no router,
// so the store is supplied here - the same pattern as the other page tests.
const current = vi.hoisted(() => ({ url: new URL('https://site.test/marketplaces') }));
vi.mock('$app/stores', () => ({
	page: { subscribe: (fn: (v: unknown) => void) => (fn({ url: current.url }), () => {}) }
}));

import { MARKETPLACES_SLUGS } from '$lib/slug-tables/marketplaces';
import MarketplacesPage from './+page.svelte';
import { LISTING, SNAPSHOT } from './fixture';

const ENTRY = MARKETPLACES_SLUGS.sections['recent-listings'];
const AT_SECTION = { kind: 'page', pill: ENTRY.pill, section: 'recent-listings' } as const;

/** The page as the server renders it at `path`, with `data` beside the snapshot. */
function renderAt(path: string, data: Record<string, unknown>) {
	current.url = new URL('https://site.test' + path);
	return render(MarketplacesPage, { props: { data: { snapshot: SNAPSHOT, ...data } } });
}

describe('/marketplaces, with Recent listings in development', () => {
	it('is the fixture: the real table with that one flag', () => {
		expect(ENTRY.unreleased).toBe(true);
	});

	it("noindexes the section's address in the operator's own view of it, card and all", () => {
		// The one reader who IS served it: indexing an address no other reader can reach would put a
		// heading nobody else can see into a search result.
		const { head, body } = renderAt('/marketplaces/recent-listings', { target: AT_SECTION, recent: [LISTING] });
		expect(head).toContain('<meta name="robots" content="noindex"');
		expect(body).toContain(`id="${ENTRY.elementId}"`);
		expect(body).toContain('Buono Amazon');
	});

	it('noindexes it with no rows too, since the head names the section from the address alone', () => {
		// The head is where the name would hide: the title, og:title, twitter:title and the
		// description all come from the section's preview when the target names it, rows or not.
		// So what is asserted is that such a page is not indexable: the gate is the server's
		// answer, and this is the belt under it.
		const { head } = renderAt('/marketplaces/recent-listings', { target: AT_SECTION });
		expect(head).toContain('<title>Nostrology - Nostr Marketplaces - Recent listings</title>');
		expect(head).toContain('<meta name="robots" content="noindex"');
	});

	it('noindexes no other address of the page', () => {
		for (const [path, target] of [
			['/marketplaces', { kind: 'page', pill: 'overview' }],
			['/marketplaces/catalogue', { kind: 'page', pill: 'catalogue' }],
			['/marketplaces/categories', { kind: 'page', pill: 'catalogue', section: 'categories' }],
			['/marketplaces/methodology', { kind: 'page', pill: 'overview', section: 'methodology' }]
		] as const) {
			const { head } = renderAt(path, { target, recent: [LISTING] });
			expect(head, path).not.toContain('noindex');
		}
	});
});
