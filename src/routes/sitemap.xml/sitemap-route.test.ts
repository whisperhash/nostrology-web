import { beforeEach, describe, expect, it, vi } from 'vitest';

// The three real inputs. $lib/seo/sitemap is deliberately NOT mocked: its rules are what
// must hold end to end, and they are unit-tested separately. What THIS file tests is the
// wiring - that the route hands those rules the right fields, from the same sources the
// pages read.
const getSitemapApps = vi.fn();
const getNutzapMintStats = vi.fn();
const fetchRegistry = vi.fn();
vi.mock('$lib/db/postgres', () => ({
	getSitemapApps: () => getSitemapApps(),
	getNutzapMintStats: (p: string) => getNutzapMintStats(p)
}));
vi.mock('$lib/server/mcpRegistry', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/mcpRegistry')>(
		'$lib/server/mcpRegistry'
	);
	return { ...actual, fetchRegistry: () => fetchRegistry() };
});

import { GET } from './+server';
import { isHiddenPath } from '$lib/seo/sitemap';

const PK = '7579076d9aff0a4cfdefa7e2045f2486c7e5d8bc63bfc6b45397233e1bbfcb19';
const PK2 = '78ce6faa72264387284e647ba6938995735ec8c7d5c5a65737e55130f026307d';

const REGISTRY = {
	metrics: [
		{ domain: 'zapstore', metric: 'zap_count' },
		{ domain: 'routstr', metric: 'network_activity' }
	],
	reference: [{ domain: 'zapstore', record: 'app_catalog' }]
};

function defaults() {
	getSitemapApps.mockResolvedValue([
		{ pubkey: PK, d_tag: 'com.example.one' },
		{ pubkey: PK, d_tag: 'com.example.two' },
		{ pubkey: PK2, d_tag: 'a/b c&d' }
	]);
	getNutzapMintStats.mockResolvedValue([
		{ mint_url: 'https://mint.minibits.cash/Bitcoin', has_page: true },
		{ mint_url: 'https://8333.space:3338', has_page: true },
		// Listed in a window but has no page of its own.
		{ mint_url: 'https://nopage.example', has_page: false },
		// A loopback test mint, reachable only over http.
		{ mint_url: 'http://127.0.0.1:3338', has_page: true }
	]);
	fetchRegistry.mockResolvedValue(REGISTRY);
}

async function run(origin = 'https://nostrolo.gy') {
	const res = (await GET({ url: new URL(`${origin}/sitemap.xml`) } as never)) as Response;
	return { res, body: await res.text() };
}

/** Every <loc> in the document, as paths. */
function locs(body: string, origin = 'https://nostrolo.gy'): string[] {
	return [...body.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1].replace(origin, ''));
}

describe('/sitemap.xml', () => {
	beforeEach(() => {
		getSitemapApps.mockReset();
		getNutzapMintStats.mockReset();
		fetchRegistry.mockReset();
		defaults();
	});

	it('serves XML with the pages built from the same sources the site links', async () => {
		const { res, body } = await run();
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('application/xml');
		const paths = locs(body);
		expect(paths).toContain('/');
		expect(paths).toContain(`/zapstore/apps/${PK}/com.example.one`);
		// The d-tag is percent-encoded exactly as the cards link it.
		expect(paths).toContain(`/zapstore/apps/${PK2}/a%2Fb%20c%26d`);
		expect(paths).toContain('/nutzaps/mints/mint.minibits.cash/Bitcoin');
		expect(paths).toContain('/data/routstr/network_activity');
		expect(paths).toContain('/data/zapstore/app_catalog');
	});

	it('lists each publisher once, from the apps that name them', async () => {
		const paths = locs((await run()).body);
		// PK publishes two apps and must still appear once.
		expect(paths.filter((p) => p === `/zapstore/publishers/${PK}`)).toHaveLength(1);
		expect(paths).toContain(`/zapstore/publishers/${PK2}`);
	});

	it('omits mints with no page, and http mints whose canonical would disagree', async () => {
		const paths = locs((await run()).body);
		expect(paths.some((p) => p.includes('nopage.example'))).toBe(false);
		// The http mint is excluded entirely - NOT listed with the query stripped, which
		// would point at a different (https) mint.
		expect(paths.some((p) => p.includes('127.0.0.1'))).toBe(false);
		expect(paths.some((p) => p.includes('scheme=http'))).toBe(false);
	});

	it('builds the document through sitemapPaths, not from the sources directly', async () => {
		// WHAT THIS REPLACED, and why. There used to be a test here claiming "never lists a
		// hidden page, whatever the sources return", feeding the registry domains `wip`
		// and `relays`. It could not fail. A registry domain only ever becomes
		// `/data/<domain>`, and `/data/wip` is NOT hidden - HIDDEN_TREES holds `/wip`, and
		// the rule is exact-or-subtree, deliberately so (`/data/routstr/...` are the public
		// registry pages for a hidden tree's domain). So `for (p of paths)
		// expect(isHiddenPath(p)).toBe(false)` was circular, and a review confirmed it:
		// neutering isHiddenPath to always return false left every route test green.
		//
		// The honest position is that NO input this route can receive expresses a hidden
		// path, so the hidden-path guarantee is not testable from here. It is proven where
		// it lives, in sitemap.test.ts, which poisons sitemapPaths' inputs directly.
		//
		// What IS worth pinning here is the wiring: that the route delegates to
		// sitemapPaths rather than assembling <loc>s itself, because that delegation is
		// what carries the hidden filter, the dedup and the validity checks. An invalid
		// pubkey is the cheapest probe - only sitemapPaths drops it.
		getSitemapApps.mockResolvedValue([
			{ pubkey: PK, d_tag: 'com.example.one' },
			{ pubkey: 'not-a-hex-pubkey', d_tag: 'com.example.evil' },
			{ pubkey: PK, d_tag: '' }
		]);
		const paths = locs((await run()).body);
		expect(paths).toContain(`/zapstore/apps/${PK}/com.example.one`);
		expect(paths.some((p) => p.includes('not-a-hex-pubkey'))).toBe(false);
		expect(paths.some((p) => p.endsWith(`/zapstore/apps/${PK}/`))).toBe(false);
		// And the filter is still applied to the assembled set, whatever it contains.
		for (const p of paths) expect(isHiddenPath(p)).toBe(false);
	});

	it('names the request origin, so it can never disagree with the canonicals', async () => {
		const { body } = await run('https://other.test');
		expect(body).toContain('<loc>https://other.test/</loc>');
		expect(body).not.toContain('nostrolo.gy');
	});

	it('fails loudly when the registry is unavailable, rather than shrinking silently', async () => {
		// A sitemap that quietly loses a quarter of its URLs reads to a crawler as "those
		// pages were removed", which is far worse than a 503 it will retry.
		fetchRegistry.mockResolvedValue(null);
		const { res, body } = await run();
		expect(res.status).toBe(503);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		expect(body).toContain('registry');
	});

	it('is cacheable, but not for longer than the catalog refresh cycle', async () => {
		const { res } = await run();
		const cc = res.headers.get('Cache-Control') ?? '';
		expect(cc).toContain('public');
		const maxAge = Number(/max-age=(\d+)/.exec(cc)?.[1] ?? 0);
		expect(maxAge).toBeGreaterThan(0);
		expect(maxAge).toBeLessThanOrEqual(86400);
	});
});
