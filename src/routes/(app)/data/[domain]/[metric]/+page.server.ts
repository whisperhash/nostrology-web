// /data/[domain]/[metric] - the per-metric page, the indexable unit of the
// registry (one URL per metric so a search for what the metric answers lands
// here). DB-free (see ../../+page.server.ts).
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { resolveEndpoint } from '$lib/mcp/endpoint';
import { fetchRegistry } from '$lib/server/mcpRegistry';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const registry = await fetchRegistry();
	if (!registry) throw error(503, 'metric registry temporarily unavailable');
	const endpoint = resolveEndpoint(env.PUBLIC_MCP_ENDPOINT);
	// A metric may register more than one grain (app_zaps has @day and @total -
	// one entry each). The page's primary entry is the DEFAULT grain's (what an
	// omitted `grain` resolves to); the others are surfaced alongside so no
	// grain is invisible. A bare find() here once hid @total entirely. (The
	// listing grids do the same grouping one level up - metricCardsOf.)
	const entries = registry.metrics.filter(
		(m) => m.domain === params.domain && m.metric === params.metric
	);
	if (entries.length > 0) {
		// `?.grain?.` all the way down: a malformed registry must degrade, not 500 -
		// the same rule metricCardsOf follows.
		const defaultGrain = entries[0].params?.grain?.default;
		const metric = entries.find((m) => m.grain === defaultGrain) ?? entries[0];
		return {
			kind: 'metric' as const,
			metric,
			record: null,
			grainEntries: entries.map((m) => ({
				grain: m.grain,
				columns: m.columns.map((c) => c.name)
			})),
			// PAID entries name their own tool (nutzaps.active_users is
			// served by nostrology_query_nutzaps, not the metrics tool). Reading the
			// payload-level tool unconditionally printed an example call naming a
			// tool that does not serve this metric - a copy-pasteable wrong answer.
			// Decided per ENTRY, never per domain: the free nutzaps metrics
			// (payment_activity, mint_*) carry no `tool` and land on the metrics
			// tool with `domain: "nutzaps"`, beside the paid one.
			tool: metric.tool ?? registry.tools?.metrics ?? registry.tool,
			// Price of one call, null when free. The per-metric page is the
			// indexable unit of the registry, so the price has to be legible HERE
			// and not only on the card that links to it.
			priceSats: metric.price_sats ?? null,
			endpoint
		};
	}
	// Not a metric - a reference record shares the same URL shape
	// (/data/zapstore/app_catalog), served by the second tool.
	const record = (registry.reference ?? []).find(
		(r) => r.domain === params.domain && r.record === params.metric
	);
	if (!record) throw error(404, `unknown metric '${params.domain}.${params.metric}'`);
	return {
		kind: 'record' as const,
		metric: null,
		record,
		grainEntries: [],
		tool: registry.tools?.reference ?? 'nostrology_query_reference',
		priceSats: null,
		endpoint
	};
};
