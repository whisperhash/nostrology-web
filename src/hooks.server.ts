// Server hooks. At boot (`init`, below the imports): start the landing cache's clock. Per
// request (`handle`): resolve the Nostr identity, and log the page view.
//
// `handle` has TWO jobs, both of which have to happen before any client JavaScript runs:
//
//  1. Put the verified identity on `locals` so +layout.server.ts can hand it to the nav.
//     Rendering the nav server-side is what keeps a logged-in user from seeing a
//     logged-out nav flash on every single page load.
//
//  2. Emit ONE structured line per page request - the path, the status, how long it took,
//     and two flags (signed in, analytics off) - so page-level analysis is possible from
//     Loki. The line carries no pubkey, no cookie value and no address.
//
// The one cookie it ever touches is the operator marker, and only to CLEAR one that arrives
// without the operator's session (below). Login and logout set and clear it themselves
// ($lib/server/auth/handlers), and the hook leaves their responses alone: a cookie added
// here lands AFTER the endpoint's own, and would override what a login had just decided.
//
// The identity comes from the cookie's HMAC, never from a header or query parameter the
// client controls. An unverifiable cookie is treated exactly like no cookie.

import type { Handle, ServerInit } from '@sveltejs/kit';
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { cookieName, OPERATOR_MARKER_COOKIE, sessionSecret } from '$lib/server/auth/config';
import { cookieHeader, verifySessionCookie } from '$lib/server/auth/cookie';
import { isOperator } from '$lib/unreleased';
import { landingCache } from '$lib/server/landing';

/** How long boot waits for the landing cache's first pass: well inside the 20 s start
 * period of the deployment's container healthcheck. */
export const BOOT_WAIT_MS = 8_000;

/**
 * Boot: start the landing cache's clock ($lib/server/landing/cache.ts) and wait for its first
 * pass (a few seconds; at most BOOT_WAIT_MS), so the first visitor after a deploy finds the
 * board's data loaded rather than its typed fallback. adapter-node starts listening only once
 * this resolves, so no request ever waits on it. Not while building: the build renders nothing
 * from the cache and has no database to read.
 */
export const init: ServerInit = async () => {
	if (building) return;
	landingCache.start();
	await landingCache.settled(BOOT_WAIT_MS);
};

/**
 * EVERY HTML page here is rendered per-cookie. The layout puts the session's pubkey in
 * the nav server-side (that is the whole point of resolving identity in this hook) and
 * the analytics flag goes into the SSR payload, so two visitors asking for the
 * same URL get different documents. SvelteKit gives each render a strong ETag - a hash
 * of the finished HTML, `runtime/server/page/render.js` - but no `Cache-Control` and no
 * `Vary: Cookie`. This adds both, and they are added for DIFFERENT reasons:
 *
 * `Vary: Cookie` is a FACT about the render. It is therefore unconditional for HTML,
 * including on a response that set its own `Cache-Control`. Coupling it to the policy
 * below was the original shape here and it was backwards: a route adding
 * `setHeaders({'cache-control': 'public, max-age=600'})` - a plausible next step now
 * that the site is open to crawlers - would have skipped the whole block and shipped a
 * per-cookie document as publicly cacheable with no Vary at all. The safety net must not
 * drop out exactly when the risk appears.
 *
 * `private, no-cache` is POLICY, and only a default: it is applied when nothing else has
 * decided. That is what keeps /sitemap.xml `public, max-age=3600` (identical for
 * everyone, and crawlers should cache it) and SvelteKit's `__data.json` on the stricter
 * `private, no-store`.
 *
 * WHAT THIS DOES AND DOES NOT BUY - the honest version, because the first draft of this
 * comment overclaimed on both counts and a review caught it:
 *
 *  - It does NOT fix "Back after logout shows the logged-in nav". That restores from
 *    bfcache, an in-memory snapshot that consults no HTTP cache; only `no-store` makes a
 *    page bfcache-ineligible, and `no-store` would cost the ETag/304 path on pages whose
 *    measured problem is a ~2 MB payload. Below bfcache, Chromium skips validation on
 *    history navigations anyway. That gap is real and remains open by choice.
 *  - Heuristic freshness (RFC 9111 4.2.2) was a weaker threat than claimed: heuristics
 *    key on `Last-Modified`, which neither SvelteKit nor Caddy sets here, so browsers
 *    were not inventing freshness. The value is in stating the policy rather than
 *    depending on that absence continuing to hold.
 *  - `private` is what actually forbids shared storage. `Vary: Cookie` is honesty on top
 *    of it, not a load-bearing control - Cloudflare, the likeliest CDN to land here,
 *    ignores `Vary` on anything but `Accept-Encoding`.
 *  - It buys no server time. SvelteKit hashes the HTML only after rendering it, so a 304
 *    has already cost the same database work as a 200. Page weight and query cost are
 *    separate problems and must not be argued away with this header.
 *
 * Revalidation stays cheap: the ETag covers the rendered output, so a login or a logout
 * changes the hash and the client gets a fresh 200 (ok), while an unchanged page is a 304
 * (not modified). GA4's `_ga_*` cookies churn on every hit and so can miss the
 * `Vary` key, but they do not affect the render, so the ETag is unchanged and the miss
 * costs a revalidation round-trip, never a refetch (measured live 2026-09-23).
 *
 * NOT handled here: a page 304. SvelteKit builds it AFTER this hook returns
 * (`runtime/server/respond.js` - `hooks.handle` at ~429, the 304 conversion at ~474)
 * from an allowlist that already carries `cache-control` and `vary` over from the 200,
 * so a page 304 inherits both. An earlier version of this block matched `status === 304`
 * to "cover" that; it was dead code resting on a false model of where 304s come from.
 */
const HTML_CACHE_CONTROL = 'private, no-cache';

function isHtmlResponse(response: Response): boolean {
	return (response.headers.get('content-type') ?? '').toLowerCase().startsWith('text/html');
}

/**
 * Add a field to `Vary` without dropping what is there. Caddy appends `Accept-Encoding`
 * downstream of us, and overwriting rather than appending would silently un-declare the
 * other axis a response varies on.
 */
function addVary(headers: Headers, field: string): void {
	const current = headers.get('vary');
	if (!current) {
		headers.set('vary', field);
		return;
	}
	if (current.trim() === '*') return;
	const present = current.split(',').some((f) => f.trim().toLowerCase() === field.toLowerCase());
	if (!present) headers.set('vary', `${current}, ${field}`);
}

/**
 * Assets and internal endpoints are not page views. Logging them would bury the handful
 * of meaningful page views under hundreds of chunk fetches per navigation.
 */
function isPageViewPath(pathname: string): boolean {
	if (pathname.startsWith('/_app/')) return false;
	if (pathname.startsWith('/api/')) return false;
	return !/\.(js|css|map|png|jpg|jpeg|svg|webp|ico|woff2?|txt|xml|json)$/i.test(pathname);
}

export const handle: Handle = async ({ event, resolve }) => {
	// One reading of the settings for the whole site: a secret too short to be a key counts as
	// none at all, here and at the login endpoints alike ($lib/server/auth/config).
	const cookie = event.cookies.get(cookieName(env));
	const result = verifySessionCookie(sessionSecret(env), cookie, Date.now());
	event.locals.session = result.ok ? { pubkey: result.claims.pubkey } : null;

	// The operator's pages are served without Google Analytics, decided from the verified
	// session alone - so signing out, or the session expiring, ends it - and never from a
	// header, a query parameter or the operator marker cookie.
	// Consumed by +layout.server.ts, and logged below so exclusion is verifiable from Loki.
	event.locals.analyticsOff = isOperator(event.locals.session);

	// THE MARKER OUTLIVES NO SESSION. It tags the access log at the edge, which cannot see the
	// session, so a marker left behind when the session died some way other than a logout or
	// their shared expiry (a new session key, a renamed or reformatted session cookie) would
	// keep a signed-out browser tagged `operator=1`. Such a marker is cleared on the first
	// request the app sees - every page and data request, not the static assets in between.
	// Never on /api/auth/*, whose responses set and clear it themselves, and never while the
	// site has no session key, when nobody's session verifies.
	const orphanMarker =
		!isOperator(event.locals.session) &&
		event.cookies.get(OPERATOR_MARKER_COOKIE) !== undefined &&
		sessionSecret(env) !== undefined &&
		!event.url.pathname.startsWith('/api/auth/');

	// 'unconfigured' means the deployment has no usable AUTH_SESSION_SECRET (missing, or under
	// 32 characters) - a deploy error, not a user error, and one that would otherwise present
	// as "login silently never works". Logged per request rather than never; it should be zero
	// lines in a healthy deployment.
	if (!result.ok && result.reason === 'unconfigured' && cookie) {
		console.log(
			JSON.stringify({
				ts: new Date().toISOString(),
				level: 'error',
				msg: 'session cookie present but AUTH_SESSION_SECRET is not configured'
			})
		);
	}

	const started = Date.now();
	const response = await resolve(event);

	if (isPageViewPath(event.url.pathname)) {
		// One self-contained JSON object per line, matching the nozzl logging convention
		// so Loki's `| json` works. No identity, no cookie value, no secret, and no query
		// string beyond the path is included.
		console.log(
			JSON.stringify({
				ts: new Date().toISOString(),
				level: 'info',
				msg: 'page view',
				path: event.url.pathname,
				// The status THIS HOOK saw, which for a page that revalidates is the 200 (ok)
				// behind the 304 (not modified) - SvelteKit converts it downstream of here
				// (see the cache-header note above). Since `private, no-cache` made
				// revalidation the steady state, these lines now routinely read 200 (ok) for
				// requests Caddy logged as 304 (not modified). The two are counting different
				// things, like Caddy's alias hops and its requests; use Caddy's `access_site` for
				// what went over the wire.
				status: response.status,
				logged_in: event.locals.session !== null,
				// True = this page was rendered with analytics disabled for the operator.
				// The server-side record that exclusion held; GA itself cannot show it.
				analytics_off: event.locals.analyticsOff,
				ms: Date.now() - started
			})
		);
	}

	if (orphanMarker) {
		try {
			response.headers.append('set-cookie', cookieHeader(OPERATOR_MARKER_COOKIE, '', 0));
		} catch {
			// An immutable response (see below): the next request clears it instead.
		}
	}

	// Deliberately AFTER the page-view line. `Headers.set` throws on a response with an
	// immutable guard (one returned straight from `fetch` or `Response.redirect`).
	// Nothing in src/ does that today - every redirect goes through SvelteKit's
	// `redirect()`, which is materialised as a fresh mutable response - but if one is
	// ever added, the throw becomes a 500, and a 500 whose request never reached the
	// page-view line is far harder to trace than one that did.
	if (isHtmlResponse(response)) {
		addVary(response.headers, 'Cookie');
		if (!response.headers.has('cache-control')) {
			response.headers.set('cache-control', HTML_CACHE_CONTROL);
		}
	}

	return response;
};
