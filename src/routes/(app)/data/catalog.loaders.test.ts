import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Neither $env module is populated under vitest - stub both before importing the
// loaders. The private one is what fetchRegistry reads to decide whether the MCP
// container is configured at all.
vi.mock('$env/dynamic/private', () => ({
	env: { NOSTROLOGY_MCP_REGISTRY_URL: 'http://nostrology-mcp:8080/registry.json' }
}));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_MCP_ENDPOINT: 'https://example.test/mcp' } }));

import { load as loadIndex } from './+page.server';
import { load as loadDomain } from './[domain]/+page.server';
import { load as loadMetric } from './[domain]/[metric]/+page.server';
import { METRICS, RECORDS, REGISTRY } from './registry-fixture';
// SvelteKit types a loader's return as `... & Record<string, any>`, so the cards
// arrive untyped; name the element type where they are read.
import type { RegistryMetricCard, RegistryReferenceCard } from '$lib/shared/metricCard';

/**
 * The GROUPING lives in the loaders, so this is where the app_zaps duplicate is
 * actually killed - a page-render test cannot see it, because a fixture handed
 * pre-grouped cards would pass against the buggy loader too.
 *
 * `app_zaps` registers @day AND @total; the fixture's three registry entries
 * must reach the grids as TWO cards.
 */
function stubRegistryFetch(payload: unknown, ok = true) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({ ok, json: async () => payload }))
	);
}

// Two casts, both narrowing noise rather than behavior: `load` is handed a bag
// of SvelteKit properties these loaders never touch beyond `params`, and its
// declared return admits `void` (SvelteKit allows a loader to return nothing),
// which neither of these does.
type Loaded<T> = Exclude<Awaited<T>, void>;

function indexData() {
	// No URL argument: /data no longer reads anything off the query string. The
	// domain selection moved into the path (/data/<domain>, loadDomain below).
	return loadIndex({} as Parameters<typeof loadIndex>[0]) as Promise<
		Loaded<ReturnType<typeof loadIndex>>
	>;
}

function metricData(domain: string, metric: string) {
	return loadMetric({ params: { domain, metric } } as Parameters<typeof loadMetric>[0]) as Promise<
		Loaded<ReturnType<typeof loadMetric>>
	>;
}

function domainData(domain: string) {
	return loadDomain({ params: { domain } } as Parameters<typeof loadDomain>[0]) as Promise<
		Loaded<ReturnType<typeof loadDomain>>
	>;
}

beforeEach(() => {
	stubRegistryFetch(REGISTRY);
});
afterEach(() => {
	vi.unstubAllGlobals();
});

describe('/data loader', () => {
	it('groups the registry entries into one card per metric', async () => {
		const data = await indexData();
		const zapstore = data.metricCards.filter((c: RegistryMetricCard) => c.domain === 'zapstore');
		expect(zapstore.map((c: RegistryMetricCard) => c.metric)).toEqual(['app_zaps', 'zap_count']);
		expect(zapstore[0].grains).toEqual(['day', 'total']);
	});

	it('stops shipping the raw metric entries to the client', async () => {
		// The page renders `metricCards` now; the full payload (methodology,
		// caveats, column contracts per metric) has no reader left, and this is a
		// crawler-facing page whose SSR data is served on every hit.
		const data = await indexData();
		expect(data.registry).not.toBeNull();
		expect(data.registry).not.toHaveProperty('metrics');
		// What the page DOES read is still there.
		expect(data.registry?.tool).toBe(REGISTRY.tool);
		// ... and the server identity (name/version/git_sha) is NOT: it would ship
		// the running build in the SSR payload of a public page.
		expect(data.registry).not.toHaveProperty('server');
	});

	it('reports an unreachable registry as null rather than throwing', async () => {
		// /data must render its honest "registry unavailable" banner, never a 500:
		// the falsy `registry` is what selects that branch.
		stubRegistryFetch(null, false);
		const data = await indexData();
		expect(data.registry).toBeNull();
		expect(data.metricCards).toEqual([]);
		expect(data.domains).toEqual([]);
	});

	it('survives a registry whose entries carry no params block', async () => {
		// A v1 payload from an older MCP container mid-rollout. Grouping must not
		// throw - a TypeError inside load() is a 500 on the public page.
		stubRegistryFetch({ ...REGISTRY, metrics: METRICS.map((m) => ({ ...m, params: undefined })) });
		const data = await indexData();
		expect(data.metricCards.map((c: RegistryMetricCard) => c.metric)).toEqual(['app_zaps', 'zap_count']);
	});

	it('opens on zapstore, then routstr and nutzaps, not alphabetically', async () => {
		// nutzaps sorts first; opening there would bury zapstore, the bulk of the
		// catalog. DOMAIN_ORDER states the order the free domains joined the metrics
		// tool - Routstr (2026-08-29), then Nutzaps (2026-09-30); everything else
		// follows alphabetically - `relays` included, which reaches the list through
		// its RECORD alone.
		const data = await indexData();
		expect(data.domains).toEqual(['zapstore', 'routstr', 'nutzaps', 'relays']);
		expect(data.selectedDomain).toBe('zapstore');
	});

	it('narrows the reference records to cards, dropping their prose', async () => {
		// Same reason as metricCards: this page is served to crawlers on every hit,
		// uncompressed, and a RegistryRecord carries methodology, caveats, params
		// and per-column descriptions that no grid on it reads.
		const data = await indexData();
		expect(data.referenceCards.map((c: RegistryReferenceCard) => c.record)).toEqual(RECORDS.map((r) => r.record));
		expect(data.referenceCards[0]).not.toHaveProperty('columns');
		expect(data.referenceCards[0]).not.toHaveProperty('methodology');
		expect(data.referenceCards[0].snapshotNote).toBe('current catalog entry');
		// A record with no snapshot_note must coalesce, not carry `undefined` - the
		// grid switches its label on this value.
		expect(data.referenceCards[1].snapshotNote).toBeNull();
		// And the raw list must not ride along beside the cards.
		expect(data.registry).not.toHaveProperty('reference');
	});

	it('reports a registry whose reference is malformed as unusable', async () => {
		// domainsOf and referenceCardsOf both .map() over it, so a non-array would
		// throw inside load() - a 500 on a public page, which this module's whole
		// design forbids. It has to degrade to the outage banner instead.
		stubRegistryFetch({ ...REGISTRY, reference: { nope: true } });
		const data = await indexData();
		expect(data.registry).toBeNull();
		expect(data.referenceCards).toEqual([]);
	});

	it('keeps every domain\'s cards in the payload, not just the selected one', async () => {
		// The pills filter in the template. Narrowing here instead would make the
		// SSR payload depend on the address in a way the grids do not expect, and
		// the two routes would stop returning the same shape.
		const data = await indexData();
		expect(data.metricCards.some((c: RegistryMetricCard) => c.domain === 'nutzaps')).toBe(true);
	});

	it('ignores a stale ?domain= rather than honouring it', async () => {
		// `?domain=` was deleted outright, not redirected: the access logs showed
		// no legitimate inbound traffic on it (every real crawler walked the path
		// form), and a compatibility shim is cruft. What a stale link must still do
		// is LAND - on the catalog, with the parameter ignored, never a 404. Hand
		// the loader a URL carrying the old parameter and assert it changes nothing.
		const data = (await loadIndex({
			url: new URL('https://example.test/data?domain=nutzaps')
		} as Parameters<typeof loadIndex>[0])) as Loaded<ReturnType<typeof loadIndex>>;
		expect(data.selectedDomain).toBe('zapstore');
	});

	it('carries the price through to the card of a paid metric', async () => {
		const data = await indexData();
		// Found by NAME: the nutzaps domain also holds free metrics now, so "the
		// nutzaps card" no longer names one card.
		const paid = data.metricCards.find(
			(c: RegistryMetricCard) => c.domain === 'nutzaps' && c.metric === 'active_users'
		);
		expect(paid?.priceSats).toBe(21);
		expect(
			data.metricCards.find((c: RegistryMetricCard) => c.metric === 'zap_count')?.priceSats
		).toBeNull();
	});

	it('survives a params block with no grain object', async () => {
		stubRegistryFetch({
			...REGISTRY,
			metrics: METRICS.map((m) => ({ ...m, params: { format: ['csv'] } }))
		});
		const data = await indexData();
		expect(data.metricCards).toHaveLength(2);
	});
});

describe('/data/[domain] loader', () => {
	it('returns the SAME payload as /data, differing only in the selection', async () => {
		// The two addresses render one component (CatalogPage.svelte), so a shape
		// that drifts between them is a runtime error on one address and not the
		// other. Compared field by field against the index's own payload rather
		// than restated, which is what makes this test notice a new field added on
		// one side only.
		const index = await indexData();
		const scoped = await domainData('nutzaps');
		expect(Object.keys(scoped).sort()).toEqual(Object.keys(index).sort());
		expect(scoped.metricCards).toEqual(index.metricCards);
		expect(scoped.domains).toEqual(index.domains);
		expect(index.selectedDomain).toBe('zapstore');
		expect(scoped.selectedDomain).toBe('nutzaps');
	});

	it('carries every domain\'s cards, not just the addressed one', async () => {
		// Parity with the index, which is what lets one component render both. The
		// template does the filtering; narrowing here would render the same page
		// while giving the two loaders two shapes to keep in step.
		const data = await domainData('nutzaps');
		expect(data.metricCards.some((c: RegistryMetricCard) => c.domain === 'zapstore')).toBe(true);
		expect(data.referenceCards.some((c: RegistryReferenceCard) => c.domain === 'zapstore')).toBe(true);
	});

	it('selects a NON-lead domain and carries its cards', async () => {
		// The lead domain is what /data answers anyway, so it cannot show that the
		// path segment is being read at all. routstr can.
		const data = await domainData('routstr');
		expect(data.selectedDomain).toBe('routstr');
		expect(
			data.metricCards
				.filter((c: RegistryMetricCard) => c.domain === 'routstr')
				.map((c: RegistryMetricCard) => c.metric)
		).toEqual(['provider_leaderboard']);
	});

	it('serves a REFERENCE-ONLY domain rather than 404ing it', async () => {
		// The seam the 404 rewrite crosses. `relays` has no metrics at all - it is
		// in the registry only as a record - so an emptiness test that consulted
		// metrics alone would 404 a domain the pills happily link to. domainsOf
		// unions both sets precisely to prevent that orphan.
		const data = await domainData('relays');
		expect(data.selectedDomain).toBe('relays');
		expect(data.metricCards.some((c: RegistryMetricCard) => c.domain === 'relays')).toBe(false);
		expect(data.referenceCards.map((c: RegistryReferenceCard) => c.record)).toContain('relay_profile');
	});

	it('survives a v1 payload, which carries no reference list at all', async () => {
		// An older MCP container mid-rollout: no `tools` map, no `reference` key. It
		// must still resolve a metric domain rather than throwing on `.map` of
		// undefined - a TypeError in load() is a 500 on a public page.
		stubRegistryFetch({ ...REGISTRY, tools: undefined, reference: undefined });
		const data = await domainData('zapstore');
		expect(data.selectedDomain).toBe('zapstore');
		expect(data.referenceCards).toEqual([]);
	});

	it('404s a DOMAIN_ORDER domain the registry does not actually serve', async () => {
		// routstr is in DOMAIN_ORDER, so a domainsOf that ever seeded from that
		// constant instead of intersecting it with the payload would 200 here.
		stubRegistryFetch({ ...REGISTRY, metrics: METRICS, reference: [] });
		await expect(domainData('routstr')).rejects.toMatchObject({ status: 404 });
	});

	it('404s an unknown domain', async () => {
		// A path segment names a resource, so an unknown one is missing - unlike
		// the old `?domain=` fallback, which showed the lead domain for a value it
		// did not recognize because the selection was a view, not an address.
		await expect(domainData('nope')).rejects.toMatchObject({ status: 404 });
	});

	it('503s when the registry is unreachable', async () => {
		// Deliberately NOT the index's graceful "registry unavailable" banner:
		// without the registry there is no way to tell an unknown domain from a
		// real one, so this address cannot honestly render. /data still can.
		stubRegistryFetch(null, false);
		await expect(domainData('zapstore')).rejects.toMatchObject({ status: 503 });
	});
});

describe('/data/[domain]/[metric] loader', () => {
	it('names the PAID tool and the price for a paid metric', async () => {
		// Both were previously wrong or absent on this page: the tool was read
		// off the payload-level `tool` (the free metrics tool, which does not
		// serve nutzaps at all), so the page printed a copy-pasteable example
		// call naming a tool that would reject it, and the price appeared only
		// on the card that links here.
		const data = await metricData('nutzaps', 'active_users');
		expect(data.tool).toBe('nostrology_query_nutzaps');
		expect(data.priceSats).toBe(21);
	});

	it('leaves a free metric on the metrics tool with no price', async () => {
		const data = await metricData('zapstore', 'app_zaps');
		expect(data.tool).toBe('nostrology_query_metric');
		expect(data.priceSats).toBeNull();
	});

	it('resolves the primary entry to the DEFAULT grain, not the first', async () => {
		// nutzaps registers day/week/month with month as the default.
		const data = await metricData('nutzaps', 'active_users');
		expect(data.metric?.grain).toBe('month');
	});
});

describe('/data - the MIXED nutzaps domain (free metrics beside the paid one, 2026-09-30)', () => {
	it('prices only active_users among the nutzaps cards', async () => {
		const data = await indexData();
		const nutzaps = data.metricCards.filter((c: RegistryMetricCard) => c.domain === 'nutzaps');
		expect(
			Object.fromEntries(nutzaps.map((c: RegistryMetricCard) => [c.metric, c.priceSats]))
		).toEqual({
			active_users: 21,
			mint_active_users: null,
			mint_activity: null,
			mint_leaderboard: null,
			payment_activity: null
		});
	});

	it('puts a FREE nutzaps metric on the metrics tool with no price', async () => {
		// The per-entry rule: no `tool` field -> the payload-level metrics tool. A
		// per-domain rule would hand this page the paid tool and a cashu_token.
		const data = await metricData('nutzaps', 'payment_activity');
		expect(data.tool).toBe('nostrology_query_metric');
		expect(data.priceSats).toBeNull();
		expect(data.metric?.grain).toBe('day');
		expect(data.grainEntries.map((g: { grain: string }) => g.grain)).toEqual(['day', 'total']);
	});

	it('serves mint_active_users at day, week and month, month the default - on the FREE tool', async () => {
		// Day and week were withdrawn on the 2026-09-30 review (summed over mints they
		// gave away the paid DAU/WAU) and made free by the operator that evening. The
		// page offers exactly what the registry serves: three grains, month primary,
		// the free metrics tool, no price.
		const data = await metricData('nutzaps', 'mint_active_users');
		expect(data.metric?.grain).toBe('month');
		expect(data.metric?.params?.grain).toMatchObject({ values: ['day', 'week', 'month'], default: 'month' });
		expect(data.grainEntries.map((g: { grain: string }) => g.grain)).toEqual(['day', 'month', 'week']);
		expect(data.tool).toBe('nostrology_query_metric');
		expect(data.priceSats).toBeNull();
	});

	it('carries the mint_url entity filter through to the page', async () => {
		const data = await metricData('nutzaps', 'mint_leaderboard');
		expect(Object.keys(data.metric?.params?.entity_filters ?? {})).toEqual(['mint_url']);
	});

	it('leaves the paid active_users page exactly as it was', async () => {
		const data = await metricData('nutzaps', 'active_users');
		expect(data.tool).toBe('nostrology_query_nutzaps');
		expect(data.priceSats).toBe(21);
		expect(data.metric?.params?.entity_filters).toBeUndefined();
	});
});
