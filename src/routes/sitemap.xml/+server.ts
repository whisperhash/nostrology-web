// /sitemap.xml - the URLs we ask search engines to crawl.
//
// Deliberately NOT under the (app) route group: the group's layout renders the nav and
// the page chrome, which an XML document must not carry.
//
// The set is built from the SAME queries that back the pages, so the sitemap cannot
// drift into listing URLs the site does not serve: every app and publisher page comes
// from the Zapstore catalog, every mint page from the mint stats, and every /data page
// from the MCP registry. $lib/seo/sitemap holds the rules (which paths are hidden, how a
// path is spelled, the XML) and is pure, so they are unit-tested without a database.
//
// FAILURE POSTURE: a sitemap that silently shrinks is worse than one that errors. If a
// source is unavailable we serve a 503 rather than a valid-looking sitemap missing 5,000
// URLs, because a crawler reads the short one as "those pages are gone".

import type { RequestHandler } from './$types';
import { getNutzapMintStats, getSitemapApps } from '$lib/db/postgres';
import { domainsOf, fetchRegistry } from '$lib/server/mcpRegistry';
import { mintHref } from '$lib/utils/mintUrl';
import { dataPaths, sitemapPaths, sitemapXml } from '$lib/seo/sitemap';

/** Cache at the edge and in crawlers for an hour. The set changes when the catalog
 *  refreshes (daily), so an hour is well inside the useful window and keeps a crawler
 *  re-fetching the index cheap. */
const CACHE_CONTROL = 'public, max-age=3600';

export const GET: RequestHandler = async ({ url }) => {
	const [apps, mints, registry] = await Promise.all([
		getSitemapApps(),
		getNutzapMintStats('all'),
		fetchRegistry()
	]);

	if (registry === null) {
		// The /data pages are ~1/4 of the set and the registry is the only source for
		// them. Serving the rest would look like a deliberate removal.
		return new Response('sitemap unavailable: the metric registry could not be read\n', {
			status: 503,
			headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }
		});
	}

	const paths = sitemapPaths({
		// The app page is keyed by the APP's pubkey, which is also the publisher's - the
		// publisher is the event author. Same spelling the cards link with.
		apps,
		publishers: [...new Set(apps.map((a) => a.pubkey))],
		mintHrefs: mints
			// A windowed view can list a mint that has no page of its own.
			.filter((m) => m.has_page)
			.map((m) => mintHref(m.mint_url))
			// http mints are excluded, not fixed. mintHref spells them
			// `/nutzaps/mints/<host>?scheme=http`, but the page's canonical link is built
			// from the PATH alone, so the canonical of an http mint points at the https
			// mint of the same name - a different page, or none. Listing a URL whose
			// canonical disagrees with it is how you teach a crawler the page is a
			// duplicate. They are all loopback and test mints today, so nothing of value
			// is withheld; if a real http mint ever appears, give the page a canonical
			// that keeps the query and drop this filter.
			.filter((href) => !href.includes('?scheme=http')),
		dataPaths: dataPaths(domainsOf(registry), [
			...registry.metrics.map((m) => ({ domain: m.domain, name: m.metric })),
			...(registry.reference ?? []).map((r) => ({ domain: r.domain, name: r.record }))
		])
	});

	// Same origin every canonical link uses: adapter-node builds url.origin from the
	// ORIGIN the compose pins, so the sitemap and the pages' <link rel="canonical"> can
	// never name different hosts. A sitemap whose URLs disagree with the canonicals is
	// read as pointing at someone else's site.
	const body = sitemapXml(url.origin, paths);

	return new Response(body, {
		headers: { 'Content-Type': 'application/xml', 'Cache-Control': CACHE_CONTROL }
	});
};
