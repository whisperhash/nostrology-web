import type { Reroute } from '@sveltejs/kit';
import { own, routedElsewhere, SLUG } from '$lib/slug-table';
import { SLUG_TABLES } from '$lib/slug-tables';

// Universal hooks: SvelteKit runs this file on the server AND in the browser.
//
// reroute - /<domain>/<slug> renders the domain's own page, for every domain with a slug
// table ($lib/slug-table). The address is left as it is; only the route that renders it
// changes. The page's server load then reads the slug from the address and answers it: a
// pill, a section, a former or retired slug, or a 302 (found) for a slug it does not know.
//
// Only ONE slug-shaped segment is rerouted. /git/.env, /git/a/b and /git/Zaps still match no
// route and answer 404 (not found), as they always did. A word that belongs to a route of its
// own is left to that route: a collection (/zapstore/apps), a pill that is a page of its own
// (/zapstore/leaderboards), a word of an own route's shape (/zapstore/<pubkey>). A trailing
// slash is let through: SvelteKit then answers 308 (permanent redirect) from /git/zaps/ to
// /git/zaps, as it does for every route.
export const reroute: Reroute = ({ url }) => {
	const m = /^\/([^/]+)\/([^/]+)\/?$/.exec(url.pathname);
	if (!m) return;
	const [, domain, slug] = m;
	// own keys only: /constructor/abc found Object's constructor here, and answered 500 (internal
	// server error), until 2026-10-19
	const t = own(SLUG_TABLES, domain);
	if (!t || !SLUG.test(slug) || routedElsewhere(t, slug)) return;
	return t.path;
};
