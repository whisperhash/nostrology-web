// /sitemap.xml - which URLs we ask search engines to crawl, and the rules that keep the
// hidden pages out of it.
//
// THE SET: the pages a visitor can already reach by following links from the nav - every
// Zapstore app and publisher page, the listed mint pages, the /data registry pages and the
// nav pages themselves - and, since 2026-10-19, every pill and section address of a domain
// with a slug table (/git/hosting, /git/zaps, /marketplaces/geography), the form the
// operator made canonical: "This is the new canonical form that should be indexed." They
// come straight from the slug tables (slugTablePaths), so a pill or a section added to one
// is listed with no other change. About 5,500 URLs. A sitemap lists URLs whether or not
// anything links to them, so it must not quietly widen what is discoverable:
//
//  - The relay pages stay out. /relays was buried on purpose (2026-08-22) and its
//    subtree is ~35,000 URLs, each an Aurora round-trip.
//  - THE HIDDEN SET stays out: /wip, /routstr, the /zapstore/apps index page, and
//    /relays with everything under it. The git page was in it from
//    2026-09-25 (at /ngit until 2026-09-29) while it incubated, and left it on 2026-10-15,
//    when it joined the nav with the redesigned landing.
//    Those pages also carry noindex; the sitemap is the other half, and robots.txt
//    deliberately names none of them (it is public, so a Disallow line would publish the
//    path).
//
// PRECISION MATTERS in isHiddenPath, in both directions:
//  - `/zapstore/apps` is hidden EXACTLY. Every app page lives under it
//    (/zapstore/apps/<pubkey>/<d_tag>), so a prefix rule would drop all 5,000+ of them.
//  - `/routstr` is hidden as a path and its subtree, never as a substring:
//    /data/routstr/... are the public registry pages for the Routstr MCP domain.
//
// Pure module: no $env, no DB, no fetch - the route (src/routes/sitemap.xml) gathers the
// inputs and this turns them into XML, so every rule here is unit-testable.

import { slugAddresses, type SlugTable } from '$lib/slug-table';
import { SLUG_TABLES } from '$lib/slug-tables';
import { visibleTable } from '$lib/unreleased';

/** A path is hidden when it IS one of these, or sits under one (a `/` boundary). */
const HIDDEN_TREES = ['/wip', '/routstr', '/relays'] as const;
/** Hidden as exactly this path only; the pages under it are public. */
const HIDDEN_EXACT = ['/zapstore/apps'] as const;

export function isHiddenPath(path: string): boolean {
	// Compare on the bare path: a query or a trailing slash must not smuggle a hidden
	// page past the rule (`/wip?x=1`, `/zapstore/apps/`).
	let p = path.split(/[?#]/, 1)[0];
	if (p.length > 1 && p.endsWith('/')) p = p.replace(/\/+$/, '') || '/';
	if ((HIDDEN_EXACT as readonly string[]).includes(p)) return true;
	return HIDDEN_TREES.some((t) => p === t || p.startsWith(`${t}/`));
}

/** The nav and index pages. Each is public, linked from the nav or the landing page. The
 * pill and section addresses of a domain with a slug table are not here - /zapstore/leaderboards
 * and /nutzaps/mints among them, pills that are pages of their own: they are slugTablePaths(). */
export const STATIC_PATHS = ['/', '/zapstore', '/marketplaces', '/git', '/lightning', '/nutzaps', '/data'] as const;

export interface SitemapInputs {
	/** The slug tables whose addresses to list; every domain's, unless a test passes its own. */
	slugTables?: Readonly<Record<string, SlugTable>>;
	/** Every (publisher pubkey, d-tag) in the Zapstore catalog - one app page each. */
	apps: { pubkey: string; d_tag: string }[];
	/** Every pubkey with at least one catalog entry - one publisher page each. */
	publishers: string[];
	/** Per-mint page hrefs, exactly as /nutzaps/mints links them (mintHref). */
	mintHrefs: string[];
	/** /data paths from the MCP registry (index, per-domain and per-entry pages). */
	dataPaths: string[];
}

export function appPath(pubkey: string, dTag: string): string {
	// The same shape every page links with (AppLeaderboardCard, the publisher page),
	// so the sitemap names the URL a crawler also finds by following links.
	return `/zapstore/apps/${pubkey}/${encodeURIComponent(dTag)}`;
}

export function publisherPath(pubkey: string): string {
	return `/zapstore/publishers/${pubkey}`;
}

/** Registry-derived /data paths: every domain page except the lead domain's (it is
 * canonicalised to /data itself), and one page per metric and per reference record. */
export function dataPaths(
	domains: string[],
	entries: { domain: string; name: string }[]
): string[] {
	const out = domains.slice(1).map((d) => `/data/${encodeURIComponent(d)}`);
	for (const e of entries) {
		out.push(`/data/${encodeURIComponent(e.domain)}/${encodeURIComponent(e.name)}`);
	}
	return out;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Every pill and section address of every domain with a slug table, in the tables' own
 * order: each domain's pills but the default one (whose address is the domain's own, one of
 * STATIC_PATHS), then its sections. Hidden domains' too: sitemapPaths drops those.
 *
 * A pill or section still in development is left out, because this file is read by strangers
 * and crawlers and that address answers them with a 302 (found) to the domain
 * ($lib/unreleased). `visibleTable(t, false)` is the anonymous reader's view, which is what a
 * sitemap is: there is no session here and there must not be one - a sitemap that varied by
 * cookie would be a sitemap nobody could cache. */
export function slugTablePaths(tables: Readonly<Record<string, SlugTable>> = SLUG_TABLES): string[] {
	return Object.values(tables).flatMap((t) => slugAddresses(visibleTable(t, false)));
}

/** Every public path, deduplicated, hidden paths removed, in a stable order. */
export function sitemapPaths(inputs: SitemapInputs): string[] {
	const paths = [
		...STATIC_PATHS,
		...slugTablePaths(inputs.slugTables),
		...inputs.dataPaths,
		...inputs.publishers.filter((p) => HEX64.test(p)).map(publisherPath),
		...inputs.apps.filter((a) => HEX64.test(a.pubkey) && a.d_tag !== '').map((a) => appPath(a.pubkey, a.d_tag)),
		...inputs.mintHrefs
	];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const p of paths) {
		if (seen.has(p) || isHiddenPath(p)) continue;
		seen.add(p);
		out.push(p);
	}
	return out;
}

function xmlEscape(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/** The sitemap protocol's own limit per file (sitemaps.org): 50,000 URLs. */
export const MAX_URLS = 50_000;

export function sitemapXml(origin: string, paths: string[]): string {
	if (paths.length > MAX_URLS) {
		// One file cannot hold more; a sitemap index would be needed. Loud, not truncated.
		throw new Error(`sitemap has ${paths.length} URLs, over the ${MAX_URLS} per-file limit`);
	}
	const lines = paths.map((p) => `<url><loc>${xmlEscape(origin + p)}</loc></url>`);
	return (
		'<?xml version="1.0" encoding="UTF-8"?>\n' +
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
		lines.join('\n') +
		'\n</urlset>\n'
	);
}
