// /data/<domain> - the catalog scoped to one domain. NOT a second page: it
// returns the same payload as /data and renders the same component, differing
// only in which pill arrives selected. DB-free for the same reason (see
// ../+page.server.ts).
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { resolveEndpoint } from '$lib/mcp/endpoint';
import { catalogPayload, domainsOf, fetchRegistry } from '$lib/server/mcpRegistry';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	// 503, not the index's "unavailable" banner: without the registry there is no
	// way to tell an unknown domain from a real one, so this address cannot
	// honestly render at all. /data still can, which is why it degrades instead.
	const registry = await fetchRegistry();
	if (!registry) throw error(503, 'metric registry temporarily unavailable');
	// Behaviour-PRESERVING rewrite of the old emptiness check (no metric card and
	// no reference record for this domain): domainsOf is exactly the union of
	// those two domain sets, so the 404 set is unchanged. It is spelled this way
	// because it now reads as the same question the pills ask - "is this one of
	// the domains?" - and because unioning is what keeps a reference-only domain
	// from 404ing as an orphan.
	if (!domainsOf(registry).includes(params.domain))
		throw error(404, `unknown metric domain '${params.domain}'`);
	return catalogPayload(registry, resolveEndpoint(env.PUBLIC_MCP_ENDPOINT), params.domain);
};
