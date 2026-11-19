// /data - the human- and crawler-facing registry hub, at its unscoped address.
// Renders the SAME component as /data/<domain> (see CatalogPage.svelte); the
// only difference is which domain arrives selected - the lead one here.
//
// DB-FREE by contract: data comes only from the MCP container's registry.json
// (see mcpRegistry.ts). Never import $lib/db/postgres here - robots.txt ALLOWS
// this subtree and the Caddy /data handle bypasses the bot deny-list, so a DB
// touch on these routes would put unmetered crawler traffic straight onto
// Aurora. (The rule predates the cluster's 0.5-ACU warm floor, when the first
// such hit also paid a ~15 s resume; the floor removed the stall, not the
// reason.)
import { env } from '$env/dynamic/public';
import { resolveEndpoint } from '$lib/mcp/endpoint';
import { catalogPayload, domainsOf, fetchRegistry } from '$lib/server/mcpRegistry';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const registry = await fetchRegistry();
	const endpoint = resolveEndpoint(env.PUBLIC_MCP_ENDPOINT);
	// The lead domain, and nothing else: selecting a domain is now expressed by
	// the PATH (/data/<domain>), not by a query parameter on this address.
	//
	// The former `?domain=` read was deleted rather than redirected, as a
	// deliberate call not to take on a compatibility obligation: a stale link
	// still LANDS here, on the catalog, with the parameter ignored, and
	// SocialMeta's canonical drops the query - so the cost of dropping it is that
	// such a link opens on the lead domain instead of the one it named. Note this
	// is a judgement, not a measurement: `?domain=` was the only linked selection
	// form for the feature's whole life, so the fact that crawlers walked path
	// URLs says nothing about whether they would have walked query ones.
	const selectedDomain = registry ? (domainsOf(registry)[0] ?? null) : null;
	return catalogPayload(registry, endpoint, selectedDomain);
};
