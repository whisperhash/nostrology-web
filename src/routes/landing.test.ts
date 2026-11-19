import { render, fireEvent } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';

// `$env/dynamic/public` is populated by the SvelteKit dev/build server, not under
// vitest. The landing PAGE takes its endpoint as a prop, but the server load reads
// the env directly, so the stub is needed for the load-function tests below.
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_MCP_ENDPOINT: '' } }));

// The landing's data functions, each hanging forever: the load-function tests below prove the
// page never waits on them (the landing cache reads them on its own clock). Counted, so a test
// can also see that the cache did start reading.
const dataCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('$lib/db/postgres', () => {
	const hang = () => {
		dataCalls.count += 1;
		return new Promise(() => {});
	};
	return {
		getMarketplacesSnapshot: hang,
		getNgitSnapshot: hang,
		getZapstoreAppsCumulativeDaily: hang,
		getNutzapsDailySeries: hang,
		getNutzapMintStats: hang,
		getLightningProviderStats: hang,
		getLightningTrendsSatsShare: hang
	};
});

import Page from './+page.svelte';
import { HARNESSES } from '$lib/mcp/harnesses';
import { buildBoard, DOMAINS } from '$lib/landing/board';
import { visibleNavItems } from '$lib/nav';
import { DEFAULT_MCP_ENDPOINT } from '$lib/mcp/endpoint';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENDPOINT = 'https://landing.test/mcp';
// Deliberately a DIFFERENT host from the endpoint: canonical/og must follow the
// page's own origin, not whatever PUBLIC_MCP_ENDPOINT happens to point at.
const ORIGIN = 'https://site.test';

function renderLanding() {
	return render(Page, {
		props: { data: { session: null, analyticsOff: false, endpoint: ENDPOINT, origin: ORIGIN, board: buildBoard({}).board } }
	});
}

/**
 * The landing page exists to be read by machines as much as by people: crawlers,
 * link-preview fetchers and agents pulling the raw HTML. jsdom cannot evaluate the
 * CSS or run GSAP, but it CAN assert the contract that matters for those readers -
 * that the content is in the markup rather than assembled by script, and that every
 * quoted endpoint comes from configuration rather than a literal.
 */
describe('landing page', () => {
	it('renders every harness panel, with only the first visible', () => {
		const { container } = renderLanding();
		// In The machine surface: the board's panels are tab panels too.
		const panels = container.querySelectorAll('#connect [role="tabpanel"]');

		expect(panels.length).toBe(HARNESSES.length);
		expect(HARNESSES.length).toBeGreaterThan(1);

		// All present in the served HTML; visibility alone distinguishes them, so a
		// crawler that never clicks still gets all thirteen snippets.
		const visible = Array.from(panels).filter((p) => !(p as HTMLElement).hidden);
		expect(visible.length).toBe(1);
		expect(visible[0].id).toBe(`hp-${HARNESSES[0].id}`);
	});

	it('quotes the configured endpoint in every snippet, never a literal', () => {
		const { container } = renderLanding();
		const snippets = Array.from(container.querySelectorAll('#connect [role="tabpanel"] pre code')).map(
			(el) => el.textContent ?? ''
		);

		expect(snippets.length).toBe(HARNESSES.length);
		for (const snippet of snippets) {
			expect(snippet).toContain(ENDPOINT);
		}
		// The built-in fallback must not survive anywhere on the page: every quoted address
		// comes from configuration. (Guarded against going vacuous: the assertion means
		// nothing if the configured endpoint IS the fallback.)
		expect(ENDPOINT).not.toBe(DEFAULT_MCP_ENDPOINT);
		expect(container.innerHTML).not.toContain(DEFAULT_MCP_ENDPOINT);
	});

	it('switches the visible panel when a harness tab is chosen', async () => {
		const { container, getByRole } = renderLanding();
		const target = HARNESSES[3];

		await fireEvent.click(getByRole('tab', { name: target.name }));

		const visible = Array.from(container.querySelectorAll('#connect [role="tabpanel"]')).filter(
			(p) => !(p as HTMLElement).hidden
		);
		expect(visible.length).toBe(1);
		expect(visible[0].id).toBe(`hp-${target.id}`);
		expect(getByRole('tab', { name: target.name }).getAttribute('aria-selected')).toBe('true');
	});

	it('offers the mcp-remote fallback for stdio-only harnesses', () => {
		const { container } = renderLanding();
		expect(container.textContent).toContain(`npx mcp-remote ${ENDPOINT}`);
	});

	it('server-renders the finished terminal transcript', () => {
		// The animation REPLAYS this; it does not create it. A reader without
		// JavaScript, and every crawler, must still see the session.
		const { container } = renderLanding();
		const out = container.querySelector('#out');

		expect(out?.textContent).toContain('nostrology_query_metric');
		expect(out?.textContent).toContain('app_stack_count');
		expect(out?.textContent).toContain(ENDPOINT);
	});

	it('renders the final counter value rather than counting up from empty', () => {
		// GSAP animates 0 -> value; the SSR'd markup carries the value, so the
		// no-JavaScript rendering is the correct one and the animation can never
		// leave a wrong number on screen. One counter: the figure on the board's tab open
		// on load (Marketplaces); here, with nothing loaded, its typed fallback.
		const { container } = renderLanding();
		const counters = Array.from(container.querySelectorAll('.num'));
		const marketplaces = DOMAINS.find((d) => d.key === 'marketplaces')!;

		expect(counters.length).toBe(1);
		expect(counters[0].textContent).toBe(marketplaces.fallback.toLocaleString('en-US'));
		expect(counters[0].getAttribute('data-to')).toBe(String(marketplaces.fallback));
	});

	it('exposes a hamburger that reveals every nav destination', async () => {
		const { container, getByLabelText } = renderLanding();
		const panel = container.querySelector('#navMobile') as HTMLElement;
		const toggle = getByLabelText('Toggle navigation menu');

		expect(panel.hidden).toBe(true);
		expect(toggle.getAttribute('aria-expanded')).toBe('false');

		await fireEvent.click(toggle);

		expect(panel.hidden).toBe(false);
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		const hrefs = Array.from(panel.querySelectorAll('a')).map((a) => a.getAttribute('href'));
		expect(hrefs).toEqual(['/zapstore', '/marketplaces', '/git', '/lightning', '/nutzaps', '/data']);
	});

	it("links every board panel to the surface its figure is from, in the nav's order", () => {
		const { container } = renderLanding();
		const hrefs = Array.from(container.querySelectorAll('.board-panel .cta')).map((a) => a.getAttribute('href'));
		expect(hrefs).toEqual(DOMAINS.map((d) => d.href));
		expect(hrefs).toEqual(['/zapstore', '/marketplaces', '/git', '/lightning', '/nutzaps']);
	});

	it('leads with the headline and the line under it, then the board with the MCP bar under the roster', () => {
		const { container } = renderLanding();
		const hero = container.querySelector('header.hero')!;
		expect(hero.querySelector('h1')!.textContent).toBe('Nostr growth, in\u00a0numbers.');
		expect(hero.querySelector('.sub')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
			'Prominent domains of the Nostr ecosystem, observed from the raw events: in charts and stats for you, and an MCP endpoint for your agent. One daily-fresh archive serving both.'
		);
		expect(hero.querySelector('.kicker')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
			'Nostr ecosystem observatory methodology included Updated daily'
		);
		// the roster, then the MCP bar with the configured endpoint, inside the board
		const board = hero.querySelector('.board')!;
		const roster = board.querySelector('.board-tabs')!;
		const bar = board.querySelector('.mcpbar')!;
		expect(roster.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(bar.querySelector('code')!.textContent).toBe(ENDPOINT);
		expect(bar.querySelector('.mb-facts')!.textContent).toBe('Metrics and records as tools your agent calls. No\u00a0account, no API key.');
		expect(bar.querySelector('.mb-go')!.getAttribute('href')).toBe('#connect');
	});

	it('heads The machine surface with its two lines, the line under it, and the terminal', () => {
		const { container } = renderLanding();
		const section = container.querySelector('#connect')!;
		expect(section.querySelector('.sec-num')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('02 The machine surface');
		const h2 = section.querySelector('h2')!;
		expect(h2.textContent).toBe('Point an agent at it.One line in whatever harness you already use.');
		// the two sentences on two lines
		expect(h2.querySelector('br')!.previousSibling!.textContent).toBe('Point an agent at it.');
		const lead = section.querySelector('.lead')!.textContent!;
		// \s matches a no-break space too, so normalise the layout whitespace first and check
		// the no-break space by itself: "question needs." is joined, so "needs." never sits alone.
		expect(lead.replace(/[ \t\n]+/g, ' ').trim()).toBe(
			'Same archive, any angle: slice, dice and compare the numbers however your question\u00a0needs.'
		);
		expect(section.querySelector('#out')).not.toBeNull();
		// the sections the board replaced are gone, and so is the closing call
		expect(container.querySelector('#tools')).toBeNull();
		expect(container.querySelector('#surfaces')).toBeNull();
		expect(container.querySelector('.final')).toBeNull();
	});
});

describe('landing route wiring', () => {
	it('serves a page rather than redirecting to /relays', async () => {
		// `/` was a 307 to /relays until 2026-08-15. A load that throws a redirect
		// would fail here rather than silently reappear.
		const { load } = await import('./+page.server');
		const result = await (
			load as (e: { url: URL }) => Promise<{ endpoint: string; origin: string; board: { panels: unknown[] } }>
		)({ url: new URL('https://site.test/') });
		expect(result.endpoint).toBeTruthy();
		// The page's identity comes from the request, not from PUBLIC_MCP_ENDPOINT.
		expect(result.origin).toBe('https://site.test');
		expect(result.board.panels).toHaveLength(5);
	});

	it('reads the database only through the landing cache', () => {
		// `/` absorbs every crawler, scanner and link-preview fetch that reaches the bare
		// hostname, so a query per request would hand every one of them an Aurora query. Until
		// 2026-10-15 that kept the landing DB-free outright; since then its board reads the
		// surface pages' data through $lib/server/landing, on that cache's own clock.

		// /data is still DB-free. An IMPORT, not a mention: the file names the module in the
		// comment that explains why it must not import it.
		const data = readFileSync(resolve(HERE, '(app)/data/+page.server.ts'), 'utf8');
		expect(data).not.toMatch(/^\s*import[^\n]*\$lib\/db\/postgres/m);

		// An import, static or dynamic, either quote - not a mention: cache.ts names the pool's
		// module in a comment. These catch the obvious slip; the per-request test below catches
		// a read whatever path it arrives by.
		const imports = (source: string, prefix: string) =>
			[...source.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]).filter((m) => m.startsWith(prefix));

		// The landing's load imports nothing from $lib/db, and from $lib/server only the cache.
		const load = readFileSync(resolve(HERE, '+page.server.ts'), 'utf8');
		expect(imports(load, '$lib/db/')).toEqual([]);
		expect(imports(load, '$lib/server/')).toEqual(['$lib/server/landing']);

		// The page component reaches neither.
		const page = readFileSync(resolve(HERE, '+page.svelte'), 'utf8');
		expect([...imports(page, '$lib/db/'), ...imports(page, '$lib/server/')]).toEqual([]);

		// Inside the cache, only the list of sources touches the data functions, so a new
		// read cannot slip in beside the clock.
		const landingDir = resolve(HERE, '../lib/server/landing');
		for (const file of ['cache.ts', 'index.ts', 'fixture.ts']) {
			expect(imports(readFileSync(resolve(landingDir, file), 'utf8'), '$lib/db/')).toEqual([]);
		}
		expect(imports(readFileSync(resolve(landingDir, 'sources.ts'), 'utf8'), '$lib/db/')).toEqual(['$lib/db/postgres']);
	});

	it('never waits on the database', async () => {
		// Every data function hangs forever (the mock at the top). The load must still answer
		// at once, with the typed fallbacks.
		const { load } = await import('./+page.server');
		const answered = (
			load as (e: { url: URL }) => Promise<{ board: { panels: { live: boolean; chart: unknown }[] } }>
		)({ url: new URL('https://site.test/') });
		const tooLate = new Promise<'waited'>((r) => setTimeout(() => r('waited'), 50));
		const result = await Promise.race([answered, tooLate]);
		expect(result).not.toBe('waited');
		const board = (result as Awaited<typeof answered>).board;
		expect(board.panels.every((p) => !p.live && p.chart === null)).toBe(true);
		// ...and not because nothing was read: the cache did start, on its own clock.
		expect(dataCalls.count).toBeGreaterThan(0);
	});

	it('reads nothing per request, however many requests arrive', async () => {
		// The contract's point: crawlers and link previews must not each cost a query. Whatever
		// path a read arrived by - an import, a helper, the board's own code - fifty more loads
		// must not start a single one. (The first read is still unanswered, hanging like the
		// rest, so the cache's own clock starts no other either.)
		const { load } = await import('./+page.server');
		const run = load as (e: { url: URL }) => Promise<unknown>;
		await run({ url: new URL('https://site.test/') });
		const before = dataCalls.count;
		for (let i = 0; i < 50; i++) await run({ url: new URL('https://site.test/') });
		expect(dataCalls.count).toBe(before);
	});
});

describe('the palette', () => {
	// The board colours each surface with a CSS variable (board.ts DOMAINS accent). An undefined
	// one draws nothing: Git-on-Nostr's red was missing once, which left its dot, its "New" and
	// its button invisible (2026-10-15, caught by eye against the prototype).
	it("defines every surface's accent on the landing", () => {
		const page = readFileSync(resolve(HERE, '+page.svelte'), 'utf8');
		const defined = new Set([...page.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]));
		for (const d of DOMAINS) {
			const v = d.accent.match(/^var\((--[a-z0-9-]+)\)$/)![1];
			expect(defined.has(v), `${d.key}: ${v}`).toBe(true);
		}
	});
});

describe('MCP endpoint resolution', () => {
	// Regression: the loaders used `??`, which falls back only on undefined/null.
	// Compose passes env vars set-but-possibly-empty, so a blank value survived as
	// '' and rendered as the endpoint everywhere on the page.
	it('treats an empty or blank environment value as absent', async () => {
		const { resolveEndpoint, DEFAULT_MCP_ENDPOINT } = await import('$lib/mcp/endpoint');
		expect(resolveEndpoint('')).toBe(DEFAULT_MCP_ENDPOINT);
		expect(resolveEndpoint('   ')).toBe(DEFAULT_MCP_ENDPOINT);
		expect(resolveEndpoint(undefined)).toBe(DEFAULT_MCP_ENDPOINT);
		expect(resolveEndpoint('https://elsewhere.test/mcp')).toBe('https://elsewhere.test/mcp');
	});
});

describe('root error page', () => {
	// Regression guard for the (app) route-group move: the chrome USED to be the root
	// layout, so an unmatched URL rendered with nav and footer. Once the chrome moved
	// into (app), SvelteKit's bare fallback was all a 404 got - no way onward from a
	// stale link. This page restores that, at the root so it covers the landing page
	// and every (app) route without a closer +error.svelte.
	it('offers every nav destination on a 404', async () => {
		const { readable } = await import('svelte/store');
		vi.doMock('$app/stores', () => ({
			page: readable({ status: 404, error: { message: 'Not Found' }, url: new URL('http://x/y') })
		}));
		const { default: ErrorPage } = await import('./+error.svelte');
		const { container } = render(ErrorPage);

		const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
		// Derived from NAV_ITEMS, not hand-copied: this page hand-copied the nav once and
		// drifted from it. '/' is the logo, which is not a nav item.
		// visibleNavItems(false), not NAV_ITEMS: like the nav and the footer, this page gates
		// the list, so an anonymous visitor is not offered an unreleased domain here either.
		expect(hrefs).toEqual(['/', ...visibleNavItems(false).map((i) => i.href)]);
		expect(container.textContent).toContain('No such page');
	});
});

describe('animation failure safety net', () => {
	// The reveal gate is inverted - `.has-gsap .rv { opacity: 0 }` - so by the time
	// onMount runs, the targets are ALREADY hidden. Anything that throws during setup
	// would strand them there: content present in the DOM, invisible on screen, which
	// is precisely what the inverted gate exists to prevent. Dropping the class is the
	// recovery, and this asserts it actually happens.
	it('reveals the static page when GSAP setup throws', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		document.documentElement.classList.add('has-gsap');
		(window as unknown as { gsap: unknown }).gsap = {
			registerPlugin: () => {},
			timeline: () => {
				throw new Error('simulated GSAP failure');
			}
		};
		(window as unknown as { ScrollTrigger: unknown }).ScrollTrigger = { getAll: () => [] };

		try {
			renderLanding();
			expect(document.documentElement.classList.contains('has-gsap')).toBe(false);
			expect(error).toHaveBeenCalled();
		} finally {
			document.documentElement.classList.remove('has-gsap');
			delete (window as unknown as { gsap?: unknown }).gsap;
			delete (window as unknown as { ScrollTrigger?: unknown }).ScrollTrigger;
			error.mockRestore();
		}
	});
});

describe('page identity', () => {
	// The canonical URL and the social card must follow the PAGE's origin. Deriving
	// them from PUBLIC_MCP_ENDPOINT - which is allowed to name a different host -
	// would silently relocate them to somewhere that does not serve this page.
	it('takes canonical, og:url and og:image from the request origin, not the endpoint', () => {
		renderLanding();
		const attr = (sel: string, name: string) =>
			document.head.querySelector(sel)?.getAttribute(name);

		expect(attr('link[rel="canonical"]', 'href')).toBe(`${ORIGIN}/`);
		expect(attr('meta[property="og:url"]', 'content')).toBe(`${ORIGIN}/`);
		expect(attr('meta[property="og:image"]', 'content')).toBe(`${ORIGIN}/social-card.png`);
		expect(attr('meta[name="twitter:image"]', 'content')).toBe(`${ORIGIN}/social-card.png`);
		// The endpoint's host must not leak into the page's identity.
		expect(document.head.innerHTML).not.toContain('landing.test/');
	});

	// The landing page's card USED to be a hand-written block in this file; it now comes
	// from the shared <SocialMeta>. That migration was verified tag-for-tag by hand, but
	// only four of the twelve tags were asserted here - so "the test still passes" was not
	// evidence of parity. Pin the whole set, since one component now owns every page's card
	// and a change here silently changes all eighteen.
	it('emits the complete card, unchanged by the move to the shared component', () => {
		renderLanding();
		const attr = (sel: string, name = 'content') =>
			document.head.querySelector(sel)?.getAttribute(name);

		// The headline and the line under it, word for word as picked on 2026-10-15.
		expect(document.title).toBe('Nostrology - Nostr growth, in numbers');
		expect(attr('meta[name="description"]')).toBe(
			'Prominent domains of the Nostr ecosystem, observed from the raw events: in charts and stats for you, and an MCP endpoint for your agent. One daily-fresh archive serving both.'
		);

		expect(attr('meta[property="og:type"]')).toBe('website');
		expect(attr('meta[property="og:site_name"]')).toBe('nostrolo.gy');
		expect(attr('meta[property="og:title"]')).toBe('Nostr growth, in numbers');
		expect(attr('meta[property="og:description"]')).toBe(
			'Prominent domains of the Nostr ecosystem, observed from the raw events: in charts and stats for you, and an MCP endpoint for your agent.'
		);

		expect(attr('meta[name="twitter:card"]')).toBe('summary_large_image');
		expect(attr('meta[name="twitter:title"]')).toBe('Nostr growth, in numbers');
		expect(attr('meta[name="twitter:description"]')).toBe(
			'Prominent domains of the Nostr ecosystem, observed from the raw events: in charts and stats for you, and an MCP endpoint for your agent.'
		);

		// The site card is 1200x630 and this page uses it, so the dimensions must be declared.
		expect(attr('meta[property="og:image:width"]')).toBe('1200');
		expect(attr('meta[property="og:image:height"]')).toBe('630');
	});

	// Google's site-name inputs, strongest first: WebSite structured data on the home page,
	// then og:site_name, then <title>. The brand term people search for ("Nostrology") goes
	// in the first and the last; og:site_name stays the domain on purpose, so social cards
	// keep teaching people the URL.
	it('names the site "Nostrology" in WebSite structured data, on the page origin', () => {
		renderLanding();
		const scripts = document.head.querySelectorAll('script[type="application/ld+json"]');
		expect(scripts.length).toBe(1);
		const record = JSON.parse(scripts[0].textContent ?? '');
		expect(record).toEqual({
			'@context': 'https://schema.org',
			'@type': 'WebSite',
			name: 'Nostrology',
			alternateName: 'nostrolo.gy',
			// The page's own origin, like the canonical - never the endpoint's host.
			url: `${ORIGIN}/`
		});
		expect(document.head.querySelector('meta[property="og:site_name"]')?.getAttribute('content')).toBe(
			'nostrolo.gy'
		);
	});
});

describe('terminal transcript animation', () => {
	// The animation used to recover each line's kind by pattern-matching the <pre>'s
	// innerHTML. Svelte's {@html} leaves an anchor comment, so the FIRST line arrived
	// as `<!---->` + the command, the prompt-anchored test missed it, and the
	// `claude mcp add` line - the whole point of the terminal - was dumped rather than
	// typed. Driving off the Step[] discriminant is what fixes it, so assert the
	// discriminant is there to drive off.
	it('marks the command and question lines as typed, distinct from streamed output', async () => {
		const { transcript } = await import('$lib/landing/terminal');
		const steps = transcript(ENDPOINT);

		expect(steps[0].t).toBe('cmd');
		expect(steps[0].s).toContain('claude mcp add');
		expect(steps.some((s) => s.t === 'ask')).toBe(true);
		expect(steps.some((s) => s.t === 'call')).toBe(true);
		// Nothing else may be typed - typing a streamed response line would misrepresent
		// what a tool call looks like.
		expect(steps.filter((s) => s.t === 'cmd' || s.t === 'ask').length).toBe(2);
	});

	it('escapes the endpoint it interpolates', async () => {
		const { transcriptHtml } = await import('$lib/landing/terminal');
		const html = transcriptHtml('https://x.test/mcp?a=1&b="><script>');
		expect(html).not.toContain('<script>');
		expect(html).toContain('&amp;b=&quot;&gt;&lt;script&gt;');
	});
});
