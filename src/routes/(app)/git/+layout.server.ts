import type { LayoutServerLoad } from './$types';
import { getNgitPage } from '$lib/db/postgres';
import { redirectsAway } from '$lib/server/slug-address';
import { GIT_SLUGS } from '$lib/slug-tables/git';

// The newest snapshot document, its Stars and Zaps lists from ngit_repo_stats (since
// 2026-10-18), and which of the two those lists came from.
//
// A LAYOUT load, apart from the address (+page.server.ts), so that a pill click - a move
// between this page's own addresses - runs only the page load and sends only its small
// answer, never this document again ($lib/server/slug-address). It reads the address only
// untracked, to fetch nothing for an address the page load is about to redirect.
export const load: LayoutServerLoad = async ({ url, untrack }) => {
	if (untrack(() => redirectsAway(GIT_SLUGS, url.pathname))) return {};
	return getNgitPage();
};
