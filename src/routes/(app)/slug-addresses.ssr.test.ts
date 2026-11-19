// @vitest-environment node
//
// Every address a slug table gives a domain page, rendered the way the server renders it - the
// HTML a crawler indexes and a link-preview fetcher reads. Each must be a page that names
// ITSELF as its own canonical address, carries noindex exactly when its domain is hidden, opens
// the pill its slug names, and has a page title of its own. A new pill or section is held to
// this with no change here: the cases come from the slug tables.
//
// THE CASES COME FROM THE WHOLE TABLE, so this is the OPERATOR'S view where a section is still
// in development ($lib/unreleased): the sitemap does NOT list such an address (slugTablePaths
// takes the anonymous view) and no other reader is served the page there at all - they get a
// 302 (found). Do not read a case here as a claim that its address is public; what each reader
// gets is pinned in src/routes/(app)/domain-loads.test.ts and src/lib/seo/sitemap.test.ts.
import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';

import { addressOf, own, pageTitle, resolveSlug, routedElsewhere, slugAddresses, slugIn, type SlugTable, type Target } from '$lib/slug-table';
import { SLUG_TABLES } from '$lib/slug-tables';
import { isHiddenPath } from '$lib/seo/sitemap';
import NgitPage from './git/+page.svelte';
import { FIXTURE as GIT_FIXTURE } from './git/fixture';
import MarketplacesPage from './marketplaces/+page.svelte';
import { SNAPSHOT as MARKETS_SNAPSHOT } from './marketplaces/fixture';
import RoutstrPage from './routstr/+page.svelte';
import { SNAPSHOT as ROUTSTR_SNAPSHOT } from './routstr/fixture';

// SocialMeta reads $page for the request's own address: the address being rendered.
const current = vi.hoisted(() => ({ url: new URL('https://site.test/') }));
vi.mock('$app/stores', () => ({
	page: { subscribe: (fn: (v: unknown) => void) => (fn({ url: current.url }), () => {}) }
}));

/** Each domain with a slug table: its page, the document it renders, and its title. */
// Any page: each takes its own `data` shape.
const PAGES: Record<string, { page: Component<any>; snapshot: unknown; base: string }> = {
	git: { page: NgitPage, snapshot: GIT_FIXTURE, base: 'Nostrology - Git on Nostr' },
	marketplaces: { page: MarketplacesPage, snapshot: MARKETS_SNAPSHOT, base: 'Nostrology - Nostr Marketplaces' },
	routstr: { page: RoutstrPage, snapshot: ROUTSTR_SNAPSHOT, base: 'Nostrology - Routstr' }
};

/** The addresses the domain's own page answers: its own and each slug's, but not a pill built as
 * a page of its own (/zapstore/leaderboards), which its own route renders and its own tests hold. */
const answered = (t: SlugTable) => [t.path, ...slugAddresses(t).filter((a) => !routedElsewhere(t, slugIn(a, t.path)!))];
/** The domains whose page answers more than its own address. */
const SERVED = Object.entries(SLUG_TABLES).filter(([, t]) => answered(t).length > 1);
const CASES = SERVED.flatMap(([domain, t]) => answered(t).map((address) => ({ domain, address, t })));

function serverRender(domain: string, t: SlugTable, address: string) {
	const target = resolveSlug(t, slugIn(address, t.path)) as Target;
	current.url = new URL('https://site.test' + address);
	const { page, snapshot } = PAGES[domain];
	// read off the result one by one: its fields are not all plain own properties
	const { head, body } = render(page, { props: { data: { snapshot, target } } });
	return { target, head, body };
}

describe('every address a slug table gives', () => {
	it('has a page here for every domain whose page answers more than its own address', () => {
		expect(Object.keys(PAGES).sort()).toEqual(SERVED.map(([d]) => d).sort());
	});

	it.each(CASES)('$address names itself, opens its pill and titles itself', ({ domain, address, t }) => {
		const { target, head, body } = serverRender(domain, t, address);
		expect(target.kind).toBe('page');
		expect(head).toContain(`<link rel="canonical" href="https://site.test${address}"`);
		expect(head).toContain(`<meta property="og:url" content="https://site.test${address}"`);
		expect(head).toContain(`<title>${pageTitle(t, PAGES[domain].base, target)}</title>`);
		// noindex when the DOMAIN is hidden (/wip, /routstr, /relays) or when the SLUG is a
		// section still in development: that address is the operator's own view, and indexing it
		// would put a heading no other reader can reach into a search result ($lib/unreleased).
		const inDevelopment = own(t.sections, slugIn(address, t.path) ?? '')?.unreleased === true;
		expect(
			head.includes('<meta name="robots" content="noindex"'),
			'noindex exactly when hidden or still in development'
		).toBe(isHiddenPath(address) || inDevelopment);
		expect(body).toContain(`id="panel-${target.pill}"`);
		// one panel: the pill the address names, and no other
		expect(body.match(/id="panel-[a-z-]+"/g)).toEqual([`id="panel-${target.pill}"`]);
		// and the pill bar marks that pill: the current page at the pill's own address, the current
		// item at a section's on it (its link goes to the pill's address, not this one)
		const marking = address === addressOf(t, target.pill) ? 'page' : 'true';
		expect(body).toContain(`<a href="${addressOf(t, target.pill)}" id="tab-${target.pill}" aria-current="${marking}"`);
		expect(body.match(/aria-current="[a-z]+"/g)).toEqual([`aria-current="${marking}"`]);
	});

	it('gives every address of a domain a different page title', () => {
		for (const [domain, t] of SERVED) {
			const titles = answered(t).map((a) => /<title>([^<]*)<\/title>/.exec(serverRender(domain, t, a).head)?.[1]);
			expect(new Set(titles).size, domain).toBe(titles.length);
		}
	});
});
