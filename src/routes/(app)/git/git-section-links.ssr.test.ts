// @vitest-environment node
//
// /git served at one of its own addresses (/git/zaps, $lib/slug-table), rendered the way the
// server renders it - the HTML a link-preview fetcher reads, and the page a browser paints
// before any script runs. The preview tags are the reason the address exists: a chat or a
// Nostr app draws its card from them without ever running the page.
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';

import type { Target } from '$lib/slug-table';
import { GIT_SLUGS } from '$lib/slug-tables/git';
import NgitPage from './+page.svelte';
import { FIXTURE } from './fixture';

// SocialMeta and the pill bar read $page for the request's own address: the one rendered.
const current = vi.hoisted(() => ({ url: new URL('https://site.test/git/zaps') }));
vi.mock('$app/stores', () => ({
	page: { subscribe: (fn: (v: unknown) => void) => (fn({ url: current.url }), () => {}) }
}));

const serverRender = (target: Target, path = '/git/zaps') => {
	current.url = new URL('https://site.test' + path);
	return render(NgitPage, { props: { data: { snapshot: FIXTURE, target } } });
};
/** An attribute's value as the HTML carries it, entities decoded. */
const meta = (head: string, attr: string, key: string) => {
	const m = new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`).exec(head);
	return m?.[1].replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
};

describe('/git/zaps server render', () => {
	const zaps = GIT_SLUGS.sections.zaps;
	const preview = zaps.preview!;
	const { body, head } = serverRender({ kind: 'page', pill: 'collaboration', section: 'zaps' });

	it('sends the Collaboration pill, with the Zaps card in it - no Overview first', () => {
		expect(body).toContain('id="panel-collaboration"');
		expect(body).not.toContain('id="panel-overview"');
		// the current item of the pill bar, not the current page: its link is /git/collaboration
		expect(body).toMatch(/<a href="\/git\/collaboration" id="tab-collaboration" aria-current="true"/);
		expect(body).toContain('id="ngit-zaps"');
	});

	it('carries the link icon as a plain link to the section, for a reader with no JavaScript, never preloaded', () => {
		const icon = /<a href="\/git\/zaps"[^>]*data-section-link[^>]*>/.exec(body)?.[0] ?? '';
		expect(icon).not.toBe('');
		expect(icon).toContain('data-sveltekit-preload-data="off"');
	});

	it('carries the Zaps preview: title, description, and its own address', () => {
		expect(head).toContain('<title>Nostrology - Git on Nostr - Zaps</title>');
		expect(meta(head, 'property', 'og:title')).toBe(preview.title);
		expect(meta(head, 'property', 'og:description')).toBe(preview.description);
		expect(meta(head, 'name', 'twitter:title')).toBe(preview.title);
		expect(meta(head, 'name', 'description')).toBe(preview.description);
		expect(meta(head, 'property', 'og:url')).toBe('https://site.test/git/zaps');
		expect(head).toContain('<link rel="canonical" href="https://site.test/git/zaps"');
		// the site card, 1200x630, until Zaps has an image of its own
		expect(meta(head, 'property', 'og:image')).toBe('https://site.test/social-card.png');
		expect(head).not.toContain('noindex');
	});

	it('keeps the preview copy in plain ASCII, so no escape noise reaches a card', () => {
		expect(preview.title + preview.description).toMatch(/^[\x20-\x7e]+$/);
	});
});

describe("/git server render, a pill's own address, What is counted's and the bare page", () => {
	// A pill's address (/git/hosting) is the page on that pill, its page title naming the pill
	// (the operator's call, 2026-10-19), with the page's own preview: only Zaps has a preview of
	// its own, and the previews were left as they were.
	it.each([
		['a pill', { kind: 'page', pill: 'hosting' } as Target, '/git/hosting', 'panel-hosting', 'Nostrology - Git on Nostr - Hosting'],
		['What is counted', { kind: 'page', pill: 'overview', section: 'methodology' } as Target, '/git/methodology', 'panel-overview', 'Nostrology - Git on Nostr - What is counted'],
		['the bare /git', { kind: 'page', pill: 'overview' } as Target, '/git', 'panel-overview', 'Nostrology - Git on Nostr']
	])("%s: that pill, its own title, and the page's preview", (_, target, path, panel, title) => {
		const { body, head } = serverRender(target, path);
		expect(body).toContain(`id="${panel}"`);
		expect(head).toContain(`<title>${title}</title>`);
		expect(meta(head, 'property', 'og:title')).toBe('Git on Nostr, in numbers');
		expect(meta(head, 'property', 'og:description')).toMatch(/^Git on Nostr measured from actual events/);
		expect(head).not.toContain('noindex');
	});

	it('sends What is counted already open at its own address, and closed anywhere else', () => {
		const opened = serverRender({ kind: 'page', pill: 'overview', section: 'methodology' }, '/git/methodology').body;
		const closed = serverRender({ kind: 'page', pill: 'overview' }, '/git').body;
		const details = (body: string) => /<details[^>]*id="methodology"[^>]*>/.exec(body)?.[0] ?? '';
		expect(details(opened)).toMatch(/\sopen(=""|\s|>)/);
		expect(details(closed)).not.toMatch(/\sopen(=""|\s|>)/);
	});

	it('draws the pill bar as plain links, for a reader with no JavaScript, none of them preloaded', () => {
		const { body } = serverRender({ kind: 'page', pill: 'hosting' }, '/git/hosting');
		const links = [...body.matchAll(/<a href="([^"]*)" id="tab-([a-z-]+)"[^>]*>/g)];
		expect(links.map((m) => [m[1], m[2]])).toEqual(GIT_SLUGS.pills.map((p) => [p.slug === 'overview' ? '/git' : `/git/${p.slug}`, p.slug]));
		for (const [tag] of links) expect(tag).toContain('data-sveltekit-preload-data="off"');
		expect(links.filter(([tag]) => tag.includes('aria-current="page"')).map((m) => m[2])).toEqual(['hosting']);
	});
});

describe('/git server render, a retired section', () => {
	it('sends its last pill', () => {
		const { body } = serverRender({ kind: 'retired', pill: 'collaboration', title: 'Zaps' }, '/git/old-zaps');
		expect(body).toContain('id="panel-collaboration"');
		expect(body).not.toContain('id="panel-overview"');
	});
});
