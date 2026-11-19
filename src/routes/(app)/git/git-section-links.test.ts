import { fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { readable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { goto, replaceState as kitReplaceState } from '$app/navigation';
import { METHODOLOGY } from '$lib/methodology';
import { addressOf, type Target } from '$lib/slug-table';
import { GIT_SLUGS } from '$lib/slug-tables/git';
import { GLOW_CLASS } from '$lib/section-link';
import NgitPage from './+page.svelte';
import { standInPillRouter } from '../pill-router.test-helper';
import { FIXTURE } from './fixture';

// /git opened at one of its own addresses (/git/zaps, $lib/slug-table): the server answers the
// address (+page.server.ts, domain-loads.test.ts) and hands the page `target`; this pins what
// the page then does with it ($lib/domain-page), on a cold load and across navigations. The
// rules themselves are pinned in src/lib/slug-table.test.ts, the reroute in src/hooks.test.ts,
// the scroll, glow and focus helpers in src/lib/section-link.test.ts, the shared navigation
// logic in src/lib/domain-page.test.ts, and the server render in git-section-links.ssr.test.ts.

// The address is a section's, so a link built from the current address would carry it.
vi.mock('$app/stores', () => ({
	page: readable({ url: new URL('https://site.test/git/zaps') })
}));
// SvelteKit's router, as git-page.test.ts stands it in: replaceState rewrites the entry and
// keeps its state; goto records the moves the page makes itself; afterNavigate keeps the
// callbacks for the tests to call.
const navigated = vi.hoisted(() => ({ callbacks: [] as ((nav: unknown) => void)[] }));
vi.mock('$app/navigation', () => ({
	replaceState: vi.fn((url: string) => window.history.replaceState(window.history.state, '', url)),
	afterNavigate: vi.fn((cb: (nav: unknown) => void) => navigated.callbacks.push(cb)),
	goto: vi.fn(() => Promise.resolve())
}));
// A pill is a link: the router's part in a click is stood in for (pill-router.test-helper.ts).
const pillRouter = standInPillRouter();

const ZAPS: Target = { kind: 'page', pill: 'collaboration', section: 'zaps' };
const OVERVIEW: Target = { kind: 'page', pill: 'overview' };
const HOSTING: Target = { kind: 'page', pill: 'hosting' };
const RETIRED: Target = { kind: 'retired', pill: 'collaboration', title: 'Zaps' };
const MOVE = { replaceState: true, noScroll: true, keepFocus: true };
const renderAt = (target?: Target) => render(NgitPage, { props: { data: { snapshot: FIXTURE, target } } });
const data = (target: Target) => ({ data: { snapshot: FIXTURE, target } });
/** A SvelteKit navigation, as the router hands it to afterNavigate: `route.id` is this
 * route's for a move within it. */
const GIT = { id: '/(app)/git' };
const LANDING = { id: '/' };
const at = (path: string, route = GIT) => ({ url: new URL('https://site.test' + path), route });
const navigate = (nav: unknown) => navigated.callbacks.at(-1)!(nav);
/** The cold load's own navigation, which SvelteKit fires once the page has hydrated. */
const enter = (path = '/git/zaps') => navigate({ type: 'enter', from: null, to: at(path) });
const macrotask = () => new Promise((r) => setTimeout(r, 0));
const zapsCard = (c: HTMLElement) => c.querySelector('#ngit-zaps') as HTMLElement;
/** The open pill: the pill bar marks it as the current page. */
const pill = (c: HTMLElement) => c.querySelector('nav[aria-label="Git on Nostr"] > a[aria-current]')?.id;

let scrollTo: ReturnType<typeof vi.fn>;
beforeEach(() => {
	navigated.callbacks.length = 0;
	vi.mocked(goto).mockClear();
	vi.mocked(kitReplaceState).mockClear();
	scrollTo = vi.fn();
	window.scrollTo = scrollTo as never;
	vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
	// A sticky nav 61 px tall, and every section 2400 px down the page.
	document.body.insertAdjacentHTML('afterbegin', '<nav class="nav"></nav>');
	vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
		return (this.matches('nav.nav') ? { top: 0, height: 61, bottom: 61 } : { top: 2400, height: 300 }) as DOMRect;
	});
	window.history.replaceState(null, '', '/git/zaps');
});
afterEach(() => {
	document.querySelector('nav.nav')?.remove();
	window.history.replaceState(null, '', '/');
	Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true, writable: true });
	vi.restoreAllMocks();
});

describe("/git's slug table and page agree", () => {
	it("draws the table's pills, in its order", () => {
		const { container } = renderAt();
		const ids = [...container.querySelectorAll('nav[aria-label="Git on Nostr"] > a')].map((t) => t.id.replace(/^tab-/, ''));
		expect(ids).toEqual(GIT_SLUGS.pills.map((p) => p.slug));
	});

	it('puts every section on the pill the table says', async () => {
		const { container } = renderAt();
		for (const [slug, s] of Object.entries(GIT_SLUGS.sections)) {
			await fireEvent.click(container.querySelector(`#tab-${s.pill}`)!);
			expect(container.querySelector(`#panel-${s.pill} #${s.elementId}`), slug).not.toBeNull();
		}
	});

	it('gives every section its link icon, to its own address, beside the heading - never inside it', async () => {
		const { container } = renderAt();
		for (const [slug, s] of Object.entries(GIT_SLUGS.sections)) {
			await fireEvent.click(container.querySelector(`#tab-${s.pill}`)!);
			const card = container.querySelector(`#${s.elementId}`) as HTMLElement;
			// What is counted's icon is MethodologySection's own, beside its <details>
			const link = (
				slug === METHODOLOGY
					? card.parentElement!.querySelector(':scope > a[data-methodology-link]')
					: card.querySelector(':scope > a[data-section-link]')
			) as HTMLAnchorElement | null;
			expect(link?.getAttribute('href'), slug).toBe(addressOf(GIT_SLUGS, slug));
			expect(link?.textContent?.trim(), slug).toBe(`Copy link to ${s.title}`);
			expect(card.querySelector('h2 a'), slug).toBeNull();
			// positioned against the card it sits on (MethodologySection's wrapper positions its own)
			if (slug === METHODOLOGY) expect(card.parentElement!.classList.contains('methodology'), slug).toBe(true);
			else expect(card.classList.contains('relative'), slug).toBe(true);
		}
	});
});

describe('the link icon on a phone (P1)', () => {
	const zapsLink = (c: HTMLElement) => zapsCard(c).querySelector('a[data-section-link]') as HTMLAnchorElement;
	/** Where the Zaps heading is on screen; every other element keeps the stand-in geometry. */
	const zapsHeadingAt = (top: number) =>
		vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
			if (this.matches('nav.nav')) return { top: 0, height: 61, bottom: 61 } as DOMRect;
			if (this.matches('#ngit-zaps > h2')) return { top, height: 28, bottom: top + 28 } as DOMRect;
			return { top: 2400, height: 300, bottom: 2700 } as DOMRect;
		});
	const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));

	it("is drawn on Zaps while its heading is on screen, and goes as the heading scrolls away", async () => {
		Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true, writable: true });
		zapsHeadingAt(300);
		const { container } = renderAt(ZAPS);
		await tick();
		await tick();
		expect(zapsLink(container).classList.contains('phone-shown')).toBe(true);
		zapsHeadingAt(20); // under the nav
		window.dispatchEvent(new Event('scroll'));
		await frame();
		await tick();
		expect(zapsLink(container).classList.contains('phone-shown')).toBe(false);
		zapsHeadingAt(500);
		window.dispatchEvent(new Event('scroll'));
		await frame();
		await tick();
		expect(zapsLink(container).classList.contains('phone-shown')).toBe(true);
		zapsHeadingAt(830); // its bottom below the screen's
		window.dispatchEvent(new Event('scroll'));
		await frame();
		await tick();
		expect(zapsLink(container).classList.contains('phone-shown')).toBe(false);
	});

	it('is worked out again when the screen changes size (a phone turned on its side)', async () => {
		Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true, writable: true });
		zapsHeadingAt(600);
		const { container } = renderAt(ZAPS);
		await tick();
		await tick();
		expect(zapsLink(container).classList.contains('phone-shown')).toBe(true);
		Object.defineProperty(window, 'innerHeight', { value: 390, configurable: true, writable: true });
		window.dispatchEvent(new Event('resize'));
		await frame();
		await tick();
		expect(zapsLink(container).classList.contains('phone-shown')).toBe(false);
	});

	it('is worked out again when the page shifts with no scroll at all (a section above folding shut)', async () => {
		Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true, writable: true });
		// jsdom has no ResizeObserver: a stand-in the test can fire, as the browser would when
		// the page's height changes - for whatever the page asked it to observe, and nothing else
		const fire: (() => void)[] = [];
		vi.stubGlobal(
			'ResizeObserver',
			class {
				constructor(private cb: () => void) {}
				observe() {
					fire.push(this.cb);
				}
				disconnect() {}
			}
		);
		try {
			zapsHeadingAt(900); // below the screen
			const { container } = renderAt(ZAPS);
			await tick();
			await tick();
			expect(zapsLink(container).classList.contains('phone-shown')).toBe(false);
			zapsHeadingAt(400); // a <details> above closed: the heading moved up, nothing scrolled
			fire.forEach((cb) => cb());
			await frame();
			await tick();
			expect(zapsLink(container).classList.contains('phone-shown')).toBe(true);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('is drawn nowhere while the open pill has no section with an address', async () => {
		zapsHeadingAt(300);
		const { container } = renderAt(OVERVIEW);
		await tick();
		await tick();
		expect(container.querySelector('a[data-section-link].phone-shown')).toBeNull();
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		await tick();
		await tick();
		expect(zapsLink(container).classList.contains('phone-shown')).toBe(true);
	});
});

describe('/git/zaps, a cold load', () => {
	it('opens on Collaboration, the Zaps card just under the nav, glowing once, with focus', async () => {
		const { container } = renderAt(ZAPS);
		await tick();
		expect(pill(container)).toBe('tab-collaboration');
		enter();
		expect(scrollTo).toHaveBeenLastCalledWith({ top: 0 + 2400 - 61 - 8 });
		expect(zapsCard(container).classList.contains(GLOW_CLASS)).toBe(true);
		expect(document.activeElement).toBe(zapsCard(container));
	});

	it('waits for a background tab to be shown before glowing', async () => {
		const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
		const { container } = renderAt(ZAPS);
		await tick();
		enter();
		expect(zapsCard(container).classList.contains(GLOW_CLASS)).toBe(false);
		visibility.mockReturnValue('visible');
		document.dispatchEvent(new Event('visibilitychange'));
		expect(zapsCard(container).classList.contains(GLOW_CLASS)).toBe(true);
	});

	it("keeps the reader's own scroll on a reload: no jump, no glow", async () => {
		vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'reload' }] as never);
		const { container } = renderAt(ZAPS);
		await tick();
		enter();
		expect(scrollTo).not.toHaveBeenCalled();
		expect(zapsCard(container).classList.contains(GLOW_CLASS)).toBe(false);
		// the pill is still the server's answer
		expect(pill(container)).toBe('tab-collaboration');
	});

	it("does nothing before the cold load completes: the arrival is the router's `enter`, not the mount", async () => {
		const { container } = renderAt(ZAPS);
		await tick();
		await macrotask();
		expect(scrollTo).not.toHaveBeenCalled();
		expect(zapsCard(container).classList.contains(GLOW_CLASS)).toBe(false);
	});

	it("names the section in the page title, and the pill once the router has moved to the pill's address", async () => {
		const { container, rerender } = renderAt(ZAPS);
		await tick();
		expect(document.title).toBe('Nostrology - Git on Nostr - Zaps');
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		window.history.replaceState(null, '', '/git/hosting');
		await rerender(data(HOSTING));
		navigate({ type: 'link', from: at('/git/zaps'), to: at('/git/hosting') });
		await tick();
		expect(document.title).toBe('Nostrology - Git on Nostr - Hosting');
	});

	it("sends a pill click from /git/zaps to the pill's own address, never a section's", async () => {
		const { container } = renderAt(ZAPS);
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		expect(pillRouter.routed).toEqual(['/git/hosting']);
		expect(pill(container)).toBe('tab-hosting');
		// the page writes no address itself
		expect(vi.mocked(kitReplaceState)).not.toHaveBeenCalled();
		expect(vi.mocked(goto)).not.toHaveBeenCalled();
	});

	it('links What is counted at its own address, /git/methodology, from any of the pages addresses', () => {
		window.history.replaceState(null, '', '/git/zaps');
		const { container } = renderAt(OVERVIEW);
		const link = container.querySelector('a[data-methodology-link]') as HTMLAnchorElement;
		expect(link.getAttribute('href')).toBe('/git/methodology');
	});

	it('shows no note', () => {
		const { container } = renderAt(ZAPS);
		expect(container.querySelector('[data-transient-note]')).toBeNull();
	});
});

describe('/git/zaps across navigations', () => {
	it("an in-site link from /git to /git/zaps: Collaboration, then the section, after the router's own scroll", async () => {
		window.history.replaceState(null, '', '/git');
		const { container, rerender } = renderAt(OVERVIEW);
		await tick();
		window.history.replaceState(null, '', '/git/zaps');
		await rerender(data(ZAPS));
		navigate({ type: 'link', from: at('/git'), to: at('/git/zaps') });
		await tick();
		expect(pill(container)).toBe('tab-collaboration');
		expect(scrollTo).not.toHaveBeenCalled(); // deferred past the router's scroll
		await macrotask();
		expect(scrollTo).toHaveBeenLastCalledWith({ top: 0 + 2400 - 61 - 8 });
		expect(zapsCard(container).classList.contains(GLOW_CLASS)).toBe(true);
		expect(document.title).toBe('Nostrology - Git on Nostr - Zaps');
	});

	it('the nav Git link from /git/zaps: Overview, the plain title, no jump', async () => {
		const { container, rerender } = renderAt(ZAPS);
		await tick();
		window.history.replaceState(null, '', '/git');
		await rerender(data(OVERVIEW));
		navigate({ type: 'link', from: at('/git/zaps'), to: at('/git') });
		await tick();
		await macrotask();
		expect(pill(container)).toBe('tab-overview');
		expect(document.title).toBe('Nostrology - Git on Nostr');
		expect(scrollTo).not.toHaveBeenCalled();
	});

	it("Back or Forward within the page: the section's pill, but the reader's own scroll", async () => {
		window.history.replaceState(null, '', '/git');
		const { container, rerender } = renderAt(OVERVIEW);
		await tick();
		window.history.replaceState(null, '', '/git/zaps');
		await rerender(data(ZAPS));
		navigate({ type: 'popstate', from: at('/git'), to: at('/git/zaps') });
		await tick();
		await macrotask();
		expect(pill(container)).toBe('tab-collaboration');
		expect(scrollTo).not.toHaveBeenCalled();
		expect(zapsCard(container).classList.contains(GLOW_CLASS)).toBe(false);
	});

	it('Back from another page to /git/zaps: the page is new, but no jump and no glow', async () => {
		const { container } = renderAt(ZAPS);
		await tick();
		navigate({ type: 'popstate', from: at('/', LANDING), to: at('/git/zaps') });
		await tick();
		await macrotask();
		expect(pill(container)).toBe('tab-collaboration');
		expect(scrollTo).not.toHaveBeenCalled();
		expect(zapsCard(container).classList.contains(GLOW_CLASS)).toBe(false);
	});

	it('/git/zaps, Hosting, the nav Git link, then Back: Hosting again, at its own address', async () => {
		// Until 2026-10-19 a pill click was a shallow history write, and Back to it loaded
		// /git/zaps again while the bar read /git#hosting (a 2026-10-19 build showed Overview there for 25
		// minutes). A pill click is a navigation of its own now, so Back is one too.
		const { container, rerender } = renderAt(ZAPS);
		await tick();
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		window.history.replaceState(null, '', '/git/hosting');
		await rerender(data(HOSTING));
		navigate({ type: 'link', from: at('/git/zaps'), to: at('/git/hosting') });
		await tick();
		scrollTo.mockClear(); // the pill click's own scroll to its panel (tap)
		window.history.replaceState(null, '', '/git');
		await rerender(data(OVERVIEW));
		navigate({ type: 'link', from: at('/git/hosting'), to: at('/git') });
		await tick();
		expect(pill(container)).toBe('tab-overview');
		window.history.replaceState(null, '', '/git/hosting');
		await rerender(data(HOSTING));
		navigate({ type: 'popstate', from: at('/git'), to: at('/git/hosting') });
		await tick();
		expect(pill(container)).toBe('tab-hosting');
		expect(document.title).toBe('Nostrology - Git on Nostr - Hosting');
		expect(scrollTo).not.toHaveBeenCalled();
	});
});

describe('a slug whose section has gone', () => {
	it("retired: names it in the note, opens its last pill, and moves to the pill's own address", async () => {
		window.history.replaceState(null, '', '/git/old-zaps');
		const { container } = renderAt(RETIRED);
		await tick();
		expect(container.querySelector('[data-transient-note]')?.textContent?.trim()).toBe('Zaps is no longer on this page.');
		// the visible copy is for the eye (the status region speaks it), laid just under the nav
		expect(container.querySelector('[data-transient-note]')?.getAttribute('aria-hidden')).toBe('true');
		expect((container.querySelector('[data-transient-note]') as HTMLElement).style.top).toBe('69px');
		expect(pill(container)).toBe('tab-collaboration');
		enter('/git/old-zaps');
		await macrotask();
		// replacing the entry, so Back never returns to the retired address
		expect(vi.mocked(goto)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(goto)).toHaveBeenCalledWith('/git/collaboration', MOVE);
	});

	it('an unknown slug, sent here by a 302 (found) with #gone: a generic note, then the address loses the hash', async () => {
		window.history.replaceState(null, '', '/git#gone');
		const { container } = renderAt(OVERVIEW);
		await tick();
		expect(container.querySelector('[data-transient-note]')?.textContent?.trim()).toBe(
			'That section is no longer on this page.'
		);
		enter('/git');
		await macrotask();
		// the router's own move, replacing the entry
		expect(vi.mocked(goto)).toHaveBeenCalledWith('/git', MOVE);
	});

	it('an unknown slug reached by an in-site link: the note too, and the hash goes', async () => {
		window.history.replaceState(null, '', '/git');
		const { container } = renderAt(OVERVIEW);
		await tick();
		expect(container.querySelector('[data-transient-note]')).toBeNull();
		window.history.replaceState(null, '', '/git#gone');
		navigate({ type: 'link', from: at('/git'), to: at('/git') });
		await tick();
		expect(container.querySelector('[data-transient-note]')?.textContent?.trim()).toBe(
			'That section is no longer on this page.'
		);
		await macrotask();
		expect(vi.mocked(goto)).toHaveBeenCalledWith('/git', MOVE);
	});
});
