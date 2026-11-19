import { render } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { describe, it, expect, vi } from 'vitest';

// SocialMeta takes the page's own origin and path from $page unless told otherwise.
// The URL is inlined in the factory because vi.mock is hoisted above any const here.
vi.mock('$app/stores', () => ({
	page: readable({ url: new URL('https://site.test/zapstore/apps/abc/org.example.app') })
}));

const ORIGIN = 'https://site.test';

import SocialMeta from './SocialMeta.svelte';

const head = (sel: string, attr = 'content') => document.head.querySelector(sel)?.getAttribute(attr);
const count = (sel: string) => document.head.querySelectorAll(sel).length;

/**
 * These assertions exist because the site shipped for months with og:/twitter: tags on the
 * landing page ONLY, so every other route unfurled as bare text. The audience arrives
 * overwhelmingly through link previews, so the card IS the first impression - and a missing
 * or malformed tag is invisible locally and only shows up once a link is already public.
 */
describe('SocialMeta', () => {
	it('emits a complete card, defaulting to the site image and a large card', () => {
		render(SocialMeta, { props: { title: 'T', description: 'D' } });

		expect(document.title).toBe('T');
		expect(head('meta[name="description"]')).toBe('D');
		expect(head('link[rel="canonical"]', 'href')).toBe(`${ORIGIN}/zapstore/apps/abc/org.example.app`);

		expect(head('meta[property="og:type"]')).toBe('website');
		expect(head('meta[property="og:url"]')).toBe(`${ORIGIN}/zapstore/apps/abc/org.example.app`);
		expect(head('meta[property="og:site_name"]')).toBe('nostrolo.gy');
		expect(head('meta[property="og:title"]')).toBe('T');
		expect(head('meta[property="og:description"]')).toBe('D');
		// Absolute, and on the PAGE's origin - unfurlers do not resolve relative paths.
		expect(head('meta[property="og:image"]')).toBe(`${ORIGIN}/social-card.png`);

		expect(head('meta[name="twitter:card"]')).toBe('summary_large_image');
		expect(head('meta[name="twitter:title"]')).toBe('T');
		expect(head('meta[name="twitter:description"]')).toBe('D');
		expect(head('meta[name="twitter:image"]')).toBe(`${ORIGIN}/social-card.png`);
	});

	// The site card is 1200x630; app icons and profile pictures are square. A square image
	// in a large card is letterboxed or dropped, so the shape has to follow the image.
	it('switches to a square card when the page supplies its own image', () => {
		const icon = 'https://cdn.example/icon.png';
		render(SocialMeta, { props: { title: 'T', image: icon } });

		expect(head('meta[property="og:image"]')).toBe(icon);
		expect(head('meta[name="twitter:image"]')).toBe(icon);
		expect(head('meta[name="twitter:card"]')).toBe('summary');
	});

	it('lets the card shape be overridden explicitly', () => {
		render(SocialMeta, {
			props: { title: 'T', image: 'https://cdn.example/wide.png', card: 'summary_large_image' }
		});
		expect(head('meta[name="twitter:card"]')).toBe('summary_large_image');
	});

	it('lets the social headline and blurb differ from the page title and description', () => {
		render(SocialMeta, {
			props: { title: 'Long page title', description: 'Long page description',
				socialTitle: 'Short headline', socialDescription: 'Short blurb' }
		});

		expect(document.title).toBe('Long page title');
		expect(head('meta[name="description"]')).toBe('Long page description');
		expect(head('meta[property="og:title"]')).toBe('Short headline');
		expect(head('meta[property="og:description"]')).toBe('Short blurb');
		expect(head('meta[name="twitter:title"]')).toBe('Short headline');
		expect(head('meta[name="twitter:description"]')).toBe('Short blurb');
	});

	// An empty description tag is worse than none: some unfurlers render the blank rather
	// than falling back to the page's own text.
	it('omits description tags entirely when there is no description', () => {
		render(SocialMeta, { props: { title: 'T' } });

		expect(count('meta[name="description"]')).toBe(0);
		expect(count('meta[property="og:description"]')).toBe(0);
		expect(count('meta[name="twitter:description"]')).toBe(0);
	});

	it('emits no robots tag by default', () => {
		render(SocialMeta, { props: { title: 'T' } });
		expect(count('meta[name="robots"]')).toBe(0);
	});

	it('emits robots noindex when asked', () => {
		render(SocialMeta, { props: { title: 'T', noindex: true } });
		expect(head('meta[name="robots"]')).toBe('noindex');
	});

	// The landing page passes the origin its server load computed, for the reason documented
	// there: deriving the page's identity from PUBLIC_MCP_ENDPOINT - which may name another
	// host - would relocate canonical and og:image to somewhere that does not serve the page.
	it('honours an explicit origin and canonical path over the request URL', () => {
		render(SocialMeta, {
			props: { title: 'T', origin: 'https://other.test', canonicalPath: '/' }
		});

		expect(head('link[rel="canonical"]', 'href')).toBe('https://other.test/');
		expect(head('meta[property="og:url"]')).toBe('https://other.test/');
		expect(head('meta[property="og:image"]')).toBe('https://other.test/social-card.png');
	});
	// Publisher-controlled image fields are dirty (scheme-less hosts, stray bech32 strings,
	// empty strings). `??` would have KEPT '' - emitting an empty og:image while the card
	// shape, which used truthiness, said summary_large_image. Two wrong answers from one value.
	it.each([
		['an empty string', ''],
		['whitespace', '   '],
		['a scheme-less host', 'www.example.com/icon.png'],
		['plain http', 'http://cdn.example/icon.png'],
		['a relative path', '/icon.png'],
		['junk', 'naddr1qqxnzd3exyerqvpjxYmn']
	])('falls back to the site card when the image is %s', (_label, bad) => {
		render(SocialMeta, { props: { title: 'T', image: bad } });

		expect(head('meta[property="og:image"]')).toBe(`${ORIGIN}/social-card.png`);
		// ...and the shape must follow the image ACTUALLY used, not the one offered.
		expect(head('meta[name="twitter:card"]')).toBe('summary_large_image');
	});

	// Facebook and LinkedIn often render an image-less card on a first scrape while the
	// dimensions are unknown. They are knowable constants for our own card, and only ours.
	it('declares the site card dimensions', () => {
		render(SocialMeta, { props: { title: 'T' } });
		expect(head('meta[property="og:image:width"]')).toBe('1200');
		expect(head('meta[property="og:image:height"]')).toBe('630');
	});

	// Separate test on purpose: testing-library cleans document.head BETWEEN tests, not
	// between two renders inside one, so a second render here would assert against the
	// first one's leftover tags.
	it('never guesses the size of a third-party image', () => {
		render(SocialMeta, { props: { title: 'T', image: 'https://cdn.example/icon.png' } });
		expect(count('meta[property="og:image:width"]')).toBe(0);
		expect(count('meta[property="og:image:height"]')).toBe(0);
	});

	it('gives the card image alt text', () => {
		render(SocialMeta, { props: { title: 'T', socialTitle: 'Headline' } });
		expect(head('meta[property="og:image:alt"]')).toBe('Headline');
		expect(head('meta[name="twitter:image:alt"]')).toBe('Headline');
	});

	// Under a prerender pass $page.url.origin is SvelteKit's `http://sveltekit-prerender`
	// sentinel, which would bake a nonsense host into canonical and og:image. Nothing
	// prerenders today; the DB-free /data subtree is the obvious future candidate.
	it('never emits the prerender sentinel as an origin', () => {
		render(SocialMeta, { props: { title: 'T', origin: 'http://sveltekit-prerender' } });

		expect(head('link[rel="canonical"]', 'href')).not.toContain('sveltekit-prerender');
		expect(head('meta[property="og:image"]')).not.toContain('sveltekit-prerender');
		expect(head('meta[property="og:image"]')).toBe('https://nostrolo.gy/social-card.png');
	});
});
