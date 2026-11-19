import { fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { goto, replaceState as kitReplaceState } from '$app/navigation';
import { METHODOLOGY } from '$lib/methodology';
import { addressOf, type Target } from '$lib/slug-table';
import { MARKETPLACES_SLUGS } from '$lib/slug-tables/marketplaces';
import { GLOW_CLASS } from '$lib/section-link';
import type { MarketsRecentListing } from '$lib/shared/data-types';
import MarketplacesPage from './+page.svelte';
import { standInPillRouter } from '../pill-router.test-helper';
import { SNAPSHOT } from './fixture';

// /marketplaces opened at a section's own address (/marketplaces/categories,
// /marketplaces/recent-listings; $lib/slug-table): the server answers the address
// (+page.server.ts, domain-loads.test.ts) and hands the page `target`; this pins what the page
// then does with it. Recent listings was given an address on 2026-10-23, "linkable in the
// identical fashion as the Zaps in /git" (the operator), and Categories on 2026-11-04, "in the
// same fashion and using the same mechanism", so these are /git's own guarantees asked of this
// page, for each section: the card the link means, the icon that copies the address, the arrival
// under the nav, and the one card a phone draws the icon on.
//
// The rules themselves are pinned in src/lib/slug-table.test.ts, the reroute in
// src/hooks.test.ts, the scroll, glow and focus helpers in src/lib/section-link.test.ts, the
// shared navigation logic in src/lib/domain-page.test.ts, the table itself in
// src/lib/components/markets/RecentListings.test.ts, and the server render (the preview tags
// a chat app reads) in marketplaces-page.ssr.test.ts.

// The address is the section's, as the page is served at it: each describe below sets it.
const current = vi.hoisted(() => ({ url: new URL('https://site.test/marketplaces') }));
vi.mock('$app/stores', () => ({
	page: { subscribe: (fn: (v: unknown) => void) => (fn({ url: current.url }), () => {}) }
}));
const navigated = vi.hoisted(() => ({ callbacks: [] as ((nav: unknown) => void)[] }));
vi.mock('$app/navigation', () => ({
	replaceState: vi.fn((url: string) => window.history.replaceState(window.history.state, '', url)),
	afterNavigate: vi.fn((cb: (nav: unknown) => void) => navigated.callbacks.push(cb)),
	goto: vi.fn(() => Promise.resolve())
}));
const pillRouter = standInPillRouter();
// The maps never draw in jsdom. The stand-in has to be a WORKING fake, not an empty object:
// BubbleMap mounts on this page and `mountBubbleMap` calls L.map(...), so `{ L: {} }` threw
// asynchronously and left vitest reporting "Errors 1 error ... might cause false positive
// tests" for the whole run. Same shape as marketplaces-page.test.ts's, cut to what this file
// needs. BubbleMap itself is covered by BubbleMap.test.ts.
const maps = vi.hoisted(() => ({
	L: {
		map: () => ({ fitBounds() {}, remove() {}, removeLayer() {} }),
		circleMarker: () => {
			const marker = { addTo: () => marker, bindPopup: () => marker };
			return marker;
		},
		latLngBounds: (points: unknown) => points
	},
	maplibreGL: () => {
		const layer = {
			addTo: () => layer,
			onRemove: () => layer,
			getContainer: () => undefined,
			getMaplibreMap: () => ({ once() {}, on() {} })
		};
		return layer;
	}
}));
vi.mock('$lib/markets/map-libs', () => ({ L: maps.L, maplibreGL: maps.maplibreGL }));

const OVERVIEW: Target = { kind: 'page', pill: 'overview' };

const PK = '2e7afe3f9af8c3dc90d6e8acaf5d7aa926a54f0c22f1c555707309c059fe831b';
const row = (over: Partial<MarketsRecentListing> = {}): MarketsRecentListing => ({
	pubkey: PK,
	d_tag: 'barattolo-3195',
	event_id: null,
	summary_len: null,
	effective_ts: 1792686600,
	title: 'Buono Amazon 25 scontato',
	status: 'active',
	client: '',
	location: 'Italia',
	cc: 'IT',
	categories: [],
	price: ['price', '23.50', 'EUR'],
	seller_name: null,
	market_image: null,
	expires_at: null,
	title_tag: null,
	visibility: '',
	content_warning: null,
	...over
});
const ROWS = [row(), row({ d_tag: 'b', title: 'Second' })];

const pill = (c: HTMLElement) => c.querySelector('nav[aria-label="Nostr Marketplaces"] > a[aria-current]')?.id;
const navigate = (nav: unknown) => navigated.callbacks.at(-1)!(nav);
const MARKETS = { id: '/(app)/marketplaces' };
const LANDING = { id: '/' };
const at = (path: string, route = MARKETS) => ({ url: new URL('https://site.test' + path), route });
const macrotask = () => new Promise((r) => setTimeout(r, 0));
const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));
const renderWith = (target: Target | undefined, recent: MarketsRecentListing[] | undefined) =>
	render(MarketplacesPage, { props: { data: { snapshot: SNAPSHOT, target, recent } } });
/** The page's `data`, as the router hands it over on a move between its own addresses. */
const movedTo = (target: Target, recent: MarketsRecentListing[] | undefined) => ({
	data: { snapshot: SNAPSHOT, target, recent }
});

let scrollTo: ReturnType<typeof vi.fn>;
beforeEach(() => {
	navigated.callbacks.length = 0;
	vi.mocked(goto).mockClear();
	vi.mocked(kitReplaceState).mockClear();
	pillRouter.routed.length = 0;
	scrollTo = vi.fn();
	window.scrollTo = scrollTo as never;
	vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
	// A sticky nav 61 px tall, and every section 2400 px down the page.
	document.body.insertAdjacentHTML('afterbegin', '<nav class="nav"></nav>');
	vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
		return (this.matches('nav.nav') ? { top: 0, height: 61, bottom: 61 } : { top: 2400, height: 300 }) as DOMRect;
	});
});
afterEach(() => {
	document.querySelector('nav.nav')?.remove();
	window.history.replaceState(null, '', '/');
	Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true, writable: true });
	vi.restoreAllMocks();
});

// The two sections with a card and an icon of their own, each rendered as the reader it is for
// gets it. Categories is drawn from the snapshot, so with no `recent` at all, which is what
// everyone but the operator is sent (+layout.server.ts); Recent listings exists only with rows.
describe.each([
	{ slug: 'categories', address: '/marketplaces/categories', recent: undefined },
	{ slug: 'recent-listings', address: '/marketplaces/recent-listings', recent: ROWS }
])('the section at $address', ({ slug, address, recent }) => {
	const ENTRY = MARKETPLACES_SLUGS.sections[slug];
	const HERE: Target = { kind: 'page', pill: ENTRY.pill, section: slug };
	const renderAt = (target: Target = HERE) => renderWith(target, recent);
	const data = (target: Target) => movedTo(target, recent);
	const card = (c: HTMLElement) => c.querySelector('#' + ENTRY.elementId) as HTMLElement;
	const icon = (c: HTMLElement) => card(c).querySelector(':scope > a[data-section-link]') as HTMLAnchorElement;
	const enter = () => navigate({ type: 'enter', from: null, to: at(address) });

	beforeEach(() => {
		current.url = new URL('https://site.test' + address);
		window.history.replaceState(null, '', address);
	});

	describe("the slug table and the card agree", () => {
		it('puts the card on the pill the table names, under the id it names', () => {
			const { container } = renderAt();
			expect(container.querySelector(`#panel-${ENTRY.pill} #${ENTRY.elementId}`)).not.toBeNull();
		});

		it('heads the card with the title the table carries, so the icon is named what the reader sees', () => {
			const { container } = renderAt();
			expect(card(container).querySelector('h2')?.textContent?.trim()).toBe(ENTRY.title);
		});

		it('gives it the link icon, to its own address, beside the heading - never inside it', () => {
			const { container } = renderAt();
			expect(icon(container).getAttribute('href')).toBe(addressOf(MARKETPLACES_SLUGS, slug));
			expect(addressOf(MARKETPLACES_SLUGS, slug)).toBe(address);
			expect(icon(container).textContent?.trim()).toBe(`Copy link to ${ENTRY.title}`);
			expect(card(container).querySelector('h2 a')).toBeNull();
			// positioned against the card, which must therefore be a positioned box
			expect(card(container).classList.contains('relative')).toBe(true);
		});

		it('never preloads the icon: a hover would land in the log as a visit that never happened', () => {
			const { container } = renderAt();
			expect(icon(container).getAttribute('data-sveltekit-preload-data')).toBe('off');
		});
	});

	describe('a cold load', () => {
		it("opens on What's for sale, the card just under the nav, glowing once, with focus", async () => {
			const { container } = renderAt();
			await tick();
			expect(pill(container)).toBe('tab-catalogue');
			expect(container.querySelector('#panel-overview')).toBeNull();
			enter();
			expect(scrollTo).toHaveBeenLastCalledWith({ top: 0 + 2400 - 61 - 8 });
			expect(card(container).classList.contains(GLOW_CLASS)).toBe(true);
			expect(document.activeElement).toBe(card(container));
		});

		it("keeps the reader's own scroll on a reload: no jump, no glow", async () => {
			vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'reload' }] as never);
			const { container } = renderAt();
			await tick();
			enter();
			expect(scrollTo).not.toHaveBeenCalled();
			expect(card(container).classList.contains(GLOW_CLASS)).toBe(false);
			expect(pill(container)).toBe('tab-catalogue');
		});

		it("does nothing before the cold load completes: the arrival is the router's `enter`, not the mount", async () => {
			const { container } = renderAt();
			await tick();
			await macrotask();
			expect(scrollTo).not.toHaveBeenCalled();
			expect(card(container).classList.contains(GLOW_CLASS)).toBe(false);
		});
	});

	describe('across navigations', () => {
		it("an in-site link from /marketplaces: What's for sale, then the card, after the router's own scroll", async () => {
			window.history.replaceState(null, '', '/marketplaces');
			const { container, rerender } = renderAt(OVERVIEW);
			await tick();
			window.history.replaceState(null, '', address);
			await rerender(data(HERE));
			navigate({ type: 'link', from: at('/marketplaces'), to: at(address) });
			await tick();
			expect(pill(container)).toBe('tab-catalogue');
			expect(scrollTo).not.toHaveBeenCalled(); // deferred past the router's own scroll
			await macrotask();
			expect(scrollTo).toHaveBeenLastCalledWith({ top: 0 + 2400 - 61 - 8 });
			expect(card(container).classList.contains(GLOW_CLASS)).toBe(true);
			expect(document.title).toBe(`Nostrology - Nostr Marketplaces - ${ENTRY.title}`);
		});

		it("the nav's link to /marketplaces from here: Overview, the plain title, no jump", async () => {
			const { container, rerender } = renderAt();
			await tick();
			window.history.replaceState(null, '', '/marketplaces');
			await rerender(data(OVERVIEW));
			navigate({ type: 'link', from: at(address), to: at('/marketplaces') });
			await tick();
			await macrotask();
			expect(pill(container)).toBe('tab-overview');
			expect(document.title).toBe('Nostrology - Nostr Marketplaces');
			expect(scrollTo).not.toHaveBeenCalled();
		});

		it("Back or Forward within the page: the section's pill, but the reader's own scroll", async () => {
			window.history.replaceState(null, '', '/marketplaces');
			const { container, rerender } = renderAt(OVERVIEW);
			await tick();
			window.history.replaceState(null, '', address);
			await rerender(data(HERE));
			navigate({ type: 'popstate', from: at('/marketplaces'), to: at(address) });
			await tick();
			await macrotask();
			expect(pill(container)).toBe('tab-catalogue');
			expect(scrollTo).not.toHaveBeenCalled();
			expect(card(container).classList.contains(GLOW_CLASS)).toBe(false);
		});

		it('Back from another page to here: the page is new, but no jump and no glow', async () => {
			const { container } = renderAt();
			await tick();
			navigate({ type: 'popstate', from: at('/', LANDING), to: at(address) });
			await tick();
			await macrotask();
			expect(pill(container)).toBe('tab-catalogue');
			expect(scrollTo).not.toHaveBeenCalled();
			expect(card(container).classList.contains(GLOW_CLASS)).toBe(false);
		});

		it("here, Geography, the nav's link to /marketplaces, then Back: Geography again, at its own address", async () => {
			const GEOGRAPHY: Target = { kind: 'page', pill: 'geography' };
			const { container, rerender } = renderAt();
			await tick();
			await fireEvent.click(container.querySelector('#tab-geography')!);
			window.history.replaceState(null, '', '/marketplaces/geography');
			await rerender(data(GEOGRAPHY));
			navigate({ type: 'link', from: at(address), to: at('/marketplaces/geography') });
			await tick();
			scrollTo.mockClear(); // the pill click's own scroll to its panel (tap)
			window.history.replaceState(null, '', '/marketplaces');
			await rerender(data(OVERVIEW));
			navigate({ type: 'link', from: at('/marketplaces/geography'), to: at('/marketplaces') });
			await tick();
			expect(pill(container)).toBe('tab-overview');
			window.history.replaceState(null, '', '/marketplaces/geography');
			await rerender(data(GEOGRAPHY));
			navigate({ type: 'popstate', from: at('/marketplaces'), to: at('/marketplaces/geography') });
			await tick();
			expect(pill(container)).toBe('tab-geography');
			expect(document.title).toBe('Nostrology - Nostr Marketplaces - Geography');
			expect(scrollTo).not.toHaveBeenCalled();
		});

		it("sends a pill click from here to the pill's own address, never the section's", async () => {
			const { container } = renderAt();
			await fireEvent.click(container.querySelector('#tab-geography')!);
			expect(pillRouter.routed).toEqual(['/marketplaces/geography']);
			expect(pill(container)).toBe('tab-geography');
			// the page writes no address itself
			expect(vi.mocked(kitReplaceState)).not.toHaveBeenCalled();
			expect(vi.mocked(goto)).not.toHaveBeenCalled();
		});
	});

	describe('the link icon on a phone (P1)', () => {
		/** Where this section's heading is on screen; everything else keeps the geometry above. */
		const headingAt = (top: number) =>
			vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
				if (this.matches('nav.nav')) return { top: 0, height: 61, bottom: 61 } as DOMRect;
				if (this.matches(`#${ENTRY.elementId} > h2`)) return { top, height: 28, bottom: top + 28 } as DOMRect;
				return { top: 2400, height: 300, bottom: 2700 } as DOMRect;
			});

		it('is drawn on the card while its heading is on screen, and goes as the heading scrolls away', async () => {
			Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true, writable: true });
			headingAt(300);
			const { container } = renderAt();
			await tick();
			await tick();
			expect(icon(container).classList.contains('phone-shown')).toBe(true);
			headingAt(20); // under the nav
			window.dispatchEvent(new Event('scroll'));
			await frame();
			await tick();
			expect(icon(container).classList.contains('phone-shown')).toBe(false);
			headingAt(500);
			window.dispatchEvent(new Event('scroll'));
			await frame();
			await tick();
			expect(icon(container).classList.contains('phone-shown')).toBe(true);
			headingAt(830); // its bottom below the screen's
			window.dispatchEvent(new Event('scroll'));
			await frame();
			await tick();
			expect(icon(container).classList.contains('phone-shown')).toBe(false);
		});

		it('is worked out again when the screen changes size (a phone turned on its side)', async () => {
			Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true, writable: true });
			headingAt(600);
			const { container } = renderAt();
			await tick();
			await tick();
			expect(icon(container).classList.contains('phone-shown')).toBe(true);
			Object.defineProperty(window, 'innerHeight', { value: 390, configurable: true, writable: true });
			window.dispatchEvent(new Event('resize'));
			await frame();
			await tick();
			expect(icon(container).classList.contains('phone-shown')).toBe(false);
		});

		it('is worked out again when the page shifts with no scroll at all (a section above folding shut)', async () => {
			Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true, writable: true });
			// jsdom has no ResizeObserver: a stand-in the test can fire, as the browser would when
			// the page's height changes - for whatever the page asked it to observe, and nothing else
			const fire: (() => void)[] = [];
			vi.stubGlobal(
				'ResizeObserver',
				class {
					constructor(private cb: () => void) {}
					observe() {
						fire.push(this.cb);
					}
					disconnect() {}
				}
			);
			try {
				headingAt(900); // below the screen
				const { container } = renderAt();
				await tick();
				await tick();
				expect(icon(container).classList.contains('phone-shown')).toBe(false);
				headingAt(400); // a <details> above closed: the heading moved up, nothing scrolled
				fire.forEach((cb) => cb());
				await frame();
				await tick();
				expect(icon(container).classList.contains('phone-shown')).toBe(true);
			} finally {
				vi.unstubAllGlobals();
			}
		});

		it('is drawn nowhere while the open pill has no section with an address of its own', async () => {
			headingAt(300);
			const { container } = renderAt(OVERVIEW);
			await tick();
			await tick();
			expect(container.querySelector('a[data-section-link].phone-shown')).toBeNull();
			await fireEvent.click(container.querySelector('#tab-catalogue')!);
			await tick();
			await tick();
			expect(icon(container).classList.contains('phone-shown')).toBe(true);
		});
	});
});

describe('/marketplaces/recent-listings with no rows', () => {
	it('opens the pill, and says nothing about a section that is not there', async () => {
		// The one table this section needs is read on its own and may fail (+layout.server.ts),
		// and the address must still answer with the page rather than an empty headed card.
		const ENTRY = MARKETPLACES_SLUGS.sections['recent-listings'];
		current.url = new URL('https://site.test/marketplaces/recent-listings');
		window.history.replaceState(null, '', '/marketplaces/recent-listings');
		const { container } = renderWith({ kind: 'page', pill: ENTRY.pill, section: 'recent-listings' }, []);
		await tick();
		expect(pill(container)).toBe('tab-catalogue');
		expect(container.querySelector('#' + ENTRY.elementId)).toBeNull();
		navigate({ type: 'enter', from: null, to: at('/marketplaces/recent-listings') });
		expect(scrollTo).not.toHaveBeenCalled();
	});
});

describe('the grid Categories sits in', () => {
	it('lets a child be narrower than its content, so no row in it carries the card past a phone', () => {
		// jsdom has no layout, so this pins the class. What it is for is measured on the deployed
		// page: scripts/verify-section-link.mjs holds the card inside its parent and the page free
		// of sideways scroll, at 360 px and 390 px.
		current.url = new URL('https://site.test/marketplaces/categories');
		const ENTRY = MARKETPLACES_SLUGS.sections.categories;
		const { container } = renderWith({ kind: 'page', pill: ENTRY.pill, section: 'categories' }, undefined);
		const grid = container.querySelector('#' + ENTRY.elementId)!.parentElement!;
		expect(grid.classList.contains('[&>*]:min-w-0')).toBe(true);
	});
});

// As /git's git-section-links.test.ts asks of its table: a section added to this one with no card
// or no icon fails here. Rendered as the operator sees it, because every section has to be drawn.
describe("every section in /marketplaces's slug table", () => {
	beforeEach(() => {
		current.url = new URL('https://site.test/marketplaces');
		window.history.replaceState(null, '', '/marketplaces');
	});

	it('sits on the pill the table says', async () => {
		const { container } = renderWith(OVERVIEW, ROWS);
		for (const [slug, s] of Object.entries(MARKETPLACES_SLUGS.sections)) {
			await fireEvent.click(container.querySelector(`#tab-${s.pill}`)!);
			expect(container.querySelector(`#panel-${s.pill} #${s.elementId}`), slug).not.toBeNull();
		}
	});

	it('has its link icon, to its own address, beside the heading - never inside it', async () => {
		const { container } = renderWith(OVERVIEW, ROWS);
		for (const [slug, s] of Object.entries(MARKETPLACES_SLUGS.sections)) {
			await fireEvent.click(container.querySelector(`#tab-${s.pill}`)!);
			const card = container.querySelector(`#${s.elementId}`) as HTMLElement;
			// What is counted's icon is MethodologySection's own, beside its <details>
			const link = (
				slug === METHODOLOGY
					? card.parentElement!.querySelector(':scope > a[data-methodology-link]')
					: card.querySelector(':scope > a[data-section-link]')
			) as HTMLAnchorElement | null;
			expect(link?.getAttribute('href'), slug).toBe(addressOf(MARKETPLACES_SLUGS, slug));
			expect(link?.textContent?.trim(), slug).toBe(`Copy link to ${s.title}`);
			expect(card.querySelector('h2 a'), slug).toBeNull();
			// positioned against the card it sits on (MethodologySection's wrapper positions its own)
			if (slug === METHODOLOGY) expect(card.parentElement!.classList.contains('methodology'), slug).toBe(true);
			else expect(card.classList.contains('relative'), slug).toBe(true);
		}
	});
});

// What's for sale is the one pill on the site with two such sections, as the operator sees it, so
// it is the one place P1's "one card at a time" is more than a card being on or off screen.
describe('the link icon on a phone, with two sections with an address on one pill', () => {
	const CATALOGUE: Target = { kind: 'page', pill: 'catalogue' };
	const headingsAt = (tops: { categories: number; 'recent-listings': number }) =>
		vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
			if (this.matches('nav.nav')) return { top: 0, height: 61, bottom: 61 } as DOMRect;
			for (const [slug, top] of Object.entries(tops))
				if (this.matches(`#${MARKETPLACES_SLUGS.sections[slug].elementId} > h2`))
					return { top, height: 28, bottom: top + 28 } as DOMRect;
			return { top: 2400, height: 300, bottom: 2700 } as DOMRect;
		});
	const drawnOn = (c: HTMLElement) =>
		[...c.querySelectorAll('a[data-section-link].phone-shown')].map((a) => a.getAttribute('href'));

	beforeEach(() => {
		current.url = new URL('https://site.test/marketplaces/catalogue');
		window.history.replaceState(null, '', '/marketplaces/catalogue');
		Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true, writable: true });
	});

	it('is drawn on the heading nearest the top and on no other, and moves on as it scrolls away', async () => {
		headingsAt({ categories: 100, 'recent-listings': 500 });
		const { container } = renderWith(CATALOGUE, ROWS);
		await tick();
		await tick();
		expect(drawnOn(container)).toEqual(['/marketplaces/categories']);
		headingsAt({ categories: 20, 'recent-listings': 400 }); // Categories under the nav
		window.dispatchEvent(new Event('scroll'));
		await frame();
		await tick();
		expect(drawnOn(container)).toEqual(['/marketplaces/recent-listings']);
	});

	it('goes to Categories, the only one there is, for a reader sent no listings', async () => {
		headingsAt({ categories: 100, 'recent-listings': 500 });
		const { container } = renderWith(CATALOGUE, undefined);
		await tick();
		await tick();
		expect(container.querySelector('#' + MARKETPLACES_SLUGS.sections['recent-listings'].elementId)).toBeNull();
		expect(drawnOn(container)).toEqual(['/marketplaces/categories']);
	});
});
