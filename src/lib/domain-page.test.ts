import { render } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { goto, replaceState } from '$app/navigation';
import { GONE_NOTE, retiredNote, sectionOf, type DomainPage } from './domain-page';
import { reload } from './legacy-hash';
import Host from './domain-page.host.svelte';
import { methodologySection } from './methodology';
import { FOCUS_CLASS, GLOW_CLASS } from './section-link';
import type { SlugTable, Target } from './slug-table';

/** Called exactly once, with these arguments (vitest 2 has no toHaveBeenCalledExactlyOnceWith). */
function onceWith(fn: unknown, ...args: unknown[]) {
	expect(fn).toHaveBeenCalledTimes(1);
	expect(fn).toHaveBeenCalledWith(...args);
}

// $lib/domain-page through a stand-in page: which pill is open, What is counted, the note,
// opening at a section, and the moves the page makes itself, on a cold load and after each
// kind of navigation. The real pages are held to the same on top (git-section-links.test.ts,
// git-page.test.ts and the other domains' page tests).

const navigated = vi.hoisted(() => ({ callbacks: [] as ((nav: unknown) => void)[] }));
vi.mock('$app/navigation', () => ({
	afterNavigate: vi.fn((cb: (nav: unknown) => void) => navigated.callbacks.push(cb)),
	goto: vi.fn(() => Promise.resolve()),
	replaceState: vi.fn()
}));

const SHOP: SlugTable = {
	path: '/shop',
	pills: [
		{ slug: 'overview', label: 'Overview' },
		{ slug: 'deals', label: 'Deals' },
		{ slug: 'sellers', label: 'Who sells' }
	],
	sections: {
		prices: { pill: 'deals', elementId: 'shop-prices', title: 'Prices' },
		methodology: methodologySection('overview')
	},
	former: {},
	retired: { refunds: { pill: 'sellers', title: 'Refunds' } },
	ownRoutes: []
};
const PRICES: Target = { kind: 'page', pill: 'deals', section: 'prices' };
const COUNTED: Target = { kind: 'page', pill: 'overview', section: 'methodology' };
const SELLERS: Target = { kind: 'page', pill: 'sellers' };
const OVERVIEW: Target = { kind: 'page', pill: 'overview' };
const REFUNDS: Target = { kind: 'retired', pill: 'sellers', title: 'Refunds' };
const MOVE = { replaceState: true, noScroll: true, keepFocus: true };

/** How the document was opened, as the Navigation Timing entry says. */
let openedAs: string;
let scrollTo: ReturnType<typeof vi.fn>;
beforeEach(() => {
	navigated.callbacks.length = 0;
	vi.mocked(goto).mockClear();
	vi.mocked(replaceState).mockClear();
	// the browser's own full load of an address, stood in for (jsdom has no navigation)
	vi.spyOn(reload, 'at').mockImplementation(() => {});
	openedAs = 'navigate';
	vi.spyOn(performance, 'getEntriesByType').mockImplementation(() => [{ type: openedAs }] as never);
	vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
	scrollTo = vi.fn();
	window.scrollTo = scrollTo as never;
	window.history.replaceState(null, '', '/shop');
});
afterEach(() => {
	window.history.replaceState(null, '', '/');
	vi.restoreAllMocks();
});

/** Mount the stand-in page at `path` with the server's answer `target`. */
function open(path: string, target?: Target) {
	window.history.replaceState(null, '', path);
	let dp!: DomainPage;
	const r = render(Host, { props: { table: SHOP, data: { target }, expose: (d: DomainPage) => (dp = d) } });
	return {
		dp,
		c: r.container,
		unmount: r.unmount,
		/** A SvelteKit navigation: the address and the server's answer change, then the router
		 * calls afterNavigate. */
		async navigate(type: string, to: string, next: Target) {
			window.history.replaceState(null, '', to);
			await r.rerender({ table: SHOP, data: { target: next }, expose: () => {} });
			navigated.callbacks.at(-1)!({ type, to: { url: new URL('https://site.test' + to) } });
			await tick();
		}
	};
}
const enter = () => navigated.callbacks.at(-1)!({ type: 'enter', to: { url: new URL(window.location.href) } });
const macrotask = () => new Promise((r) => setTimeout(r, 0));
const landed = (c: HTMLElement, id: string) => {
	const el = c.querySelector(`#${id}`) as HTMLElement;
	return el.classList.contains(GLOW_CLASS) && el.classList.contains(FOCUS_CLASS) && document.activeElement === el;
};

describe('sectionOf', () => {
	it("is the section a page target opens at, and nothing for a pill's or a retired slug's", () => {
		expect(sectionOf(PRICES)).toBe('prices');
		expect(sectionOf(SELLERS)).toBeUndefined();
		expect(sectionOf(REFUNDS)).toBeUndefined();
		expect(sectionOf(undefined)).toBeUndefined();
	});
});

describe('the cold load', () => {
	it("opens the pill the server's answer names, and the default one with no answer", () => {
		expect(get(open('/shop/sellers', SELLERS).dp.tab)).toBe('sellers');
	});

	it('opens the default pill with no answer (a document alone)', () => {
		expect(get(open('/shop').dp.tab)).toBe('overview');
	});

	it("opens What is counted at its own address, and only there", () => {
		expect(get(open('/shop/methodology', COUNTED).dp.methodologyOpen)).toBe(true);
	});

	it('leaves What is counted closed anywhere else', () => {
		expect(get(open('/shop/deals', { kind: 'page', pill: 'deals' }).dp.methodologyOpen)).toBe(false);
	});

	it("opens at a section's own address on a fresh load: under the nav, glowing, focused", async () => {
		const { c } = open('/shop/prices', PRICES);
		enter();
		expect(scrollTo).toHaveBeenCalledTimes(1);
		expect(landed(c, 'shop-prices')).toBe(true);
	});

	// one render each: a second copy's #ids would resolve to the first's (jsdom)
	it.each(['reload', 'back_forward'])("keeps the reader's own scroll on a %s", (how) => {
		openedAs = how;
		const { c } = open('/shop/prices', PRICES);
		enter();
		expect(scrollTo).not.toHaveBeenCalled();
		expect(landed(c, 'shop-prices')).toBe(false);
	});

	it("opens at What is counted's own address the same way, already expanded", () => {
		const { c } = open('/shop/methodology', COUNTED);
		enter();
		expect(landed(c, 'methodology')).toBe(true);
		expect(c.querySelector('#methodology')?.getAttribute('data-open')).toBe('true');
	});

	it('says why the reader is here after a 302 (found) for an unknown slug, then drops the #gone, keeping the query', async () => {
		const { dp } = open('/shop?utm_source=nostr#gone', OVERVIEW);
		await tick();
		expect(get(dp.note)).toBe(GONE_NOTE);
		enter();
		expect(goto).not.toHaveBeenCalled(); // the router has not started yet
		await macrotask();
		// the router's own move, replacing the entry - never its shallow replaceState, which
		// would leave its record of the address on the entry for Back to load again
		onceWith(goto, '/shop?utm_source=nostr', MOVE);
		expect(replaceState).not.toHaveBeenCalled();
	});

	it("names a retired section in the note, and moves to its pill's address, replacing the entry", async () => {
		const { dp } = open('/shop/refunds', REFUNDS);
		expect(get(dp.note)).toBe(retiredNote('Refunds'));
		expect(get(dp.tab)).toBe('sellers');
		enter();
		expect(goto).not.toHaveBeenCalled(); // the router has not started yet
		await macrotask();
		onceWith(goto, '/shop/sellers', MOVE);
	});

	it('shows no note anywhere else', async () => {
		const { dp } = open('/shop/deals', { kind: 'page', pill: 'deals' });
		enter();
		await macrotask();
		expect(get(dp.note)).toBe('');
		expect(goto).not.toHaveBeenCalled();
		expect(replaceState).not.toHaveBeenCalled();
	});
});

describe('an old #slug link ($lib/legacy-hash)', () => {
	it('opens the pill it meant before the first paint, then moves to its address, replacing the entry', async () => {
		const { dp } = open('/shop?utm_source=nostr#sellers', OVERVIEW);
		expect(get(dp.tab)).toBe('sellers');
		enter();
		expect(goto).not.toHaveBeenCalled(); // the router has not started yet
		await macrotask();
		onceWith(goto, '/shop/sellers?utm_source=nostr', MOVE);
		expect(scrollTo).not.toHaveBeenCalled();
	});

	it('opens What is counted for #methodology, and moves to its address', async () => {
		const { dp } = open('/shop#methodology', OVERVIEW);
		expect(get(dp.methodologyOpen)).toBe(true);
		enter();
		await macrotask();
		onceWith(goto, '/shop/methodology', MOVE);
	});

	it('only drops the hash when it named the address the page is already at', async () => {
		open('/shop#overview', OVERVIEW);
		enter();
		await macrotask();
		onceWith(goto, '/shop', MOVE);
		expect(replaceState).not.toHaveBeenCalled();
	});

	it('loads the address an old link followed while the page is open meant, replacing the entry', async () => {
		// a jump within the page, which the browser pushed behind the router's back: a move of the
		// router's own left Back stuck (fresh-context review, 2026-10-19), so it is a full load
		open('/shop/deals?utm_source=nostr', { kind: 'page', pill: 'deals' });
		enter();
		await macrotask();
		window.history.replaceState(null, '', '/shop/deals?utm_source=nostr#methodology');
		window.dispatchEvent(new HashChangeEvent('hashchange'));
		onceWith(reload.at, '/shop/methodology?utm_source=nostr');
		expect(goto).not.toHaveBeenCalled();
		// and any other hash change is left alone
		window.history.replaceState(null, '', '/shop/deals#somewhere');
		window.dispatchEvent(new HashChangeEvent('hashchange'));
		expect(reload.at).toHaveBeenCalledTimes(1);
	});

	it('stops listening once the page is gone', async () => {
		const page = open('/shop', OVERVIEW);
		page.unmount();
		window.history.replaceState(null, '', '/shop#sellers');
		window.dispatchEvent(new HashChangeEvent('hashchange'));
		expect(reload.at).not.toHaveBeenCalled();
	});

	it('leaves any other hash alone', async () => {
		const { dp } = open('/shop#somewhere', OVERVIEW);
		expect(get(dp.tab)).toBe('overview');
		enter();
		await macrotask();
		expect(goto).not.toHaveBeenCalled();
		expect(replaceState).not.toHaveBeenCalled();
	});
});

describe('after a navigation', () => {
	it("opens the pill the new address names - a pill click's, a link's, Back's", async () => {
		const page = open('/shop', OVERVIEW);
		enter();
		for (const [type, to, target, pill] of [
			['link', '/shop/sellers', SELLERS, 'sellers'],
			['popstate', '/shop', OVERVIEW, 'overview'],
			['goto', '/shop/deals', { kind: 'page', pill: 'deals' } as Target, 'deals']
		] as const) {
			await page.navigate(type, to, target);
			expect(get(page.dp.tab), `${type} ${to}`).toBe(pill);
		}
		expect(scrollTo).not.toHaveBeenCalled();
	});

	it("opens at a section reached by a link, once the router's own scroll is done", async () => {
		const page = open('/shop', OVERVIEW);
		enter();
		await page.navigate('link', '/shop/prices', PRICES);
		expect(get(page.dp.tab)).toBe('deals');
		expect(scrollTo).not.toHaveBeenCalled();
		await macrotask();
		expect(landed(page.c, 'shop-prices')).toBe(true);
	});

	it('opens at a section the page moved to itself (an old link, a retired slug), as after a link', async () => {
		// a `goto` navigation is a move to the section like a link's, not a restore like Back's
		const page = open('/shop', OVERVIEW);
		enter();
		await page.navigate('goto', '/shop/prices', PRICES);
		expect(scrollTo).not.toHaveBeenCalled();
		await macrotask();
		expect(landed(page.c, 'shop-prices')).toBe(true);
	});

	it("never scrolls on Back or Forward to a section: the restored scroll is the reader's", async () => {
		const page = open('/shop', OVERVIEW);
		enter();
		await page.navigate('popstate', '/shop/prices', PRICES);
		await macrotask();
		expect(scrollTo).not.toHaveBeenCalled();
		expect(get(page.dp.tab)).toBe('deals');
	});

	it('opens What is counted when the address names it, even on Back, and never closes it', async () => {
		const page = open('/shop', OVERVIEW);
		enter();
		await page.navigate('popstate', '/shop/methodology', COUNTED);
		expect(get(page.dp.methodologyOpen)).toBe(true);
		for (const [to, target] of [
			['/shop/sellers', SELLERS],
			['/shop', OVERVIEW]
		] as const) {
			await page.navigate('link', to, target);
			expect(get(page.dp.methodologyOpen), to).toBe(true);
		}
	});

	it('says why after an in-site move to an unknown slug, and drops the #gone', async () => {
		const page = open('/shop/deals', { kind: 'page', pill: 'deals' });
		enter();
		await page.navigate('link', '/shop#gone', OVERVIEW);
		expect(get(page.dp.note)).toBe(GONE_NOTE);
		await macrotask();
		onceWith(goto, '/shop', MOVE);
		expect(replaceState).not.toHaveBeenCalled();
	});

	it("names a retired section after an in-site move to it, and moves to its pill's address", async () => {
		const page = open('/shop', OVERVIEW);
		enter();
		await page.navigate('link', '/shop/refunds', REFUNDS);
		expect(get(page.dp.note)).toBe(retiredNote('Refunds'));
		expect(get(page.dp.tab)).toBe('sellers');
		await macrotask();
		onceWith(goto, '/shop/sellers', MOVE);
	});
});

describe('pick', () => {
	it("opens the clicked pill at once, ahead of the router's answer", () => {
		const { dp } = open('/shop', OVERVIEW);
		dp.pick('sellers');
		expect(get(dp.tab)).toBe('sellers');
	});
});
