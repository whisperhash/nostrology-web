import type { LayoutServerLoad } from './$types';
import { getRoutstrSnapshot } from '$lib/db/postgres';
import { redirectsAway } from '$lib/server/slug-address';
import { ROUTSTR_SLUGS } from '$lib/slug-tables/routstr';

// The newest routstr_snapshot document, written daily by nostrology-data's routstr_refresh
// job. A LAYOUT load, apart from the address (+page.server.ts), so that a pill click runs
// only the page load and sends only its small answer, never this document again
// ($lib/server/slug-address). It reads the address only untracked, to fetch nothing for an
// address the page load is about to redirect.
export const load: LayoutServerLoad = async ({ url, untrack }) => {
	if (untrack(() => redirectsAway(ROUTSTR_SLUGS, url.pathname))) return {};
	return { snapshot: await getRoutstrSnapshot() };
};
