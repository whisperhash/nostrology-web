// The landing page. Until 2026-08-15 this route was a bare 307 to /relays.
//
// THE DATABASE ONLY THROUGH THE LANDING CACHE, by contract. This is the site's root, so it takes
// every crawler, scanner and link-preview fetch that arrives at the bare hostname; a query per
// request would hand every one of them an Aurora query. Until 2026-10-15 that kept this load
// DB-free outright, like /data (see (app)/data/+page.server.ts), its figures typed in by hand.
// The board it shows since then draws each surface's chart and figure from the surface pages'
// own data functions, read through $lib/server/landing: on that cache's hourly clock, one
// source at a time, never on a request. So:
//
//   - never import $lib/db/postgres here, or anything else that queries;
//   - never await the cache: `landingBoard()` returns the last good copies at once, and a
//     source that has not loaded since the server started shows its typed fallback.
//
// src/routes/landing.test.ts pins both.
//
// The endpoint URL is read from the same PUBLIC_MCP_ENDPOINT the /data page uses, so one env
// var pins every place the address is quoted.
import { env } from '$env/dynamic/public';
import { resolveEndpoint } from '$lib/mcp/endpoint';
import { landingBoard } from '$lib/server/landing';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	return {
		endpoint: resolveEndpoint(env.PUBLIC_MCP_ENDPOINT),
		// The page's OWN origin, for canonical/og/twitter. Deliberately not derived
		// from the endpoint: PUBLIC_MCP_ENDPOINT is allowed to point at a different
		// host, and the day it does, every canonical and og:image would silently
		// relocate to a host that does not serve this page. adapter-node takes this
		// from the ORIGIN env var, which the deploy compose pins to https://nostrolo.gy.
		origin: url.origin,
		board: landingBoard()
	};
};
