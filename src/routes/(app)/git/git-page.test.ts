import { fireEvent, render, within } from '@testing-library/svelte';
import { npubEncode } from 'nostr-tools/nip19';
import { readable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { goto, replaceState as kitReplaceState } from '$app/navigation';
import type { Target } from '$lib/slug-table';
import { FOCUS_CLASS, GLOW_CLASS } from '$lib/section-link';
import { shortNpub } from '$lib/auth/profile';
import { gitworkshopUrl, irisGitUrl, repoUrl } from '$lib/ngit/links';
import { dayName, HOST_CLASS_KIND, LEDGER_LABEL, NO_VISIBLE_TEXT } from '$lib/ngit/format';
import { NGIT_NOT_SHOWN } from '$lib/ngit/shape';
import {
	AMBER,
	BLUE,
	GRASP_COLOR,
	GREEN,
	HOST_KIND_COLOR,
	HOSTING_CLASS_COLOR,
	NEUTRAL_SERIES,
	OTHERS_COLOR,
	PINK,
	RELAYS_PER_REPO_COLOR
} from '$lib/ngit/palette';
import type { NgitHostClass, NgitSnapshot } from '$lib/shared/data-types';
import NgitPage from './+page.svelte';
import { standInPillRouter } from '../pill-router.test-helper';
import { ACTIVE_NAMED, ACTIVE_UNNAMED, FIXTURE, PK_A, PK_B, PK_C, PK_D, PK_E } from './fixture';
import { PILL_SECTIONS, panelProblems, sortInkProblems } from './panel-checks';

// Every page renders <SocialMeta>, which reads $page for the request's own origin and
// path. Rendering a page component in isolation gives it no router, so the store has to
// be supplied here - same pattern as SiteNav.test.ts.
vi.mock('$app/stores', () => ({
	page: readable({ url: new URL('https://site.test/git') })
}));
// SvelteKit's router, stood in for ($lib/domain-page uses it). afterNavigate keeps the
// callbacks, and the tests call the newest one with a navigation of their own; replaceState
// rewrites the entry and keeps its state, as SvelteKit's does; goto records the moves the
// page makes itself.
const navigated = vi.hoisted(() => ({ callbacks: [] as ((nav: unknown) => void)[] }));
vi.mock('$app/navigation', () => ({
	replaceState: vi.fn((url: string) => window.history.replaceState(window.history.state, '', url)),
	afterNavigate: vi.fn((cb: (nav: unknown) => void) => navigated.callbacks.push(cb)),
	goto: vi.fn(() => Promise.resolve())
}));
// A pill is a link: the router's part in a click is stood in for (pill-router.test-helper.ts).
const pillRouter = standInPillRouter();
beforeEach(() => {
	navigated.callbacks.length = 0;
	vi.mocked(goto).mockClear();
	vi.mocked(kitReplaceState).mockClear();
});

/** Bidi embeddings, overrides and isolates: none may reach the rendered text. */
const BIDI = /[\u202A-\u202E\u2066-\u2069]/;

/** A "#rrggbb" palette colour the way jsdom reports it back from a style. */
const rgb = (hex: string, alpha?: number) => {
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
	return alpha === undefined ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
const bg = (el: Element | null) => (el as HTMLElement | null)?.style.backgroundColor;

/**
 * /git renders one server-loaded snapshot document (data.snapshot) and nothing else, so
 * this pins the data-source contract: the headline cards, the ledger, the tables, the
 * leaderboards and the stamp all come from the prop. Charts mount Chart.js, which no-ops
 * on jsdom's null canvas context; their captions and legends are DOM and are
 * checked here and in the component tests.
 */
const renderPage = (snapshot: NgitSnapshot = FIXTURE) => render(NgitPage, { props: { data: { snapshot } } });
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ');
/** Relays the page has named as sources, or might: since 2026-10-09 it names none. */
const RELAY_HOSTS = [
	'nos.lol',
	'relay.damus.io',
	'relay.primal.net',
	'relay.ngit.dev',
	'relay.zapstore.dev',
	'relay.fountain.fm',
	'relay.ditto.pub',
	'gitnostr.com',
	'git.shakespeare.diy',
	'ngit.danconwaydev.com',
	'grasp.budabit.club',
	'index.ngit.dev'
];
/** Whether a path (`summary.forks`, `grasp_servers[].first_choice`) is present in a
 * document; through a `[]` segment, present in any row of that list. */
const hasPath = (node: unknown, path: string): boolean => {
	const [head, ...rest] = path.split('.');
	if (node === null || typeof node !== 'object') return false;
	const obj = node as Record<string, unknown>;
	if (head.endsWith('[]')) {
		const rows = obj[head.slice(0, -2)];
		return Array.isArray(rows) && rows.some((row) => hasPath(row, rest.join('.')));
	}
	if (!Object.prototype.hasOwnProperty.call(obj, head)) return false;
	return rest.length === 0 || hasPath(obj[head], rest.join('.'));
};
/** Deletes a path (`summary.forks`, `grasp_servers[].first_choice`) from a document, in
 * place; a `[]` segment deletes it from every row of that list. */
const deletePath = (node: unknown, path: string): void => {
	const [head, ...rest] = path.split('.');
	const obj = node as Record<string, unknown>;
	if (head.endsWith('[]')) {
		for (const row of (obj[head.slice(0, -2)] as unknown[] | undefined) ?? []) deletePath(row, rest.join('.'));
		return;
	}
	if (rest.length === 0) delete obj[head];
	else deletePath(obj[head], rest.join('.'));
};

afterEach(() => {
	// Some tests open the page at an address of its own; keep tests order-independent.
	window.history.replaceState(null, '', '/');
	vi.restoreAllMocks();
});

describe('/git headline cards', () => {
	it('renders every card from the document', () => {
		const { container } = renderPage();
		const cards = text(container.querySelector('#ngit-cards'));
		expect(cards).toContain('Repositories');
		expect(cards).toContain('4,527');
		// the Repositories card is the figure alone; the ledger arithmetic is in What is counted
		expect(cards).not.toContain('announcements kept');
		const repoCard = [...container.querySelectorAll('#ngit-cards > div')].find(
			(c) => text(c.firstElementChild).trim() === 'Repositories'
		)!;
		expect([...repoCard.children].map((el) => text(el).trim())).toEqual(['Repositories', '4,527']);
		expect(cards).toContain('Active repositories (30 d)');
		expect(cards).toContain('581');
		expect(cards).toContain('1,414 pushed in the last 90 days');
		expect(cards).toContain('Pushes (30 d)');
		expect(cards).toContain('5,021');
		expect(cards).toContain('1,203 in the last 7 days');
		expect(cards).toContain('1,310');
		expect(cards).toContain('402 pushed in the last 30 days');
		expect(cards).toContain('GRASP or hashtree share');
		expect(cards).toContain('39.3%'); // (1,420 GRASP-hosted + 358 hashtree) / 4,527
		expect(cards).toContain('1,778 repositories on GRASP servers or hashtree');
		expect(cards).not.toContain('GRASP-hosted');
		expect(cards).toContain('876');
		expect(cards).toContain('2,210 in the last 90 days');
		expect(cards).not.toContain('counted in all');
		expect(cards).not.toContain('capture began');
		expect(cards).not.toContain('observation began');
		expect(cards).not.toContain('since Jun 18');
	});

	it('leaves the comments card without a sub-line for a document that has no comments_90d', () => {
		const old = structuredClone(FIXTURE);
		delete old.summary.comments_90d;
		const card = [...renderPage(old).container.querySelectorAll('#ngit-cards > div')].find((c) =>
			text(c).includes('Comments (30 d)')
		)!;
		expect(text(card).trim()).toBe('Comments (30 d) 876');
	});

	// The headline share card's label, value and sub-line, one document at a time (two
	// mounted copies of the page would share every id).
	const shareCard = (snapshot: NgitSnapshot): string[] => {
		const { container, unmount } = renderPage(snapshot);
		const card = [...container.querySelectorAll('[id="ngit-cards"] > div')].find(
			(c) => text(c.firstElementChild).trim() === 'GRASP or hashtree share'
		);
		const parts = card ? [...card.children].map((el) => text(el).trim()) : [];
		unmount();
		return parts;
	};

	it('makes the share GRASP or hashtree: GRASP-hosted plus the hashtree class, over all repositories', () => {
		// The operator, 2026-10-10: GRASP is not to be singled out, hashtree is a host of the same
		// standing. A repository on both is grasp_mixed (the classes are exclusive), so the sum
		// counts it once.
		expect(shareCard(FIXTURE)).toEqual(['GRASP or hashtree share', '39.3%', '1,778 repositories on GRASP servers or hashtree']);
		// the document's own GRASP-hosted share is not read: a stale or wrong one changes nothing
		const stale = structuredClone(FIXTURE);
		stale.summary.grasp_share = 0.99;
		expect(shareCard(stale)).toEqual(shareCard(FIXTURE));
	});

	it('counts no hashtree repository when the class is empty or missing, and 0% of no repositories', () => {
		const noHashtree = structuredClone(FIXTURE);
		noHashtree.hosting = noHashtree.hosting.map((h) => (h.k === 'hashtree' ? { ...h, v: 0 } : h));
		expect(shareCard(noHashtree)).toEqual(['GRASP or hashtree share', '31.4%', '1,420 repositories on GRASP servers or hashtree']);
		const missing = structuredClone(FIXTURE);
		missing.hosting = missing.hosting.filter((h) => h.k !== 'hashtree');
		expect(shareCard(missing)).toEqual(shareCard(noHashtree));
		const empty = structuredClone(FIXTURE);
		empty.summary.repos = 0;
		empty.summary.grasp_repos = 0;
		empty.hosting = empty.hosting.map((h) => ({ ...h, v: 0 }));
		expect(shareCard(empty)).toEqual(['GRASP or hashtree share', '0.0%', '0 repositories on GRASP servers or hashtree']);
	});

	it('writes every card figure in the same white, the share included', () => {
		// The share spans three hosting classes, so no class colour is its own; it was the GRASP
		// purple while it was GRASP's alone.
		const { container } = renderPage();
		const values = [...container.querySelectorAll('#ngit-cards > div')].map((c) => c.children[1] as HTMLElement);
		expect(values).toHaveLength(6);
		for (const v of values) {
			expect(v.style.color, text(v)).toBe('');
			expect(v.classList.contains('text-white'), text(v)).toBe(true);
		}
	});

	it('sits above the pills from sm up, and below them on a phone', () => {
		const { container } = renderPage();
		const cards = container.querySelector('#ngit-cards')!;
		const pillBar = container.querySelector('nav[aria-label="Git on Nostr"]')!;
		// The DOM keeps cards, then pills: the pill bar stays right before its panel.
		expect(cards.compareDocumentPosition(pillBar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		// On a phone the pill bar is drawn first, or it starts 1.4 screens down below six
		// stacked cards. jsdom applies no CSS, so this is the class contract: both are items of
		// one flex column, the pill bar ordered first below sm and back in DOM order from sm.
		expect(cards.parentElement).toBe(pillBar.parentElement);
		expect(cards.parentElement!.classList.contains('flex-col')).toBe(true);
		expect([...pillBar.classList]).toEqual(expect.arrayContaining(['order-first', 'sm:order-none', 'self-start']));
	});

	it('says which day the snapshot runs to and when it was generated once, in the footer', () => {
		// From 2026-09-26 (web review 4) a line under the title said it too, so that a page a
		// failed nightly run leaves on the previous row looked stale where it is read; on
		// 2026-10-18 the operator folded that line into the footer's first sentence
		const { container } = renderPage();
		expect(container.querySelector('#ngit-asof')).toBeNull();
		// the title, then the intro: nothing between them
		const h1 = container.querySelector('h1')!;
		expect(text(h1.nextElementSibling)).toContain('Git on Nostr puts the coordination layer of a git repository on Nostr');
		const page = text(container);
		expect(page).not.toContain('As of');
		expect(page.split('2026-09-25 03:31:07Z')).toHaveLength(2); // once
		const foot = container.querySelector('#ngit-footer')!;
		expect([...foot.querySelectorAll('time')].map((t) => [t.getAttribute('datetime'), text(t)])).toEqual([
			['2026-09-24', 'Sep 24, 2026'],
			['2026-09-25 03:31:07Z', '2026-09-25 03:31:07Z'],
			['2026-05-02', 'May 2, 2026'],
			['2026-06-14', 'Jun 14, 2026'],
			['2026-06-18', 'Jun 18, 2026']
		]);
		// the footer closes the page, after the cards and every pill
		expect(container.querySelector('#ngit-cards')!.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(container.querySelector('[id^="panel-"]')!.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});
});

describe('/git pills', () => {
	// Since 2026-10-19 a pill is an address (/git/hosting) and the pill bar a row of links
	// (PillBar, $lib/domain-page): a click opens the pill at once and the router's navigation
	// follows, adding the history entry Back returns through.
	const pills = (c: HTMLElement) => [...c.querySelectorAll('nav[aria-label="Git on Nostr"] > a')] as HTMLAnchorElement[];
	const openPill = (c: HTMLElement) => c.querySelector('nav[aria-label="Git on Nostr"] > a[aria-current]')?.id;
	const MOVE = { replaceState: true, noScroll: true, keepFocus: true };
	const settle = () => new Promise((r) => setTimeout(r, 0));
	/** The page at one of its addresses, as the server answered it, with the router's moves. */
	const renderAt = (path: string, target?: Target) => {
		window.history.replaceState(null, '', path);
		const r = render(NgitPage, { props: { data: { snapshot: FIXTURE, target } } });
		return {
			...r,
			enter: () => navigated.callbacks.at(-1)!({ type: 'enter', to: { url: new URL('https://site.test' + path) } }),
			/** A SvelteKit navigation: the address and the server's answer change, then afterNavigate. */
			async navigate(type: string, to: string, next: Target) {
				window.history.replaceState(null, '', to);
				await r.rerender({ data: { snapshot: FIXTURE, target: next } });
				navigated.callbacks.at(-1)!({ type, to: { url: new URL('https://site.test' + to) } });
			}
		};
	};

	it('offers the five pills of the design, as links to their own addresses, with Overview open', () => {
		const { container } = renderPage();
		expect(pills(container).map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
			['Overview', '/git'],
			['Repositories', '/git/repositories'],
			['Hosting', '/git/hosting'],
			['Maintainers', '/git/maintainers'],
			['Collaboration', '/git/collaboration']
		]);
		expect(openPill(container)).toBe('tab-overview');
		// each its own stop in the tab order, as links are: no roving tabindex as the old tabs had
		expect(pills(container).map((a) => a.getAttribute('tabindex'))).toEqual([null, null, null, null, null]);
		expect(container.querySelectorAll('[id^="panel-"]')).toHaveLength(1);
		expect(container.querySelector('#panel-overview')).not.toBeNull();
	});

	it('opens a pill at once on a click, and leaves the address to the router', async () => {
		const { container } = renderPage();
		for (const id of ['repositories', 'hosting', 'maintainers', 'collaboration', 'overview']) {
			await fireEvent.click(container.querySelector(`#tab-${id}`)!);
			expect(container.querySelectorAll('[id^="panel-"]'), id).toHaveLength(1);
			expect(container.querySelector(`#panel-${id}`), id).not.toBeNull();
			expect(openPill(container), id).toBe(`tab-${id}`);
		}
		// every click went to the router, to the pill's own address; the page wrote none itself
		expect(pillRouter.routed).toEqual(['/git/repositories', '/git/hosting', '/git/maintainers', '/git/collaboration', '/git']);
		expect(vi.mocked(kitReplaceState)).not.toHaveBeenCalled();
		expect(vi.mocked(goto)).not.toHaveBeenCalled();
	});

	it("opens the pill the router's new address names: after a click, Back or Forward", async () => {
		const page = renderAt('/git');
		page.enter();
		await page.navigate('link', '/git/hosting', { kind: 'page', pill: 'hosting' });
		expect(openPill(page.container)).toBe('tab-hosting');
		await page.navigate('popstate', '/git', { kind: 'page', pill: 'overview' });
		expect(openPill(page.container)).toBe('tab-overview');
		await page.navigate('popstate', '/git/hosting', { kind: 'page', pill: 'hosting' });
		expect(page.container.querySelector('#panel-hosting')).not.toBeNull();
	});

	it('names the open pill in the page title, from its address', async () => {
		renderAt('/git/maintainers', { kind: 'page', pill: 'maintainers' });
		expect(document.title).toBe('Nostrology - Git on Nostr - Maintainers');
	});

	it('a click scrolls the panel into view when it starts off screen (a phone), and nowhere else', async () => {
		// On a phone the pill bar is drawn above six stacked cards and the panel starts below
		// them, off screen, so a click would change nothing in view. jsdom lays nothing out: the
		// geometry is given here, the sticky nav included.
		document.body.insertAdjacentHTML('afterbegin', '<nav class="nav"></nav>');
		const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
		const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect');
		const geometry = (top: number) => rect.mockReturnValue({ top, height: 56 } as DOMRect);
		Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true, writable: true });
		try {
			const { container } = renderPage();
			geometry(1328); // a phone: the panel top is 1.6 screens down
			// a pointer's click (detail 1: fireEvent's default of 0 is what Enter gives)
			await fireEvent.click(container.querySelector('#tab-hosting')!, { detail: 1 });
			await settle();
			expect(scrollTo).toHaveBeenCalledTimes(1);
			// to the panel top, less the sticky nav's measured height and a small gap
			expect(scrollTo).toHaveBeenLastCalledWith({ top: 1328 - 56 - 8 });
			geometry(618); // a desktop: the panel starts right under the pill bar, on screen
			await fireEvent.click(container.querySelector('#tab-maintainers')!, { detail: 1 });
			await settle();
			expect(scrollTo).toHaveBeenCalledTimes(1);
			// Enter on a pill (a click with no pointer behind it): focus stays on the pill, which must
			// stay on screen, so nothing scrolls
			geometry(1328);
			await fireEvent.click(container.querySelector('#tab-repositories')!, { detail: 0 });
			await settle();
			expect(scrollTo).toHaveBeenCalledTimes(1);
			expect(container.querySelector('#panel-repositories')).not.toBeNull();
			await fireEvent.click(container.querySelector('#tab-hosting')!, { detail: 1 });
			await settle();
			expect(scrollTo).toHaveBeenCalledTimes(2);
			// a modified click opens a new tab: nothing changes here
			geometry(1328);
			await fireEvent.click(container.querySelector('#tab-collaboration')!, { metaKey: true });
			await settle();
			expect(scrollTo).toHaveBeenCalledTimes(2);
			expect(container.querySelector('#panel-hosting')).not.toBeNull();
		} finally {
			document.querySelector('nav.nav')?.remove();
			Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true, writable: true });
		}
	});

	it('opens the pill an old /git#pill link names before the first paint, then moves to its address', async () => {
		// $lib/legacy-hash: a courtesy for links written before 2026-10-19
		const page = renderAt('/git#maintainers');
		expect(page.container.querySelector('#panel-maintainers')).not.toBeNull();
		page.enter();
		await settle();
		expect(vi.mocked(goto)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(goto)).toHaveBeenCalledWith('/git/maintainers', MOVE);
	});

	// What is counted's address (CLAUDE.md -> "Every domain page's What is counted has an
	// address"): /git/methodology is what the operator sends when someone asks how a figure was
	// arrived at, so it must land on the OPEN section, and nothing but an address may open it.
	describe('/git/methodology', () => {
		const COUNTED: Target = { kind: 'page', pill: 'overview', section: 'methodology' };
		/** A laid-out page: jsdom measures nothing, so the nav and the section's top are given. */
		const geometry = () => {
			document.body.insertAdjacentHTML('afterbegin', '<nav class="nav"></nav>');
			vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 2400, height: 56 } as DOMRect);
			vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
			return vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
		};
		const counted = (c: HTMLElement) => c.querySelector('#methodology') as HTMLDetailsElement;
		afterEach(() => document.querySelector('nav.nav')?.remove());

		it('lands on Overview with What is counted open, just under the nav, glowing and focused', async () => {
			const scrollTo = geometry();
			const page = renderAt('/git/methodology', COUNTED);
			expect(page.container.querySelector('#panel-overview')).not.toBeNull();
			// open in the FIRST render, as the server sends it
			expect(counted(page.container).open).toBe(true);
			expect(document.title).toBe('Nostrology - Git on Nostr - What is counted');
			page.enter();
			// scrollY 0 + the section's top, less the nav's measured height and a small gap
			expect(scrollTo).toHaveBeenLastCalledWith({ top: 2400 - 56 - 8 });
			expect(counted(page.container).classList.contains(GLOW_CLASS)).toBe(true);
			expect(counted(page.container).classList.contains(FOCUS_CLASS)).toBe(true);
			expect(document.activeElement).toBe(counted(page.container));
		});

		it('opens for an old /git#methodology link, then moves to its address', async () => {
			geometry();
			const page = renderAt('/git#methodology');
			expect(counted(page.container).open).toBe(true);
			page.enter();
			await settle();
			expect(vi.mocked(goto)).toHaveBeenCalledWith('/git/methodology', MOVE);
		});

		it('stays closed anywhere else, and opening it by hand writes nothing', async () => {
			const scrollTo = geometry();
			for (const path of ['/git', '/git#nope', '/git#ngit-ledger']) {
				const page = renderAt(path);
				expect(counted(page.container).open, path).toBe(false);
				page.unmount();
			}
			const page = renderAt('/git');
			page.enter();
			await settle();
			expect(scrollTo).not.toHaveBeenCalled();
			// a visitor opening it reads as itself in the DOM and moves no address
			counted(page.container).open = true;
			await fireEvent(counted(page.container), new Event('toggle'));
			expect(vi.mocked(kitReplaceState)).not.toHaveBeenCalled();
			expect(vi.mocked(goto)).not.toHaveBeenCalled();
			expect(window.location.pathname).toBe('/git');
		});

		it("opens after a navigation to its address, once the router's own scroll is done; Back only opens it", async () => {
			// A link elsewhere on the site, not a cold load: the router scrolls and reset_focus
			// re-applies that position from a timer, so the page's own landing is deferred.
			const scrollTo = geometry();
			const page = renderAt('/git');
			page.enter();
			expect(counted(page.container).open).toBe(false);
			await page.navigate('link', '/git/methodology', COUNTED);
			// NOT YET: a landing run synchronously here is undone by the router's own scroll
			expect(scrollTo).not.toHaveBeenCalled();
			await settle();
			expect(counted(page.container).open).toBe(true);
			expect(scrollTo).toHaveBeenLastCalledWith({ top: 2400 - 56 - 8 });
			// Back and Forward restore their own scroll: the section opens, nothing scrolls
			scrollTo.mockClear();
			await page.navigate('popstate', '/git', { kind: 'page', pill: 'overview' });
			await page.navigate('popstate', '/git/methodology', COUNTED);
			await settle();
			expect(counted(page.container).open).toBe(true);
			expect(scrollTo).not.toHaveBeenCalled();
		});

		it('is never closed by a navigation: the reader may have opened it', async () => {
			// Until 2026-10-19 the hash decided, and a page reached without it was collapsed again.
			// Now an address only opens it (the nav's Git link from /git/methodology to /git keeps
			// what the reader is reading).
			geometry();
			const page = renderAt('/git/methodology', COUNTED);
			expect(counted(page.container).open).toBe(true);
			await page.navigate('link', '/git', { kind: 'page', pill: 'overview' });
			await settle();
			expect(counted(page.container).open).toBe(true);
		});

		it('keeps the section open across a pill round trip, since the visitor opened it', async () => {
			geometry();
			const { container } = renderAt('/git/methodology', COUNTED);
			expect(counted(container).open).toBe(true);
			// the panel is destroyed and rebuilt; the open state is the page's, not the DOM's
			await fireEvent.click(container.querySelector('#tab-hosting')!);
			expect(container.querySelector('#methodology')).toBeNull();
			await fireEvent.click(container.querySelector('#tab-overview')!);
			expect(counted(container).open).toBe(true);
		});

		// The link icon on the section's head (MethodologySection): a click puts the section's
		// address on the clipboard and changes nothing on the page. Its own behaviour is pinned
		// in MethodologySection.test.ts; this is that it is here, wired to /git.
		it.each([
			['/git', undefined],
			['/git/methodology', COUNTED]
		])('copies /git/methodology from the icon on %s, and writes nothing', async (start, target) => {
			const writeText = vi.fn(() => Promise.resolve());
			Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
			try {
				const scrollTo = geometry();
				const page = renderAt(start, target);
				page.enter();
				await settle();
				scrollTo.mockClear();
				const wasOpen = counted(page.container).open;
				const link = page.container.querySelector('#panel-overview a[data-methodology-link]') as HTMLAnchorElement;
				expect(link.getAttribute('href')).toBe('/git/methodology');
				// not followed: a copy leaves the page as it was
				expect(await fireEvent.click(link)).toBe(false);
				await settle();
				expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/git/methodology`);
				expect(counted(page.container).open).toBe(wasOpen);
				expect(window.location.pathname + window.location.hash).toBe(start);
				expect(vi.mocked(kitReplaceState)).not.toHaveBeenCalled();
				expect(vi.mocked(goto)).not.toHaveBeenCalled();
				expect(scrollTo).not.toHaveBeenCalled();
				expect(openPill(page.container)).toBe('tab-overview');
			} finally {
				delete (navigator as { clipboard?: unknown }).clipboard;
			}
		});
	});
});

describe('/git overview', () => {
	it('opens on Cumulative repositories and closes on What is counted', () => {
		const { container } = renderPage();
		const panel = container.querySelector('#panel-overview')!;
		// the page's own sections in reading order; the ledger, the anomalies and the caveats
		// sit inside What is counted
		const known = new Set([...PILL_SECTIONS.overview]);
		const order = [...panel.querySelectorAll('[id]')].map((el) => el.id).filter((id) => known.has(id));
		expect(order).toEqual([
			'ngit-cumulative',
			'ngit-new-repos',
			'ngit-pushes',
			'ngit-pushed',
			'methodology',
			'ngit-ledger',
			'ngit-anomalies',
			'ngit-not'
		]);
		// the cumulative chart says what it plots and nothing else
		expect(text(container.querySelector('#ngit-cumulative p')).trim()).toBe('Repositories by first-seen day.');
		expect(text(container.querySelector('#methodology'))).toContain(
			'Observation began on May 2, 2026 for repository announcements, on Jun 14, 2026 for states and GRASP lists and on Jun 18, 2026 for comments.'
		);
		expect(text(container.querySelector('#methodology'))).toContain(
			'the weekly charts start no earlier than the week of Jun 29, 2026 (the week holding Jul 1, 2026), after all three, and the cumulative chart fades the days before observation of announcements began.'
		);
		// collapsed by default behind its own heading; closed, it is still in the DOM (and the SSR HTML)
		const counted = container.querySelector('#methodology') as HTMLDetailsElement;
		expect(counted.tagName).toBe('DETAILS');
		expect(counted.open).toBe(false);
		expect(counted.querySelector(':scope > summary > h2')!.textContent).toBe('What is counted');
	});

	/** The Sources table as source kind -> its "Observed since" cell ("Captured since" until 2026-10-18). */
	const capturedSince = (container: Element) =>
		Object.fromEntries(
			[...container.querySelectorAll('#methodology tbody tr')].map((tr) => [
				text(tr.querySelector('td')).trim(),
				text(tr.querySelector('td:last-child')).trim()
			])
		);

	it('lists every exclusion-ledger row with its unit', () => {
		const { container } = renderPage();
		const ledger = container.querySelector('#ngit-ledger')!;
		const rows = [...ledger.querySelectorAll('[data-ledger-row]')].map(text);
		expect(rows).toHaveLength(FIXTURE.exclusions.length);
		// the document ships keys; every row is worded, never shown as a bare key
		for (const e of FIXTURE.exclusions) {
			const row = rows.find((r) => r.includes(LEDGER_LABEL[e.k]));
			expect(row, e.k).toBeDefined();
			expect(row).toContain(e.v.toLocaleString('en-US'));
			expect(row).toContain(e.why);
		}
		expect(rows.some((r) => r.includes('daily_cap') || r.includes('orphan_states'))).toBe(false);
		// units, in the singular for one - and a zero row is still shown
		expect(rows.find((r) => r.includes('N0 Malformed identifier'))).toContain('(announcements)');
		expect(rows.find((r) => r.includes('N1 Agent-profile squatters'))).toContain('(announcements)');
		expect(rows.find((r) => r.includes('N5 Automated republish loop'))).toContain('(announcement)');
		// N0 leads the announcement rules, as in the reference
		expect(rows[0]).toContain('N0 Malformed identifier');
		expect(rows.find((r) => r.includes('Orphan states'))).toContain('(state coordinates)');
		expect(rows.find((r) => r.includes('State republish loops'))).toContain('(state coordinate)');
		expect(rows.find((r) => r.includes('Mirrored comments'))).toContain('(comment)');
		const imported = rows.find((r) => r.includes('Imported comments'))!;
		expect(imported.trim().startsWith('0 Imported comments')).toBe(true); // no minus on a zero
		expect(imported).toContain('(comments)');
		expect(rows.find((r) => r.includes('N1 Agent-profile squatters'))!.trim().startsWith('\u2212784')).toBe(true);
		// the tally the announcement-unit rows lead to; the archive's version count is not a figure
		expect(text(ledger)).toContain('4,614 announcements kept, forming 4,527 repositories');
		expect(text(ledger)).toContain('6,604 announcements (one per author and identifier)');
		expect(text(ledger)).not.toContain('92,335');
	});

	it('still words the daily cap row of a document written before 2026-10-02', () => {
		// every push counts since 2026-10-02, so a current document has no pushes row
		expect(FIXTURE.exclusions.some((e) => e.unit === 'pushes')).toBe(false);
		const old: NgitSnapshot = structuredClone(FIXTURE);
		// such a document also predates N10 (2026-10-12), so it has no N10 row either
		old.exclusions = old.exclusions.filter((e) => e.k !== 'N10');
		old.exclusions.splice(13, 0, { k: 'daily_cap', unit: 'pushes', v: 124, why: 'beyond 50 per repository per UTC day' });
		expect(old.exclusions.map((e) => e.k).slice(11, 15)).toEqual(['state_republish_loop', 'orphan_states', 'daily_cap', 'ephemeral']);
		const { container } = renderPage(old);
		const rows = [...container.querySelectorAll('#ngit-ledger [data-ledger-row]')].map(text);
		expect(rows).toHaveLength(old.exclusions.length);
		expect(rows.find((r) => r.includes('Pushes above the daily cap'))).toContain('(pushes)');
	});

	it('renders a document written before N10 (2026-10-12) with no N10 row', () => {
		const old: NgitSnapshot = structuredClone(FIXTURE);
		old.exclusions = old.exclusions.filter((e) => e.k !== 'N10');
		const { container } = renderPage(old);
		const rows = [...container.querySelectorAll('#ngit-ledger [data-ledger-row]')].map(text);
		expect(rows).toHaveLength(FIXTURE.exclusions.length - 1);
		expect(rows.some((r) => r.includes('N10'))).toBe(false);
		expect(rows.find((r) => r.includes('N9 Stateless personal forks'))).toBeDefined();
	});

	it('words N10, the nostr.net catalog, in the ledger', () => {
		const { container } = renderPage();
		const rows = [...container.querySelectorAll('#ngit-ledger [data-ledger-row]')].map(text);
		const n10 = rows.find((r) => r.includes("N10 Catalog of other people's projects"));
		expect(n10).toBeDefined();
		expect(n10).toContain('(announcements)');
	});

	it('names every source kind with its capture date and states what the numbers are not', () => {
		const { container } = renderPage();
		const counted = text(container.querySelector('#methodology'));
		for (const kind of [
			'kind-30617 (repo-announcements)',
			'kind-30618 (repo-states)',
			'kind-10317 (grasp-server-lists)',
			'kind-1111 (comments)',
			'kind-7 (reactions)',
			'kind-17 (external-content-reactions)',
			'kind-9735 (zap-receipts)',
			'kind-5 (event-deletion-requests)'
		]) {
			expect(counted).toContain(kind);
		}
		// no per-kind row counts: the archive's totals are not a figure the page reports
		expect(counted).not.toContain('92,335');
		expect(container.querySelector('#methodology thead')?.textContent).not.toContain('Rows used');
		expect(counted).toContain('Not commits');
		// every source has a capture date in the fixture, the three social kinds included
		const since = [...container.querySelectorAll('#methodology tbody tr td:last-child')].map((td) =>
			td.textContent?.trim()
		);
		expect(since).not.toContain('-');
		expect(since.filter((t) => t === 'no date recorded')).toHaveLength(0);
		expect(capturedSince(container)).toMatchObject({
			'kind-7 (reactions)': '2026-06-19',
			'kind-17 (external-content-reactions)': '2026-10-11',
			'kind-9735 (zap-receipts)': '2026-06-14',
			'kind-5 (event-deletion-requests)': '2026-07-01'
		});
		// the caveats of the dataset reference, section 8, in its order - all but "Not
		// Sybil-resistant", which the operator dropped from the page on 2026-10-09 (the reference
		// keeps it: it is true of the data); hashtree's since 2026-10-09
		const not = [...container.querySelectorAll('#ngit-not li')].map((li) => text(li).trim());
		expect(not).toHaveLength(9);
		// no relay named: the page names none since 2026-10-09
		expect(not[0]).toBe(
			'Not an exhaustive count of repositories on Nostr: only of the ones the relays we read served, after the ' +
				'ledger. A repository whose events never reached one of them is invisible.'
		);
		expect(not.map((t) => t.split(':')[0])).toEqual([
			'Not an exhaustive count of repositories on Nostr',
			'Not commits',
			'Not every hashtree push',
			'Not verified projects',
			'Not issue or pull-request counts',
			'Not net of every unstar',
			'Not verified payments',
			'Not case-folded',
			'Not activity before Jun 14, 2026'
		]);
		// hashtree records a push in its own root event; since the nostrology-data deploy of
		// 2026-10-12 a hashtree repository's push is counted from the announcement its git tool
		// republishes with each ref of a public push, grouped into pushes (dataset reference
		// section 3), 1,227 in the fixture; what it cannot see is named (dataset reference section 8)
		expect(not[1]).toBe(
			'Not commits: a push is one state publication that moved at least one branch or tag, or one ' +
				'hashtree push read from its republished announcements, however many commits it carried.'
		);
		// the count sits with what is counted, not after what is missed (the second review of the
		// rework, 2026-10-12: "missed (217 ...)" read as 217 missed)
		expect(not[2]).toBe(
			'Not every hashtree push: hashtree publishes a push as its own root event, never as a ' +
				"kind-30618 (repo-states), so a hashtree repository's push is counted from the announcement " +
				'its git tool republishes with a public push (1,227 of the pushes in 30 days). Private and ' +
				"link-visible pushes, pushes from Iris Git's web app and a repository's first push are not " +
				'counted, nor is a push whose announcements did not reach us in time; an edit that republishes ' +
				'the announcement counts as one.'
		);
		// Iris Git's unstars are read since 2026-10-11 (dataset reference 6.2), kind-7 (reactions) ones are not
		expect(not[5]).toBe(
			'Not net of every unstar: a kind-7 (reactions) star is withdrawn by a deletion request, and those ' +
				'are not read for reactions; an Iris Git star is withdrawn by its key\'s later "-", which is.'
		);
		// a counted receipt is signed by a listed provider key: plausible, not proof of payment
		expect(not[6]).toContain('signed by a verified LNURL provider key');
		expect(not[6]).toContain('not proof that the invoice was paid');
		expect(not[6]).not.toContain('counted as published');
		expect(not[7]).toContain('NIP-01 (protocol basics)');
		expect(text(container.querySelector('#ngit-not'))).not.toMatch(/Sybil|fresh keys/);
		// both anomaly blocks: 1 + 2 future-dated, 4 past-dated in the fixture
		const anomalies = text(container.querySelector('#ngit-anomalies'));
		expect(anomalies).toContain('3 events dated after the run instant');
		expect(anomalies).toContain('4 dated before 2023');
	});

	// Its own render: two renders in one test share ids (see '/git collaboration').
	it('says "no date recorded" for a capture date the document lacks, never a bare dash', () => {
		// a document written before 2026-09-25 has none for the three social kinds
		const snapshot: NgitSnapshot = JSON.parse(JSON.stringify(FIXTURE));
		delete snapshot.coverage.reactions_since;
		delete snapshot.coverage.zaps_since;
		delete snapshot.coverage.deletions_since;
		const { container } = renderPage(snapshot);
		const since = [...container.querySelectorAll('#methodology tbody tr td:last-child')].map((td) =>
			td.textContent?.trim()
		);
		expect(since).not.toContain('-');
		expect(since.filter((t) => t === 'no date recorded')).toHaveLength(3);
		expect(capturedSince(container)).toEqual({
			'kind-30617 (repo-announcements)': '2026-05-02',
			'kind-30618 (repo-states)': '2026-06-14',
			'kind-10317 (grasp-server-lists)': '2026-06-14',
			'kind-1111 (comments)': '2026-06-18',
			'kind-7 (reactions)': 'no date recorded',
			'kind-17 (external-content-reactions)': '2026-10-11',
			'kind-9735 (zap-receipts)': 'no date recorded',
			'kind-5 (event-deletion-requests)': 'no date recorded'
		});
	});

	// Its own render, for the same reason.
	it('describes the stars of a document written before Iris Git stars were counted as it did then', async () => {
		// a document from before the first run after the nostrology-data deploy of 2026-10-11
		// lacks every kind-17 (external-content-reactions) key, and its stars are kind-7 (reactions) alone
		const snapshot: NgitSnapshot = JSON.parse(JSON.stringify(FIXTURE));
		delete snapshot.coverage.external_reactions_since;
		delete snapshot.anomalies.future_dated.external_reactions;
		delete snapshot.anomalies.past_dated.external_reactions;
		delete snapshot.summary.archive_events.external_reactions;
		delete snapshot.summary.stars_iris;
		// nor the key of 2026-10-12, whose hashtree caveat names Iris Git's web app
		delete snapshot.summary.pushes_hashtree_30d;
		const { container } = renderPage(snapshot);
		const counted = text(container.querySelector('#methodology'));
		expect(counted).not.toContain('kind-17 (external-content-reactions)');
		expect(counted).not.toContain('Iris Git');
		const not = [...container.querySelectorAll('#ngit-not li')].map((li) => text(li).trim());
		expect(not[5]).toBe('Not net stars: an unstar is a deletion request, and those are not read for reactions.');
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		const card = container.querySelector('#ngit-stars')!;
		expect(text(card.querySelector('h2'))).toBe('Stars');
		expect(text(card.querySelector('h2 + p')).trim()).toBe(
			'A star is a kind-7 (reactions) with "+" or empty content on a repository announcement, counted once ' +
				'per reacting key and repository. It is not net of unstars, which are deletion requests this page ' +
				'does not read.'
		);
	});

	it('draws new repositories per week as one bar per kind of host, first-time maintainers as a line on its own axis', () => {
		const { container } = renderPage();
		const card = container.querySelector('#ngit-new-repos')!;
		expect(card.querySelector('h2')!.textContent).toBe('New repositories per week');
		// one chart: the companion first-time maintainers chart is now its line
		expect(card.querySelectorAll('canvas')).toHaveLength(1);
		expect(card.querySelector('h3')).toBeNull();
		// the operator's five kinds, in the operator's order (Self-hosted before Forges since
		// 2026-10-12), each keyed in the donut's colour of its kind (GRASP purple, hashtree pink,
		// Self-hosted green, Forges amber, none slate), then the line
		const legend = [...card.querySelectorAll('[data-testid="chart-legend"] button')].map((b) => b.textContent?.trim());
		expect(legend).toEqual(['GRASP', 'hashtree', 'Self-hosted', 'Forges', 'No public host', 'First-time maintainers']);
		const swatches = [...card.querySelectorAll('[data-swatch="bar"]')].map(bg);
		expect(swatches).toEqual([GRASP_COLOR, PINK, GREEN, AMBER, OTHERS_COLOR].map((c) => rgb(c)));
		expect(bg(card.querySelector('[data-swatch="line"]'))).toBe(rgb(NEUTRAL_SERIES));
		expect(text(card)).toContain('No public host counts those with no public clone URL.');
		expect(text(card)).toContain('by kind of host today');
		expect(card.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe(
			'New repositories per week by the kinds of host they are on today, and first-time maintainers'
		);
		// a repository counts under every kind it is on, and the caption says what that does to a sum
		expect(text(card)).toContain('under every kind of host it is on today');
		expect(text(card)).toContain("a week's bars can add up to more than its new repositories");
		expect(text(card)).toContain('The line is first-time maintainers');
		// the week holding Jul 1, after every capture wall: only the week still filling is keyed
		const notes = [...card.querySelectorAll('[data-testid="bucket-notes"] li')].map((li) => [
			li.getAttribute('data-note'),
			text(li).trim()
		]);
		expect(notes).toEqual([['partial_last', 'partial week: data to Sep 24, 2026']]);
	});

	it('says the count by kind of host is not in a snapshot written before the 2026-10-08 deploy, and draws the rest', () => {
		const old: NgitSnapshot = structuredClone(FIXTURE);
		for (const r of old.new_repos_weekly!) delete r.by_host;
		const { container } = renderPage(old);
		const newRepos = container.querySelector('#ngit-new-repos')!;
		expect(text(newRepos.querySelector('[data-not-in-snapshot]')).trim()).toBe(
			'Not in this snapshot: it was written before the count by kind of host was added.'
		);
		expect(newRepos.querySelector('canvas')).toBeNull();
		expect(container.querySelector('#ngit-pushes canvas')).not.toBeNull();
		// one row without it is enough: the chart never draws a missing count as zeros
		const mixed: NgitSnapshot = structuredClone(FIXTURE);
		delete mixed.new_repos_weekly![3].by_host;
		const second = renderPage(mixed);
		expect(second.container.querySelector('[id="ngit-new-repos"] canvas')).toBeNull();
		second.unmount();
	});

	it('says a weekly chart is not in a snapshot written before the weekly series, and draws the rest', async () => {
		const old: NgitSnapshot = structuredClone(FIXTURE);
		delete old.new_repos_weekly;
		delete old.comments_weekly;
		delete old.grasp_lists.per_week;
		const { container } = renderPage(old);
		const NOTE = 'Not in this snapshot: it was written before the weekly series were added.';
		const newRepos = container.querySelector('#ngit-new-repos')!;
		expect(text(newRepos.querySelector('[data-not-in-snapshot]')).trim()).toBe(NOTE);
		expect(newRepos.querySelector('canvas')).toBeNull();
		expect(container.querySelector('#ngit-pushes canvas')).not.toBeNull();
		await fireEvent.click(container.querySelector('#tab-maintainers')!);
		expect(text(container.querySelector('#ngit-grasp-lists [data-not-in-snapshot]')).trim()).toBe(NOTE);
		expect(container.querySelector('#ngit-grasp-lists [data-share]')).not.toBeNull();
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		// the discussion bars and the participants lines both
		const notes = [...container.querySelectorAll('#ngit-discussion [data-not-in-snapshot]')].map((p) => text(p).trim());
		expect(notes).toEqual([NOTE, NOTE]);
		expect(container.querySelector('#ngit-discussion canvas')).toBeNull();
		expect(text(container.querySelector('#ngit-discussion'))).toContain('333 authors have commented in 1,502 threads in all');
	});

	it('names N8b by public clone URLs, the page word for the reference\'s reachable', () => {
		const { container } = renderPage();
		const n8b = [...container.querySelectorAll('#ngit-ledger [data-ledger-row]')].map(text).find((r) => r.includes('N8b'));
		expect(n8b).toContain('N8b No public clone URL and no state');
	});

	it('draws all repositories in the neutral ink, and GRASP-hosted in the GRASP colour', () => {
		// Purple means GRASP on this pill (the first bar of each week; the headline card wears no
		// colour since 2026-10-10); the cumulative line counts ALL repositories. The line's
		// faded-stretch key carries the series colour.
		const { container } = renderPage();
		expect(bg(container.querySelector('#ngit-cumulative [data-note="wall"] span'))).toBe(rgb(NEUTRAL_SERIES, 0.35));
		expect(bg(container.querySelector('#ngit-new-repos [data-testid="chart-legend"] span'))).toBe(rgb(GRASP_COLOR));
		expect(NEUTRAL_SERIES).not.toBe(GRASP_COLOR);
	});

	it("keys the cumulative chart's faded days as before observation began", () => {
		// "observation", not "capture" (the operator's wording, 2026-10-18; "before capture"
		// until then)
		const { container } = renderPage();
		expect(text(container.querySelector('#ngit-cumulative [data-note="wall"]')).trim()).toBe(
			'before observation began: only what relays still served'
		);
	});

	it('starts the push charts with the week of Jul 1, keyed only for the week still filling, with every push counted', () => {
		const { container } = renderPage();
		for (const id of ['ngit-pushes', 'ngit-pushed']) {
			const legend = [...container.querySelectorAll(`#${id} [data-testid="bucket-notes"] li`)];
			// no capture key and no partial first week: the window starts after the states wall
			expect(legend.map((li) => [li.getAttribute('data-note'), text(li).trim()]), id).toEqual([
				['partial_last', 'partial week: data to Sep 24, 2026']
			]);
		}
		const pushes = text(container.querySelector('#ngit-pushes'));
		// no running total beside the title, and no cap: every push counts
		expect(pushes).not.toContain(FIXTURE.summary.pushes_total!.toLocaleString('en-US'));
		expect(pushes).not.toContain('since Jun 14');
		expect(pushes).not.toContain('At most 50');
		expect(text(container.querySelector('#ngit-pushed'))).not.toContain('uncapped');
		// the recency cohorts and the no-state split are gone (2026-10-02)
		expect(container.querySelector('#ngit-recency, #ngit-no-state')).toBeNull();
		expect(text(container.querySelector('#panel-overview'))).not.toContain('Last state seen');
	});
});

describe('/git repositories', () => {
	it('titles the first table Most active repositories, its 90 days in the caption under it', async () => {
		// the operator's wording, 2026-10-10: "Most active repositories" for "Most active (90 d)"
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-repositories')!);
		const card = container.querySelector('#ngit-repos-active')!;
		expect(text(card.querySelector('h2')).trim()).toBe('Most active repositories');
		expect(text(card.querySelector('h2 + p'))).toContain('pushed in the 90 days to Sep 24, 2026, by pushes.');
		expect(card.querySelector('table')!.getAttribute('aria-label')).toBe('Most active repositories, 90 days');
		expect(text(container.querySelector('#panel-repositories'))).not.toContain('(90 d)');
	});

	it('opens on the most active table, then Topics and Anatomy side by side', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-repositories')!);
		const panel = container.querySelector('#panel-repositories')!;
		// every section of the pill, not only the known ones: a section re-added under a new id
		// shows up here
		expect([...panel.querySelectorAll('[id^="ngit-"]')].map((el) => el.id)).toEqual([
			'ngit-repos-active',
			'ngit-topics',
			'ngit-anatomy'
		]);
		// jsdom applies no CSS, so this is the class contract: Topics and Anatomy are the two
		// cells of one two-column row, Topics first...
		const topics = container.querySelector('#ngit-topics')!;
		const anatomy = container.querySelector('#ngit-anatomy')!;
		expect(topics.parentElement).toBe(anatomy.parentElement);
		expect(topics.parentElement!.classList.contains('lg:grid-cols-2')).toBe(true);
		expect(topics.nextElementSibling).toBe(anatomy);
		// ...and in that half the anatomy's two lists stack, one above the other
		const lists = [...anatomy.querySelectorAll('h3')];
		expect(lists.map((h) => text(h).trim())).toEqual(['Branches per repository', 'Tags per repository']);
		const stack = lists[0].parentElement!.parentElement!;
		expect(lists[1].parentElement!.parentElement).toBe(stack);
		// no grid, no flex row and no breakpoint variant that could set the two side by side
		expect([...stack.classList].filter((c) => /grid|flex|^(sm|md|lg|xl|2xl):/.test(c))).toEqual([]);
		expect(text(anatomy)).not.toContain('Default branch');
	});

	it('shows no recently pushed or newest table and no fork families', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-repositories')!);
		const panel = container.querySelector('#panel-repositories')!;
		for (const id of ['ngit-repos-recent', 'ngit-repos-new', 'ngit-forks']) {
			expect(container.querySelector(`#${id}`), id).toBeNull();
		}
		expect(panel.querySelectorAll('table')).toHaveLength(1); // the most active
		for (const heading of ['Recently pushed', 'Newest repositories', 'Largest fork families']) {
			expect(text(panel)).not.toContain(heading);
		}
	});

	it('reads nothing it stopped showing: every pill says the same with or without those keys', async () => {
		// The pipeline can drop any of them without a coordinated deploy only while this holds.
		// One document at a time: two mounted copies of the page would share every id.
		const seenOnEveryPill = async (snapshot: NgitSnapshot) => {
			const { container, unmount } = renderPage(snapshot);
			const seen: Record<string, (string | null)[]> = { cards: [text(container.querySelector('#ngit-cards'))] };
			for (const pill of Object.keys(PILL_SECTIONS)) {
				await fireEvent.click(container.querySelector(`#tab-${pill}`)!);
				const panel = container.querySelector('[id^="panel-"]')!;
				seen[pill] = [text(panel), ...[...panel.querySelectorAll('[title]')].map((el) => el.getAttribute('title'))];
			}
			unmount();
			window.history.replaceState(null, '', '/');
			return seen;
		};
		const without: NgitSnapshot = JSON.parse(JSON.stringify(FIXTURE));
		// every path is in the fixture first, so each deletion has something to delete
		for (const path of NGIT_NOT_SHOWN) expect(hasPath(FIXTURE, path), path).toBe(true);
		for (const path of NGIT_NOT_SHOWN) deletePath(without, path);
		// the deletion itself is checked, path by path (a name like "other" is also a key of
		// rows the page still reads), or a deletePath that silently missed a path would pass
		for (const path of NGIT_NOT_SHOWN) expect(hasPath(without, path), path).toBe(false);
		expect(await seenOnEveryPill(without)).toEqual(await seenOnEveryPill(FIXTURE));
	});

	const firstCol = (table: Element) =>
		[...table.querySelectorAll('tbody tr td:first-child a')].map((a) => a.textContent);

	// Three rows tied on pushes in 90 d and 30 d, ranked C, A, B by the pipeline's finer keys
	// (the last push's full timestamp, then the key). By name they read apple, mango, zebra
	// and by pubkey zebra, apple, mango, so a table that re-sorts the tie either way shows it.
	const TIED = [
		{ ...ACTIVE_NAMED, pubkey: PK_C, d: 'mango', name: 'mango', pushes_30d: 9, pushes_90d: 40 },
		{ ...ACTIVE_NAMED, pubkey: PK_A, d: 'zebra', name: 'zebra', pushes_30d: 9, pushes_90d: 40 },
		{ ...ACTIVE_NAMED, pubkey: PK_B, d: 'apple', name: 'apple', pushes_30d: 9, pushes_90d: 40 }
	];
	const DOC_ORDER = ['mango', 'zebra', 'apple'];

	it('renders the most active in the document order, ties included', async () => {
		const { container } = renderPage({ ...FIXTURE, repos_active: TIED });
		await fireEvent.click(container.querySelector('#tab-repositories')!);
		const table = container.querySelector('#ngit-repos-active table')!;
		expect(firstCol(table)).toEqual(DOC_ORDER);
		expect(table.querySelector('th[aria-sort="descending"]')?.textContent).toContain('Pushes 90 d');
	});

	it('keeps ties in document order after sorting by another column and back', async () => {
		const { container } = renderPage({ ...FIXTURE, repos_active: TIED });
		await fireEvent.click(container.querySelector('#tab-repositories')!);
		const table = container.querySelector('#ngit-repos-active table')!;
		await fireEvent.click(table.querySelector('button[aria-label="Sort by Repository"]')!);
		expect(firstCol(table)).toEqual(['apple', 'mango', 'zebra']);
		await fireEvent.click(table.querySelector('button[aria-label="Sort by Pushes 90 d"]')!);
		expect(firstCol(table)).toEqual(DOC_ORDER);
		// ascending on the same tied key: still the document order among the ties
		await fireEvent.click(table.querySelector('button[aria-label="Sort by Pushes 90 d"]')!);
		expect(firstCol(table)).toEqual(DOC_ORDER);
	});

	it('shows name-or-d and links each repository to gitworkshop.dev', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-repositories')!);
		const table = container.querySelector('#ngit-repos-active table')!;
		const links = [...table.querySelectorAll('tbody a')] as HTMLAnchorElement[];
		const named = links.find((a) => a.textContent === 'ngit')!;
		expect(named.getAttribute('href')).toBe(`https://gitworkshop.dev/${npubEncode(PK_A)}/ngit`);
		expect(named.getAttribute('target')).toBe('_blank');
		expect(named.getAttribute('rel')).toBe('noopener noreferrer');
		// no name: the d identifier is the label, and it is percent-encoded in the link
		const unnamed = links.find((a) => a.textContent === ACTIVE_UNNAMED.d)!;
		expect(unnamed.getAttribute('href')).toBe(
			`https://gitworkshop.dev/${npubEncode(PK_B)}/tools%2Fsync%20bot`
		);
		// the full repository key is on the row for hover
		expect(table.querySelector(`td[title="${PK_A}:ngit"]`)).not.toBeNull();
		// the lead's display name, and the hosts
		expect(text(table)).toContain('by Dan the maintainer');
		expect(text(table)).toContain('relay.ngit.dev, gitnostr.com, github.com');
		// the Hosting cell names the kinds of host, in Clone hosts' words, not the class (the
		// operator's choice, 2026-10-11)
		const hosting = [...table.querySelectorAll('tbody tr')].map((tr) => {
			const cell = tr.querySelector('td:nth-child(2)')!.cloneNode(true) as Element;
			cell.querySelector('div')?.remove();
			return text(cell).trim();
		});
		expect(hosting).toEqual(['GRASP, Forge', 'Forge']);
		expect(text(table)).not.toContain('GRASP + other hosts');
	});

	it.each([
		['no hashtree class row', [], 'so none of them is counted.'],
		['one hashtree repository', [{ k: 'hashtree' as const, v: 1 }], 'so none of them is counted for its one repository.'],
		['1,200 of them', [{ k: 'hashtree' as const, v: 1200 }], 'so none of them is counted for its 1,200 repositories.']
	])('words the hashtree caveat of a document that counts no hashtree push for %s', async (_name, hashtree, ending) => {
		// a document written before the nostrology-data deploy of 2026-10-12 has no
		// pushes_hashtree_30d and counts none of hashtree's pushes
		const hosting = [...FIXTURE.hosting.filter((h) => h.k !== 'hashtree'), ...hashtree];
		const old = structuredClone(FIXTURE);
		delete old.summary.pushes_hashtree_30d;
		const { container } = renderPage({ ...old, hosting });
		const item = [...container.querySelectorAll('#ngit-not li')].map((li) => text(li).trim())[2];
		expect(item.startsWith("Not hashtree's pushes:"), item).toBe(true);
		expect(item.endsWith(ending), item).toBe(true);
	});

	it("says what a push is, hashtree's included, only in a document that counts hashtree's pushes", () => {
		// pushes_hashtree_30d marks a document written by the first run after the
		// nostrology-data deploy of 2026-10-12 or later (dataset reference section 3)
		const caption = (doc: NgitSnapshot) => {
			const { container, unmount } = renderPage(doc);
			const out = {
				pushes: text(container.querySelector('#ngit-pushes p')).trim(),
				pushed: text(container.querySelector('#ngit-pushed p')).replace(/\s+/g, ' ').trim(),
				bound: /every count is a lower bound[^.]*\./.exec(text(container.querySelector('#ngit-footer')))?.[0],
				commits: [...container.querySelectorAll('#ngit-not li')].map((li) => text(li).trim())[1],
				roster: [...container.querySelectorAll('#methodology tbody tr')]
					.map((tr) => [...tr.querySelectorAll('td')].map((td) => text(td).trim()))
					.find((cells) => cells[0] === 'kind-30617 (repo-announcements)')?.[1]
			};
			unmount();
			return out;
		};
		const STATES = 'A push is a published state whose branch or tag tips moved; identical republishes and HEAD-only changes do not count.';
		const WHO = 'Distinct repositories with a push, and distinct maintainers pushing, each ISO week.';
		const withState = (doc: NgitSnapshot) => doc.summary.repos_with_state.toLocaleString('en-US');
		expect(caption(FIXTURE)).toEqual({
			pushes: `${STATES} A hashtree repository's push is read from the announcement its git tool republishes with each branch or tag it pushes publicly; republishes less than two minutes apart count once.`,
			commits:
				'Not commits: a push is one state publication that moved at least one branch or tag, or one ' +
				'hashtree push read from its republished announcements, however many commits it carried.',
			roster: "the repository roster, and hashtree's pushes",
			// a series that now includes hashtree repositories, which push without a state
			pushed: `${WHO} ${withState(FIXTURE)} repositories have ever published a state; a hashtree repository pushes without one.`,
			// an edit that republishes a hashtree announcement counts as a push: not every count is a lower bound
			bound: 'every count is a lower bound, but for the hashtree edits What is counted names.'
		});
		const old = structuredClone(FIXTURE);
		delete old.summary.pushes_hashtree_30d;
		expect(caption(old)).toEqual({
			pushes: STATES,
			commits: 'Not commits: a push is one state publication that moved at least one branch or tag, however many commits it carried.',
			roster: 'the repository roster',
			pushed: `${WHO} ${withState(old)} repositories have ever published a state.`,
			bound: 'every count is a lower bound.'
		});
		// zero hashtree pushes in 30 days is a counted zero, not an old document
		expect(caption({ ...FIXTURE, summary: { ...FIXTURE.summary, pushes_hashtree_30d: 0 } }).roster).toBe(
			"the repository roster, and hashtree's pushes"
		);
	});

	it('opens a hashtree repository on git.iris.to, every other on gitworkshop.dev, and the caption names neither', async () => {
		// 2026-10-09: gitworkshop.dev reads code over HTTP(S) only (for a repository whose clone
		// URLs are all htree:// it shows a "cannot access" card), so the hashtree class opens on
		// hashtree's own viewer, in every table that links a repository
		// an htree:// clone URL's host is its npub
		const hashtree = {
			...ACTIVE_UNNAMED,
			pubkey: PK_C,
			d: 'iris repo',
			cls: 'hashtree' as const,
			host_kinds: ['hashtree' as const],
			hosts: [npubEncode(PK_C)]
		};
		const { container } = renderPage({ ...FIXTURE, repos_active: [ACTIVE_NAMED, hashtree] });
		await fireEvent.click(container.querySelector('#tab-repositories')!);
		const card = container.querySelector('#ngit-repos-active')!;
		expect([...card.querySelectorAll('tbody a')].map((a) => a.getAttribute('href'))).toEqual([
			`https://gitworkshop.dev/${npubEncode(PK_A)}/ngit`,
			`https://git.iris.to/#/${npubEncode(PK_C)}/iris%20repo`
		]);
		// the row names its kind of host in the Hosting cell, in Clone hosts' word (above its hosts)
		const cell = card.querySelector('tbody tr:nth-child(2) td:nth-child(2)')!.cloneNode(true) as Element;
		cell.querySelector('div')?.remove();
		expect(text(cell).trim()).toBe('hashtree');
		// the caption no longer says where names open (the operator's choice, 2026-10-09)
		expect(text(card.querySelector('h2 + p')).trim()).toBe(
			`The top 2 of 1,414 repositories pushed in the 90 days to ${dayName(FIXTURE.as_of_day)}, by pushes. ` +
				'Sorting reorders these 2 only.'
		);
		expect(text(container.querySelector('#panel-repositories'))).not.toMatch(/Names open|git\.iris\.to|gitworkshop/);
		// and on Collaboration, where the fixture's second zapped repository is hashtree's
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		const zaps = [...container.querySelectorAll('#ngit-zaps tbody a')].map((a) => a.getAttribute('href'));
		expect(zaps).toEqual(
			FIXTURE.repos_zapped.map((r) => (r.cls === 'hashtree' ? irisGitUrl(r.pubkey, r.d) : gitworkshopUrl(r.pubkey, r.d)))
		);
		expect(zaps.filter((h) => h?.startsWith('https://git.iris.to/'))).toEqual([
			`https://git.iris.to/#/${npubEncode(PK_B)}/zapped-1`
		]);
	});

	it('links every leaderboard row to gitworkshop.dev in a document from before the rows had a class', async () => {
		const strip = <T extends { cls?: unknown }>(rows: readonly T[]): T[] =>
			rows.map((r) => {
				const c = { ...r };
				delete c.cls;
				return c;
			});
		const snapshot: NgitSnapshot = {
			...FIXTURE,
			// five rows, so the stars table is drawn too
			repos_starred: strip([...FIXTURE.repos_starred, { ...FIXTURE.repos_starred[2], d: 'starred-4', name: 'Starred 4' }]),
			repos_zapped: strip(FIXTURE.repos_zapped),
			repos_discussed: strip(FIXTURE.repos_discussed ?? [])
		};
		const { container } = renderPage(snapshot);
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		const hrefs = [...container.querySelectorAll('#ngit-stars tbody a, #ngit-zaps tbody a')].map((a) =>
			a.getAttribute('href')
		);
		expect(hrefs).toHaveLength(10);
		expect(hrefs.every((h) => h?.startsWith('https://gitworkshop.dev/npub1')), hrefs.join(' ')).toBe(true);
		expect(panelProblems(container, 'collaboration', snapshot)).toEqual([]);
	});

	it('sorts the most-active table by any column, pushes 90 d first', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-repositories')!);
		const table = container.querySelector('#ngit-repos-active table')!;
		const order = () => [...table.querySelectorAll('tbody tr td:first-child a')].map((a) => a.textContent);
		expect(table.querySelector('th[aria-sort="descending"]')?.textContent).toContain('Pushes 90 d');
		expect(order()).toEqual([ACTIVE_NAMED.name, ACTIVE_UNNAMED.d]);
		await fireEvent.click(table.querySelector('button[aria-label="Sort by Pushes 30 d"]')!);
		expect(order()).toEqual([ACTIVE_UNNAMED.d, ACTIVE_NAMED.name]);
		await fireEvent.click(table.querySelector('button[aria-label="Sort by Pushes 30 d"]')!);
		expect(order()).toEqual([ACTIVE_NAMED.name, ACTIVE_UNNAMED.d]);
		expect(table.querySelector('th[aria-sort="ascending"]')?.textContent).toContain('Pushes 30 d');
	});

	it('falls back to the identifier for a name of zero-width characters only', async () => {
		const snapshot: NgitSnapshot = {
			...FIXTURE,
			repos_active: [{ ...FIXTURE.repos_active[0], name: '\u200B\u200B', d: 'visible-id' }]
		};
		const { container } = renderPage(snapshot);
		await fireEvent.click(container.querySelector('#tab-repositories')!);
		const a = container.querySelector('#ngit-repos-active tbody a')!;
		expect(a.textContent).toBe('visible-id');
		expect(a.querySelector('bdi')?.textContent).toBe('visible-id');
	});

	it('draws the lead and each host in its own isolate, cleaned', async () => {
		const snapshot: NgitSnapshot = {
			...FIXTURE,
			repos_active: [
				{ ...ACTIVE_NAMED, lead_name: '\u202ESatoshi', hosts: ['\u202Eevil.example', 'github.com', '\u200B'] },
				{ ...ACTIVE_UNNAMED, lead_name: '\u200B\u2060' }
			]
		};
		const { container } = renderPage(snapshot);
		await fireEvent.click(container.querySelector('#tab-repositories')!);
		const table = container.querySelector('#ngit-repos-active table')!;
		expect(text(table)).not.toMatch(BIDI);
		const [first, second] = [...table.querySelectorAll('tbody tr')];
		expect(text(first)).toContain('by Satoshi');
		const hosts = first.querySelector('td:nth-child(2) div')!;
		expect([...hosts.querySelectorAll('bdi')].map((b) => b.textContent)).toEqual([
			'evil.example',
			'github.com',
			NO_VISIBLE_TEXT
		]);
		expect(text(hosts).trim()).toBe(`evil.example, github.com, ${NO_VISIBLE_TEXT}`);
		// an invisible display name is no name: the short npub stands in
		expect(text(second)).toContain(`by ${shortNpub(PK_B)}`);
	});

	it('states each cut, and that sorting reorders the rows shown only', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-repositories')!);
		// the population is known for the most active (repos_pushed_90d), not for the topics
		expect(text(container.querySelector('#ngit-repos-active'))).toContain(
			'The top 2 of 1,414 repositories pushed in the 90 days to Sep 24, 2026, by pushes. Sorting reorders these 2 only.'
		);
		expect(text(container.querySelector('#ngit-topics'))).toContain('the top 2 topics by repositories');
	});

	it('says "all" when a list holds its whole population, with no sort note', async () => {
		const { container } = renderPage({
			...FIXTURE,
			summary: { ...FIXTURE.summary, repos_pushed_90d: 2 }
		});
		await fireEvent.click(container.querySelector('#tab-repositories')!);
		const active = text(container.querySelector('#ngit-repos-active'));
		expect(active).toContain('All 2 repositories pushed in the 90 days');
		expect(active).not.toContain('Sorting reorders');
	});
});

describe('/git hosting and maintainers', () => {
	it('explains every hosting class beside the donut', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		const classes = text(container.querySelector('#ngit-hosting-classes'));
		for (const l of ['GRASP only', 'GRASP + other hosts', 'hashtree, no GRASP', 'Forges only', 'Self-hosted, no GRASP', 'No public host']) {
			expect(classes).toContain(l);
		}
		// the announcing-tools heuristic is no longer shown (2026-10-08)
		expect(container.querySelector('#ngit-tools')).toBeNull();
		expect(text(container.querySelector('#panel-hosting'))).not.toContain('Announcing tools');
	});

	it("colours each clone host's bar by its kind of host, in the donut's colours, with no marker after the name", async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		const card = container.querySelector('#ngit-clone-hosts')!;
		// the names alone, in the document's order: "(GRASP)" no longer follows a GRASP server's
		// (the operator's choice, 2026-10-10)
		expect([...card.querySelectorAll('span[title]')].map((e) => e.textContent?.trim())).toEqual(
			FIXTURE.clone_hosts.map((h) => h.host)
		);
		expect(text(card)).not.toContain('(GRASP)');
		// each bar wears the donut's colour of its host's kind: a forge the Forges only amber (blue
		// until 2026-10-12), a GRASP server the GRASP purple, a self-hosted server the Self-hosted green
		expect(FIXTURE.clone_hosts.map((h) => h.cls)).toEqual(['forge', 'grasp', 'self_hosted']);
		const fills = [...card.querySelectorAll('[data-bar]')];
		expect(fills.map(bg)).toEqual([
			rgb(HOSTING_CLASS_COLOR.forge_only),
			rgb(HOSTING_CLASS_COLOR.grasp_only),
			rgb(HOSTING_CLASS_COLOR.other_hosts)
		]);
		// and the kind in words, in a host's words, as two of those colours (the hashtree pink and
		// the self-hosted green) are close under colour-vision deficiency: the hover title on the
		// bar's whole track, and the text a screen reader reads after the name
		expect(fills.map((f) => f.parentElement!.getAttribute('title'))).toEqual([
			'2,300 repositories - Forge',
			'700 repositories - GRASP',
			'12 repositories - Self-hosted'
		]);
		const words = [...card.querySelectorAll('[data-category]')];
		expect(words.map((e) => e.textContent)).toEqual(['Forge', 'GRASP', 'Self-hosted']);
		expect(words.every((e) => e.classList.contains('sr-only'))).toBe(true);
		// the key above the bars: each kind shown, once, in the operator's order (Self-hosted before
		// Forge since 2026-10-12), a square of its colour
		const legend = card.querySelector('[data-testid="chart-legend"]')!;
		expect(legend.getAttribute('aria-label')).toBe('Kinds of host');
		const keys = [...legend.querySelectorAll('li')];
		expect(keys.map((k) => text(k).trim())).toEqual(['GRASP', 'Self-hosted', 'Forge']);
		expect(keys.map((k) => bg(k.querySelector('[data-swatch="bar"]')))).toEqual([
			rgb(GRASP_COLOR),
			rgb(HOSTING_CLASS_COLOR.other_hosts),
			rgb(HOSTING_CLASS_COLOR.forge_only)
		]);
		expect(legend.nextElementSibling?.querySelector('[data-fill]')).not.toBeNull();
		// the caption says nothing of the colours: the key does (the operator dropped "Bars are
		// coloured by kind of host, as in the donut above." on 2026-10-11); the GRASP server count
		// is the card beside it
		expect(text(card.querySelector('p')).trim()).toBe(
			'The top 3 hosts across all clone URLs, by repositories; a repository counts once per host.'
		);
		expect(text(card)).not.toContain('coloured');
		expect(text(card)).not.toContain('host set');
		expect(text(container.querySelector('#ngit-grasp-servers'))).toContain(
			'Clone hosts counts any clone URL on a host, so its figure for a GRASP server can be higher.'
		);
	});

	it("wears New repositories per week's hashtree pink in Where the code lives and Clone hosts too, the operator's choice", async () => {
		// 2026-10-11: hashtree's teal there could not be told apart from the self-hosted green.
		// A hashtree host among the clone hosts: its "host" is its owner's npub.
		const doc = structuredClone(FIXTURE);
		doc.clone_hosts = [...doc.clone_hosts, { host: 'npub1hashtreeowner', repos: 5, cls: 'hashtree' }];
		const { container } = renderPage(doc);
		const keyOf = (root: Element, label: string) =>
			[...root.querySelectorAll('[data-testid="chart-legend"] li')]
				.find((li) => li.textContent?.trim() === label)
				?.querySelector('[data-swatch="bar"]') ?? null;
		// Overview: New repositories per week's key
		const weekly = bg(keyOf(container.querySelector('#ngit-new-repos')!, 'hashtree'));
		expect(weekly).toBe(rgb(PINK));
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		// Where the code lives: the class's swatch, which the donut's slice shares (one colour list)
		const rows = [...container.querySelectorAll('#ngit-hosting-classes dl > div')];
		const swatchOf = (label: string) =>
			rows.find((row) => row.querySelector('dt > span')?.textContent?.trim() === label)?.querySelector(':scope > span') ?? null;
		expect(bg(swatchOf('hashtree, no GRASP'))).toBe(weekly);
		// Clone hosts: the hashtree host's bar and the key's square
		const card = container.querySelector('#ngit-clone-hosts')!;
		const bar = [...card.querySelectorAll('[data-bar]')].find((b) => b.parentElement?.getAttribute('title')?.endsWith('- hashtree'));
		expect(bar).toBeDefined();
		expect(bg(bar ?? null)).toBe(weekly);
		expect(bg(keyOf(card, 'hashtree'))).toBe(weekly);
		// and the self-hosted green is another colour
		expect(bg(swatchOf('Self-hosted, no GRASP'))).toBe(rgb(GREEN));
		expect(bg(keyOf(card, 'Self-hosted'))).toBe(rgb(GREEN));
	});

	it("swaps GRASP + other hosts' and Forges only's colours, so a forge is one amber on the whole page, the operator's choice", async () => {
		// 2026-10-12: the donut's GRASP + other hosts was amber and its Forges only blue, which Clone
		// hosts wore for a forge, while New repositories per week drew a forge amber
		const { container } = renderPage();
		const keyOf = (root: Element, label: string) =>
			[...root.querySelectorAll('[data-testid="chart-legend"] li')]
				.find((li) => li.textContent?.trim() === label)
				?.querySelector('[data-swatch="bar"]') ?? null;
		// Overview: New repositories per week's key
		expect(bg(keyOf(container.querySelector('#ngit-new-repos')!, 'Forges'))).toBe(rgb(AMBER));
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		// Where the code lives: the swatches the donut's slices share
		const rows = [...container.querySelectorAll('#ngit-hosting-classes dl > div')];
		const swatchOf = (label: string) =>
			rows.find((row) => row.querySelector('dt > span')?.textContent?.trim() === label)?.querySelector(':scope > span') ?? null;
		expect(bg(swatchOf('Forges only'))).toBe(rgb(AMBER));
		expect(bg(swatchOf('GRASP + other hosts'))).toBe(rgb(BLUE));
		// Clone hosts: the forge's bar and the key's square
		const card = container.querySelector('#ngit-clone-hosts')!;
		const bar = [...card.querySelectorAll('[data-bar]')].find((b) => b.parentElement?.getAttribute('title')?.endsWith('- Forge'));
		expect(bar).toBeDefined();
		expect(bg(bar ?? null)).toBe(rgb(AMBER));
		expect(bg(keyOf(card, 'Forge'))).toBe(rgb(AMBER));
		// no bar and no key of a kind of host wears the blue, which is no kind's
		expect([...card.querySelectorAll('[data-bar], [data-swatch]')].map(bg)).not.toContain(rgb(BLUE));
		// Relays per repository keeps the blue (the operator's choice of 2026-10-08)
		const relays = [...container.querySelectorAll('#ngit-relays-per-repo [data-bar]')].map(bg);
		expect(relays.length).toBeGreaterThan(0);
		expect(new Set(relays)).toEqual(new Set([rgb(BLUE)]));
	});

	it('gives each kind of host one colour in both keys, the donut\'s for its kind', async () => {
		// every kind among the clone hosts, so both keys show all five
		const doc = structuredClone(FIXTURE);
		doc.clone_hosts = [
			{ host: 'github.com', repos: 50, cls: 'forge' },
			{ host: 'relay.example', repos: 40, cls: 'grasp' },
			{ host: 'npub1hashtreeowner', repos: 30, cls: 'hashtree' },
			{ host: 'git.example', repos: 20, cls: 'self_hosted' },
			{ host: 'localhost', repos: 10, cls: 'private' }
		];
		const { container } = renderPage(doc);
		const keys = (root: Element) =>
			[...root.querySelectorAll('[data-testid="chart-legend"] li')]
				.filter((li) => li.querySelector('[data-swatch="bar"]'))
				.map((li) => bg(li.querySelector('[data-swatch="bar"]')));
		const weekly = keys(container.querySelector('#ngit-new-repos')!);
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		const clone = keys(container.querySelector('#ngit-clone-hosts')!);
		// the same five colours in the same order: one colour per kind, one order of the kinds
		expect(weekly).toEqual(clone);
		// and each the colour of the donut's class of its kind, in the operator's order
		expect(clone).toEqual(
			[
				HOSTING_CLASS_COLOR.grasp_only,
				HOSTING_CLASS_COLOR.hashtree,
				HOSTING_CLASS_COLOR.other_hosts,
				HOSTING_CLASS_COLOR.forge_only,
				HOSTING_CLASS_COLOR.none
			].map((c) => rgb(c))
		);
	});

	it("orders the kinds of host GRASP, hashtree, Self-hosted, Forge, then the one that is not public, in both keys, the operator's order", async () => {
		// 2026-10-12. The document lists by_host grasp, hashtree, forge, self_hosted, none.
		expect(FIXTURE.new_repos_weekly![0].by_host!.map((c) => c.k)).toEqual(['grasp', 'hashtree', 'forge', 'self_hosted', 'none']);
		const doc = structuredClone(FIXTURE);
		doc.clone_hosts = [
			{ host: 'github.com', repos: 60, cls: 'forge' },
			{ host: 'git.example', repos: 50, cls: 'self_hosted' },
			{ host: 'localhost', repos: 40, cls: 'private' },
			{ host: 'new.example', repos: 30, cls: 'brand_new_class' as NgitHostClass },
			{ host: 'npub1hashtreeowner', repos: 20, cls: 'hashtree' },
			{ host: 'relay.example', repos: 10, cls: 'grasp' }
		];
		const { container } = renderPage(doc);
		const words = (root: Element) => [...root.querySelectorAll('[data-testid="chart-legend"] li')].map((li) => text(li).trim());
		// New repositories per week: the bars' keys, then the line's
		expect(words(container.querySelector('#ngit-new-repos')!)).toEqual([
			'GRASP',
			'hashtree',
			'Self-hosted',
			'Forges',
			'No public host',
			'First-time maintainers'
		]);
		// Clone hosts: whatever the bars' order, and a kind the page does not know yet last
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		expect(words(container.querySelector('#ngit-clone-hosts')!)).toEqual([
			'GRASP',
			'hashtree',
			'Self-hosted',
			'Forge',
			'Not public',
			'brand_new_class'
		]);
	});

	it("keeps New repositories per week's order whatever the document's, a kind it does not know yet after the five", async () => {
		const doc = structuredClone(FIXTURE);
		const order = ['none', 'brand_new_kind', 'forge', 'self_hosted', 'hashtree', 'grasp'];
		doc.new_repos_weekly = doc.new_repos_weekly!.map((r) => ({
			...r,
			by_host: order.map((k) => ({ k, v: r.by_host!.find((c) => c.k === k)?.v ?? 1 })) as typeof r.by_host
		}));
		const { container } = renderPage(doc);
		const legend = [...container.querySelectorAll('#ngit-new-repos [data-testid="chart-legend"] li')];
		expect(legend.map((li) => text(li).trim())).toEqual([
			'GRASP',
			'hashtree',
			'Self-hosted',
			'Forges',
			'No public host',
			'brand_new_kind',
			'First-time maintainers'
		]);
		expect(legend.map((li) => bg(li.querySelector('[data-swatch]')))).toEqual(
			[GRASP_COLOR, PINK, GREEN, AMBER, OTHERS_COLOR, OTHERS_COLOR, NEUTRAL_SERIES].map((c) => rgb(c))
		);
		// the page's checks hold the same order on any document
		expect(panelProblems(container, 'overview', doc)).toEqual([]);
	});

	it('paints the two classes of host that are not public alike, under one key, and keys a class it does not know yet by its name', async () => {
		const { container } = renderPage({
			...FIXTURE,
			clone_hosts: [
				{ host: 'new.example', repos: 50, cls: 'brand_new_class' as NgitHostClass },
				{ host: 'npub1example', repos: 40, cls: 'hashtree' },
				{ host: 'localhost', repos: 30, cls: 'private' },
				{ host: 'gitnostr.example', repos: 20, cls: 'non_network' },
				{ host: 'relay.example', repos: 10, cls: 'grasp' }
			]
		});
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		const card = container.querySelector('#ngit-clone-hosts')!;
		const fills = [...card.querySelectorAll('[data-bar]')];
		expect(fills.map(bg)).toEqual([
			rgb(OTHERS_COLOR),
			rgb(HOSTING_CLASS_COLOR.hashtree),
			rgb(HOSTING_CLASS_COLOR.none),
			rgb(HOSTING_CLASS_COLOR.none),
			rgb(GRASP_COLOR)
		]);
		expect(fills.map((f) => f.parentElement!.getAttribute('title'))).toEqual([
			'50 repositories - brand_new_class',
			'40 repositories - hashtree',
			'30 repositories - Not public',
			'20 repositories - Not public',
			'10 repositories - GRASP'
		]);
		// the operator's order, whatever the bars' order; one key for private and non-network
		// hosts; a kind the page does not know yet last
		const keys = [...card.querySelectorAll('[data-testid="chart-legend"] li')];
		expect(keys.map((k) => text(k).trim())).toEqual(['GRASP', 'hashtree', 'Not public', 'brand_new_class']);
		expect(keys.map((k) => bg(k.querySelector('[data-swatch="bar"]')))).toEqual([
			rgb(GRASP_COLOR),
			rgb(HOSTING_CLASS_COLOR.hashtree),
			rgb(HOSTING_CLASS_COLOR.none),
			rgb(OTHERS_COLOR)
		]);
	});

	it("names a hashtree host htree:// and its owner's short npub, the whole npub on hover, the operator's choice", async () => {
		// 2026-10-11: an htree:// URL's authority is its owner's npub, not a server, and in full it
		// took two or three lines. The operator: "Seeing pyramid.fiatjaf.com and git.jb55.com in the
		// list makes me lean towards htree://npub1xdhn...eycm in this case".
		const NPUB = 'npub1hwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasxw04hu'; // 'bb' x 32
		const doc = structuredClone(FIXTURE);
		doc.clone_hosts = [...doc.clone_hosts, { host: NPUB, repos: 5, cls: 'hashtree' }, { host: 'self', repos: 2, cls: 'hashtree' }];
		const { container } = renderPage(doc);
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		const labels = [...container.querySelectorAll('#ngit-clone-hosts span[title]')];
		expect(labels.map((l) => [l.textContent?.trim(), l.getAttribute('title')])).toEqual([
			['github.com', 'github.com'],
			['relay.ngit.dev', 'relay.ngit.dev'],
			['git.example.org', 'git.example.org'],
			['htree://npub1hwam...04hu', `htree://${NPUB}`],
			['self', 'self']
		]);
		expect(text(container.querySelector('#ngit-clone-hosts'))).not.toContain(NPUB);
		// the shared panel check holds every bar's label and hover to the same rule ...
		expect(panelProblems(container, 'hosting', doc)).toEqual([]);
		// ... and is not vacuous: held to another owner's key, the row fails
		const other = structuredClone(doc);
		other.clone_hosts[3] = { ...other.clone_hosts[3], host: 'npub1enxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxvenxqn2pktz' }; // 'cc' x 32
		expect(panelProblems(container, 'hosting', other).join(' ')).toContain('#ngit-clone-hosts row 4 (hashtree)');
	});

	it('draws no key, and says nothing of colours, when the document has no clone host', async () => {
		const { container } = renderPage({ ...FIXTURE, clone_hosts: [] });
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		const card = container.querySelector('#ngit-clone-hosts')!;
		expect(card.querySelector('[data-testid="chart-legend"]')).toBeNull();
		expect(card.querySelector('[data-fill]')?.children.length).toBe(0);
		expect(text(card)).toContain('a repository counts once per host.');
		expect(text(card)).not.toContain('coloured');
	});

	it('says each repository is in ONE class, so no slice double-counts another', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		const classes = text(container.querySelector('#ngit-hosting-classes'));
		expect(classes).toContain('Each repository is in exactly one class judged over its public clone URLs.');
		// the legend is in the document's precedence order. The intro no longer says "the first
		// that fits" (2026-10-11): each definition below excludes the classes above it ("plus ...
		// another kind", "no GRASP server", "only forges", "no GRASP, no hashtree", "no public
		// clone URL"), so they hold without it
		const legend = [...container.querySelectorAll('#ngit-hosting-classes dt > span:first-child')].map((e) => e.textContent);
		expect(legend).toEqual(['GRASP only', 'GRASP + other hosts', 'hashtree, no GRASP', 'Forges only', 'Self-hosted, no GRASP', 'No public host']);
		expect(FIXTURE.hosting.map((h) => h.k)).toEqual(['grasp_only', 'grasp_mixed', 'hashtree', 'forge_only', 'other_hosts', 'none']);
		// GRASP + other hosts names hashtree as one of its other hosts; the hashtree slice says
		// it holds only the repositories with no GRASP server
		const defOf = (label: string) =>
			[...container.querySelectorAll('#ngit-hosting-classes dl > div')]
				.find((item) => item.querySelector('dt span')?.textContent === label)
				?.querySelector('dd')?.textContent;
		expect(defOf('GRASP + other hosts')).toContain('a self-hosted server or hashtree');
		expect(defOf('GRASP + other hosts')).toMatch(/; counted here, not again below$/);
		expect(defOf('hashtree, no GRASP')).toBe('an htree:// clone URL and no GRASP server');
		expect(defOf('Self-hosted, no GRASP')).toBe('a self-hosted git server, no GRASP, no hashtree');
	});

	it('says public, never reachable, and no class definition fits vacuously', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		const classes = text(container.querySelector('#ngit-hosting-classes'));
		expect(classes).toContain('judged over its public clone URLs.');
		expect(classes).not.toContain("owner's npub");
		// the classes are kinds of host, not counts: two GRASP servers are still GRASP only. And
		// the definition cannot fit vacuously: "every public clone URL is on a GRASP server", its
		// words until 2026-10-10, also held for a repository with no public clone URL, which the
		// first-that-fits order would then have put in GRASP only (the operator asked whether the
		// classes are exclusive and exhaustive)
		expect(classes).toContain('only GRASP servers (one or several)');
		expect(classes).not.toContain('every public clone URL');
		expect(classes).toContain(
			'a GRASP server plus a public clone URL of another kind - a forge, a self-hosted server or hashtree - such as a GitHub mirror'
		);
		expect(classes).toContain('No public host');
		// a word that implies a live check appears on no pill
		for (const pill of Object.keys(PILL_SECTIONS)) {
			await fireEvent.click(container.querySelector(`#tab-${pill}`)!);
			const panel = container.querySelector(`#panel-${pill}`);
			expect(panel, pill).not.toBeNull();
			expect(text(panel).toLowerCase(), pill).not.toContain('reachab');
		}
	});

	it('gives each hosting class its share beside its count, in whole percents as Servers per list does', async () => {
		// the operator's request, 2026-10-10: percentages beside the counts, as Servers per list has
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		const rows = [...container.querySelectorAll('#ngit-hosting-classes dl > div')].map((item) => {
			const dt = item.querySelector('dt')!;
			const right = dt.children[1];
			return [text(dt.children[0]).trim(), text(right.children[0]).trim(), text(right.querySelector('[data-share]')).trim()];
		});
		// over the fixture's 4,527 repositories: 900 / 4,527 is 19.9%, 249 / 4,527 is 5.5003%
		expect(rows).toEqual([
			['GRASP only', '900', '20%'],
			['GRASP + other hosts', '520', '11%'],
			['hashtree, no GRASP', '358', '8%'],
			['Forges only', '1,900', '42%'],
			['Self-hosted, no GRASP', '600', '13%'],
			['No public host', '249', '6%']
		]);
		// the centre keeps its one decimal: 20 + 11 + 8 is 39, beside a centre of 39.3%
		expect(text(container.querySelector('#ngit-hosting-classes'))).toContain('39.3% GRASP or hashtree');
	});

	it('marks a class under one percent as <1%, never 0%, as Servers per list does', async () => {
		// row 826's No public host: 10 of 4,596 repositories, 0.2%
		const doc = structuredClone(FIXTURE);
		doc.hosting = doc.hosting.map((h) => (h.k === 'none' ? { ...h, v: 10 } : h));
		doc.summary.repos = doc.hosting.reduce((t, h) => t + h.v, 0);
		const { container } = renderPage(doc);
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		const shares = [...container.querySelectorAll('#ngit-hosting-classes [data-share]')].map((e) => text(e).trim());
		expect(shares.at(-1)).toBe('<1%');
	});

	it('gives every class 0% of a snapshot with no repositories', async () => {
		const empty = structuredClone(FIXTURE);
		empty.summary.repos = 0;
		empty.summary.grasp_repos = 0;
		empty.hosting = empty.hosting.map((h) => ({ ...h, v: 0 }));
		const { container } = renderPage(empty);
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		const shares = [...container.querySelectorAll('#ngit-hosting-classes [data-share]')].map((e) => text(e).trim());
		expect(shares).toEqual(Array(6).fill('0%'));
	});

	it('defines hashtree beside GRASP, before the classes', async () => {
		// the operator's request, 2026-10-10: the page defined GRASP and never hashtree
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		const intro = [...container.querySelectorAll('#ngit-hosting-classes > p')].map(text).join(' ');
		const hashtree =
			'A hashtree repository is a whole git repository, branches and tags included, kept as one content-addressed tree on Blossom file servers and peers.';
		expect(intro).toContain(hashtree);
		expect(intro.indexOf('A GRASP server is a git host that is also a Nostr relay.')).toBeLessThan(intro.indexOf(hashtree));
		expect(intro.indexOf(hashtree)).toBeLessThan(intro.indexOf('Each repository is in exactly one class'));
	});

	it('shows the GRASP or hashtree share at one precision, in the card and the donut alike', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		expect(text(container.querySelector('#ngit-cards'))).toContain('39.3%');
		const classes = text(container.querySelector('#ngit-hosting-classes'));
		expect(classes).toContain('39.3%');
		expect(classes).toContain('GRASP or hashtree');
		expect(classes).not.toMatch(/\b39%/);
		// the centre no longer names GRASP alone
		expect(classes).not.toContain('GRASP-hosted');
		expect(classes).not.toContain('31.4%');
	});

	it('sorts the maintainers by pushes in 90 days first, and by any column on a click', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-maintainers')!);
		const table = container.querySelector('#ngit-maintainers table')!;
		const order = () => [...table.querySelectorAll('tbody a')].map((a) => a.getAttribute('href'));
		const B = `https://njump.me/${npubEncode(PK_B)}`;
		const A = `https://njump.me/${npubEncode(PK_A)}`;
		const sortOf = (label: string) =>
			table.querySelector(`button[aria-label="Sort by ${label}"]`)!.closest('th')!.getAttribute('aria-sort');
		// before any click: the document's ranking, marked on the Pushes 90 d column
		expect(order()).toEqual([B, A]); // 661 pushes above 340
		expect(sortOf('Pushes 90 d')).toBe('descending');
		expect(['Maintainer', 'Repositories', 'Last push'].map(sortOf)).toEqual(['none', 'none', 'none']);
		await fireEvent.click(table.querySelector('button[aria-label="Sort by Repositories"]')!);
		expect(order()).toEqual([A, B]); // 47 repositories above 12
		expect(sortOf('Repositories')).toBe('descending');
		await fireEvent.click(table.querySelector('button[aria-label="Sort by Repositories"]')!);
		expect(order()).toEqual([B, A]); // flipped: ascending
		await fireEvent.click(table.querySelector('button[aria-label="Sort by Last push"]')!);
		expect(order()).toEqual([A, B]); // A pushed later
		await fireEvent.click(table.querySelector('button[aria-label="Sort by Pushes 90 d"]')!);
		expect(order()).toEqual([B, A]); // a new column starts descending
		await fireEvent.click(table.querySelector('button[aria-label="Sort by Maintainer"]')!);
		expect(sortOf('Maintainer')).toBe('ascending'); // text starts ascending
	});

	it('shows pushes-first order even over a document ranked the old way (repositories first)', async () => {
		// A row written before 2026-09-29 ranks by repositories. The marker says Pushes 90 d,
		// so the rows must follow it: the page always applies the marked sort (stable).
		const { container } = renderPage({
			...FIXTURE,
			maintainers_top: [FIXTURE.maintainers_top[1], FIXTURE.maintainers_top[0]] // 47 repos first
		});
		await fireEvent.click(container.querySelector('#tab-maintainers')!);
		const hrefs = [...container.querySelectorAll('#ngit-maintainers tbody a')].map((a) => a.getAttribute('href'));
		expect(hrefs).toEqual([`https://njump.me/${npubEncode(PK_B)}`, `https://njump.me/${npubEncode(PK_A)}`]);
	});

	it('sorts the GRASP servers table', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		const table = container.querySelector('#ngit-grasp-servers table')!;
		const first = () => table.querySelector('tbody tr td')?.textContent;
		expect(first()).toBe('relay.ngit.dev');
		await fireEvent.click(table.querySelector('button[aria-label="Sort by Repositories"]')!);
		expect(first()).toBe('git.shakespeare.diy');
		await fireEvent.click(table.querySelector('button[aria-label="Sort by Server"]')!);
		expect(first()).toBe('git.shakespeare.diy');
	});

	it('links maintainers to njump.me by npub, falling back to a short npub for no name', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-maintainers')!);
		const table = container.querySelector('#ngit-maintainers table')!;
		const links = [...table.querySelectorAll('tbody a')] as HTMLAnchorElement[];
		// the document's ranking - pushes in 90 d, then repositories: 661/12 above 340/47
		expect(links.map((a) => a.getAttribute('href'))).toEqual([
			`https://njump.me/${npubEncode(PK_B)}`,
			`https://njump.me/${npubEncode(PK_A)}`
		]);
		const npubB = npubEncode(PK_B);
		expect(links[0].textContent).toBe(`${npubB.slice(0, 9)}...${npubB.slice(-4)}`);
		expect(links[0].textContent).toBe(shortNpub(PK_B));
		expect(links[1].textContent).toBe('Dan the maintainer');
		expect(table.querySelector(`td[title="${PK_B}"]`)).not.toBeNull();
		// the four maintainer cards went on 2026-10-02
		expect(container.querySelector('#ngit-maintainers-cards')).toBeNull();
		const panel = text(container.querySelector('#panel-maintainers'));
		for (const gone of ['Shared repositories', 'Concentration', 'one-way listing', 'top 10 announcers']) {
			expect(panel, gone).not.toContain(gone);
		}
	});

	it('titles the table Most active maintainers and leaves its links to speak for themselves', async () => {
		// the operator's wording, 2026-10-09: "Most active maintainers" for "Top maintainers",
		// display names "where one is available", and no sentence naming njump.me (the names
		// still link there)
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-maintainers')!);
		const card = container.querySelector('#ngit-maintainers')!;
		expect(text(card.querySelector('h2'))).toBe('Most active maintainers');
		expect(card.querySelector('table')!.getAttribute('aria-label')).toBe('Most active maintainers');
		const caption = text(card.querySelector('h2 + p'));
		expect(caption.endsWith('Names are their kind-0 (profile-metadata) display names where one is available.'), caption).toBe(true);
		expect(text(container.querySelector('#panel-maintainers'))).not.toMatch(/Top maintainers|njump|where one is known/);
	});

	it('says a push counts only for its publisher, and a shared repository for each of its maintainers', async () => {
		// the operator's choice of wording, 2026-10-09 (the earlier "a repository shared by
		// co-maintainers counts for each of them" read as if one push counted for several):
		// dataset reference 5.1, pushes_90d = the pubkey's own push rows, repos = every
		// repository it is a member of
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-maintainers')!);
		expect(text(container.querySelector('#ngit-maintainers h2 + p')).trim()).toBe(
			'The top 2 of 1,310 maintainers by pushes in the last 90 days, then by repositories they ' +
				'maintain. Sorting reorders these 2 only. A push counts only for the maintainer who ' +
				'published it, never for their co-maintainers. A repository with several maintainers ' +
				'counts once for each of them. Names are their kind-0 (profile-metadata) display names ' +
				'where one is available.'
		);
		expect(text(container.querySelector('#panel-maintainers'))).not.toMatch(/shared by co-maintainers/);
	});

	it('repeats the pushes in 90 days under each name on a phone, where that column is off screen', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-maintainers')!);
		const lines = [...container.querySelectorAll('#ngit-maintainers tbody td:first-child [class~="sm:hidden"]')];
		expect(lines.map((el) => el.textContent?.trim())).toEqual(['661 pushes in 90 d', '340 pushes in 90 d']);
		// outside the link: the name stays the link's whole text
		expect(lines.every((el) => el.closest('a') === null)).toBe(true);
	});

	it('opens every maintainer link in a new tab with noopener noreferrer', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-maintainers')!);
		const links = [...container.querySelectorAll('#ngit-maintainers tbody a')];
		expect(links).toHaveLength(FIXTURE.maintainers_top.length);
		for (const a of links) {
			expect(a.getAttribute('target')).toBe('_blank');
			expect(a.getAttribute('rel')).toBe('noopener noreferrer');
		}
	});

	it('shows a cleaned maintainer name, and the short npub for an invisible one', async () => {
		const { container } = renderPage({
			...FIXTURE,
			maintainers_top: [
				{ ...FIXTURE.maintainers_top[0], name: '\u200B\u200B' },
				{ ...FIXTURE.maintainers_top[1], name: '\u202ESatoshi' }
			]
		});
		await fireEvent.click(container.querySelector('#tab-maintainers')!);
		const links = [...container.querySelectorAll('#ngit-maintainers tbody a')];
		expect(links.map((a) => a.textContent)).toEqual([shortNpub(PK_B), 'Satoshi']);
		expect(links.every((a) => a.querySelector('bdi') !== null)).toBe(true);
	});

	it('states each cut on the Maintainers pill, with the sort note beside the sortable table', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-maintainers')!);
		expect(text(container.querySelector('#ngit-maintainers'))).toContain(
			'The top 2 of 1,310 maintainers by pushes in the last 90 days, then by repositories they maintain. Sorting reorders these 2 only.'
		);
		const lists = container.querySelector('#ngit-grasp-lists')!;
		expect(lists.querySelector('h2')!.textContent).toBe('Users with a GRASP server list');
		expect(text(lists)).not.toContain('First choice');
		expect(text(container.querySelector('#ngit-grasp-servers'))).not.toContain('first choice');
	});

	it("keeps Where the code lives' intro to the operator's three sentences, the last in its own paragraph", async () => {
		// 2026-10-11, the operator's words: "it's a massive paragraph otherwise". The precedence,
		// what public means and how a GRASP server is recognised (dataset reference 4.1-4.3) went.
		// Later that day: "Move "Each repository is in exactly one class judged over its public
		// clone URLs." to its own paragraph".
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		const card = container.querySelector('#ngit-hosting-classes')!;
		expect([...card.querySelectorAll(':scope > p')].map((p) => text(p).trim())).toEqual([
			'A GRASP server is a git host that is also a Nostr relay. A hashtree repository is a whole git repository, branches and tags included, kept as one content-addressed tree on Blossom file servers and peers.',
			'Each repository is in exactly one class judged over its public clone URLs.'
		]);
		// the two paragraphs sit between the title and the donut with the classes
		expect([...card.children].map((e) => e.tagName)).toEqual(['H2', 'P', 'P', 'DIV']);
		// a GRASP server is never recognised "on a public host", which read as a DNS check
		const classes = text(container.querySelector('#ngit-hosting-classes'));
		expect(classes).not.toContain('on a public host');
		expect(classes).not.toContain('public DNS');
	});

	it('shows the top 20 clone hosts and the top 10 web hosts, in the document order, of the longer lists it carries', async () => {
		// the document carries 30 and 12 (dataset reference 4.5): ranked by repositories, ties
		// by host, so the first rows are the top N
		const cloneHosts = Array.from({ length: 30 }, (_, i) => ({ host: `h${String(i).padStart(2, '0')}.example`, repos: 300 - i, cls: i < 20 ? ('self_hosted' as const) : ('private' as const) }));
		const webHosts = Array.from({ length: 12 }, (_, i) => ({ host: `w${String(i).padStart(2, '0')}.example`, repos: 120 - i }));
		const { container } = renderPage({ ...FIXTURE, clone_hosts: cloneHosts, web_hosts: webHosts });
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		const labels = (id: string) => [...container.querySelectorAll(`#${id} span[title]`)].map((e) => e.textContent?.trim());
		expect(labels('ngit-clone-hosts')).toEqual(cloneHosts.slice(0, 20).map((h) => h.host));
		expect(labels('ngit-web-hosts')).toEqual(webHosts.slice(0, 10).map((h) => h.host));
		expect(text(container.querySelector('#ngit-clone-hosts'))).toContain('The top 20 hosts across all clone URLs');
		expect(text(container.querySelector('#ngit-web-hosts'))).toContain('the top 10 hosts by repositories');
		expect(text(container.querySelector('#ngit-clone-hosts'))).not.toContain('h20.example');
		// the key holds only the kinds of the bars shown: rows 21-30 are private here, and no key
		// may stand for a bar the list does not draw
		expect([...container.querySelectorAll('#ngit-clone-hosts [data-testid="chart-legend"] li')].map((k) => text(k).trim())).toEqual([
			'Self-hosted'
		]);
		expect(text(container.querySelector('#ngit-web-hosts'))).not.toContain('w10.example');
	});

	it('lays the Hosting cards out in pairs, each pair one grid row sharing one height', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		const PAIRS = [
			['ngit-clone-hosts', 'ngit-grasp-servers'],
			['ngit-relays-per-repo', 'ngit-grasp-per-repo'],
			['ngit-relays', 'ngit-web-hosts']
		];
		for (const [a, b] of PAIRS) {
			const row = container.querySelector(`#${a}`)!.parentElement!;
			// both cards are the row's own children (a grid stretches its items to the row's
			// height): nothing stacked inside a column, which is what let the heights drift
			expect([...row.children].map((el) => el.id), a).toEqual([a, b]);
			expect(row.className, a).toContain('lg:grid-cols-2');
			expect(row.className, a).not.toContain('items-');
		}
		// Clone hosts' bars are shorter than the table's rows: its list spreads down to where
		// the table ends (HBar fill, in a flex column card). No other list on the pill spreads.
		// classList, not className substrings: 'flex-col' contains 'flex', and the spread needs
		// both the card and the wrapper to be flex containers
		const cloneHosts = container.querySelector('#ngit-clone-hosts')!;
		const wrapper = cloneHosts.querySelector('[data-fill]')!.parentElement!;
		for (const c of ['flex', 'flex-col']) expect(cloneHosts.classList.contains(c), `card ${c}`).toBe(true);
		for (const c of ['flex', 'flex-col', 'flex-1']) expect(wrapper.classList.contains(c), `wrapper ${c}`).toBe(true);
		expect(wrapper.parentElement).toBe(cloneHosts);
		expect([...container.querySelectorAll('#panel-hosting [data-fill]')].map((el) => el.closest('[id^="ngit-"]')?.id)).toEqual([
			'ngit-clone-hosts'
		]);
	});

	it('states each cut on the Hosting pill, with the sort note beside the sortable table', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		expect(text(container.querySelector('#ngit-grasp-servers'))).toContain(
			'The top 3 of 41 servers by repositories'
		);
		expect(text(container.querySelector('#ngit-grasp-servers'))).toContain('Sorting reorders these 3 only.');
		expect(text(container.querySelector('#ngit-clone-hosts'))).toContain('The top 3 hosts across all clone URLs, by repositories');
		expect(text(container.querySelector('#ngit-relays'))).toContain('the top 2 relays by repositories naming each');
		expect(text(container.querySelector('#ngit-web-hosts'))).toContain('the top host by repositories');
	});

	it("quotes ngit.dev's general advice on GRASP servers per repository, three to five", async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		// ngit.dev says "three to five" in general and "at least three" only in the middle of
		// swapping servers (ngit-docs docs/repositories.md). nostrology-web#18 (/git: "ngit.dev
		// advises keeping at least three" misquotes ngit.dev)
		const caption = text(container.querySelector('#ngit-grasp-per-repo p')).trim();
		expect(caption).toBe('Over the 1,420 GRASP-hosted repositories; ngit.dev recommends listing three to five.');
		expect(caption).not.toContain('at least three');
	});

	it('keeps hosting colours for hosting classes on the Hosting pill', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		// the donut's key: each class wears its fixed colour, by key
		const swatches = [...container.querySelectorAll('#ngit-hosting-classes dl span[style]')];
		expect(swatches.map(bg)).toEqual(FIXTURE.hosting.map((h) => rgb(HOSTING_CLASS_COLOR[h.k])));
		// GRASP servers per repository is GRASP; Relays per repository beside it wears blue, the
		// operator's choice (2026-10-08), which stayed when Forges only went amber (2026-10-12);
		// Clone hosts wears the donut's colours by kind of host (the operator's choice,
		// 2026-10-10; tested above); the rest take the neutral ink
		const barColours = (id: string) => [...container.querySelectorAll(`#${id} [data-bar]`)].map(bg);
		expect(new Set(barColours('ngit-grasp-per-repo'))).toEqual(new Set([rgb(GRASP_COLOR)]));
		expect(new Set(barColours('ngit-relays-per-repo'))).toEqual(new Set([rgb(BLUE)]));
		expect(RELAYS_PER_REPO_COLOR).toBe(BLUE);
		expect(barColours('ngit-clone-hosts')).toEqual(FIXTURE.clone_hosts.map((h) => rgb(HOST_KIND_COLOR[HOST_CLASS_KIND[h.cls]])));
		for (const id of ['ngit-relays', 'ngit-web-hosts']) {
			const colours = barColours(id);
			expect(colours.length, id).toBeGreaterThan(0);
			expect(new Set(colours), id).toEqual(new Set([rgb(NEUTRAL_SERIES)]));
		}
	});

	it('shows third-party hosts, relays, topics and client tags cleaned', async () => {
		const RLO = '\u202E';
		const snapshot: NgitSnapshot = {
			...FIXTURE,
			clone_hosts: [{ host: `${RLO}evil.example`, repos: 9, cls: 'grasp' }],
			grasp_servers: [{ host: `${RLO}evil.example`, repos: 9, users: 1, first_choice: 1 }],
			relays: [{ relay: `${RLO}relay.example`, repos: 9 }],
			web_hosts: [{ host: '\u200B', repos: 9 }]
		};
		const { container } = renderPage(snapshot);
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		const panel = text(container.querySelector('#panel-hosting'));
		expect(panel).not.toMatch(BIDI);
		expect(container.querySelector('#ngit-grasp-servers tbody td bdi')?.textContent).toBe('evil.example');
		expect(text(container.querySelector('#ngit-web-hosts'))).toContain(NO_VISIBLE_TEXT);
		// the label and its hover title are the cleaned string; the kind of host is the bar's
		// colour and words of its own, never text joined to the name
		expect(container.querySelector('#ngit-clone-hosts span[title="evil.example"]')?.textContent?.trim()).toBe('evil.example');
		expect(container.querySelector('#ngit-clone-hosts [data-category]')?.textContent).toBe('GRASP');
	});
});

describe('/git page-wide', () => {
	const PILLS = ['overview', 'repositories', 'hosting', 'maintainers', 'collaboration'];
	const eachPill = async (check: (pill: string, container: HTMLElement) => void) => {
		const { container } = renderPage();
		for (const pill of PILLS) {
			await fireEvent.click(container.querySelector(`#tab-${pill}`)!);
			check(pill, container);
		}
	};

	it('holds exactly the sections of the design on each pill, in order - nothing re-added under a new id', async () => {
		await eachPill((pill, container) => {
			const panel = container.querySelector('[id^="panel-"]')!;
			// every section carries an `ngit-` id except What is counted, whose id is the
			// site-wide `methodology` anchor ($lib/methodology)
			const ids = [...panel.querySelectorAll('[id^="ngit-"], #methodology')].map((el) => el.id);
			expect(ids, pill).toEqual(PILL_SECTIONS[pill]);
		});
	});

	it('says "observation", never "capture", anywhere a reader can see, on every pill', async () => {
		// The operator's preference for public wording (2026-10-18): the chart key, What is
		// counted, its Sources column, a caveat, Discussion and the footer all said "capture"
		// until then. Text and the attributes a reader meets (hover titles, aria labels).
		await eachPill((pill, container) => {
			const seen = [
				text(container),
				...[...container.querySelectorAll('[title], [aria-label]')].flatMap((el) => [
					el.getAttribute('title') ?? '',
					el.getAttribute('aria-label') ?? ''
				])
			].join(' ');
			expect(seen, pill).not.toMatch(/captur/i);
		});
	});

	it('introduces Git on Nostr generically, naming no tool or host as the whole space', () => {
		const { container } = renderPage();
		const intro = text(container.querySelector('h1')!.nextElementSibling).trim();
		expect(intro).toBe(
			'Git on Nostr puts the coordination layer of a git repository on Nostr, as NIP-34 (git collaboration) defines it: each maintainer announces the repository, every push republishes its branch and tag tips, and issues, patches and pull requests travel as events. Different tools publish these events and keep the code in different places; this page measures what the events themselves say.'
		);
	});

	it('stops saying the cumulative chart fades pre-capture days once its year no longer reaches them', () => {
		const later: NgitSnapshot = structuredClone(FIXTURE);
		later.as_of_day = '2027-07-15';
		const { container } = renderPage(later);
		const counted = text(container.querySelector('#methodology'));
		expect(counted).toContain('the weekly charts start no earlier than the week of Jun 29, 2026 (the week holding Jul 1, 2026), after all three.');
		expect(counted).not.toContain('fades');
		expect(container.querySelector('#ngit-cumulative [data-note="wall"]')).toBeNull();
	});

	it('offers no "Show as a table" on any pill', async () => {
		await eachPill((pill, container) => {
			expect(text(container), pill).not.toContain('Show as a table');
			// the only collapsibles left are the two method sections, both closed
			const details = [...container.querySelectorAll('details')];
			for (const d of details) expect(d.querySelector('summary')!.textContent, pill).toMatch(/What is counted|Comments left out/);
		});
	});

	it('does not dwell on the archive keeping every version', async () => {
		await eachPill((pill, container) => {
			const t = text(container);
			for (const phrase of ['archived version', 'every version', 'surviving version', 'keeps them all', 'survivors', 'state version']) {
				expect(t, `${pill}: ${phrase}`).not.toContain(phrase);
			}
		});
	});

	it('names no relay in What is counted or the footer, the paragraph that named them gone whole', () => {
		// The operator's choice on 2026-10-09: the source list changes whenever nozzl
		// onboards a relay, so the page names none and nostrology-data's docs/dataset-reference/ngit-dataset-reference.md,
		// section 0 item 1, carries it. The paragraph went with its other sentences, the
		// lower-bound one included: the footer still says every count is a lower bound.
		const { container } = renderPage();
		const counted = text(container.querySelector('#methodology'));
		const footer = text(container.querySelector('#ngit-footer'));
		for (const relay of RELAY_HOSTS) {
			expect(counted, relay).not.toContain(relay);
			expect(footer, relay).not.toContain(relay);
		}
		for (const phrase of ['Every count is a lower bound', 'Everything is read from', 'aggregator', 'holds back an announcement', 'not verified as one']) {
			expect(counted, phrase).not.toContain(phrase);
		}
		expect(footer).toContain('every count is a lower bound');
		expect(footer).not.toContain('The archive holds');
	});

	it("lists no relays in the Collaboration panels, and never calls one relay the git ecosystem's home", async () => {
		// The space is wider than one relay (hashtree, for one), and since 2026-10-09 the page
		// names no source relay anywhere: never beside a figure either.
		const { container } = renderPage();
		for (const pill of PILLS) {
			await fireEvent.click(container.querySelector(`#tab-${pill}`)!);
			const t = text(container);
			expect(t, pill).not.toContain('home relay');
			expect(t, pill).not.toMatch(/ecosystem's/);
		}
		for (const id of ['discussion', 'stars', 'zaps']) {
			const t = text(container.querySelector(`#ngit-${id}`));
			for (const relay of RELAY_HOSTS) {
				expect(t, `${id}: ${relay}`).not.toContain(relay);
			}
			// the caveat is stated once, in the footer
			expect(t, id).not.toContain('lower bound');
		}
	});

});

describe('/git collaboration', () => {
	it('shows leaderboards at five rows and the summary below five', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		// fixture: starred 4, zapped 5
		expect(container.querySelector('#ngit-starred table, #ngit-stars table')).toBeNull();
		expect(container.querySelector('#ngit-stars [data-leaderboard-hidden]')).not.toBeNull();
		expect(container.querySelector('#ngit-zaps table')).not.toBeNull();
		expect(text(container.querySelector('#ngit-zaps table'))).toContain('21,000');
	});

	it('shows no table of repositories named in comments: a count of namings read as discussion volume', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		expect(container.querySelector('#ngit-discussed')).toBeNull();
		const panel = text(container.querySelector('#panel-collaboration'));
		expect(panel).not.toContain('Repositories named in comments');
		expect(panel).not.toContain('Most-discussed');
		expect(panel).not.toContain('Commenters');
	});

	it('draws discussion per week, and its authors and threads each on its own axis, keyed only for the week still filling', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		const card = container.querySelector('#ngit-discussion')!;
		expect(card.querySelector('h2')!.textContent).toBe('Discussion per week');
		const plots = [...card.querySelectorAll('[role="img"]')].map((p) => p.getAttribute('aria-label'));
		expect(plots).toEqual([
			'Counted comments per week by root kind',
			'Comment authors and threads per week, each on its own axis'
		]);
		expect(text(card)).toContain('per week, each on its own axis:');
		// one note per chart, the trailing partial week: no capture key, no partial first week
		const notes = [...card.querySelectorAll('[data-testid="bucket-notes"] li')].map((li) => [
			li.getAttribute('data-note'),
			text(li).trim()
		]);
		expect(notes).toEqual([
			['partial_last', 'partial week: data to Sep 24, 2026'],
			['partial_last', 'partial week: data to Sep 24, 2026']
		]);
	});

	it('gives Servers per list as counts and shares of every list publisher', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-maintainers')!);
		const lists = container.querySelector('#ngit-grasp-lists')!;
		// FIXTURE: 77 users bucketed 20 / 30 / 20 / 7
		expect(text(lists)).toContain("How many servers users' lists name.");
		expect(text(lists)).not.toContain('by how many servers their list names');
		const shares = [...lists.querySelectorAll('[data-share]')].map((e) => text(e).trim());
		expect(shares).toEqual(['26%', '39%', '26%', '9%']);
		expect(lists.querySelectorAll('[data-share]')).toHaveLength(FIXTURE.grasp_lists.length.length);
	});

	it('draws the GRASP lists per week, keyed only for the week still filling', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-maintainers')!);
		const lists = container.querySelector('#ngit-grasp-lists')!;
		expect(text(lists)).toContain('Bars are new users, by the week their list was first seen; the line is the running total.');
		const notes = [...lists.querySelectorAll('[data-testid="bucket-notes"] li')].map((li) => [
			li.getAttribute('data-note'),
			text(li).trim()
		]);
		expect(notes).toEqual([['partial_last', 'partial week: data to Sep 24, 2026']]);
	});

	it('flips each leaderboard across the floor', async () => {
		const snapshot: NgitSnapshot = {
			...FIXTURE,
			repos_starred: [...FIXTURE.repos_starred, { ...FIXTURE.repos_starred[0], d: 'starred-4', stars: 1 }],
			repos_zapped: FIXTURE.repos_zapped.slice(0, 4)
		};
		const { container } = renderPage(snapshot);
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		expect(container.querySelector('#ngit-stars table')).not.toBeNull();
		expect(container.querySelector('#ngit-zaps table')).toBeNull();
	});

	it('keeps Comments left out collapsed behind its own heading', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		const left = container.querySelector('#ngit-comment-ledger')!.closest('details') as HTMLDetailsElement;
		expect(left.open).toBe(false);
		expect(left.querySelector(':scope > summary > h3')!.textContent).toBe('Comments left out');
	});

	it('draws the GRASP list chart as new users and a running total, each with a legend key', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-maintainers')!);
		const keys = [...container.querySelectorAll('#ngit-grasp-lists [data-testid="chart-legend"] button')].map((b) =>
			b.textContent?.trim()
		);
		expect(keys).toEqual(['New users', 'Total']);
		expect(container.querySelector('#ngit-grasp-lists [role="img"]')!.getAttribute('aria-label')).toBe(
			'New users with a GRASP server list per week, and the running total'
		);
	});

	it('sorts the stars and zaps tables by any column, the document ranking first', async () => {
		const starred = [
			{ pubkey: PK_A, d: 's-a', name: 'Charlie', stars: 40 },
			{ pubkey: PK_B, d: 's-b', name: 'alpha', stars: 30 },
			{ pubkey: PK_C, d: 's-c', name: 'Bravo', cls: 'hashtree' as const, stars: 20 },
			{ pubkey: PK_D, d: 's-d', name: 'delta', stars: 10 },
			{ pubkey: PK_E, d: 's-e', name: 'Echo', stars: 5 }
		];
		const zapped = [
			{ pubkey: PK_A, d: 'z-a', name: 'Zulu', msats: 50_000_000, receipts: 1 },
			{ pubkey: PK_B, d: 'z-b', name: 'Yankee', msats: 40_000_000, receipts: 9 },
			{ pubkey: PK_C, d: 'z-c', name: 'X-ray', cls: 'hashtree' as const, msats: 30_000_000, receipts: 5 },
			{ pubkey: PK_D, d: 'z-d', name: 'Whiskey', msats: 20_000_000, receipts: 7 },
			{ pubkey: PK_E, d: 'z-e', name: 'Victor', msats: 10_000_000, receipts: 3 }
		];
		const { container } = renderPage({ ...FIXTURE, repos_starred: starred, repos_zapped: zapped });
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		const names = (id: string) =>
			[...container.querySelectorAll(`#${id} tbody tr`)].map((tr) => text(tr.querySelector('td')).trim());
		const button = (id: string, label: string) =>
			container.querySelector(`#${id} button[aria-label="Sort by ${label}"]`)!;
		const sortOf = (id: string, label: string) => button(id, label).closest('th')!.getAttribute('aria-sort');
		// rows are keyed by index, so a sort re-props each row in place: every link must follow
		// its name, or a reader lands on another repository
		const links = (id: string): [string, string | null][] =>
			[...container.querySelectorAll(`#${id} tbody tr`)].map((tr) => [
				text(tr.querySelector('td')).trim(),
				tr.querySelector('a')!.getAttribute('href')
			]);
		type Row = { pubkey: string; d: string; name: string; cls?: string };
		const byName = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.name, repoUrl(r.pubkey, r.d, r.cls)]));
		const linksRight = (id: string, rows: Row[]) => {
			const want = byName(rows);
			for (const [name, href] of links(id)) expect(href, `${id} ${name}`).toBe(want[name]);
		};
		// the hashtree rows open on git.iris.to, before any sort and after
		expect(links('ngit-stars')[2]).toEqual(['Bravo', irisGitUrl(PK_C, 's-c')]);
		expect(links('ngit-zaps')[2]).toEqual(['X-ray', irisGitUrl(PK_C, 'z-c')]);
		// stars: the document's ranking by stars, marked on the Stars column
		expect(names('ngit-stars')).toEqual(['Charlie', 'alpha', 'Bravo', 'delta', 'Echo']);
		expect([sortOf('ngit-stars', 'Stars'), sortOf('ngit-stars', 'Repository')]).toEqual(['descending', 'none']);
		await fireEvent.click(button('ngit-stars', 'Repository'));
		expect(names('ngit-stars')).toEqual(['alpha', 'Bravo', 'Charlie', 'delta', 'Echo']); // text: ascending, any case
		linksRight('ngit-stars', starred);
		await fireEvent.click(button('ngit-stars', 'Repository'));
		expect(names('ngit-stars')).toEqual(['Echo', 'delta', 'Charlie', 'Bravo', 'alpha']);
		linksRight('ngit-stars', starred);
		await fireEvent.click(button('ngit-stars', 'Stars'));
		expect(names('ngit-stars')).toEqual(['Charlie', 'alpha', 'Bravo', 'delta', 'Echo']);
		// zaps: by receipts since 2026-10-18 (the operator's ask), over a document ranked by
		// sats, as every one was until that day's second nostrology-data deploy; sats and names
		// sort too
		expect(names('ngit-zaps')).toEqual(['Yankee', 'Whiskey', 'X-ray', 'Victor', 'Zulu']);
		expect([sortOf('ngit-zaps', 'Receipts'), sortOf('ngit-zaps', 'Sats')]).toEqual(['descending', 'none']);
		linksRight('ngit-zaps', zapped);
		await fireEvent.click(button('ngit-zaps', 'Sats'));
		expect(names('ngit-zaps')).toEqual(['Zulu', 'Yankee', 'X-ray', 'Whiskey', 'Victor']);
		linksRight('ngit-zaps', zapped);
		expect([sortOf('ngit-zaps', 'Receipts'), sortOf('ngit-zaps', 'Sats')]).toEqual(['none', 'descending']);
		await fireEvent.click(button('ngit-zaps', 'Receipts'));
		expect(names('ngit-zaps')).toEqual(['Yankee', 'Whiskey', 'X-ray', 'Victor', 'Zulu']);
		await fireEvent.click(button('ngit-zaps', 'Receipts')); // the active column flips
		expect(names('ngit-zaps')).toEqual(['Zulu', 'Victor', 'X-ray', 'Whiskey', 'Yankee']);
		expect(sortOf('ngit-zaps', 'Receipts')).toBe('ascending');
		linksRight('ngit-zaps', zapped);
		await fireEvent.click(button('ngit-zaps', 'Repository'));
		expect(names('ngit-zaps')).toEqual(['Victor', 'Whiskey', 'X-ray', 'Yankee', 'Zulu']);
		linksRight('ngit-zaps', zapped);
		expect(links('ngit-zaps')[0][1]).toBe(gitworkshopUrl(PK_E, 'z-e'));
		// the sats cells follow their rows
		expect(text(container.querySelector('#ngit-zaps tbody tr'))).toContain('10,000');
		// each cut is stated by its own length (the population, 120 and 12, is not named since
		// 2026-10-18, nor a measure, which a re-sort would contradict), and what a sort does to it
		expect(text(container.querySelector('#ngit-stars'))).toContain('The top 5 repositories. Sorting reorders these 5 only.');
		expect(text(container.querySelector('#ngit-zaps'))).toContain('The top 5 repositories. Sorting reorders these 5 only.');
	});

	it('shows Receipts before Sats in the zaps table, ranked by receipts', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		const table = container.querySelector('#ngit-zaps table')!;
		expect([...table.querySelectorAll('thead button')].map((b) => b.getAttribute('aria-label'))).toEqual([
			'Sort by Repository',
			'Sort by Receipts',
			'Sort by Sats'
		]);
		expect([...table.querySelectorAll('thead th')].map((th) => th.getAttribute('aria-sort'))).toEqual([
			'none',
			'descending',
			'none'
		]);
		// the cells follow their headers: 10 receipts, then 21,000 sats
		const first = [...table.querySelectorAll('tbody tr:first-child td')].map((td) => text(td).trim());
		expect(first).toEqual(['Zapped 0', '10', '21,000']);
	});

	it('opens Zaps by receipts whatever the document ranks by, its order kept among equal counts', async () => {
		// The operator's ask of 2026-10-18. This document ranks by sats, as every one did until
		// that day's second nostrology-data deploy: the table still opens by receipts. Among
		// equal counts the document's order stands (sortRows is stable): by sats in every real
		// document, whichever figure it ranks by first, then by the repository key, which the
		// pair with equal receipts AND sats stands for here. Each tie's names are out of
		// alphabetical order, so a tie broken by name shows. The bright ink is on Receipts, the
		// column sorted at that moment.
		const zapped = [
			{ pubkey: PK_A, d: 'z-a', name: 'Charlie', msats: 9_000_000, receipts: 1 },
			{ pubkey: PK_B, d: 'z-b', name: 'Delta', msats: 8_000_000, receipts: 3 },
			{ pubkey: PK_C, d: 'z-c', name: 'Alpha', msats: 7_000_000, receipts: 1 },
			{ pubkey: PK_D, d: 'z-d', name: 'Bravo', msats: 6_000_000, receipts: 3 },
			{ pubkey: PK_E, d: 'z-e', name: 'Golf', msats: 5_000_000, receipts: 2 },
			{ pubkey: PK_A, d: 'z-f', name: 'Foxtrot', msats: 5_000_000, receipts: 2 }
		];
		const snapshot: NgitSnapshot = { ...FIXTURE, repos_zapped: zapped };
		const { container } = renderPage(snapshot);
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		const rows = [...container.querySelectorAll('#ngit-zaps tbody tr')];
		const cells = rows.map((tr) => [...tr.querySelectorAll('td')].map((td) => text(td).trim()));
		expect(cells).toEqual([
			['Delta', '3', '8,000'],
			['Bravo', '3', '6,000'],
			['Golf', '2', '5,000'],
			['Foxtrot', '2', '5,000'],
			['Charlie', '1', '9,000'],
			['Alpha', '1', '7,000']
		]);
		for (const tr of rows) {
			const [, receipts, sats] = tr.querySelectorAll('td');
			expect([receipts.classList.contains('text-gray-200'), sats.classList.contains('text-gray-400')]).toEqual([true, true]);
		}
		expect(text(container.querySelector('#ngit-zaps table')!.previousElementSibling).trim()).toBe(
			'The top 6 repositories. Sorting reorders these 6 only.'
		);
		expect(panelProblems(container, 'collaboration', snapshot)).toEqual([]);
	});

	it('brightens the column sorted at that moment in every sortable table, and only that one', async () => {
		// The operator's rule of 2026-10-18: the emphasis follows the reader's sort, so a
		// re-sorted screenshot reads true. Each table opens bright in the column it is ranked
		// by; a click on any other column moves the ink there alone, and a click on the name
		// column (first, which keeps its own ink) leaves every other column dim.
		const snapshot: NgitSnapshot = {
			...FIXTURE,
			repos_starred: [...FIXTURE.repos_starred, { ...FIXTURE.repos_starred[0], d: 'starred-4', name: 'Starred 4' }]
		};
		const { container } = renderPage(snapshot);
		const cases: [pill: string, id: string, opens: string][] = [
			['repositories', 'ngit-repos-active', 'Pushes 90 d'],
			['hosting', 'ngit-grasp-servers', 'Repositories'],
			['maintainers', 'ngit-maintainers', 'Pushes 90 d'],
			['collaboration', 'ngit-stars', 'Stars'],
			['collaboration', 'ngit-zaps', 'Receipts']
		];
		for (const [pill, id, opens] of cases) {
			await fireEvent.click(container.querySelector(`#tab-${pill}`)!);
			const el = container.querySelector(`#${id}`)!;
			const labels = [...el.querySelectorAll('thead button')].map((b) => b.getAttribute('aria-label')!.replace(/^Sort by /, ''));
			// the columns whose every cell is bright, the name column aside (rows re-read: a
			// sort re-props them in place)
			const bright = () => {
				const rows = [...el.querySelectorAll('tbody tr')];
				return labels.filter((_, j) => j > 0 && rows.length > 1 && rows.every((tr) => tr.children[j].classList.contains('text-gray-200')));
			};
			const click = (label: string) => fireEvent.click(el.querySelector(`button[aria-label="Sort by ${label}"]`)!);
			expect(el.querySelectorAll('tbody tr').length, id).toBeGreaterThan(1);
			expect(bright(), `${id} opens`).toEqual([opens]);
			expect(sortInkProblems(el, id)).toEqual([]);
			for (const other of labels.slice(1)) {
				await click(other);
				expect(bright(), `${id} sorted by ${other}`).toEqual([other]);
				expect(sortInkProblems(el, id)).toEqual([]);
			}
			await click(labels[0]);
			expect(bright(), `${id} by name`).toEqual([]);
			expect(sortInkProblems(el, id)).toEqual([]);
		}
		// and the check sees a column left bright after its sort moved on, a sorted column left
		// dim, and a cell carrying both inks (after the loop above: sorted by Repository, then
		// re-sorted by Receipts here)
		const zaps = container.querySelector('#ngit-zaps')!;
		await fireEvent.click(zaps.querySelector('button[aria-label="Sort by Receipts"]')!);
		expect(sortInkProblems(zaps, 'ngit-zaps')).toEqual([]);
		const cell = (row: number, col: number) => zaps.querySelector(`tbody tr:nth-child(${row}) td:nth-child(${col})`)!;
		cell(1, 3).classList.replace('text-gray-400', 'text-gray-200');
		cell(2, 2).classList.replace('text-gray-200', 'text-gray-400');
		cell(3, 2).classList.add('text-gray-400');
		expect(sortInkProblems(zaps, 'ngit-zaps')).toEqual([
			'#ngit-zaps Receipts is sorted but not bright in 2 of 5 rows',
			'#ngit-zaps Sats is not sorted but not dim in 1 of 5 rows'
		]);
	});

	it('repeats the sorted column under each maintainer on a phone, and follows a re-sort', async () => {
		// The line under the name is the only figure in view below 640 px (the table scrolls);
		// it follows the reader's sort, as the bright ink does, and is gone for a sort by name.
		// Dan has one repository and one push here, so each count is read in the singular too.
		// A new column sorts descending, so every click leaves the rows in a known order.
		const [b, a] = FIXTURE.maintainers_top;
		const { container } = renderPage({ ...FIXTURE, maintainers_top: [b, { ...a, repos: 1, pushes_90d: 1 }] });
		await fireEvent.click(container.querySelector('#tab-maintainers')!);
		const el = container.querySelector('#ngit-maintainers')!;
		const lines = () => [...el.querySelectorAll('tbody td:first-child [class~="sm:hidden"]')].map((e) => text(e).trim());
		const click = (label: string) => fireEvent.click(el.querySelector(`button[aria-label="Sort by ${label}"]`)!);
		expect(lines()).toEqual(['661 pushes in 90 d', '1 push in 90 d']);
		await click('Repositories');
		expect(lines()).toEqual(['12 repositories', '1 repository']);
		await click('Last push');
		expect(lines()).toEqual(['last push 2026-09-24', 'last push 2026-09-20']);
		await click('Pushes 90 d');
		expect(lines()).toEqual(['661 pushes in 90 d', '1 push in 90 d']);
		await click('Maintainer');
		expect(lines()).toEqual([]);
	});

	it('marks the Stars and Zaps cards with the path their lists came by, for a live check to read', async () => {
		// the server takes them from ngit_repo_stats when it holds the document's run (since
		// 2026-10-18), else keeps the document's own; a caller passing a document alone gets
		// the document's
		for (const listsFrom of ['table', 'document', undefined] as const) {
			const { container, unmount } = render(NgitPage, { props: { data: { snapshot: FIXTURE, listsFrom } } });
			await fireEvent.click(container.querySelector('#tab-collaboration')!);
			for (const id of ['ngit-stars', 'ngit-zaps']) {
				expect(container.querySelector(`#${id}`)?.getAttribute('data-lists'), `${id} ${listsFrom}`).toBe(listsFrom ?? 'document');
			}
			unmount();
			window.history.replaceState(null, '', '/');
		}
	});

	it('says which zap receipts count: signed by a verified provider key, paying a maintainer, amounts matching', async () => {
		// dataset reference 6.3, since 2026-09-26: a receipt under an unlisted key never counts
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		const card = container.querySelector('#ngit-zaps')!;
		const zaps = text(card);
		// the whole intro, so a caveat cannot come back in other words: since 2026-10-08 (the
		// operator's choice) it no longer adds that a counted receipt is plausible, not proof of
		// payment - What is counted on Overview still says so
		// the first paragraph after the heading (the link icon sits between them, SectionLink)
		expect(text(card.querySelector('h2 ~ p'))).toBe(
			"kind-9735 (zap-receipts) naming a repository. A receipt counts only when it is signed by a verified LNURL provider key, pays a maintainer of the repository, and its zap request's amount, where the request states one, equals the invoice amount."
		);
		// heading (with the link icon and its live region), intro, figures, cut, table: no
		// paragraph of its own for a caveat either
		expect([...card.children].map((e) => e.tagName)).toEqual(['H2', 'A', 'SPAN', 'P', 'P', 'P', 'TABLE']);
		expect(zaps).not.toMatch(/plausible|proof/);
		expect(zaps).not.toContain('signer list');
		expect(zaps).not.toContain('missed until it is added');
		expect(zaps).not.toContain('a fabricated receipt counts');
		expect(zaps).toContain('The top 5 repositories.');
	});

	it('gives the stars no total, in its heading or its cut, and no sentence on keys or Sybils', async () => {
		const { container } = renderPage({
			...FIXTURE,
			repos_starred: [...FIXTURE.repos_starred, { ...FIXTURE.repos_starred[0], d: 'starred-4', stars: 1 }]
		});
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		const card = container.querySelector('#ngit-stars')!;
		const stars = text(card);
		expect(text(card.querySelector('h2'))).toBe('Stars');
		// both clients' stars since 2026-10-11 (dataset reference 6.2): the whole definition, its
		// last sentence in the operator's words (2026-10-11). The page does read deletion requests,
		// for repository withdrawals (Sources), so "for reactions" is load-bearing
		expect(text(card.querySelector('h2 + p')).trim()).toBe(
			'A star is a kind-7 (reactions) with "+" or empty content on a repository announcement, or ' +
				"Iris Git's kind-17 (external-content-reactions) on a repository announcement when that key's " +
				'latest one on it is "+" or empty. Each key counts once per repository. An Iris Git star is ' +
				'net of unstars (a later "-"); a kind-7 (reactions) star is not, as its unstars are deletion ' +
				'requests, which this page does not currently read for reactions.'
		);
		expect(stars).not.toContain('stars_iris');
		expect(stars).toContain('The top 5 repositories.');
		// the operator dropped "250 stars on 120 repositories - one per key, not Sybil-resistant:
		// fifty fresh keys make fifty stars." (2026-10-08), and What is counted on Overview its own
		// Sybil caveat the same evening; the totals then moved to the heading and the cut, and
		// since 2026-10-18 (the operator's ask) the card states neither. Heading, definition,
		// cut, table and nothing else, so no total can come back in other words either
		expect([...card.children].map((e) => e.tagName)).toEqual(['H2', 'P', 'P', 'TABLE']);
		expect(stars).not.toMatch(/Sybil|fresh keys|stars on 120/);
		expect(stars).not.toMatch(/\b(250|120)\b/);
	});

	// One render per test: two renders in one test give the document duplicate ids, and
	// jsdom answers `#id` selectors through getElementById - the FIRST render's element.
	it('says when nothing was read, instead of printing a zero', async () => {
		const { container } = renderPage({
			...FIXTURE,
			summary: {
				...FIXTURE.summary,
				archive_events: { ...FIXTURE.summary.archive_events, reactions: 0, external_reactions: 0, zaps: 0 },
				stars_total: 0,
				stars_repos: 0,
				stars_iris: 0,
				zap_receipts: 0,
				zap_msats: 0,
				zappers: 0,
				zaps_repos: 0
			},
			repos_starred: [],
			repos_zapped: []
		});
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		const stars = text(container.querySelector('#ngit-stars'));
		expect(stars).toContain(
			'No kind-7 (reactions) or kind-17 (external-content-reactions) were read in this run - an empty input, not a measured zero.'
		);
		const zaps = text(container.querySelector('#ngit-zaps'));
		expect(zaps).toContain('No kind-9735 (zap-receipts) were read in this run - an empty input, not a measured zero.');
		expect(zaps).not.toContain('0 sats');
		// the headings are the same either way
		expect(text(container.querySelector('#ngit-stars h2'))).toBe('Stars');
		expect(text(container.querySelector('#ngit-zaps h2'))).toBe('Zaps \u26a1');
	});

	it('says only kind-7 (reactions) was not read for a document from before Iris Git stars were counted', async () => {
		const { stars_iris: _iris, ...summary } = FIXTURE.summary;
		const { external_reactions: _ext, ...archive } = FIXTURE.summary.archive_events;
		const { container } = renderPage({
			...FIXTURE,
			summary: { ...summary, archive_events: { ...archive, reactions: 0 }, stars_total: 0, stars_repos: 0 },
			repos_starred: []
		});
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		const stars = text(container.querySelector('#ngit-stars'));
		expect(stars).toContain('No kind-7 (reactions) were read in this run - an empty input, not a measured zero.');
		expect(stars).not.toContain('kind-17 (external-content-reactions)');
	});

	it('takes the stars as read when only Iris Git stars were read', async () => {
		// kind-7 (reactions) empty, kind-17 (external-content-reactions) read: the stars are
		// ranked (here too few to rank), with no empty-input note
		const { container } = renderPage({
			...FIXTURE,
			summary: {
				...FIXTURE.summary,
				archive_events: { ...FIXTURE.summary.archive_events, reactions: 0 },
				stars_total: 14,
				stars_iris: 14
			}
		});
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		const card = container.querySelector('#ngit-stars')!;
		expect(card.querySelector('[data-empty-input]')).toBeNull();
		expect(text(card)).toContain('Too few starred repositories to rank (4).');
	});

	it('shows a measured zero as a zero when the input was read', async () => {
		// reactions were read and none counts: that IS a zero
		const { container } = renderPage({
			...FIXTURE,
			summary: { ...FIXTURE.summary, stars_total: 0, stars_repos: 0 },
			repos_starred: []
		});
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		// in words since the heading went bare (2026-10-18)
		const stars = text(container.querySelector('#ngit-stars'));
		expect(stars).toContain('No repository has a counted star in this snapshot.');
		expect(container.querySelector('#ngit-stars [data-empty-input]')).toBeNull();
	});

	it('says so plainly when a leaderboard is empty rather than "too few"', async () => {
		const snapshot: NgitSnapshot = { ...FIXTURE, repos_starred: [], repos_zapped: [] };
		const { container } = renderPage(snapshot);
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		expect(text(container.querySelector('#ngit-stars'))).toContain('No repository has a counted star in this snapshot.');
		expect(text(container.querySelector('#ngit-zaps'))).toContain('No repository has a counted zap in this snapshot.');
	});

	it('says "too few" with the count for a short, non-empty leaderboard', async () => {
		const { container } = renderPage(); // the fixture ships four starred repositories
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		const card = container.querySelector('#ngit-stars')!;
		expect(text(card)).toContain('Too few starred repositories to rank (4).');
		// heading, definition, the note: no sentence of figures or caveats on this path either
		expect([...card.children].map((e) => e.tagName)).toEqual(['H2', 'P', 'P']);
		expect(text(card)).not.toMatch(/Sybil|fresh keys|stars on/);
	});

	it('lists the top 20 starred and zapped repositories, with no total in either heading or cut', async () => {
		// The operator's ask of 2026-10-18, on that day's live figures: 510 stars on 225
		// repositories, so 20 of them and a sort note; 31 receipts (19,951 sats) to 20
		// repositories from 17 zappers, so all of them and no note. The headings had read
		// "Stars: 510" and "Zaps: 19,951 sats", the cuts "The top 10 of 225 repositories by
		// stars" and "The top 10 of 20 repositories by sats".
		const PKS = [PK_A, PK_B, PK_C, PK_D, PK_E];
		const repo = (i: number) => ({ pubkey: PKS[i % 5], d: `repo-${i}`, name: `Repo ${i}`, cls: 'grasp_only' as const });
		const snapshot: NgitSnapshot = {
			...FIXTURE,
			summary: {
				...FIXTURE.summary,
				stars_total: 510,
				stars_repos: 225,
				zap_receipts: 31,
				zap_msats: 19_951_000,
				zappers: 17,
				zaps_repos: 20
			},
			repos_starred: Array.from({ length: 20 }, (_, i) => ({ ...repo(i), stars: 40 - i })),
			repos_zapped: Array.from({ length: 20 }, (_, i) => ({ ...repo(i), receipts: 2, msats: (3_000 - i * 100) * 1000 }))
		};
		const { container } = renderPage(snapshot);
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		const stars = container.querySelector<HTMLElement>('#ngit-stars')!;
		const zaps = container.querySelector<HTMLElement>('#ngit-zaps')!;
		// bare headings, and the Zaps bolt drawn but out of the heading's name
		expect(text(stars.querySelector('h2'))).toBe('Stars');
		expect(text(zaps.querySelector('h2'))).toBe('Zaps \u26a1');
		expect(zaps.querySelector('h2 > span[aria-hidden="true"]')?.textContent).toBe('\u26a1');
		expect(within(zaps).getByRole('heading', { level: 2, name: 'Zaps' })).toBe(zaps.querySelector('h2'));
		// twenty rows each
		expect(stars.querySelectorAll('tbody tr')).toHaveLength(20);
		expect(zaps.querySelectorAll('tbody tr')).toHaveLength(20);
		// each cut names only its own length; the population still decides the sort note
		expect(text(stars.querySelector('table')!.previousElementSibling).trim()).toBe(
			'The top 20 repositories. Sorting reorders these 20 only.'
		);
		expect(text(zaps.querySelector('table')!.previousElementSibling).trim()).toBe('The top 20 repositories.');
		// the receipts sentence stays: the Zaps card's one line of figures
		expect(text(zaps)).toContain('31 receipts to 20 repositories from 17 zappers.');
		// and no other figure comes back: the receipts sentence is the Zaps card's one line of them
		expect([...stars.children].map((e) => e.tagName)).toEqual(['H2', 'P', 'P', 'TABLE']);
		expect([...zaps.children].map((e) => e.tagName)).toEqual(['H2', 'A', 'SPAN', 'P', 'P', 'P', 'TABLE']);
		expect(text(stars)).not.toMatch(/\b(510|225)\b/);
		expect(text(zaps)).not.toContain('19,951');
		expect(panelProblems(container, 'collaboration', snapshot)).toEqual([]);
	});

	it('breaks Stars and Zaps names anywhere, as their tables have no horizontal scroll', async () => {
		// jsdom applies no CSS, so this is the class contract. With break-words a name with no
		// break in it set the cell's min-content width: 80 characters widened a 300 px table to
		// 613 px in Chrome (2026-10-18), past a phone's card. The most active repositories keep
		// break-words: their table scrolls.
		const zapped = [...FIXTURE.repos_zapped];
		const starred = zapped.map(({ receipts: _r, msats: _m, ...r }, i) => ({ ...r, stars: 9 - i }));
		const { container } = renderPage({ ...FIXTURE, repos_starred: starred, repos_zapped: zapped });
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		for (const id of ['ngit-stars', 'ngit-zaps']) {
			const names = [...container.querySelectorAll(`#${id} tbody td:first-child a`)];
			expect(names, id).toHaveLength(5);
			for (const a of names) {
				expect(a.classList.contains('[overflow-wrap:anywhere]'), id).toBe(true);
				expect(a.classList.contains('break-words'), id).toBe(false);
			}
		}
		await fireEvent.click(container.querySelector('#tab-repositories')!);
		const active = [...container.querySelectorAll('#ngit-repos-active tbody a')].filter((a) => a.closest('td'));
		expect(active.length).toBeGreaterThan(0);
		expect(active[0].classList.contains('break-words')).toBe(true);
	});

	it('says issue and PR roots are not archived, with the attributable share and the comment ledger', async () => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		const discussion = text(container.querySelector('#ngit-discussion'));
		expect(discussion).toContain('kind-1621 (git-issues)');
		expect(discussion).toContain('are not archived yet');
		expect(discussion).toContain('13.0% of them do');
		// totals are all-time, the weeks start after the wall
		expect(discussion).toContain(
			'333 authors have commented in 1,502 threads in all, including what relays still served from before observation began on Jun 18, 2026'
		);
		expect(discussion).not.toContain('threads since');
		// two legends in the panel: the stacked root kinds, then the authors / threads lines
		const legends = [...container.querySelectorAll('#ngit-discussion [data-testid="chart-legend"]')].map((l) =>
			[...l.querySelectorAll('button')].map((b) => b.textContent?.trim())
		);
		expect(legends).toEqual([
			['Issues', 'Pull requests', 'Patches', 'Repository', 'Other'],
			['Authors', 'Threads']
		]);
		const ledger = text(container.querySelector('#ngit-comment-ledger'));
		for (const k of ['Ephemeral comments', 'Imported comments', 'Mirrored comments']) expect(ledger).toContain(k);
		expect(ledger).toContain(`${FIXTURE.summary.comments_total.toLocaleString('en-US')} comments counted`);
	});
});

describe('/git every panel', () => {
	it.each(Object.keys(PILL_SECTIONS))('%s: every section is present and shows the document', async (pill) => {
		const { container } = renderPage();
		await fireEvent.click(container.querySelector(`#tab-${pill}`)!);
		expect(panelProblems(container, pill, FIXTURE)).toEqual([]);
	});

	// Documents written before the first run after the 2026-10-08 deploy (no count by kind of
	// host) and before 2026-10-02 (no weekly series): each chart section holds its "not in this
	// snapshot" note instead.
	const withoutByHost = (): NgitSnapshot => {
		const doc: NgitSnapshot = structuredClone(FIXTURE);
		for (const r of doc.new_repos_weekly!) delete r.by_host;
		return doc;
	};
	const withoutWeekly = (): NgitSnapshot => {
		const doc: NgitSnapshot = structuredClone(FIXTURE);
		delete doc.new_repos_weekly;
		delete doc.comments_weekly;
		delete doc.grasp_lists.per_week;
		return doc;
	};
	it.each([
		['without by_host', withoutByHost],
		['without the weekly series', withoutWeekly]
	])('every section is present and shows a document %s', async (_name, make) => {
		const doc = make();
		const { container } = renderPage(doc);
		for (const pill of Object.keys(PILL_SECTIONS)) {
			await fireEvent.click(container.querySelector(`#tab-${pill}`)!);
			expect(panelProblems(container, pill, doc), pill).toEqual([]);
		}
	});

	it('catches a chart that is missing, or drawn where the document cannot draw it', async () => {
		// the page on a document without the count, held to one with it: the chart is missing
		const { container, unmount } = renderPage(withoutByHost());
		expect(panelProblems(container, 'overview', FIXTURE)).toContain('#ngit-new-repos has no chart');
		unmount();
		window.history.replaceState(null, '', '/');
		// and the page with it, held to one without: the note is missing, and a chart is drawn
		// that the document could not draw
		const second = renderPage();
		const problems = panelProblems(second.container, 'overview', withoutByHost());
		expect(problems).toContain('#ngit-new-repos does not show "Not in this snapshot"');
		expect(problems).toContain('#ngit-new-repos has a chart the document cannot draw');
		second.unmount();
	});

	// A document is third-party-shaped data: an empty series, a row without kinds or a repeated
	// kind must not take the page down (Svelte 5 throws on a duplicate each-key in production).
	it.each([
		['an empty weekly series', (d: NgitSnapshot) => (d.new_repos_weekly = [])],
		['no kinds in the first row', (d: NgitSnapshot) => (d.new_repos_weekly![0].by_host = [])],
		[
			'a repeated kind',
			(d: NgitSnapshot) => {
				for (const r of d.new_repos_weekly!) r.by_host = [...r.by_host!, { k: 'grasp', v: 1 }];
			}
		]
	])('survives %s', (name, mutate) => {
		const doc: NgitSnapshot = structuredClone(FIXTURE);
		mutate(doc);
		const { container, unmount } = renderPage(doc);
		const card = container.querySelector('#ngit-new-repos')!;
		if (name === 'a repeated kind') {
			// each kind named once, the first entry read
			const legend = [...card.querySelectorAll('[data-testid="chart-legend"] button')].map((b) => b.textContent?.trim());
			expect(legend).toEqual(['GRASP', 'hashtree', 'Self-hosted', 'Forges', 'No public host', 'First-time maintainers']);
		} else {
			expect(card.querySelector('canvas'), name).toBeNull();
			expect(text(card.querySelector('[data-not-in-snapshot]')), name).toContain('Not in this snapshot');
		}
		unmount();
	});

	it('catches a repository row that opens the wrong viewer, or a row too many (the link check is not vacuous)', async () => {
		// five starred rows, so the stars table is drawn and checked too; its third and the
		// second zapped one are hashtree's
		const classed: NgitSnapshot = {
			...FIXTURE,
			repos_starred: [...FIXTURE.repos_starred, { ...FIXTURE.repos_starred[0], d: 'starred-4', name: 'Starred 4' }]
		};
		const unclassed: NgitSnapshot = structuredClone(classed);
		for (const r of [...unclassed.repos_starred, ...unclassed.repos_zapped]) delete r.cls;
		const wrong = (a: string | null, b: string | null) => `links ${a}, not ${b}`;
		const [starIris, starWorkshop] = [irisGitUrl(PK_C, 'starred-2'), gitworkshopUrl(PK_C, 'starred-2')];
		const [zapIris, zapWorkshop] = [irisGitUrl(PK_B, 'zapped-1'), gitworkshopUrl(PK_B, 'zapped-1')];
		// the page drew the document without classes, held to the one with them
		const first = renderPage(unclassed);
		await fireEvent.click(first.container.querySelector('#tab-collaboration')!);
		expect(panelProblems(first.container, 'collaboration', classed)).toEqual([
			`#ngit-stars row 3 ${wrong(starWorkshop, starIris)}`,
			`#ngit-zaps row 2 ${wrong(zapWorkshop, zapIris)}`
		]);
		first.unmount();
		window.history.replaceState(null, '', '/');
		// the other way round, and a document with one zapped row more than the table shows
		const second = renderPage(classed);
		await fireEvent.click(second.container.querySelector('#tab-collaboration')!);
		expect(panelProblems(second.container, 'collaboration', unclassed)).toEqual([
			`#ngit-stars row 3 ${wrong(starIris, starWorkshop)}`,
			`#ngit-zaps row 2 ${wrong(zapIris, zapWorkshop)}`
		]);
		const longer: NgitSnapshot = {
			...classed,
			repos_zapped: [...classed.repos_zapped, { ...classed.repos_zapped[0], d: 'zapped-5', name: 'Zapped 0', receipts: 1 }]
		};
		// (since 2026-10-18 the cut is held to the document's length too; the extra row has the
		// fewest receipts, so the table opens on it last)
		expect(panelProblems(second.container, 'collaboration', longer)).toEqual([
			'#ngit-zaps caption is "The top 5 repositories. Sorting reorders these 5 only.", not "The top 6 repositories. Sorting reorders these 6 only."',
			'#ngit-zaps shows 5 rows, the document has 6'
		]);
		second.unmount();
		window.history.replaceState(null, '', '/');
		// and the most active repositories, drawn with a hashtree row, held to a forge one
		const active = { ...ACTIVE_UNNAMED, cls: 'hashtree' as const };
		const third = renderPage({ ...FIXTURE, repos_active: [ACTIVE_NAMED, active] });
		await fireEvent.click(third.container.querySelector('#tab-repositories')!);
		expect(panelProblems(third.container, 'repositories', FIXTURE)).toEqual([
			`#ngit-repos-active row 2 ${wrong(irisGitUrl(PK_B, ACTIVE_UNNAMED.d), gitworkshopUrl(PK_B, ACTIVE_UNNAMED.d))}`
		]);
		third.unmount();
	});

	it('catches a key of the kinds of host in another order or another colour (the key checks are not vacuous)', async () => {
		const keyText = (items: [string, string][]) => items.map(([words, hex]) => `${words} ${rgb(hex)}`).join(' | ');
		const { container } = renderPage();
		expect(panelProblems(container, 'overview', FIXTURE)).toEqual([]);
		// New repositories per week: Forges back before Self-hosted, the order until 2026-10-12
		const weekly = container.querySelector('#ngit-new-repos [data-testid="chart-legend"]')!;
		const want = keyText([
			['GRASP', GRASP_COLOR],
			['hashtree', PINK],
			['Self-hosted', GREEN],
			['Forges', AMBER],
			['No public host', OTHERS_COLOR],
			['First-time maintainers', NEUTRAL_SERIES]
		]);
		weekly.insertBefore(weekly.children[3], weekly.children[2]);
		const swapped = keyText([
			['GRASP', GRASP_COLOR],
			['hashtree', PINK],
			['Forges', AMBER],
			['Self-hosted', GREEN],
			['No public host', OTHERS_COLOR],
			['First-time maintainers', NEUTRAL_SERIES]
		]);
		expect(panelProblems(container, 'overview', FIXTURE)).toEqual([`#ngit-new-repos key is ${swapped}, not ${want}`]);
		// back in order, but a forge in the Forges only blue of before 2026-10-12
		weekly.insertBefore(weekly.children[3], weekly.children[2]);
		expect(panelProblems(container, 'overview', FIXTURE)).toEqual([]);
		weekly.children[3].querySelector<HTMLElement>('[data-swatch]')!.style.backgroundColor = BLUE;
		expect(panelProblems(container, 'overview', FIXTURE)).toEqual([
			`#ngit-new-repos key is ${want.replace(`Forges ${rgb(AMBER)}`, `Forges ${rgb(BLUE)}`)}, not ${want}`
		]);
		// Clone hosts: its key in the order of before, then a forge's bar in the blue
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		expect(panelProblems(container, 'hosting', FIXTURE)).toEqual([]);
		const card = container.querySelector('#ngit-clone-hosts')!;
		const key = card.querySelector('[data-testid="chart-legend"]')!;
		key.insertBefore(key.children[2], key.children[1]);
		expect(panelProblems(container, 'hosting', FIXTURE)).toEqual([
			`#ngit-clone-hosts key is ${keyText([
				['GRASP', GRASP_COLOR],
				['Forge', AMBER],
				['Self-hosted', GREEN]
			])}, not ${keyText([
				['GRASP', GRASP_COLOR],
				['Self-hosted', GREEN],
				['Forge', AMBER]
			])}`
		]);
		key.insertBefore(key.children[2], key.children[1]);
		expect(panelProblems(container, 'hosting', FIXTURE)).toEqual([]);
		expect(FIXTURE.clone_hosts[0].cls).toBe('forge');
		card.querySelector<HTMLElement>('[data-bar]')!.style.backgroundColor = BLUE;
		expect(panelProblems(container, 'hosting', FIXTURE)).toEqual([
			`#ngit-clone-hosts row 1 (forge) shows Forge / ${rgb(BLUE)} / true / ${FIXTURE.clone_hosts[0].host} / ${FIXTURE.clone_hosts[0].host}, not Forge / ${rgb(AMBER)} / true / ${FIXTURE.clone_hosts[0].host} / ${FIXTURE.clone_hosts[0].host}`
		]);
	});

	it('catches a panel that loses its data (the check is not vacuous)', async () => {
		const broken: NgitSnapshot = { ...FIXTURE, topics: [{ t: 'nostr', repos: 900 }] };
		const { container } = renderPage(broken);
		await fireEvent.click(container.querySelector('#tab-repositories')!);
		// the page shows 'nostr'; hold it to a document that says 'bitcoin' comes first
		const expectedElsewhere: NgitSnapshot = { ...FIXTURE, topics: [{ t: 'bitcoin', repos: 7 }] };
		expect(panelProblems(container, 'repositories', expectedElsewhere)).toEqual([
			'#ngit-topics does not show "bitcoin"',
			'#ngit-topics does not show "7"'
		]);
	});

	it('holds the Stars and Zaps headings and cuts exactly (the checks are not vacuous)', async () => {
		// since 2026-10-18: bare headings, the Zaps bolt out of the heading's name, and a cut
		// with no population, its sort note only beside a table that is not the whole population.
		// A repository NAMED like an old heading is third-party text: it neither fails nor passes.
		const named: NgitSnapshot = {
			...FIXTURE,
			repos_starred: [...FIXTURE.repos_starred, { ...FIXTURE.repos_starred[0], d: 'starred-4', name: 'Stars: 510' }]
		};
		const { container } = renderPage(named); // 5 starred of 120, 5 zapped of 12
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		expect(panelProblems(container, 'collaboration', named)).toEqual([]);
		// held to a document whose 5 zapped repositories are all of them, the note is one too many
		const whole: NgitSnapshot = { ...named, summary: { ...named.summary, zaps_repos: 5 } };
		expect(panelProblems(container, 'collaboration', whole)).toEqual([
			'#ngit-zaps does not show "56 receipts to 5 repositories from 30 zappers."',
			'#ngit-zaps caption is "The top 5 repositories. Sorting reorders these 5 only.", not "The top 5 repositories."'
		]);
		// a heading that carries its total again, in any words, and a bolt read out as part of
		// the heading's name
		const stars = container.querySelector('#ngit-stars h2')!;
		const zaps = container.querySelector('#ngit-zaps h2')!;
		stars.textContent = 'Stars (250)';
		zaps.innerHTML = 'Zaps <span>\u26a1</span>';
		expect(panelProblems(container, 'collaboration', named)).toEqual([
			'#ngit-stars heading is "Stars (250)" (named "Stars (250)"), not "Stars" (named "Stars")',
			'#ngit-zaps heading is "Zaps \u26a1" (named "Zaps \u26a1"), not "Zaps \u26a1" (named "Zaps")'
		]);
	});
});

describe('/git frame', () => {
	it('stamps the footer with as_of_day, generated_utc and the coverage caveat', () => {
		const { container } = renderPage();
		const foot = text(container.querySelector('#ngit-footer'));
		expect(foot).toContain('Every window ends on Sep 24, 2026, the last complete UTC day');
		expect(foot).toContain('generated at 2026-09-25 03:31:07Z');
		expect(foot).toContain('lower bound');
		// each capture date, named for what it applies to
		expect(foot).toContain('Announcements have been observed since May 2, 2026');
		expect(foot).toContain('states and GRASP lists since Jun 14, 2026');
		expect(foot).toContain('comments since Jun 18, 2026');
		// and nothing else: the sentence naming the relays went on 2026-10-09, and the first
		// sentence took in the line under the title on 2026-10-18, each fact once, every date
		// in that line's style since (the operator's choice; ISO until then)
		// (the fixture counts hashtree's pushes, so the lower-bound clause names their exception)
		expect(foot).toBe(
			'Every window ends on Sep 24, 2026, the last complete UTC day before this snapshot was generated at 2026-09-25 03:31:07Z, and every count is a lower bound, but for the hashtree edits What is counted names. Announcements have been observed since May 2, 2026, states and GRASP lists since Jun 14, 2026, and comments since Jun 18, 2026.'
		);
	});

	it('survives rows whose third-party identifiers or hosts repeat', async () => {
		// Svelte 5 throws on a duplicate each-key even in production; the page keys document
		// rows by index so a crafted collision cannot take it down.
		const twin = { ...ACTIVE_NAMED, name: 'twin' };
		const snapshot: NgitSnapshot = {
			...FIXTURE,
			repos_active: [ACTIVE_NAMED, twin],
			grasp_servers: [FIXTURE.grasp_servers[0], { ...FIXTURE.grasp_servers[0], repos: 1 }],
			exclusions: [...FIXTURE.exclusions, FIXTURE.exclusions[0]],
			maintainers_top: [FIXTURE.maintainers_top[0], FIXTURE.maintainers_top[0]],
			repos_zapped: [...FIXTURE.repos_zapped, FIXTURE.repos_zapped[0]]
		};
		const { container } = renderPage(snapshot);
		for (const id of ['repositories', 'hosting', 'maintainers', 'collaboration', 'overview']) {
			await fireEvent.click(container.querySelector(`#tab-${id}`)!);
			expect(container.querySelector(`#panel-${id}`)).not.toBeNull();
		}
	});

	it('renders no site nav of its own (the site nav carries it, since 2026-10-15): its one nav is the pill bar', () => {
		const { container } = renderPage();
		const navs = [...container.querySelectorAll('nav')];
		expect(navs.map((n) => n.getAttribute('aria-label'))).toEqual(['Git on Nostr']);
		// and it links nowhere but to /git's own pills
		for (const a of navs[0].querySelectorAll('a')) expect(a.getAttribute('href')).toMatch(/^\/git(\/[a-z-]+)?$/);
	});

	it("writes every number in en-US whatever the viewer's locale", async () => {
		// The cards and tables force en-US; the bar lists used to format in the viewer's
		// locale, so a German reader saw "2.837" in a bar beside "4,304" on a card. Any number
		// formatted in the default locale renders the marker below instead.
		const original = Number.prototype.toLocaleString;
		vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (
			this: number,
			locales?: Intl.LocalesArgument,
			options?: Intl.NumberFormatOptions
		) {
			return locales === undefined ? 'VIEWER-LOCALE' : original.call(this, locales, options);
		});
		const { container } = renderPage();
		for (const id of ['overview', 'repositories', 'hosting', 'maintainers', 'collaboration']) {
			await fireEvent.click(container.querySelector(`#tab-${id}`)!);
			expect(container.textContent, id).not.toContain('VIEWER-LOCALE');
			for (const el of container.querySelectorAll('[title]')) {
				expect(el.getAttribute('title'), id).not.toContain('VIEWER-LOCALE');
			}
		}
		// the bars themselves: "2,300", never the viewer's grouping
		await fireEvent.click(container.querySelector('#tab-hosting')!);
		expect(text(container.querySelector('#ngit-clone-hosts'))).toContain('2,300');
	});

	it('uses no small grey below WCAG AA contrast on the card surface', async () => {
		// text-gray-500 (#6b7280) on the gray-800 card measures 3.04:1, under the 4.5:1 AA
		// minimum for small text; text-gray-400 measures 5.78:1.
		const { container } = renderPage();
		for (const id of ['overview', 'repositories', 'hosting', 'maintainers', 'collaboration']) {
			await fireEvent.click(container.querySelector(`#tab-${id}`)!);
			for (const details of container.querySelectorAll('details')) {
				details.open = true;
				await fireEvent(details, new Event('toggle'));
			}
			for (const button of container.querySelectorAll('[data-testid="chart-legend"] button')) {
				await fireEvent.click(button); // the struck-through, hidden-series state
			}
			// text colours only (hover variants included); borders and underlines are not text
			expect(container.querySelectorAll('[class*="text-gray-500"], [class*="text-gray-600"]').length, id).toBe(0);
		}
	});

	it('lets no third-party string reorder, hide or blank anything, on any pill', async () => {
		// Every string field a third party writes, carrying a right-to-left override, an
		// isolate and a zero-width space; the page must render none of them.
		const taint = (v: string) => `\u202E${v}\u2066\u200B`;
		const doc: NgitSnapshot = JSON.parse(JSON.stringify(FIXTURE));
		for (const r of doc.repos_active) {
			r.name = taint(r.name);
			r.d = taint(r.d);
			r.lead_name = taint('lead');
			r.hosts = r.hosts.map(taint);
		}
		for (const list of [doc.repos_starred, doc.repos_zapped]) {
			for (const r of list) r.name = taint(r.name);
		}
		for (const m of doc.maintainers_top) m.name = taint('maintainer');
		for (const t of doc.topics) t.t = taint(t.t);
		for (const r of doc.relays) r.relay = taint(r.relay);
		for (const w of doc.web_hosts) w.host = taint(w.host);
		// a hashtree host too: its short label and its hover title, the whole npub, are cleaned
		doc.clone_hosts.push({ host: 'npub1hwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwamhwasxw04hu', repos: 1, cls: 'hashtree' });
		for (const h of doc.clone_hosts) h.host = taint(h.host);
		for (const g of doc.grasp_servers) g.host = taint(g.host);
		const { container } = renderPage(doc);
		let seenLinks = 0;
		for (const id of ['overview', 'repositories', 'hosting', 'maintainers', 'collaboration']) {
			await fireEvent.click(container.querySelector(`#tab-${id}`)!);
			expect(container.textContent, id).not.toMatch(/\p{Cf}/u);
			for (const el of container.querySelectorAll('[title]:not(td)')) {
				// hover titles repeat the shown label; a cell's title is the raw repository key
				expect(el.getAttribute('title'), id).not.toMatch(/\p{Cf}/u);
			}
			const links = container.querySelectorAll(`#panel-${id} a`);
			seenLinks += links.length;
			for (const a of [...container.querySelectorAll('main a'), ...links]) {
				expect(text(a).trim(), id).not.toBe('');
			}
		}
		// links were there to check
		expect(seenLinks).toBeGreaterThan(0);
	});
});
