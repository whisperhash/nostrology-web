import { fireEvent, render } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { goto, replaceState as kitReplaceState } from '$app/navigation';
import type { Target } from '$lib/slug-table';
import MarketplacesPage from './+page.svelte';
import { standInPillRouter } from '../pill-router.test-helper';
import { SNAPSHOT } from './fixture';

// Every page renders <SocialMeta>, which reads $page for the request's own origin and
// path. Rendering a page component in isolation gives it no router, so the store has to be
// supplied here - same pattern as SiteNav.test.ts.
vi.mock('$app/stores', () => ({
	page: readable({ url: new URL('https://site.test/marketplaces') })
}));
// SvelteKit's router, stood in for ($lib/domain-page uses it). afterNavigate keeps the
// callbacks, and the tests call the newest one with a navigation of their own; replaceState
// rewrites the entry and keeps its state, as SvelteKit's does; goto records the moves the
// page makes itself.
const navigated = vi.hoisted(() => ({ callbacks: [] as ((nav: unknown) => void)[] }));
vi.mock('$app/navigation', () => ({
	replaceState: vi.fn((url: string) => window.history.replaceState(window.history.state, '', url)),
	afterNavigate: vi.fn((cb: (nav: unknown) => void) => navigated.callbacks.push(cb)),
	goto: vi.fn(() => Promise.resolve())
}));
// A pill is a link: the router's part in a click is stood in for (pill-router.test-helper.ts).
const pillRouter = standInPillRouter();
beforeEach(() => {
	navigated.callbacks.length = 0;
	vi.mocked(goto).mockClear();
	vi.mocked(kitReplaceState).mockClear();
});
// The map chunk (Leaflet, MapLibre GL and the bridge) cannot draw in jsdom. This stand-in
// records what each map would show: its points, their colour, and the basemap style it was
// given. BubbleMap.test.ts covers the component itself.
const maps = vi.hoisted(() => {
	const built: Array<{ points: unknown[]; colors: unknown[]; styles: unknown[] }> = [];
	const L = {
		map: () => {
			const m = { points: [] as unknown[], colors: [] as unknown[], styles: [] as unknown[], fitBounds() {}, remove() {}, removeLayer() {} };
			built.push(m);
			return m;
		},
		circleMarker: (latlng: unknown, options: { fillColor: string }) => {
			const marker = {
				addTo: (m: { points: unknown[]; colors: unknown[] }) => (m.points.push(latlng), m.colors.push(options.fillColor), marker),
				bindPopup: () => marker
			};
			return marker;
		},
		latLngBounds: (points: unknown) => points
	};
	const maplibreGL = ({ style }: { style: unknown }) => {
		const layer = {
			addTo: (m: { styles: unknown[] }) => (m.styles.push(style), layer),
			onRemove: () => layer,
			getContainer: () => undefined,
			getMaplibreMap: () => ({ once() {}, on() {} })
		};
		return layer;
	};
	return { built, L, maplibreGL };
});
vi.mock('$lib/markets/map-libs', () => ({ L: maps.L, maplibreGL: maps.maplibreGL }));

/**
 * /marketplaces renders one server-loaded snapshot document (data.snapshot) - this pins the
 * data-source contract that replaced the committed static JSON on 2026-08-23: every headline
 * card, the exclusion ledger and the snapshot stamp must come from the prop, because there is
 * no other source left. Under jsdom no chart draws (there is no 2D context) and the map chunk
 * is the stand-in above, so every pill renders its markup from the fixture; what the growth
 * pill hands to Chart.js is pinned in marketplaces-page.charts.test.ts.
 */
describe('/marketplaces page (DB-powered)', () => {
	// Some tests open the page at an address of its own, and the page reads an old #pill at
	// init: reset it, or the next test starts there.
	afterEach(() => window.history.replaceState(null, '', '/'));

	it('renders the headline cards from the server-loaded snapshot', () => {
		const { container } = render(MarketplacesPage, { props: { data: { snapshot: SNAPSHOT } } });
		const text = container.textContent ?? '';
		expect(text).toContain('4,935'); // live listings
		expect(text).toContain('1,292'); // sellers
		expect(text).toContain('Priced in bitcoin');
		// 1800 of 3858 priced -> 47%, computed by the page, not shipped in the snapshot
		expect(text).toContain('47%');
		expect(text).toContain('54'); // countries
	});

	it('renders the exclusion ledger and the what-is-counted numbers', () => {
		const { container } = render(MarketplacesPage, { props: { data: { snapshot: SNAPSHOT } } });
		// scoped to the What is counted card: 11,784 also appears in the seller-base paragraph
		const text = container.querySelector('#panel-overview')!.lastElementChild!.textContent ?? '';
		expect(text).toContain('11,784'); // current coordinates
		expect(text).toContain('Non-retail bulk publishers');
		expect(text).toContain('Deleted (NIP-09)');
	});

	it('says a product counts once, and draws that row last, just above what it leaves', () => {
		const { container } = render(MarketplacesPage, { props: { data: { snapshot: SNAPSHOT } } });
		const section = container.querySelector('#panel-overview')!.lastElementChild!;
		const prose = section.querySelector('p')!.textContent!.replace(/\s+/g, ' ');
		// "six" is the groups that are not someone selling something, and a product's options are
		// someone selling something, so the sentence has to name them apart from the six.
		expect(prose).toContain(
			'six groups that are not someone selling something are removed, and a product published with one listing per size or colour counts once.'
		);
		const rows = [...section.querySelectorAll('div.border-l-2')].map((r) => r.textContent!.replace(/\s+/g, ' '));
		expect(rows).toHaveLength(SNAPSHOT.exclusions.length + 1);
		expect(rows.at(-2)).toContain('Product options');
		expect(rows.at(-1)).toContain('Live listings');
		// The sum the page states has to be one a run can produce: check_invariants requires it.
		const removed = SNAPSHOT.exclusions.reduce((sum, e) => sum + e.v, 0);
		expect(removed + SNAPSHOT.summary.active_listings).toBe(SNAPSHOT.summary.current_coordinates);
	});

	it('closes the overview on What is counted, collapsed, after the figures it qualifies', () => {
		const { container } = render(MarketplacesPage, { props: { data: { snapshot: SNAPSHOT } } });
		const panel = container.querySelector('#panel-overview')!;
		const headings = [...panel.querySelectorAll('h2')].map((h) => h.textContent?.trim());
		expect(headings).toEqual(['Who publishes', 'The shape of the seller base', 'What is counted']);
		// the ledger rows live inside that last section, not beside it. The section is the
		// panel's last child's <details>: MethodologySection wraps it with the copy-link icon,
		// which has to sit outside the <details> to be drawn while it is closed.
		const last = panel.lastElementChild!.querySelector(':scope > details') as HTMLDetailsElement;
		expect(last.querySelector('h2')?.textContent?.trim()).toBe('What is counted');
		for (const row of ['Non-retail bulk publishers', 'Withdrawn', 'Live listings']) {
			expect(last.textContent).toContain(row);
		}
		// collapsed since 2026-10-17, as on /git, behind its own heading; closed, the content
		// is still in the DOM (and the SSR HTML), only not drawn
		expect(last.open).toBe(false);
		expect(last.id).toBe('methodology');
		expect(last.querySelector(':scope > summary > h2')!.textContent).toBe('What is counted');
		// with the icon that copies its link beside it, and nothing else
		expect([...panel.lastElementChild!.children].map((c) => c.tagName)).toEqual(['A', 'DETAILS', 'SPAN']);
	});

	// Since 2026-10-19 a pill is an address (/marketplaces/geography) and the pill bar a row of links
	// (PillBar, $lib/domain-page, whose own tests pin the shared behaviour): this pins that the
	// page is wired to them.
	describe('pills and their addresses', () => {
		const pills = (c: HTMLElement) => [...c.querySelectorAll('nav[aria-label="Nostr Marketplaces"] > a')] as HTMLAnchorElement[];
		const openPill = (c: HTMLElement) => c.querySelector('nav[aria-label="Nostr Marketplaces"] > a[aria-current]')?.id;
		const settle = () => new Promise((r) => setTimeout(r, 0));
		const MOVE = { replaceState: true, noScroll: true, keepFocus: true };
		const COUNTED: Target = { kind: 'page', pill: 'overview', section: 'methodology' };
		/** The page at one of its addresses, as the server answered it, with the router's moves. */
		const renderAt = (path: string, target?: Target) => {
			window.history.replaceState(null, '', path);
			const r = render(MarketplacesPage, { props: { data: { ...{ snapshot: SNAPSHOT }, target } } });
			return {
				...r,
				enter: () => navigated.callbacks.at(-1)!({ type: 'enter', to: { url: new URL('https://site.test' + path) } }),
				async navigate(type: string, to: string, next: Target) {
					window.history.replaceState(null, '', to);
					await r.rerender({ data: { ...{ snapshot: SNAPSHOT }, target: next } });
					navigated.callbacks.at(-1)!({ type, to: { url: new URL('https://site.test' + to) } });
				}
			};
		};
		/** A laid-out page: jsdom measures nothing, so the nav and the section's top are given. */
		const geometry = () => {
			document.body.insertAdjacentHTML('afterbegin', '<nav class="nav"></nav>');
			vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 1800, height: 56 } as DOMRect);
			vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
			return vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
		};
		const counted = (c: Element) => c.querySelector('#methodology') as HTMLDetailsElement;
		afterEach(() => {
			document.querySelector('nav.nav')?.remove();
			vi.restoreAllMocks();
		});

		it('offers the pills as links to their own addresses, the default one open', () => {
			const { container } = renderAt('/marketplaces');
			expect(pills(container).map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
			['Overview', '/marketplaces'],
			['Growth', '/marketplaces/growth'],
			["What's for sale", '/marketplaces/catalogue'],
			['Geography', '/marketplaces/geography'],
			['Shipping', '/marketplaces/shipping']
			]);
			expect(openPill(container)).toBe('tab-overview');
			expect(container.querySelectorAll('[id^="panel-"]')).toHaveLength(1);
			expect(container.querySelector('#panel-overview')).not.toBeNull();
		});

		it('opens a pill at once on a click, leaves the address to the router, and follows it', async () => {
			const page = renderAt('/marketplaces');
			page.enter();
			await fireEvent.click(page.container.querySelector('#tab-geography')!);
			expect(page.container.querySelector('#panel-geography')).not.toBeNull();
			expect(pillRouter.routed).toEqual(['/marketplaces/geography']);
			expect(vi.mocked(kitReplaceState)).not.toHaveBeenCalled();
			expect(vi.mocked(goto)).not.toHaveBeenCalled();
			await page.navigate('link', '/marketplaces/geography', { kind: 'page', pill: 'geography' });
			expect(openPill(page.container)).toBe('tab-geography');
			expect(document.title).toBe('Nostrology - Nostr Marketplaces - Geography');
			await page.navigate('popstate', '/marketplaces', { kind: 'page', pill: 'overview' });
			expect(openPill(page.container)).toBe('tab-overview');
			expect(document.title).toBe('Nostrology - Nostr Marketplaces');
		});

		it('opens the pill an old #pill link names, then moves to its address', async () => {
			const page = renderAt('/marketplaces#geography');
			expect(page.container.querySelector('#panel-geography')).not.toBeNull();
			page.enter();
			await settle();
			expect(vi.mocked(goto)).toHaveBeenCalledWith('/marketplaces/geography', MOVE);
		});

		it("says why after a 302 (found) for an unknown slug, then drops the #gone", async () => {
			const page = renderAt('/marketplaces#gone', { kind: 'page', pill: 'overview' });
			await settle();
			expect(page.container.querySelector('[data-transient-note]')?.textContent?.trim()).toBe('That section is no longer on this page.');
			page.enter();
			await settle();
			// the router's own move, replacing the entry
			expect(vi.mocked(goto)).toHaveBeenCalledWith('/marketplaces', MOVE);
		});

		// What is counted's address (CLAUDE.md -> "Every domain page's What is counted has an
		// address"): /marketplaces/methodology must land on the OPEN section, and nothing but an
		// address may open it.
		it('lands /marketplaces/methodology on Overview with What is counted open, just under the nav', async () => {
			const scrollTo = geometry();
			const page = renderAt('/marketplaces/methodology', COUNTED);
			expect(page.container.querySelector('#panel-overview')).not.toBeNull();
			expect(counted(page.container).open).toBe(true);
			expect(document.title).toBe('Nostrology - Nostr Marketplaces - What is counted');
			page.enter();
			expect(scrollTo).toHaveBeenLastCalledWith({ top: 1800 - 56 - 8 });
			expect(document.activeElement).toBe(counted(page.container));
		});

		it('opens What is counted for an old #methodology link, then moves to its address', async () => {
			geometry();
			const page = renderAt('/marketplaces#methodology');
			expect(counted(page.container).open).toBe(true);
			page.enter();
			await settle();
			expect(vi.mocked(goto)).toHaveBeenCalledWith('/marketplaces/methodology', MOVE);
		});

		it('leaves What is counted closed anywhere else, and opening it by hand writes nothing', async () => {
			const scrollTo = geometry();
			const page = renderAt('/marketplaces');
			page.enter();
			await settle();
			expect(counted(page.container).open).toBe(false);
			expect(scrollTo).not.toHaveBeenCalled();
			counted(page.container).open = true;
			await fireEvent(counted(page.container), new Event('toggle'));
			expect(vi.mocked(kitReplaceState)).not.toHaveBeenCalled();
			expect(vi.mocked(goto)).not.toHaveBeenCalled();
		});

		it("opens What is counted after a navigation to its address, once the router's scroll is done; Back only opens it", async () => {
			const scrollTo = geometry();
			const page = renderAt('/marketplaces');
			page.enter();
			await page.navigate('link', '/marketplaces/methodology', COUNTED);
			expect(scrollTo).not.toHaveBeenCalled();
			await settle();
			expect(counted(page.container).open).toBe(true);
			expect(scrollTo).toHaveBeenLastCalledWith({ top: 1800 - 56 - 8 });
			scrollTo.mockClear();
			await page.navigate('popstate', '/marketplaces', { kind: 'page', pill: 'overview' });
			// never closed by a navigation: the reader may have opened it
			expect(counted(page.container).open).toBe(true);
			await page.navigate('popstate', '/marketplaces/methodology', COUNTED);
			await settle();
			expect(scrollTo).not.toHaveBeenCalled();
		});

		it('keeps What is counted open across a pill round trip, since the visitor opened it', async () => {
			geometry();
			const { container } = renderAt('/marketplaces/methodology', COUNTED);
			await fireEvent.click(container.querySelector('#tab-geography')!);
			expect(container.querySelector('#methodology')).toBeNull();
			await fireEvent.click(container.querySelector('#tab-overview')!);
			expect(counted(container).open).toBe(true);
		});

		// The link icon on the section's head (MethodologySection): a click puts the section's
		// address on the clipboard and changes nothing on the page. Its own behaviour is pinned in
		// MethodologySection.test.ts; this is that it is here, wired to this page.
		it.each([
			['/marketplaces', undefined],
			['/marketplaces/methodology', COUNTED]
		])('copies /marketplaces/methodology from the icon on %s, and writes nothing', async (start, target) => {
			const writeText = vi.fn(() => Promise.resolve());
			Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
			try {
				const scrollTo = geometry();
				const page = renderAt(start, target);
				page.enter();
				await settle();
				scrollTo.mockClear();
				const wasOpen = counted(page.container).open;
				const link = page.container.querySelector('#panel-overview a[data-methodology-link]') as HTMLAnchorElement;
				expect(link.getAttribute('href')).toBe('/marketplaces/methodology');
				expect(await fireEvent.click(link)).toBe(false);
				await settle();
				expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/marketplaces/methodology`);
				expect(counted(page.container).open).toBe(wasOpen);
				expect(window.location.pathname + window.location.hash).toBe(start);
				expect(vi.mocked(kitReplaceState)).not.toHaveBeenCalled();
				expect(vi.mocked(goto)).not.toHaveBeenCalled();
				expect(scrollTo).not.toHaveBeenCalled();
				expect(openPill(page.container)).toBe('tab-overview');
			} finally {
				delete (navigator as { clipboard?: unknown }).clipboard;
			}
		});
	});

	it('renders the snapshot stamp at the page foot', () => {
		const { container } = render(MarketplacesPage, { props: { data: { snapshot: SNAPSHOT } } });
		expect(container.textContent).toContain('Snapshot 2026-08-23 09:43:05Z');
	});

	it('keys new listings per month as /git keys its weekly bars, and names the partial month under the plot', async () => {
		const { container } = render(MarketplacesPage, { props: { data: { snapshot: SNAPSHOT } } });
		await fireEvent.click(container.querySelector('#tab-growth')!);
		const card = [...container.querySelectorAll('#panel-growth h2')]
			.find((h) => h.textContent?.trim() === 'New listings per month')!
			.closest('.rounded-xl')!;
		// The legend is the page's markup, each key in its mark's shape (it was Chart.js's
		// own legend, two circles crowding their labels, until 2026-10-08).
		const keys = [...card.querySelectorAll('[data-testid="chart-legend"] button')].map((b) => [
			b.textContent?.trim(),
			b.querySelector('[data-swatch]')?.getAttribute('data-swatch')
		]);
		expect(keys).toEqual([
			['New listings', 'bar'],
			['First-time sellers', 'line']
		]);
		// One key under the plot, the trailing month's, dated by the snapshot's own cut to the
		// minute (the run's data runs INTO its day, unlike /git's, which runs through it).
		const notes = [...card.querySelectorAll('[data-testid="bucket-notes"] li')].map((li) => [
			li.getAttribute('data-note'),
			li.textContent?.trim()
		]);
		expect(notes).toEqual([['partial_last', 'partial month: data to Aug 23, 2026, 09:43 UTC']]);
		// the caption says it, so the paragraph no longer does; the paragraph says what the line
		// counts, as /git's does, and the heading carries no axis aside (the legend keys the line)
		expect(card.textContent).not.toContain('The final bar is a partial month');
		expect(card.querySelector('p')!.textContent!.replace(/\s+/g, ' ')).toContain(
			'The line is first-time sellers: sellers whose earliest live listing falls in the month, each counted once, ever.'
		);
		expect(card.textContent).not.toContain('right axis');
		expect(card.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
			'New listings per month, and first-time sellers'
		);
	});

	it('marks no month on the 1st before a listing is dated in it: the month just completed is whole', async () => {
		// partial_month is the run's month; at 02:16 UTC on Sep 1, with nothing dated in
		// September yet, it has no bar, and August, which the run saw in full, is not marked.
		const first = { ...SNAPSHOT, generated_utc: '2026-09-01 02:16:30Z', partial_month: '2026-09' };
		const { container } = render(MarketplacesPage, { props: { data: { snapshot: first } } });
		await fireEvent.click(container.querySelector('#tab-growth')!);
		const card = [...container.querySelectorAll('#panel-growth h2')]
			.find((h) => h.textContent?.trim() === 'New listings per month')!
			.closest('.rounded-xl')!;
		expect(card.querySelector('[data-testid="chart-legend"]')).not.toBeNull();
		expect(card.querySelector('[data-testid="bucket-notes"]')).toBeNull();
	});

	it('dates the caption by its day alone when generated_utc carries no time', async () => {
		const { container } = render(MarketplacesPage, { props: { data: { snapshot: { ...SNAPSHOT, generated_utc: '2026-08-23' } } } });
		await fireEvent.click(container.querySelector('#tab-growth')!);
		expect(container.querySelector('#panel-growth [data-note="partial_last"]')?.textContent?.trim()).toBe(
			'partial month: data to Aug 23, 2026'
		);
	});

	it('words the listings that cannot be placed plainly, with no first person and no method aside', async () => {
		const { container } = render(MarketplacesPage, { props: { data: { snapshot: SNAPSHOT } } });
		await fireEvent.click(container.querySelector('#tab-geography')!);
		const card = [...container.querySelectorAll('#panel-geography h2')]
			.find((h) => h.textContent?.includes('cannot be placed'))!
			.closest('.rounded-xl')!;
		const text = card.textContent ?? '';
		expect(text).toContain('Free text that could not be resolved');
		expect(text).not.toContain('I could not resolve');
		expect(text).not.toMatch(/IP address|relay/);
		// The intro is the one sentence since 2026-10-08 (the IP address and relay aside went).
		expect(card.querySelector('p')?.textContent?.trim()).toBe('Geography is optional in NIP-99 and most sellers skip it.');
	});

	it('maps the listings on Geography and the shipping destinations on Shipping, both over the OpenFreeMap basemap', async () => {
		// A browser with WebGL2, and an OpenFreeMap that answers.
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
			getExtension: () => null
		} as unknown as RenderingContext);
		const style = { version: 8, sources: {}, layers: [] };
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(style))));
		const settle = () => new Promise((r) => setTimeout(r, 0));
		try {
			maps.built.length = 0;
			const { container } = render(MarketplacesPage, { props: { data: { snapshot: SNAPSHOT } } });
			await settle();
			expect(maps.built).toHaveLength(0); // Overview has no map, so nothing is built
			await fireEvent.click(container.querySelector('#tab-geography')!);
			for (let i = 0; i < 20 && !maps.built[0]?.styles.length; i++) await settle();
			await fireEvent.click(container.querySelector('#tab-shipping')!);
			for (let i = 0; i < 20 && !maps.built[1]?.styles.length; i++) await settle();

			const [geography, shipping] = maps.built;
			expect(maps.built).toHaveLength(2);
			expect(geography.points).toEqual(SNAPSHOT.map_points.map((p) => [p.lat, p.lon]));
			expect(geography.colors).toEqual(['#a78bfa']);
			expect(shipping.points).toEqual(SNAPSHOT.shipping.map((p) => [p.lat, p.lon]));
			expect(shipping.colors).toEqual(['#34d399']);
			// one basemap for both: the style fetched from OpenFreeMap, never CARTO's tiles
			expect(geography.styles).toEqual([style]);
			expect(shipping.styles).toEqual([style]);
			expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
				'https://tiles.openfreemap.org/styles/dark',
				'https://tiles.openfreemap.org/styles/dark'
			]);
		} finally {
			vi.restoreAllMocks();
			vi.unstubAllGlobals();
		}
	});
});
