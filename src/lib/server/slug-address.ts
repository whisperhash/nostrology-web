import { redirect } from '@sveltejs/kit';
import { keepQuery, resolveSlug, slugIn, type SlugTable, type Target } from '$lib/slug-table';

// A domain page's address, answered on the server ($lib/slug-table has the rules). Every
// domain page with a slug table splits its server load in two:
//   - +page.server.ts reads the address and answers it with `answerAddress`: the pill and
//     the section to open, or a redirect. The router tracks that read, so this load runs
//     again on every move between the page's own addresses - a pill click, Back - and sends
//     only its small answer;
//   - +layout.server.ts fetches the page's document, never reading the address in a way the
//     router tracks, so it runs once per visit rather than once per click. It still looks at
//     the address, untracked, through `redirectsAway`, so that it fetches nothing for an
//     address the page load is about to redirect (a bot walking /git/<anything> would
//     otherwise cost a database read per 302 (found)).

/** What the request's address names, for a domain's +page.server.ts: the page's target, or
 * the redirect, thrown. A redirect keeps the request's query and is never cached: slugs are
 * not permanent - a former slug can be given to a new section, an unknown one can become a
 * section - so every request for one must reach the server again, and a 308 (permanent
 * redirect) with no Cache-Control may be cached with no expiry (RFC 9110 15.4.9).
 * deploy/Caddyfile sends no-store on its alias redirects for the same reason. */
export function answerAddress(
	t: SlugTable,
	url: URL,
	setHeaders: (headers: Record<string, string>) => void
): Target {
	const r = resolveSlug(t, slugIn(url.pathname, t.path));
	if (r.kind !== 'redirect') return r;
	setHeaders({ 'cache-control': 'no-store' });
	redirect(r.status, keepQuery(r.location, url.search));
}

/** Whether the address redirects, for a domain's +layout.server.ts: the page load answers it
 * with the redirect, and the layout's document must not be fetched for it first. */
export function redirectsAway(t: SlugTable, pathname: string): boolean {
	return resolveSlug(t, slugIn(pathname, t.path)).kind === 'redirect';
}
