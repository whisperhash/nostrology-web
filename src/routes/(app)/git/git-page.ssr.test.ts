// @vitest-environment node
//
// /git rendered the way SvelteKit renders it on the server (svelte/server on the server
// compile - the "ssr" project in vitest.workspace.ts). The jsdom page tests use Svelte's
// client build, so they cannot see a page that only breaks on the server: touching
// window, history or document outside `browser`, or a reactive statement that throws
// during the server render. That class took /relays and /lightning down in September
// (failed-query.ssr.test.ts). Rendered with the fixture, and with a real document when
// NGIT_SNAPSHOT_JSON names one.
import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { readable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NgitSnapshot } from '$lib/shared/data-types';
import NgitPage from './+page.svelte';
import { FIXTURE } from './fixture';

vi.mock('$app/stores', () => ({
	page: readable({ url: new URL('https://site.test/git') })
}));

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
	consoleError.mockRestore();
});

function serverRender(snapshot: NgitSnapshot) {
	const { body, head } = render(NgitPage, { props: { data: { snapshot } } });
	return { body, head };
}

describe('/git server render', () => {
	it('renders the cards, the Overview pill and the whole ledger, indexable', () => {
		const { body, head } = serverRender(FIXTURE);
		expect(body).toContain('id="ngit-cards"');
		expect(body).toContain('4,527');
		expect(body).toContain('id="panel-overview"');
		// the server knows no hash: Overview is the pill it sends
		expect(body).not.toContain('id="panel-hosting"');
		expect(body.match(/data-ledger-row/g)).toHaveLength(FIXTURE.exclusions.length);
		// launched on 2026-10-15: no longer noindex
		expect(head).not.toContain('noindex');
		// the snapshot's dates are in the server HTML before any script runs: in the footer's
		// first sentence, and only there since 2026-10-18 (the operator's choice; a line under
		// the title said the same from 2026-09-26)
		expect(body).not.toContain('id="ngit-asof"');
		expect(body).toMatch(
			/id="ngit-footer"[^>]*>[^]*?<time datetime="2026-09-24">Sep 24, 2026<\/time>[^]*?<time datetime="2026-09-25 03:31:07Z">2026-09-25 03:31:07Z<\/time>/
		);
		expect(body.indexOf('id="ngit-footer"')).toBeGreaterThan(body.indexOf('id="ngit-cards"'));
		// the page is named for the whole ecosystem, not for one client
		expect(head).toContain('<title>Nostrology - Git on Nostr</title>');
		// the link-preview title, the operator's of 2026-10-15 (the landing's "in numbers")
		expect(head).toContain('<meta property="og:title" content="Git on Nostr, in numbers"');
		expect(body).toMatch(/<h1[^>]*>Git on Nostr<\/h1>/);
		// the Overview pill opens on the charts; the method section closes it
		expect(body.indexOf('id="ngit-cumulative"')).toBeLessThan(body.indexOf('id="ngit-new-repos"'));
		expect(body.indexOf('id="ngit-pushed"')).toBeGreaterThan(-1);
		expect(body.indexOf('id="ngit-pushed"')).toBeLessThan(body.indexOf('id="methodology"'));
		// What is counted is in the SERVER's HTML, and closed there at the bare /git: its own
		// address, /git/methodology, is what sends it open (git-section-links.ssr.test.ts).
		// by its id, never "the first <details>": the Collaboration pill has one of its own,
		// and a second one added above this on Overview would make the check read the wrong tag
		const details = [...body.matchAll(/<details[^>]*>/g)].map((m) => m[0]).filter((t) => t.includes('id="methodology"'));
		expect(details).toHaveLength(1);
		expect(details[0]).not.toMatch(/\sopen\b/);
		// and the icon that copies the address is in it too, as a plain link to it - which is
		// all it is with no JavaScript, and what a right-click "Copy link" copies
		const links = [...body.matchAll(/<a[^>]*data-methodology-link[^>]*>/g)].map((m) => m[0]);
		expect(links).toHaveLength(1);
		expect(links[0]).toContain('href="/git/methodology"');
		expect(body.indexOf(links[0])).toBeLessThan(body.indexOf(details[0]));
		expect(consoleError).not.toHaveBeenCalled();
	});

	const PATH = process.env.NGIT_SNAPSHOT_JSON;
	it.skipIf(!PATH)('renders a real document (NGIT_SNAPSHOT_JSON)', () => {
		const snapshot = JSON.parse(readFileSync(PATH as string, 'utf8')) as NgitSnapshot;
		const { body } = serverRender(snapshot);
		expect(body).toContain(snapshot.generated_utc);
		expect(body.match(/data-ledger-row/g)).toHaveLength(snapshot.exclusions.length);
		expect(consoleError).not.toHaveBeenCalled();
	});
});
