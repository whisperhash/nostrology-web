// @vitest-environment node
//
// /routstr rendered the way SvelteKit renders it on the server (svelte/server on the server
// compile: the node environment and the "ssr" project in vitest.workspace.ts), for what only
// the server's HTML can show: What is counted is in it, CLOSED at the bare /routstr, with
// its content, and OPEN at its own address, /routstr/methodology (CLAUDE.md -> "Every
// domain page's What is counted has an address"); and each pill's address arrives on its pill.
import { render } from 'svelte/server';
import { readable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';

import RoutstrPage from './+page.svelte';
import { SNAPSHOT } from './fixture';

// Every page renders <SocialMeta>, which reads $page; a page rendered on its own has no
// router, so the store is supplied here - same pattern as the other page tests.
vi.mock('$app/stores', () => ({
	page: readable({ url: new URL('https://site.test/routstr') })
}));

describe('/routstr on the server', () => {
	it('renders What is counted last on Overview, as a closed <details> with the icon that links its address', () => {
		const { body } = render(RoutstrPage, { props: { data: { snapshot: SNAPSHOT } } });
		// by its id, never "the first <details>"
		const details = [...body.matchAll(/<details[^>]*>/g)].map((m) => m[0]).filter((t) => t.includes('id="methodology"'));
		expect(details).toHaveLength(1);
		expect(details[0]).not.toMatch(/\sopen\b/);
		// closed, the content is still there to be read, indexed and linked
		expect(body).toContain('Providers in the aggregates');
		// after the figures it qualifies, not ahead of them as it was until 2026-10-18
		expect(body.indexOf('Cumulative observed revenue')).toBeGreaterThan(-1);
		expect(body.indexOf('Cumulative observed revenue')).toBeLessThan(body.indexOf(details[0]));
		expect(body).not.toContain('and who is not');
		// and the icon that copies the address, as a plain link to it - which is all it is with
		// no JavaScript, and what a right-click "Copy link" copies
		const links = [...body.matchAll(/<a[^>]*data-methodology-link[^>]*>/g)].map((m) => m[0]);
		expect(links).toHaveLength(1);
		expect(links[0]).toContain('href="/routstr/methodology"');
		expect(body.indexOf(links[0])).toBeLessThan(body.indexOf(details[0]));
	});
	it.each([
		['a pill', { kind: 'page', pill: 'providers' }, 'panel-providers', 'Nostrology - Routstr - Providers'],
		['What is counted', { kind: 'page', pill: 'overview', section: 'methodology' }, 'panel-overview', 'Nostrology - Routstr - What is counted']
	] as const)('renders %s at its own address: that pill, its own title, and still hidden from search engines', (_, target, panel, title) => {
		const { body, head } = render(RoutstrPage, { props: { data: { snapshot: SNAPSHOT, target } } });
		expect(body).toContain(`id="${panel}"`);
		expect(head).toContain(`<title>${title}</title>`);
		expect(head).toContain('<meta property="og:title" content="Routstr, measured"');
		// /routstr is hidden, and every address of it with it
		expect(head).toContain('<meta name="robots" content="noindex"');
		const details = /<details[^>]*id="methodology"[^>]*>/.exec(body)?.[0];
		// on Overview the section is there, open at its own address only
		if (panel === 'panel-overview') expect(details).toBeDefined();
		if (details) expect(/\sopen(=""|\s|>)/.test(details)).toBe('section' in target);
	});
});
