import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_MCP_ENDPOINT } from '$lib/mcp/endpoint';

/**
 * THE ONE COPY OF THE MCP URL THAT `grep` CANNOT SEE.
 *
 * static/social-card.png is the og:image/twitter:image of every page that supplies no
 * image of its own - i.e. the whole site - and the endpoint on it is PIXELS, baked in at
 * render time rather than read from PUBLIC_MCP_ENDPOINT like every other copy. So when
 * the endpoint host changed on 2026-09-22 (dev.nostrolo.gy -> nostrolo.gy), the
 * repo-wide `grep -rn 'dev\.nostrolo\.gy'` that found all 40-odd other copies reported
 * the card clean, and the stale URL would have gone on teaching the old host to everyone
 * who shared a link - in immutable Nostr notes, permanently. A review caught it by
 * OPENING the image.
 *
 * This test is the cheap standing version of that review. It cannot read pixels, so it
 * guards the PNG's SOURCE: scripts/social-card.html, which is what gets
 * rendered, and which IS greppable. Change the endpoint and this fails, naming the
 * regeneration command. The pairing that remains unguarded - source edited, PNG not
 * re-rendered - is covered by `node scripts/render-social-card.mjs --check`, kept out of
 * CI on purpose: byte equality breaks on a Chrome upgrade's anti-aliasing, and a test
 * that cries wolf about fonts would get muted long before it caught a wrong URL.
 *
 * Since 2026-10-15 the card names NO URL: the operator dropped the MCP endpoint from it "for
 * now", after seeing the card in a WhatsApp preview. The host guard stays, so a URL put back
 * must be the current endpoint.
 */
describe('social card', () => {
	const source = readFileSync(resolve('scripts/social-card.html'), 'utf8');

	it('draws no URL since 2026-10-15 (the operator dropped the endpoint "for now")', () => {
		const body = source.slice(source.indexOf('<body>'));
		expect(body).toContain('Tools for your agent.');
		expect(body).not.toMatch(/https?:\/\/|nostrolo\.gy\//);
	});

	it('carries no nostrolo.gy host but the current one - a stale one would be invisible in the PNG', () => {
		const hosts = new Set(
			[...source.matchAll(/https?:\/\/([a-z0-9.-]*nostrolo\.gy)/gi)].map((m) => m[1].toLowerCase())
		);
		for (const host of hosts) expect(host).toBe(new URL(DEFAULT_MCP_ENDPOINT).host);
	});

	it('tells the reader the URL is pixels and must be re-rendered', () => {
		// The comment is the only thing standing between a future endpoint change and a
		// stale card, for anyone who edits the source without running the tests.
		expect(source).toMatch(/render-social-card|regenerat/i);
	});
});
