import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Legacy publisher URL: /zapstore/<pubkey> -> /zapstore/publishers/<pubkey>.
//
// Pubkeys used to hang directly off /zapstore, sharing that path segment with
// literal children (leaderboards, apps) and with the static assets served out
// of static/zapstore/. They now live under a collection segment of their own.
// Links in the old shape were handed out before the move, so it stays alive
// as a redirect rather than becoming a 404.
//
// 308, permanent. The shape has settled, and a permanent redirect is what tells a
// search engine to move the old URL's standing onto the new one (a 302 is not a
// canonicalization signal). 308 rather than 301 so the method survives, for the
// same reason as the alias hosts in deploy/Caddyfile (only GET is served here,
// where the two behave the same). Until 2026-09-22 this was a 302, while the
// surface was still moving and nothing was indexed.
//
// url.search is carried across: shared links are exactly the ones that arrive
// with query params, and dropping them here would silently break GA4 campaign
// attribution, which reads window.location.search on the page it lands on.
export const GET: RequestHandler = ({ params, url }) => {
	redirect(308, `/zapstore/publishers/${params.pubkey}${url.search}`);
};
