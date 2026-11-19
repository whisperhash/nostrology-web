import { render } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';

import MetricPage from './[domain]/[metric]/+page.svelte';
import {
	ENDPOINT,
	METRICS,
	MINT_URL_NOTE,
	NUTZAPS_FREE_METRICS,
	PAID_METRIC,
	PAID_METRICS
} from './registry-fixture';

// Every page renders <SocialMeta>, which reads $page for the request's own origin and
// path. Rendering a page component in isolation gives it no router, so the store has to
// be supplied here - same pattern as SiteNav.test.ts.
vi.mock('$app/stores', () => ({
	page: readable({ url: new URL('https://site.test/') })
}));

/**
 * The per-metric page is the indexable unit of the registry - the URL a search
 * lands on. For a PAID metric it therefore has to state the price there, not
 * only on the /data card that links to it, and its example call has to name the
 * tool that actually serves the metric and carry the credential argument. All
 * three were wrong or missing when the paid tool first shipped.
 */
/**
 * Three grains, because the real metric has three. A single-grain fixture sent
 * every test down the `{:else}` branch, so the multi-grain sentence - the whole
 * point of the fix that shipped with it - was rendered by no test at all.
 */
function paidData() {
	return {
		session: null, analyticsOff: false,
		kind: 'metric' as const,
		metric: PAID_METRIC,
		record: null,
		grainEntries: PAID_METRICS.map((m) => ({ grain: m.grain, columns: [] })),
		tool: 'nostrology_query_nutzaps',
		priceSats: 21,
		endpoint: ENDPOINT
	};
}

function freeData() {
	return {
		session: null, analyticsOff: false,
		kind: 'metric' as const,
		metric: METRICS[2], // zap_count, single grain, free
		record: null,
		grainEntries: [{ grain: 'day', columns: [] }],
		tool: 'nostrology_query_metric',
		priceSats: null,
		endpoint: ENDPOINT
	};
}

describe('/data/[domain]/[metric] - a paid metric', () => {
	it('states the price where someone deciding to call it is looking', () => {
		const { getByText } = render(MetricPage, { data: paidData() });
		expect(getByText(/21 sats per call/)).not.toBeNull();
	});

	it('names the paying argument and that asking the price is free', () => {
		const { container } = render(MetricPage, { data: paidData() });
		const text = container.textContent ?? '';
		expect(text).toContain('cashu_token');
		expect(text).toMatch(/without one costs nothing/i);
	});

	it('states the price as a fact, not as a warning', () => {
		// Amber is this site's warning colour. A price dressed as a hazard reads as
		// a reason to leave, so this block wears the same gray card and teal accent
		// as the facts above it.
		const { container } = render(MetricPage, { data: paidData() });
		const block = [...container.querySelectorAll('div')].find((d) =>
			(d.textContent ?? '').startsWith('price')
		);
		expect(block).toBeDefined();
		expect(block?.className).toContain('bg-gray-800');
		expect(block?.className).not.toMatch(/amber/);
	});

	it('puts the price under the facts grid, not above it', () => {
		// Reading order: what the metric IS (unit, grain, series, key), then what
		// it costs. Asserted on document order so a refactor cannot quietly float
		// it back to the top.
		const { container } = render(MetricPage, { data: paidData() });
		const text = container.textContent ?? '';
		expect(text.indexOf('sats per call')).toBeGreaterThan(text.indexOf('nutzaps.active_users@month'));
	});

	it('puts the credential in the example call, under the paid tool', () => {
		// A copy-pasteable example that omits the token, or names the free
		// metrics tool, is a call that cannot succeed.
		const { container } = render(MetricPage, { data: paidData() });
		const examples = [...container.querySelectorAll('pre')].map((p) => p.textContent ?? '');
		expect(examples.length).toBeGreaterThan(0);
		for (const example of examples) {
			expect(example).toContain('"name": "nostrology_query_nutzaps"');
			expect(example).toContain('"cashu_token"');
		}
	});

	it('promises the grain you request, not the default one', () => {
		// The page renders the DEFAULT grain's registry entry, so on a
		// three-grain metric a sentence built from that entry told every reader
		// they would get month data no matter which grain they asked for.
		const { container } = render(MetricPage, { data: paidData() });
		const text = container.textContent ?? '';
		expect(text).toContain('the grain you request');
		expect(text).not.toMatch(/at month grain/);
	});

	it('still names the single grain when a metric has only one', () => {
		// The other branch, so the fix above cannot be satisfied by vagueness
		// everywhere: a one-grain metric should say which grain that is.
		const single = { ...paidData(), grainEntries: [{ grain: 'month', columns: [] }] };
		const { container } = render(MetricPage, { data: single });
		expect(container.textContent ?? '').toContain('at month grain');
	});
});

describe('/data/[domain]/[metric] - a free metric', () => {
	it('says nothing about payment', () => {
		const { container } = render(MetricPage, { data: freeData() });
		const text = container.textContent ?? '';
		expect(text).not.toContain('cashu_token');
		expect(text).not.toMatch(/sats per call/);
	});
});

/**
 * The nutzaps domain is MIXED since 2026-09-30: its payment and mint metrics are free on
 * nostrology_query_metric, beside the paid active_users. The page decides paid-ness per
 * ENTRY (the loader's `tool` and `priceSats`), so a free nutzaps metric must read exactly
 * like any other free metric - its example calls naming the metrics tool WITH the domain,
 * and nothing about a token or a price.
 */
function freeNutzapsData() {
	// mint_active_users: the free per-mint active users, served at day, week and month
	// (month the default; day and week since the evening of 2026-09-30). The fixture
	// is generated from the real registry, so this renders the served texts.
	const entries = NUTZAPS_FREE_METRICS.filter((m) => m.metric === 'mint_active_users');
	return {
		session: null, analyticsOff: false,
		kind: 'metric' as const,
		metric: entries.find((m) => m.grain === 'month')!,
		record: null,
		grainEntries: entries.map((m) => ({ grain: m.grain, columns: m.columns.map((c) => c.name) })),
		tool: 'nostrology_query_metric',
		priceSats: null,
		endpoint: ENDPOINT
	};
}

describe('/data/[domain]/[metric] - a FREE metric in the mixed nutzaps domain', () => {
	it('shows example calls on the metrics tool, scoped by domain, with no token', () => {
		const { container } = render(MetricPage, { data: freeNutzapsData() });
		const examples = [...container.querySelectorAll('pre')].map((p) => p.textContent ?? '');
		// Both the plain and the windowed call: the metric accepts from/to.
		expect(examples).toHaveLength(2);
		for (const example of examples) {
			const call = JSON.parse(example);
			expect(call.name).toBe('nostrology_query_metric');
			expect(call.arguments).toMatchObject({
				metric: 'mint_active_users',
				domain: 'nutzaps',
				grain: 'month'
			});
			expect(call.arguments).not.toHaveProperty('cashu_token');
		}
	});

	it('carries none of the paid page\'s payment furniture', () => {
		// Asserted on the page's OWN paid-only elements, not on every word: the served
		// caveats may rightly name the paid tool (the network-wide count lives there),
		// and that mention is documentation, not a price.
		const { container } = render(MetricPage, { data: freeNutzapsData() });
		const text = container.textContent ?? '';
		expect(text).not.toMatch(/sats per call/);
		expect(text).not.toMatch(/paid in Cashu ecash/);
		expect(text).not.toMatch(/A paid response adds one line/);
		for (const example of container.querySelectorAll('pre')) {
			expect(example.textContent ?? '').not.toContain('cashu_token');
		}
	});

	it('documents the mint_url entity filter in the parameters table', () => {
		const { container } = render(MetricPage, { data: freeNutzapsData() });
		const rows = [...container.querySelectorAll('tbody tr')].map((tr) =>
			[...tr.querySelectorAll('td')].map((td) => (td.textContent ?? '').replace(/\s+/g, ' ').trim())
		);
		expect(rows).toContainEqual(['mint_url', MINT_URL_NOTE]);
	});

	it('offers day, week and month - month the default - and promises the grain you request', () => {
		const { container } = render(MetricPage, { data: freeNutzapsData() });
		const grainRow = [...container.querySelectorAll('tbody tr')].find(
			(tr) => tr.querySelector('td')?.textContent === 'grain'
		);
		// The values cell: a row's textContent runs its cells together.
		const text = (grainRow?.querySelectorAll('td')[1]?.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toMatch(/^day \| week \| month - default month/);
		// Three grains -> the page promises the grain asked for, never "at month
		// grain", and lists the columns per grain.
		const page = container.textContent ?? '';
		expect(page).toContain('the grain you request');
		expect(page).not.toMatch(/at month grain/);
		expect(page).toContain('Columns per grain');
	});
});
