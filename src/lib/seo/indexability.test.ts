import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveSlug, slugAddresses, slugIn } from '$lib/slug-table';
import { visibleTable } from '$lib/unreleased';
import { SLUG_TABLES } from '$lib/slug-tables';
import { isHiddenPath, sitemapPaths, slugTablePaths, STATIC_PATHS } from './sitemap';

/**
 * THE TWO HALVES OF "WHAT IS INDEXABLE" MUST AGREE.
 *
 * The sitemap says which pages we ASK crawlers to take; `noindex` says which we ask them
 * to drop. Nothing connected them before Phase 2: a new page could be born crawlable and
 * absent from both lists, and the only symptom would be it quietly appearing in search
 * results - or quietly not.
 *
 * So this walks the real route tree and holds every page to one of two states:
 *   hidden  -> `isHiddenPath` says so, the page carries `noindex`, and the sitemap
 *              cannot emit it (proven in sitemap.test.ts).
 *   public  -> no `noindex`, and the sitemap covers it, either as one of STATIC_PATHS or
 *              as a member of a generated family.
 *
 * A route that is neither fails, by construction: adding a page now forces the decision
 * instead of deferring it to whoever notices in Search Console months later.
 */

const ROUTES = resolve('src/routes');

/** Every +page.svelte, as the URL path it serves (route groups removed). */
function routePaths(): { path: string; file: string }[] {
	const out: { path: string; file: string }[] = [];
	const walk = (dir: string, url: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				// `(group)` segments organise files without appearing in the URL.
				const seg = /^\(.*\)$/.test(entry.name) ? '' : `/${entry.name}`;
				walk(full, url + seg);
			} else if (entry.name === '+page.svelte') {
				out.push({ path: url === '' ? '/' : url, file: full });
			}
		}
	};
	walk(ROUTES, '');
	return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** A route path with its parameters filled in, so the hidden-path rules can judge it. */
function concrete(path: string): string {
	return path
		.replace('[pubkey=hex64]', 'a'.repeat(64))
		.replace('[d_tag]', 'com.example.app')
		.replace('[...relay]', 'relay.example')
		.replace('[...mint]', 'mint.example')
		.replace('[domain]', 'zapstore')
		.replace('[metric]', 'zap_count');
}

/**
 * Public route families the sitemap generates one URL per row for. Each is listed with
 * WHERE the rows come from, because "the sitemap covers it" is only true while that
 * source still feeds the route.
 */
const GENERATED = new Map<string, string>([
	['/zapstore/apps/[pubkey=hex64]/[d_tag]', 'getZapstoreAllApps -> appPath'],
	['/zapstore/publishers/[pubkey=hex64]', 'distinct app_pubkey -> publisherPath'],
	['/nutzaps/mints/[...mint]', 'getNutzapMintStats(has_page) -> mintHref'],
	['/data/[domain]', 'domainsOf(registry) -> dataPaths'],
	['/data/[domain]/[metric]', 'registry metrics + reference -> dataPaths']
]);

const pages = routePaths();

describe('indexability: every page is either in the sitemap or noindexed', () => {
	it('finds the route tree (guards against this test silently walking nothing)', () => {
		expect(pages.length).toBeGreaterThan(15);
		expect(pages.map((p) => p.path)).toContain('/');
	});

	it.each(pages)('$path', ({ path, file }) => {
		const source = readFileSync(file, 'utf8');
		// `noindex` as a standalone SocialMeta prop. The component is the only way the
		// site emits the meta tag (SocialMeta.test.ts pins that).
		const hasNoindex = /^\s*noindex\s*$/m.test(source);
		const hidden = isHiddenPath(concrete(path));

		if (hidden) {
			expect(hasNoindex, `${path} is hidden, so its page must pass noindex`).toBe(true);
			return;
		}

		expect(hasNoindex, `${path} is public, so it must NOT pass noindex`).toBe(false);
		const covered =
			(STATIC_PATHS as readonly string[]).includes(path) ||
			// a pill built as a page of its own (/zapstore/leaderboards) is listed from its slug table
			slugTablePaths().includes(path) ||
			GENERATED.has(path);
		expect(
			covered,
			`${path} is public but the sitemap cannot emit it. Add it to STATIC_PATHS or a slug table, ` +
				`generate it in the sitemap route (and list it in GENERATED here), or make it ` +
				`hidden - do not leave it in neither list.`
		).toBe(true);
	});

	it('lists no generated family that has stopped being a route', () => {
		// The other direction: a route deleted or renamed leaves GENERATED naming a page
		// that no longer exists, and the claim "the sitemap covers it" rots silently.
		const known = new Set(pages.map((p) => p.path));
		for (const family of GENERATED.keys()) expect(known).toContain(family);
	});

	it('serves every STATIC_PATH from a real route', () => {
		// A sitemap that lists a URL the site does not serve teaches a crawler a 404.
		const known = new Set(pages.map((p) => p.path));
		for (const p of STATIC_PATHS) expect(known, `STATIC_PATHS lists ${p}`).toContain(p);
	});
});

/**
 * The addresses a slug table gives a domain page (/git/hosting) are not route files, so the walk
 * above cannot see them. Each is the domain's own page, rendered from its own +page.svelte, so
 * it takes that page's state: a hidden domain's addresses are noindexed with it and never in the
 * sitemap; a public domain's are all in it (src/routes/(app)/slug-addresses.ssr.test.ts renders
 * each one and checks it names itself as its own canonical address).
 */
describe('indexability: every address a slug table gives is either in the sitemap or noindexed', () => {
	const listed = new Set(
		sitemapPaths({ apps: [], publishers: [], mintHrefs: [], dataPaths: [] })
	);

	it.each(Object.entries(SLUG_TABLES))('%s', (_, t) => {
		const page = pages.find((p) => p.path === t.path);
		expect(page, `the page serving ${t.path}`).toBeDefined();
		const noindex = /^\s*noindex\s*$/m.test(readFileSync(page!.file, 'utf8'));
		const hidden = isHiddenPath(t.path);
		expect(noindex, `${t.path}: noindex exactly when hidden`).toBe(hidden);
		// the anonymous reader's view: a pill or section still in development is not an address
		// they have at all, and the case below says what they get instead ($lib/unreleased)
		for (const address of slugAddresses(visibleTable(t, false))) {
			// a page of its own, as the server answers it: never a redirect
			expect(resolveSlug(t, slugIn(address, t.path)).kind, address).toBe('page');
			expect(listed.has(address), address).toBe(!hidden);
		}
		// and the other way round for what is still in development: out of the sitemap, and a
		// redirect rather than a page, which is exactly why it must be out of the sitemap
		for (const address of slugAddresses(t)) {
			if (slugAddresses(visibleTable(t, false)).includes(address)) continue;
			expect(listed.has(address), address).toBe(false);
			expect(resolveSlug(visibleTable(t, false), slugIn(address, t.path)!).kind, address).toBe(
				'redirect'
			);
		}
	});
});
