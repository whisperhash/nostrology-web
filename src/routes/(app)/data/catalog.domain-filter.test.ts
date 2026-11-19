import { render } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';

import IndexPage from './+page.svelte';
import { metricCardsOf, referenceCardsOf } from '$lib/server/mcpRegistry';
import { ENDPOINT, RECORDS, REGISTRY } from './registry-fixture';

// Every page renders <SocialMeta>, which reads $page for the request's own origin and
// path. Rendering a page component in isolation gives it no router, so the store has to
// be supplied here - same pattern as SiteNav.test.ts.
vi.mock('$app/stores', () => ({
	page: readable({ url: new URL('https://site.test/') })
}));

/**
 * The catalog used to render every domain unrolled, one section after another -
 * fine at one domain, unreadable by the fourth. The pills are now the filter:
 * one chip per domain, the selected one filled, and ONLY that domain's
 * endpoints below it.
 *
 * These are render assertions. That the loader picks the right domain (the lead
 * one at /data, the path segment at /data/<domain>) is asserted against the
 * loaders in catalog.loaders.test.ts - a template test would pass against a
 * loader that always answered "zapstore".
 */
const CARDS = metricCardsOf(REGISTRY.metrics);
const REFERENCE = referenceCardsOf(RECORDS);

function pageData(selectedDomain: string) {
	return {
		session: null, analyticsOff: false,
		registry: {
			server: REGISTRY.server,
			tool: REGISTRY.tool,
			tools: REGISTRY.tools
		},
		endpoint: ENDPOINT,
		domains: ['zapstore', 'nutzaps', 'relays'],
		selectedDomain,
		metricCards: CARDS,
		referenceCards: REFERENCE
	};
}

/** The pills: the domain links in the filter row. Matched by their exact hrefs
 * rather than a `/data/` prefix, which would also catch every metric card. */
function pills(container: HTMLElement): HTMLAnchorElement[] {
	return [
		...container.querySelectorAll<HTMLAnchorElement>(
			'[aria-label="Filter the catalog by domain"] a'
		)
	];
}

describe('/data catalog domain filter', () => {
	it('renders one pill per domain, as absolute links to the domain address', () => {
		// Links, not buttons: the selection has to survive a reload and a share,
		// and be crawlable without running scripts. ABSOLUTE, and a path rather
		// than a query: the old `?domain=` href was query-only and therefore
		// relative, which is how /?domain=zapstore - a URL nothing links to - ended
		// up being requested by clients that resolved it against the site root.
		const { container } = render(IndexPage, { data: pageData('zapstore') });
		expect(pills(container).map((a) => a.getAttribute('href'))).toEqual([
			'/data/zapstore',
			'/data/nutzaps',
			'/data/relays'
		]);
	});

	it('keeps a pill click from jumping the page to the top', () => {
		// The whole interaction: clicking a pill on an already-open page selects it
		// in place. SvelteKit restores scroll on navigation unless told otherwise,
		// which would yank the reader back to the banner every time they changed
		// domain - a navigation artifact in what reads as a filter.
		const { container } = render(IndexPage, { data: pageData('zapstore') });
		for (const pill of pills(container)) {
			expect(pill.hasAttribute('data-sveltekit-noscroll')).toBe(true);
		}
	});

	it('marks only the selected pill, and keeps both the same shape', () => {
		const { container } = render(IndexPage, { data: pageData('nutzaps') });
		const [zapstore, nutzaps] = pills(container);
		// "true", not "page": every pill's href navigates somewhere, and on /data
		// the SELECTED pill's href is a different URL from the one being viewed, so
		// announcing it as the current page is simply false. These are the current
		// item in a set of filters, which is what aria-current="true" means.
		expect(nutzaps.getAttribute('aria-current')).toBe('true');
		expect(zapstore.getAttribute('aria-current')).toBeNull();
		// Colour is the ONLY difference: same pill geometry on both, so the row
		// reads as one set of chips rather than a selected thing and some links.
		expect(nutzaps.className).toContain('bg-teal-500/20');
		expect(zapstore.className).not.toContain('bg-teal-500/20');
		for (const pill of [zapstore, nutzaps]) {
			expect(pill.className).toContain('rounded-full');
			expect(pill.className).toContain('px-4 py-1.5');
			expect(pill.className).toContain('text-lg');
		}
	});

	it('shows only the selected domain\'s endpoints', () => {
		const zapstoreView = render(IndexPage, { data: pageData('zapstore') }).container;
		expect(zapstoreView.querySelector('a[href="/data/zapstore/app_zaps"]')).not.toBeNull();
		expect(zapstoreView.querySelector('a[href="/data/nutzaps/active_users"]')).toBeNull();

		const nutzapsView = render(IndexPage, { data: pageData('nutzaps') }).container;
		expect(nutzapsView.querySelector('a[href="/data/nutzaps/active_users"]')).not.toBeNull();
		expect(nutzapsView.querySelector('a[href="/data/zapstore/app_zaps"]')).toBeNull();
	});

	it('links each domain address exactly once - the pill IS that link', () => {
		// The page used to carry a second link to the selected domain's own page (a
		// footnote reading "the same list on its own URL"), which existed only
		// because the pills pointed at `?domain=` instead. Asserting the deleted
		// STRING is absent would pass for any implementation, including one with no
		// pills at all; the invariant worth pinning is that there is exactly one
		// route to each domain address.
		const { container } = render(IndexPage, { data: pageData('nutzaps') });
		for (const domain of ['zapstore', 'nutzaps', 'relays']) {
			expect(container.querySelectorAll(`a[href="/data/${domain}"]`)).toHaveLength(1);
		}
	});

	it('renders the reference-data grid, labelled by snapshot vs listing', () => {
		// The records grid moved here from the deleted domain page and had never
		// been rendered by any test - every fixture passed `reference: []`.
		const { container, getByText } = render(IndexPage, { data: pageData('zapstore') });
		const link = container.querySelector('a[href="/data/zapstore/app_catalog"]');
		expect(link).not.toBeNull();
		expect(getByText('reference - current state')).not.toBeNull();

		// The other record has no snapshot_note, so it reads as an event listing.
		const relays = render(IndexPage, { data: pageData('relays') });
		expect(relays.container.querySelector('a[href="/data/relays/relay_profile"]')).not.toBeNull();
		expect(relays.getByText('reference - event listing')).not.toBeNull();
	});

	it('names the selected domain in the grid headings, not only in a pill', () => {
		// /data/nutzaps renders the site-wide <h1>, so without these the domain
		// appears in the BODY only as the text of one chip - thin for a page whose
		// job is to be read by crawlers and agents.
		const zapstore = render(IndexPage, { data: pageData('zapstore') });
		expect(zapstore.getByText(/zapstore metrics/i)).not.toBeNull();
		expect(zapstore.getByText(/zapstore reference data/i)).not.toBeNull();
	});

	it('shows the honest outage banner when the registry is unreachable', () => {
		// The whole design premise: a bad registry renders an explicit outage, never
		// a stale copy and never a 500. The loader answers `registry: null`; this is
		// the half that asserts the template picks that branch - and that the
		// connect instructions, which stay valid, survive it.
		const { getByText, container } = render(IndexPage, {
			data: {
				...pageData('zapstore'),
				registry: null,
				domains: [],
				selectedDomain: null,
				metricCards: [],
				referenceCards: []
			}
		});
		expect(getByText(/metric registry is temporarily unavailable/i)).not.toBeNull();
		expect(container.querySelector('code')?.textContent).toContain(ENDPOINT);
	});

	it('prices the paid metric on its card', () => {
		const { getByText } = render(IndexPage, { data: pageData('nutzaps') });
		expect(getByText(/21 sats\/call \(Cashu\)/)).not.toBeNull();
	});
});

describe('/data catalog - the MIXED nutzaps domain (2026-09-30)', () => {
	/** The nutzaps grid's cards: href -> whether the card carries a price clause. */
	function nutzapsCards(container: HTMLElement): Record<string, boolean> {
		return Object.fromEntries(
			[...container.querySelectorAll<HTMLAnchorElement>('a[href^="/data/nutzaps/"]')].map((a) => [
				a.getAttribute('href') ?? '',
				/sats\/call/.test(a.textContent ?? '')
			])
		);
	}

	it('renders the free metrics beside the paid one, pricing only the paid card', () => {
		const { container } = render(IndexPage, { data: pageData('nutzaps') });
		expect(nutzapsCards(container)).toEqual({
			'/data/nutzaps/active_users': true,
			'/data/nutzaps/mint_active_users': false,
			'/data/nutzaps/mint_activity': false,
			'/data/nutzaps/mint_leaderboard': false,
			'/data/nutzaps/payment_activity': false
		});
	});

	it('labels both active-user cards with three grains, the price on the paid one only', () => {
		// The free per-mint metric serves day, week and month since the evening of
		// 2026-09-30; the paid card differs by its price, not its grains.
		const { container } = render(IndexPage, { data: pageData('nutzaps') });
		const label = (href: string) =>
			(container.querySelector(`a[href="${href}"] span.text-sm`)?.textContent ?? '')
				.replace(/\s+/g, ' ')
				.trim();
		expect(label('/data/nutzaps/mint_active_users')).toBe('users / month, day, week - sparse');
		expect(label('/data/nutzaps/active_users')).toBe(
			'users / month, day, week - sparse - 21 sats/call (Cashu)'
		);
	});

	it('says the nutzaps payment and mint metrics are free and only active_users is paid', () => {
		// The catalog paragraph used to say the paid tool "serves the nutzaps
		// metrics" - true while active_users was the domain's only metric, false
		// the moment the free ones land beside it.
		const { container } = render(IndexPage, { data: pageData('zapstore') });
		const intro = [...container.querySelectorAll('p')]
			.map((p) => (p.textContent ?? '').replace(/\s+/g, ' '))
			.find((t) => t.startsWith('Three tools.'));
		expect(intro).toBeDefined();
		expect(intro).not.toMatch(/serves the nutzaps metrics/);
		expect(intro).toMatch(
			/nostrology_query_metric serves the free quantitative metrics - including the nutzaps payment and mint metrics/
		);
		expect(intro).toMatch(
			/nostrology_query_nutzaps serves the one paid metric, network-wide nutzaps active users \(active_users\), paid per call in Cashu ecash/
		);
		expect(intro).toContain('kind-9321 (nutzaps)');
	});
});
