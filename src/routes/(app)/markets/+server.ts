import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// /markets -> /marketplaces. The page was renamed when it graduated into the
// top-level nav; "Marketplaces" is what the nav and the landing copy call the
// domain, and the URL had drifted from that.
//
// It stays alive as a redirect because the /markets URL was handed out while
// the page was still unlinked, so a 404 would break exactly the links that
// were shared by hand.
//
// 308, permanent, matching the /zapstore shims: the rename is settled, and a
// permanent redirect is what tells a search engine to consolidate the old URL onto
// the new one (a 302 is not a canonicalization signal). 308 rather than 301 so the
// method survives, for the same reason as the alias hosts in deploy/Caddyfile
// (only GET is served here, where the two behave the same).
//
// url.search is carried across so a shared ?utm_* link keeps its campaign
// attribution, and url.hash never reaches the server - the browser re-applies it
// to the redirect target on its own, so an old /markets#geography arrives as
// /marketplaces#geography, which the page then moves to /marketplaces/geography
// ($lib/legacy-hash: a courtesy, not a commitment).
export const GET: RequestHandler = ({ url }) => {
	redirect(308, `/marketplaces${url.search}`);
};
