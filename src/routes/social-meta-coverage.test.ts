import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const ROUTES = resolve(dirname(fileURLToPath(import.meta.url)));

function pageFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = join(dir, e.name);
		if (e.isDirectory()) return pageFiles(p);
		return e.name === '+page.svelte' ? [p] : [];
	});
}

/**
 * COVERAGE GUARD. This site shipped for months with og:/twitter: tags on the landing page
 * only, so every other route unfurled as bare text - no image, no summary - and nobody
 * noticed, because a missing card is invisible until a link is already public and the
 * preview renders wrong in someone else's feed.
 *
 * Most of this site's audience arrives THROUGH those previews: on the Marketplaces launch,
 * 195 of 249 distinct IPs fetched the HTML and nothing else. So the card is the first
 * impression for the majority of traffic, and a route without one is a real defect.
 *
 * Derived from the filesystem rather than a hand-kept list, deliberately: the failure mode
 * being guarded is a NEW route, and a hand-kept list would not know about it.
 */
describe('social card coverage', () => {
	const pages = pageFiles(ROUTES);

	it('finds every route page', () => {
		// A floor, not a census - its job is to fail loudly if the glob ever stops matching
		// (a rename, a move) rather than silently asserting nothing over an empty list.
		expect(pages.length).toBeGreaterThan(15);
	});

	it.each(pages.map((p) => relative(ROUTES, p)))('%s renders <SocialMeta>', (rel) => {
		const src = readFileSync(join(ROUTES, rel), 'utf8');
		expect(src).toContain('<SocialMeta');
	});

	// SocialMeta is the single place these tags are built. A page hand-rolling its own is
	// how the two drift apart again.
	it.each(pages.map((p) => relative(ROUTES, p)))('%s does not hand-roll og/twitter tags', (rel) => {
		const src = readFileSync(join(ROUTES, rel), 'utf8');
		// Attribute-order- and quote-agnostic on purpose: /<meta\s+property="og:/ only
		// matches when `property` happens to come first, so `<meta content=".." property="og:..">`
		// and single quotes both slip past it.
		expect(src).not.toMatch(/property=["']og:/);
		expect(src).not.toMatch(/name=["']twitter:/);
	});
});
