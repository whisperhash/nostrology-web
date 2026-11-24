// @vitest-environment node
//
// /marketplaces must render on the server with none of its map libraries loaded. Leaflet
// reads `window` and `document` the moment it is imported, so a STATIC import of it (or of
// MapLibre, or the bridge) anywhere in this page's import graph turns every server render
// of /marketplaces into a 500 - while the jsdom tests, svelte-check and `vite build` all
// stay green, because none of them imports the page on the server. That includes
// `import { type X } from 'leaflet'`: with verbatimModuleSyntax the import itself is kept.
// The libraries belong in $lib/markets/map-libs.ts, imported dynamically from BubbleMap's
// onMount (2026-10-13, when the maps moved from CARTO's tiles to OpenFreeMap).
//
// This renders the page and the map component the way SvelteKit does on the server
// (svelte/server on the server compile: the node environment and the "ssr" project in
// vitest.workspace.ts). With a static Leaflet import added to BubbleMap.svelte, the import
// of this file fails with "ReferenceError: window is not defined".
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';

import BubbleMap from '$lib/components/markets/BubbleMap.svelte';
import { MARKETPLACES_SLUGS } from '$lib/slug-tables/marketplaces';
import MarketplacesPage from './+page.svelte';
import { LISTING, SNAPSHOT } from './fixture';

// Every page renders <SocialMeta>, which reads $page; a page rendered on its own has no
// router, so the store is supplied here - same pattern as the other page tests.
const current = vi.hoisted(() => ({ url: new URL('https://site.test/marketplaces') }));
vi.mock('$app/stores', () => ({
	page: { subscribe: (fn: (v: unknown) => void) => (fn({ url: current.url }), () => {}) }
}));

describe('/marketplaces on the server', () => {
	it('renders the page without loading any map library', () => {
		const { body } = render(MarketplacesPage, { props: { data: { snapshot: SNAPSHOT } } });
		expect(body).toContain('Nostr Marketplaces');
		expect(body).toContain('id="tab-geography"');
		expect(body).toContain('id="tab-shipping"');
		expect(globalThis).not.toHaveProperty('L'); // Leaflet sets window.L when it loads
	});

	it('renders What is counted as a closed <details>, with the icon that links its address', () => {
		// What is counted is in the SERVER's HTML, and closed there at the bare /marketplaces:
		// its own address, /marketplaces/methodology, is what sends it open (below).
		const { body } = render(MarketplacesPage, { props: { data: { snapshot: SNAPSHOT } } });
		// by its id, never "the first <details>": a second one added above this on the Overview
		// tab would make the check read the wrong tag
		const details = [...body.matchAll(/<details[^>]*>/g)].map((m) => m[0]).filter((t) => t.includes('id="methodology"'));
		expect(details).toHaveLength(1);
		expect(details[0]).not.toMatch(/\sopen\b/);
		// and the icon that copies the address is in it too, as a plain link to it - which is
		// all it is with no JavaScript, and what a right-click "Copy link" copies
		const links = [...body.matchAll(/<a[^>]*data-methodology-link[^>]*>/g)].map((m) => m[0]);
		expect(links).toHaveLength(1);
		expect(links[0]).toContain('href="/marketplaces/methodology"');
		expect(body.indexOf(links[0])).toBeLessThan(body.indexOf(details[0]));
		// closed, the content is still there to be read, indexed and linked
		expect(body).toContain('What is counted');
		expect(body).toContain('Live listings');
	});

	it('renders a map box with no basemap status: the map is built in the browser only', () => {
		const { body } = render(BubbleMap, { props: { points: SNAPSHOT.map_points } });
		expect(body).toMatch(/<div[^>]*class="markets-map[^"]*"/);
		expect(body).not.toContain('data-basemap');
		expect(body).not.toContain('leaflet');
	});
	// Since 2026-10-19 each pill and What is counted has an address of its own
	// ($lib/slug-table), answered by the server: the page arrives on that pill, its page title
	// naming it, with the page's own preview (the previews were left as they were).
	it.each([
		['a pill', { kind: 'page', pill: 'geography' }, 'panel-geography', 'Nostrology - Nostr Marketplaces - Geography'],
		['What is counted', { kind: 'page', pill: 'overview', section: 'methodology' }, 'panel-overview', 'Nostrology - Nostr Marketplaces - What is counted'],
		['the bare /marketplaces', { kind: 'page', pill: 'overview' }, 'panel-overview', 'Nostrology - Nostr Marketplaces']
	] as const)('renders %s: that pill, its own title, and the page preview', (_, target, panel, title) => {
		current.url = new URL(`https://site.test/marketplaces${'section' in target ? '/methodology' : target.pill === 'overview' ? '' : '/' + target.pill}`);
		const { body, head } = render(MarketplacesPage, { props: { data: { snapshot: SNAPSHOT, target } } });
		expect(body).toContain(`id="${panel}"`);
		expect(head).toContain(`<title>${title}</title>`);
		expect(head).toContain('<meta property="og:title" content="Nostr Marketplaces, measured"');
		expect(head).not.toContain('noindex');
		const details = /<details[^>]*id="methodology"[^>]*>/.exec(body)?.[0];
		if (panel === 'panel-overview') expect(details).toBeDefined();
		// open at its own address only
		if (details) expect(/\sopen(=""|\s|>)/.test(details)).toBe('section' in target);
	});

	it('draws the pill bar as plain links to the pills\' addresses, none of them preloaded', () => {
		current.url = new URL('https://site.test/marketplaces/catalogue');
		const { body } = render(MarketplacesPage, { props: { data: { snapshot: SNAPSHOT, target: { kind: 'page', pill: 'catalogue' } } } });
		const links = [...body.matchAll(/<a href="([^"]*)" id="tab-([a-z-]+)"[^>]*>/g)];
		expect(links.map((m) => m[1])).toEqual(['/marketplaces', '/marketplaces/growth', '/marketplaces/catalogue', '/marketplaces/geography', '/marketplaces/shipping']);
		for (const [tag] of links) expect(tag).toContain('data-sveltekit-preload-data="off"');
		expect(links.filter(([tag]) => tag.includes('aria-current="page"')).map((m) => m[2])).toEqual(['catalogue']);
	});
});

/** An attribute's value as the HTML carries it, entities decoded. */
const meta = (head: string, attr: string, key: string) => {
	const m = new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`).exec(head);
	return m?.[1].replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
};

// Categories' own address (/marketplaces/categories, 2026-11-04), rendered the way the server
// renders it, as below for Recent listings. The page's data here is the snapshot and the answer
// with no `recent` at all - what a reader is sent while Recent listings is in development - so
// these show the card does not depend on it.
describe('/marketplaces/categories on the server', () => {
	const ENTRY = MARKETPLACES_SLUGS.sections.categories;
	const preview = ENTRY.preview!;
	const at = () => {
		current.url = new URL('https://site.test/marketplaces/categories');
		return render(MarketplacesPage, {
			props: { data: { snapshot: SNAPSHOT, target: { kind: 'page', pill: ENTRY.pill, section: 'categories' } } }
		});
	};

	it("sends What's for sale, with the card in it - no Overview first", () => {
		const { body } = at();
		expect(body).toContain(`id="panel-${ENTRY.pill}"`);
		expect(body).not.toContain('id="panel-overview"');
		expect(body).toContain(`id="${ENTRY.elementId}"`);
		expect(body).toContain('books'); // the fixture's one category: the chart, not just the heading
		// the current item, not the current page, as for any section's address
		const tab = /<a href="\/marketplaces\/catalogue" id="tab-catalogue"[^>]*>/.exec(body)?.[0] ?? '';
		expect(tab).toContain('aria-current="true"');
	});

	it('carries the link icon as a plain link to the section, for a reader with no JavaScript, never preloaded', () => {
		const icon = /<a href="\/marketplaces\/categories"[^>]*data-section-link[^>]*>/.exec(at().body)?.[0] ?? '';
		expect(icon).not.toBe('');
		expect(icon).toContain('data-sveltekit-preload-data="off"');
	});

	it('carries the section preview: its title, its description, and its own address', () => {
		const { head } = at();
		expect(head).toContain('<title>Nostrology - Nostr Marketplaces - Categories</title>');
		expect(meta(head, 'property', 'og:title')).toBe(preview.title);
		expect(meta(head, 'property', 'og:description')).toBe(preview.description);
		expect(meta(head, 'name', 'twitter:title')).toBe(preview.title);
		expect(meta(head, 'name', 'description')).toBe(preview.description);
		expect(meta(head, 'property', 'og:url')).toBe('https://site.test/marketplaces/categories');
		expect(head).toContain('<link rel="canonical" href="https://site.test/marketplaces/categories"');
		// the site card until this section has an image of its own
		expect(meta(head, 'property', 'og:image')).toBe('https://site.test/social-card.png');
	});

	it('keeps the preview copy in plain ASCII, so no escape noise reaches a card', () => {
		expect(preview.title + preview.description).toMatch(/^[\x20-\x7e]+$/);
	});

	it('is an indexable page: it is for every reader, and the sitemap lists it', () => {
		expect(ENTRY.unreleased).toBeUndefined();
		expect(at().head).not.toContain('noindex');
	});

	it("draws the card and its icon at the pill's own address too, which is where a reader finds the link", () => {
		current.url = new URL('https://site.test/marketplaces/catalogue');
		const { body } = render(MarketplacesPage, {
			props: { data: { snapshot: SNAPSHOT, target: { kind: 'page', pill: 'catalogue' } } }
		});
		expect(body).toContain(`id="${ENTRY.elementId}"`);
		expect(body).toMatch(/<a href="\/marketplaces\/categories"[^>]*data-section-link/);
	});
});

// Recent listings' own address (/marketplaces/recent-listings, 2026-10-23), rendered the way
// the server renders it - the HTML a link-preview fetcher reads, and the page a browser paints
// before any script runs. The preview tags are the reason the address exists: a chat or a
// Nostr app draws its card from them without ever running the page. The browser's side of the
// same address is marketplaces-section-links.test.ts.
describe('/marketplaces/recent-listings on the server', () => {
	const ENTRY = MARKETPLACES_SLUGS.sections['recent-listings'];
	const preview = ENTRY.preview!;
	const RECENT = [LISTING];
	const at = () => {
		current.url = new URL('https://site.test/marketplaces/recent-listings');
		return render(MarketplacesPage, {
			props: {
				data: {
					snapshot: SNAPSHOT,
					target: { kind: 'page', pill: ENTRY.pill, section: 'recent-listings' },
					recent: RECENT
				}
			}
		});
	};
	it('paints a bitcoin price in the orange of the Priced in bitcoin card, before any script runs', () => {
		// The operator's request, 2026-11-04: "the same orange as what is used in the "Priced in
		// bitcoin" stat block". So the card is READ here and compared, not assumed, its figure and
		// the sellers under it alike. The server's markup is what a reader sees until the page
		// hydrates, so the ink has to be in it, and not added afterwards.
		current.url = new URL('https://site.test/marketplaces/recent-listings');
		const { body } = render(MarketplacesPage, {
			props: {
				data: {
					snapshot: SNAPSHOT,
					target: { kind: 'page', pill: ENTRY.pill, section: 'recent-listings' },
					recent: [{ ...RECENT[0], price: ['price', '1700', 'SAT'] }, { ...RECENT[0], d_tag: 'euro' }]
				}
			}
		});
		const rows = body.slice(body.indexOf('<tbody')).split('<tr').slice(1);
		expect(rows).toHaveLength(2);
		expect(rows[0].match(/color: ?#f7931a/g)).toHaveLength(3); // the cell, its unit, the phone's line
		expect(rows[1]).not.toContain('#f7931a');
		const figure = /Priced in bitcoin<\/div>\s*<div[^>]*style="color: ?(#[0-9a-f]{6})/.exec(body)?.[1];
		const sellers = /priced listings; <span style="color: ?(#[0-9a-f]{6})/.exec(body)?.[1];
		const cell = /color: ?(#[0-9a-f]{6})/.exec(rows[0])?.[1];
		expect(figure).toBe('#f7931a');
		expect(sellers).toBe(figure);
		expect(cell).toBe(figure);
	});
	it("sends What's for sale, with the card in it - no Overview first", () => {
		const { body } = at();
		expect(body).toContain(`id="panel-${ENTRY.pill}"`);
		expect(body).not.toContain('id="panel-overview"');
		expect(body).toContain(`id="${ENTRY.elementId}"`);
		// The pill is the CURRENT ITEM, not the current page: the page being shown is the
		// section's address, and the pill's link is a different address (/marketplaces/catalogue).
		// `page` is only for a pill at its own address, as the pill-bar test above pins.
		const tab = /<a href="\/marketplaces\/catalogue" id="tab-catalogue"[^>]*>/.exec(body)?.[0] ?? '';
		expect(tab).toContain('aria-current="true"');
	});

	it('carries the link icon as a plain link to the section, for a reader with no JavaScript, never preloaded', () => {
		const icon = /<a href="\/marketplaces\/recent-listings"[^>]*data-section-link[^>]*>/.exec(at().body)?.[0] ?? '';
		expect(icon).not.toBe('');
		expect(icon).toContain('data-sveltekit-preload-data="off"');
	});

	it('carries the section preview: its title, its description, and its own address', () => {
		const { head } = at();
		expect(head).toContain('<title>Nostrology - Nostr Marketplaces - Recent listings</title>');
		expect(meta(head, 'property', 'og:title')).toBe(preview.title);
		expect(meta(head, 'property', 'og:description')).toBe(preview.description);
		expect(meta(head, 'name', 'twitter:title')).toBe(preview.title);
		expect(meta(head, 'name', 'description')).toBe(preview.description);
		expect(meta(head, 'property', 'og:url')).toBe('https://site.test/marketplaces/recent-listings');
		expect(head).toContain('<link rel="canonical" href="https://site.test/marketplaces/recent-listings"');
		// the site card until this section has an image of its own
		expect(meta(head, 'property', 'og:image')).toBe('https://site.test/social-card.png');
	});

	it('keeps the preview copy in plain ASCII, so no escape noise reaches a card', () => {
		expect(preview.title + preview.description).toMatch(/^[\x20-\x7e]+$/);
	});

	it('draws no card, and no listing of anyone, when the server sent no rows', () => {
		// The page's own half of the gate, whose loads' half is domain-loads.gating.test.ts: the
		// section is drawn only when `recent` is PRESENT, which it is for every reader unless the
		// slug table marks the section in development ($lib/unreleased) - and then for the
		// operator alone, so a visitor, who is not sent the field at all, gets the pill without the
		// card. Rendered here at the section's own address, which such a visitor never reaches, so
		// that the page is shown to be safe even if one did.
		current.url = new URL('https://site.test/marketplaces/recent-listings');
		const { body } = render(MarketplacesPage, {
			props: {
				data: {
					snapshot: SNAPSHOT,
					target: { kind: 'page', pill: ENTRY.pill, section: 'recent-listings' }
				}
			}
		});
		expect(body).toContain(`id="panel-${ENTRY.pill}"`);
		expect(body).not.toContain(`id="${ENTRY.elementId}"`);
		expect(body).not.toContain(ENTRY.title);
		expect(body).not.toContain('Buono Amazon');
		expect(body).not.toContain('barattolo-3195');
		// nor the section's own address anywhere in it: no heading, no link icon
		expect(body).not.toContain('/marketplaces/recent-listings');
	});

	it('is an indexable page: it is for every reader, and the sitemap lists it', () => {
		// At the address of a section in development the page carries noindex, the belt under the
		// server's 302 (found) for everyone else; marketplaces-page.gating.ssr.test.ts holds that
		// with a fixture flag.
		expect(ENTRY.unreleased).toBeUndefined();
		expect(at().head).not.toContain('noindex');
	});

	it('draws it with the rows the server sent, which it sends every reader', () => {
		const { body } = at();
		expect(body).toContain(`id="${ENTRY.elementId}"`);
		expect(body).toContain('Buono Amazon');
	});
});

// Orange and amber are bitcoin's on this site (the operator, 2026-10-23; 2026-11-05 for what was
// still at odds with that on this page). The server's markup holds every stat, bar and swatch the
// page draws in the DOM, each with its colour as written, so this counts what wears them. The
// Chart.js charts are in marketplaces-page.charts.test.ts. The map's gold ring is neither: it is
// drawn in the browser (bubbles.ts), and whether it stays is still the operator's to say.
describe("/marketplaces: orange and amber are bitcoin's", () => {
	// With BRL in the rows, which it is not every day, because BRL was the amber.
	const snapshot = { ...SNAPSHOT, currency: [...SNAPSHOT.currency, { cur: 'BRL', listings: 21, sellers: 8 }] };
	const on = (pill: string) => {
		current.url = new URL(`https://site.test/marketplaces/${pill}`);
		return render(MarketplacesPage, { props: { data: { snapshot, target: { kind: 'page', pill } } } }).body;
	};
	const count = (body: string, hex: string) => body.split(hex).length - 1;

	it.each(MARKETPLACES_SLUGS.pills.map((p) => p.slug))('%s wears them for bitcoin alone', (pill) => {
		const body = on(pill);
		expect(body).toContain(`id="panel-${pill}"`);
		// The Priced in bitcoin card sits above the pills, so every pill has its figure and its
		// sellers; What's for sale adds the bitcoin swatch in the Currency legend.
		expect(count(body, '#f7931a')).toBe(pill === 'catalogue' ? 3 : 2);
		expect(count(body, '#fbbf24')).toBe(0);
	});

	it("draws the seller-country bars in the purple of Cumulative sellers, beside the listings' teal", () => {
		const body = on('geography');
		const firstBarAfter = (title: string) =>
			/background: ?(#[0-9a-f]{6})[^>]*data-bar/.exec(body.slice(body.indexOf(title)))?.[1];
		expect(firstBarAfter('Top countries by sellers')).toBe('#a78bfa');
		expect(firstBarAfter('Top countries by listings')).toBe('#2dd4bf');
	});
});
