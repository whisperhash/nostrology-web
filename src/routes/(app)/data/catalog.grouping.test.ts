import { render } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';

import IndexPage from './+page.svelte';
import DomainPage from './[domain]/+page.svelte';
import { metricCardsOf, referenceCardsOf } from '$lib/server/mcpRegistry';
import {
	ENDPOINT,
	METRICS,
	NUTZAPS_FREE_METRICS,
	PAID_METRICS,
	RECORDS,
	REGISTRY
} from './registry-fixture';

// Every page renders <SocialMeta>, which reads $page for the request's own origin and
// path. Rendering a page component in isolation gives it no router, so the store has to
// be supplied here - same pattern as SiteNav.test.ts.
vi.mock('$app/stores', () => ({
	page: readable({ url: new URL('https://site.test/') })
}));

/**
 * The rendered half of the app_zaps fix: given grouped cards, each grid must
 * render ONE card per metric and label it with every grain. The grouping itself
 * - the half that actually killed the duplicate - is asserted against the
 * loaders in catalog.loaders.test.ts; these tests would pass against a buggy
 * loader, and are here to stop a template from re-expanding the cards or
 * quietly dropping the extra grain from the label.
 */
const CARDS = metricCardsOf([...METRICS, ...PAID_METRICS]);

function hrefs(container: HTMLElement, selector: string): string[] {
	return [...container.querySelectorAll(selector)].map((a) => a.getAttribute('href') ?? '');
}

const indexData = {
	session: null, analyticsOff: false,
	registry: {
		server: REGISTRY.server,
		tool: REGISTRY.tool,
		tools: REGISTRY.tools
	},
	endpoint: ENDPOINT,
	domains: ['zapstore', 'nutzaps', 'relays'],
	// The catalog renders the SELECTED domain only; these grid assertions are
	// about zapstore, so that is what is selected.
	selectedDomain: 'zapstore',
	metricCards: CARDS,
	referenceCards: referenceCardsOf(RECORDS)
};

describe('/data catalog grid', () => {
	const data = indexData;

	it('renders ONE app_zaps card, not one per grain', () => {
		const { container } = render(IndexPage, { data });
		const links = hrefs(container, 'a[href^="/data/zapstore/"]');
		expect(links.filter((h) => h === '/data/zapstore/app_zaps')).toHaveLength(1);
	});

	it('lists both grains on that one card', () => {
		const { getByText } = render(IndexPage, { data });
		expect(getByText('zaps+msats / day, total')).not.toBeNull();
	});

	it('still labels a single-grain metric with its row shape', () => {
		const { getByText } = render(IndexPage, { data });
		expect(getByText('zaps / day - dense')).not.toBeNull();
	});
});

describe('/data/<domain> page', () => {
	// The grid assertions above are NOT repeated here. Both routes render the same
	// CatalogPage from the same object, so a domain-address copy of them could not
	// fail independently - it would only double the cost of every future change to
	// the grid. What IS worth pinning at this layer is the two things the domain
	// route does on its own: the shared body, and its own social-card copy.

	it('renders a body identical to /data at the lead domain', () => {
		// The contract that makes the domain address the index rather than a second,
		// thinner page. This is the only test that catches the two +page.svelte
		// files drifting apart - everything else asserts one or the other.
		const index = render(IndexPage, { data: indexData }).container.innerHTML;
		const scoped = render(DomainPage, { data: indexData }).container.innerHTML;
		expect(scoped).toBe(index);
	});

	// <head> is shared across renders and only cleaned between TESTS, so each of
	// these renders exactly once. Two renders in one `it` would have the first
	// one's <meta> answer every query - a green test asserting the wrong page.
	const metaDescription = () =>
		document.head.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
	const canonical = () =>
		document.head.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '';

	it('lists only the addressed domain\'s names in the card copy', () => {
		// The description is what a crawler and an unfurl actually read, and it is
		// built from a FILTERED list - the failure it guards is naming every
		// domain's metrics on every domain's page, or naming none and shipping a
		// dangling ": . Free, no auth."
		render(DomainPage, { data: { ...indexData, selectedDomain: 'nutzaps' } });
		expect(metaDescription()).toContain('active_users');
		expect(metaDescription()).not.toContain('app_zaps');
		expect(metaDescription()).not.toContain(': .');
	});

	it('names reference records in the card copy alongside the metrics', () => {
		// Both grids are on the page, so both belong in the copy; before the
		// records grid moved here the domain page built this list from its own
		// `records` array, and it would be easy to drop half of it in the move.
		render(DomainPage, { data: indexData });
		expect(metaDescription()).toContain('app_catalog');
		expect(metaDescription()).toContain('zap_count');
	});

	it('names each metric once in the meta description', () => {
		// Built from the same list the grid iterates, so per-entry cards named
		// app_zaps twice in the <meta> a crawler reads.
		render(DomainPage, { data: indexData });
		expect(metaDescription().match(/app_zaps/g) ?? []).toHaveLength(1);
	});

	it('defers the LEAD domain to /data as canonical', () => {
		// /data and /data/<lead> render byte-identical bodies (asserted above), so
		// without this they compete as two indexable URLs for one page on a subtree
		// that exists to be indexed. /data is the hub everything links to - the nav,
		// McpDerivableNote, every metric breadcrumb - so it wins.
		render(DomainPage, { data: indexData });
		expect(canonical()).toMatch(/\/data$/);
	});

	it('keeps its own canonical for every OTHER domain', () => {
		// nutzaps has no twin: /data never shows it, so this address is the only URL
		// serving that catalog and must not hand its ranking to /data.
		render(DomainPage, { data: { ...indexData, selectedDomain: 'nutzaps' } });
		expect(canonical()).toMatch(/\/data\/nutzaps$/);
	});

	// The nutzaps domain is MIXED since 2026-09-30 (free payment and mint metrics
	// beside the paid active_users), so "Free, no auth" is only true per metric.
	const mixedData = {
		...indexData,
		selectedDomain: 'nutzaps',
		metricCards: metricCardsOf([...METRICS, ...PAID_METRICS, ...NUTZAPS_FREE_METRICS])
	};
	const ogDescription = () =>
		document.head.querySelector('meta[property="og:description"]')?.getAttribute('content') ?? '';

	it('names the paid metric and its price in a mixed domain\'s card copy', () => {
		render(DomainPage, { data: mixedData });
		expect(metaDescription()).toContain('payment_activity');
		expect(metaDescription()).toMatch(/Free, no auth, except active_users at 21 sats\/call \(Cashu\)\.$/);
		expect(ogDescription()).toMatch(/Free, no auth, except active_users at 21 sats\/call \(Cashu\)\.$/);
	});

	it('keeps an all-free domain\'s card copy exactly as it was', () => {
		render(DomainPage, { data: { ...mixedData, selectedDomain: 'zapstore' } });
		expect(metaDescription()).toMatch(/\. Free, no auth\.$/);
		expect(metaDescription()).not.toContain('except');
	});
});
