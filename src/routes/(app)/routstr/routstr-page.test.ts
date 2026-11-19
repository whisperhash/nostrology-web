import { fireEvent, render } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { goto, replaceState as kitReplaceState } from '$app/navigation';
import type { Target } from '$lib/slug-table';
import type { RoutstrSnapshot } from '$lib/shared/data-types';
import RoutstrPage from './+page.svelte';
import { standInPillRouter } from '../pill-router.test-helper';
import { SNAPSHOT } from './fixture';

// Every page renders <SocialMeta>, which reads $page for the request's own origin and
// path. Rendering a page component in isolation gives it no router, so the store has to be
// supplied here - same pattern as SiteNav.test.ts.
vi.mock('$app/stores', () => ({
	page: readable({ url: new URL('https://site.test/routstr') })
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

/**
 * /routstr renders one server-loaded snapshot document (data.snapshot) - this pins the
 * data-source contract: every headline card, the exclusion ledger, the provider table and
 * the snapshot stamp must come from the prop, because there is no other source. The
 * overview tab mounts DailyBarChart/LineChart, which no-op cleanly under jsdom's null
 * canvas context, so the fixture (./fixture.ts) can stay small; chart internals get their own coverage
 * elsewhere. Revenue fields in the document are integer MILLISATS - the sats the page
 * shows are its own division, and the fixture numbers are chosen so that conversion is
 * visible (21,000,000 msats -> 21,000 sats).
 */
describe('/routstr page (DB-powered)', () => {
	// The providers-tab test persists selector state; keep tests order-independent.
	// (jsdom's Storage here lacks clear(); remove the two keys explicitly.)
	afterEach(() => {
		for (const k of ['routstr:providersTopN', 'routstr:providersChart']) {
			try {
				localStorage.removeItem(k);
			} catch {
				// no storage in this environment
			}
		}
	});

	it('renders the headline cards from the server-loaded snapshot', () => {
		const { container } = render(RoutstrPage, { props: { data: { snapshot: SNAPSHOT } } });
		const text = container.textContent ?? '';
		expect(text).toContain('49'); // providers announced
		expect(text).toContain('21,000 sats'); // revenue 30d (pre-converted sats field)
		expect(text).toContain('12,433,216'); // all-time sats
		expect(text).toContain('65.7k'); // requests 30d, compact
		expect(text).toContain('21 in the curated catalog');
	});

	it('renders the exclusion ledger with the included-provider tally', () => {
		const { container } = render(RoutstrPage, { props: { data: { snapshot: SNAPSHOT } } });
		const text = container.textContent ?? '';
		expect(text).toContain('Test / staging nodes');
		expect(text).toContain('Kind squatters');
		// providers array has 1 included row
		expect(text).toContain('Providers in the aggregates');
	});

	it('marks the usage figures as self-reported in the page foot', () => {
		const { container } = render(RoutstrPage, { props: { data: { snapshot: SNAPSHOT } } });
		const text = container.textContent ?? '';
		expect(text).toContain('Snapshot 2026-08-24 15:50:00Z');
		expect(text).toContain('self-reported');
	});

	it('providers tab: sortable table headers, Top-N selector and Bars/Lines toggle', async () => {
		const snapshot: RoutstrSnapshot = {
			...SNAPSHOT,
			providers: [
				SNAPSHOT.providers[0],
				{ ...SNAPSHOT.providers[0], id: 'cccccccccccc', name: 'Charlie', msats_30d: 500000, msats_alltime: 500000 },
				SNAPSHOT.providers[1]
			]
		};
		const { container } = render(RoutstrPage, { props: { data: { snapshot } } });
		await fireEvent.click(container.querySelector('#tab-providers')!);
		const table = container.querySelector('#panel-providers table')!;
		const firstCol = () => [...table.querySelectorAll('tbody td:first-child')].map((td) => td.textContent?.trim());
		// default: 30d sats descending, only included providers
		expect(table.querySelector('th[aria-sort="descending"]')?.textContent).toContain('Sats (30d)');
		expect(firstCol()).toEqual(['Alpha Node', 'Charlie']);
		// click the active column: flips to ascending
		await fireEvent.click(table.querySelector('button[aria-label="Sort by Sats (30d)"]')!);
		expect(firstCol()).toEqual(['Charlie', 'Alpha Node']);
		expect(table.querySelector('th[aria-sort="ascending"]')?.textContent).toContain('Sats (30d)');
		// a text column starts ascending
		await fireEvent.click(table.querySelector('button[aria-label="Sort by Provider"]')!);
		expect(firstCol()).toEqual(['Alpha Node', 'Charlie']);
		await fireEvent.click(table.querySelector('button[aria-label="Sort by Provider"]')!);
		expect(firstCol()).toEqual(['Charlie', 'Alpha Node']);
		// the chart controls
		const buttons = () => [...container.querySelectorAll('#panel-providers button')];
		const labels = buttons().map((b) => b.textContent?.trim());
		for (const l of ['Top 5', 'Top 10', 'Top 20', 'Bars', 'Lines']) expect(labels).toContain(l);
		// Bars = DailyBarChart, which renders an HTML legend button per dataset; Lines =
		// CumulativeLineChart, which has no HTML legend - the swap is observable.
		expect(labels).toContain('Alpha Node');
		await fireEvent.click(buttons().find((b) => b.textContent?.trim() === 'Lines')!);
		expect(buttons().map((b) => b.textContent?.trim())).not.toContain('Alpha Node');
		expect(container.querySelector('#panel-providers canvas')).not.toBeNull();
		await fireEvent.click(buttons().find((b) => b.textContent?.trim() === 'Bars')!);
		expect(buttons().map((b) => b.textContent?.trim())).toContain('Alpha Node');
	});

	it('brightens the providers column sorted at that moment, and only that one', async () => {
		// The operator's rule of 2026-10-18, as on /git: the bright ink follows the reader's sort.
		// The provider's name keeps its own ink and Review its verdict's colour, so neither is
		// checked here.
		const { container } = render(RoutstrPage, { props: { data: { snapshot: SNAPSHOT } } });
		await fireEvent.click(container.querySelector('#tab-providers')!);
		const table = container.querySelector('#panel-providers table')!;
		const labels = [...table.querySelectorAll('thead button')].map((b) => b.getAttribute('aria-label')!.replace(/^Sort by /, ''));
		const inked = labels.map((l, j) => [l, j] as const).filter(([l]) => l !== 'Provider' && l !== 'Review');
		const bright = () => {
			const rows = [...table.querySelectorAll('tbody tr')];
			return inked
				.filter(([, j]) => rows.length > 0 && rows.every((tr) => tr.children[j].classList.contains('text-gray-200')))
				.map(([l]) => l);
		};
		const dimElsewhere = () => {
			const rows = [...table.querySelectorAll('tbody tr')];
			const sorted = labels[[...table.querySelectorAll('thead th')].findIndex((th) => th.getAttribute('aria-sort') !== 'none')];
			return inked.every(([l, j]) => l === sorted || rows.every((tr) => tr.children[j].classList.contains('text-gray-400')));
		};
		expect(table.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
		expect(bright()).toEqual(['Sats (30d)']);
		expect(dimElsewhere()).toBe(true);
		for (const [label] of inked) {
			await fireEvent.click(table.querySelector(`button[aria-label="Sort by ${label}"]`)!);
			expect(bright(), label).toEqual([label]);
			expect(dimElsewhere(), label).toBe(true);
		}
		await fireEvent.click(table.querySelector('button[aria-label="Sort by Provider"]')!);
		expect(bright()).toEqual([]);
	});

	it('closes the overview on What is counted, collapsed, after the figures it qualifies', () => {
		// The operator's 2026-10-18 change: the section was the tab's FIRST card, always open,
		// headed "What is counted - and who is not"; it is now the standard section, last and
		// collapsed, as on /git and /marketplaces.
		const { container } = render(RoutstrPage, { props: { data: { snapshot: SNAPSHOT } } });
		const panel = container.querySelector('#panel-overview')!;
		const headings = [...panel.querySelectorAll('h2')].map((h) => h.textContent?.trim());
		expect(headings).toEqual([
			'Daily network revenue',
			'Successful requests per day',
			'Tokens billed per day',
			'Cumulative observed revenue',
			'What is counted'
		]);
		// MethodologySection wraps the <details> with the copy-link icon, which has to sit
		// outside the <details> to be drawn while it is closed
		const last = panel.lastElementChild!.querySelector(':scope > details') as HTMLDetailsElement;
		expect(last.id).toBe('methodology');
		expect(last.open).toBe(false);
		expect(last.querySelector(':scope > summary > h2')!.textContent).toBe('What is counted');
		// the ledger lives inside it; closed, it is still in the DOM (and the SSR HTML)
		for (const row of ['Test / staging nodes', 'Kind squatters', 'Providers in the aggregates']) {
			expect(last.textContent).toContain(row);
		}
		// it closes the tab now, so the history it explains is not "below" it any more
		expect(last.textContent).toContain('The daily history on this page is');
		expect(last.textContent).not.toMatch(/\bbelow\b/);
		expect([...panel.lastElementChild!.children].map((c) => c.tagName)).toEqual(['A', 'DETAILS', 'SPAN']);
	});

	// Since 2026-10-19 a pill is an address (/routstr/providers) and the pill bar a row of links
	// (PillBar, $lib/domain-page, whose own tests pin the shared behaviour): this pins that the
	// page is wired to them.
	describe('pills and their addresses', () => {
		const pills = (c: HTMLElement) => [...c.querySelectorAll('nav[aria-label="Routstr"] > a')] as HTMLAnchorElement[];
		const openPill = (c: HTMLElement) => c.querySelector('nav[aria-label="Routstr"] > a[aria-current]')?.id;
		const settle = () => new Promise((r) => setTimeout(r, 0));
		const MOVE = { replaceState: true, noScroll: true, keepFocus: true };
		const COUNTED: Target = { kind: 'page', pill: 'overview', section: 'methodology' };
		/** The page at one of its addresses, as the server answered it, with the router's moves. */
		const renderAt = (path: string, target?: Target) => {
			window.history.replaceState(null, '', path);
			const r = render(RoutstrPage, { props: { data: { ...{ snapshot: SNAPSHOT }, target } } });
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
			vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 2100, height: 56 } as DOMRect);
			vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
			return vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
		};
		const counted = (c: Element) => c.querySelector('#methodology') as HTMLDetailsElement;
		afterEach(() => {
			document.querySelector('nav.nav')?.remove();
			vi.restoreAllMocks();
		});

		it('offers the pills as links to their own addresses, the default one open', () => {
			const { container } = renderAt('/routstr');
			expect(pills(container).map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
			['Overview', '/routstr'],
			['Providers', '/routstr/providers'],
			['Models', '/routstr/models'],
			['Network', '/routstr/network']
			]);
			expect(openPill(container)).toBe('tab-overview');
			expect(container.querySelectorAll('[id^="panel-"]')).toHaveLength(1);
			expect(container.querySelector('#panel-overview')).not.toBeNull();
		});

		it('opens a pill at once on a click, leaves the address to the router, and follows it', async () => {
			const page = renderAt('/routstr');
			page.enter();
			await fireEvent.click(page.container.querySelector('#tab-providers')!);
			expect(page.container.querySelector('#panel-providers')).not.toBeNull();
			expect(pillRouter.routed).toEqual(['/routstr/providers']);
			expect(vi.mocked(kitReplaceState)).not.toHaveBeenCalled();
			expect(vi.mocked(goto)).not.toHaveBeenCalled();
			await page.navigate('link', '/routstr/providers', { kind: 'page', pill: 'providers' });
			expect(openPill(page.container)).toBe('tab-providers');
			expect(document.title).toBe('Nostrology - Routstr - Providers');
			await page.navigate('popstate', '/routstr', { kind: 'page', pill: 'overview' });
			expect(openPill(page.container)).toBe('tab-overview');
			expect(document.title).toBe('Nostrology - Routstr');
		});

		it('opens the pill an old #pill link names, then moves to its address', async () => {
			const page = renderAt('/routstr#providers');
			expect(page.container.querySelector('#panel-providers')).not.toBeNull();
			page.enter();
			await settle();
			expect(vi.mocked(goto)).toHaveBeenCalledWith('/routstr/providers', MOVE);
		});

		it("says why after a 302 (found) for an unknown slug, then drops the #gone", async () => {
			const page = renderAt('/routstr#gone', { kind: 'page', pill: 'overview' });
			await settle();
			expect(page.container.querySelector('[data-transient-note]')?.textContent?.trim()).toBe('That section is no longer on this page.');
			page.enter();
			await settle();
			// the router's own move, replacing the entry
			expect(vi.mocked(goto)).toHaveBeenCalledWith('/routstr', MOVE);
		});

		// What is counted's address (CLAUDE.md -> "Every domain page's What is counted has an
		// address"): /routstr/methodology must land on the OPEN section, and nothing but an
		// address may open it.
		it('lands /routstr/methodology on Overview with What is counted open, just under the nav', async () => {
			const scrollTo = geometry();
			const page = renderAt('/routstr/methodology', COUNTED);
			expect(page.container.querySelector('#panel-overview')).not.toBeNull();
			expect(counted(page.container).open).toBe(true);
			expect(document.title).toBe('Nostrology - Routstr - What is counted');
			page.enter();
			expect(scrollTo).toHaveBeenLastCalledWith({ top: 2100 - 56 - 8 });
			expect(document.activeElement).toBe(counted(page.container));
		});

		it('opens What is counted for an old #methodology link, then moves to its address', async () => {
			geometry();
			const page = renderAt('/routstr#methodology');
			expect(counted(page.container).open).toBe(true);
			page.enter();
			await settle();
			expect(vi.mocked(goto)).toHaveBeenCalledWith('/routstr/methodology', MOVE);
		});

		it('leaves What is counted closed anywhere else, and opening it by hand writes nothing', async () => {
			const scrollTo = geometry();
			const page = renderAt('/routstr');
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
			const page = renderAt('/routstr');
			page.enter();
			await page.navigate('link', '/routstr/methodology', COUNTED);
			expect(scrollTo).not.toHaveBeenCalled();
			await settle();
			expect(counted(page.container).open).toBe(true);
			expect(scrollTo).toHaveBeenLastCalledWith({ top: 2100 - 56 - 8 });
			scrollTo.mockClear();
			await page.navigate('popstate', '/routstr', { kind: 'page', pill: 'overview' });
			// never closed by a navigation: the reader may have opened it
			expect(counted(page.container).open).toBe(true);
			await page.navigate('popstate', '/routstr/methodology', COUNTED);
			await settle();
			expect(scrollTo).not.toHaveBeenCalled();
		});

		it('keeps What is counted open across a pill round trip, since the visitor opened it', async () => {
			geometry();
			const { container } = renderAt('/routstr/methodology', COUNTED);
			await fireEvent.click(container.querySelector('#tab-providers')!);
			expect(container.querySelector('#methodology')).toBeNull();
			await fireEvent.click(container.querySelector('#tab-overview')!);
			expect(counted(container).open).toBe(true);
		});

		// The link icon on the section's head (MethodologySection): a click puts the section's
		// address on the clipboard and changes nothing on the page. Its own behaviour is pinned in
		// MethodologySection.test.ts; this is that it is here, wired to this page.
		it.each([
			['/routstr', undefined],
			['/routstr/methodology', COUNTED]
		])('copies /routstr/methodology from the icon on %s, and writes nothing', async (start, target) => {
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
				expect(link.getAttribute('href')).toBe('/routstr/methodology');
				expect(await fireEvent.click(link)).toBe(false);
				await settle();
				expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/routstr/methodology`);
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

	it('never adds Routstr to the shared nav (it is /wip-linked only)', async () => {
		// The page itself must not smuggle a nav entry in; the SiteNav guardrail test
		// pins the global list, this pins the page's own markup: its one nav is its pill bar,
		// linking only to its own pills.
		const { container } = render(RoutstrPage, { props: { data: { snapshot: SNAPSHOT } } });
		const navs = [...container.querySelectorAll('nav')];
		expect(navs.map((n) => n.getAttribute('aria-label'))).toEqual(['Routstr']);
		for (const a of navs[0].querySelectorAll('a')) expect(a.getAttribute('href')).toMatch(/^\/routstr(\/[a-z-]+)?$/);
	});
});
