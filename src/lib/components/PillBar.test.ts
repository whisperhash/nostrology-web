import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SlugTable } from '$lib/slug-table';
import PillBar from './PillBar.svelte';

// The page's own address, which decides how the open pill is marked.
const address = vi.hoisted(() => ({ path: '/shop' }));
vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return { page: { subscribe: (fn: (v: unknown) => void) => readable({ url: new URL('https://site.test' + address.path) }).subscribe(fn) } };
});

/** Called exactly once, with these arguments (vitest 2 has no toHaveBeenCalledExactlyOnceWith). */
function onceWith(fn: unknown, ...args: unknown[]) {
	expect(fn).toHaveBeenCalledTimes(1);
	expect(fn).toHaveBeenCalledWith(...args);
}

// A domain page's pill bar: links to the pills' own addresses, drawn from the slug table. What a
// click then does to the page is $lib/domain-page's (domain-page.test.ts) and each page's own
// tests; scripts/verify-section-link.mjs clicks the real thing in Chrome.

const SHOP: SlugTable = {
	path: '/shop',
	pills: [
		{ slug: 'overview', label: 'Overview' },
		{ slug: 'deals', label: 'Deals' },
		{ slug: 'sellers', label: 'Who sells' }
	],
	sections: {},
	former: {},
	retired: {},
	ownRoutes: []
};

// SvelteKit's router takes a link click over in a listener of its own, after the link's own
// handler: stand in for it, recording whether the bar had already cancelled the click (it must
// not, or the router would leave it alone and nothing would navigate).
let prevented: boolean[];
const router = (e: Event) => {
	if (!(e.target as Element).closest('a')) return;
	prevented.push(e.defaultPrevented);
	e.preventDefault();
};
beforeEach(() => {
	prevented = [];
	address.path = '/shop';
	document.addEventListener('click', router);
});
afterEach(() => {
	document.removeEventListener('click', router);
});

const mount = (props: Record<string, unknown> = {}) =>
	render(PillBar, { props: { table: SHOP, current: 'overview', label: 'Shop', ...props } }).container;
const links = (c: HTMLElement) => [...c.querySelectorAll('nav > a')] as HTMLAnchorElement[];

describe('PillBar', () => {
	it("draws one link per pill, in the table's order, each to its own address", () => {
		const c = mount();
		expect(links(c).map((a) => [a.getAttribute('href'), a.textContent?.trim()])).toEqual([
			['/shop', 'Overview'],
			['/shop/deals', 'Deals'],
			['/shop/sellers', 'Who sells']
		]);
		expect(links(c).map((a) => a.id)).toEqual(['tab-overview', 'tab-deals', 'tab-sellers']);
	});

	it('is a navigation landmark named for the domain, marking the open pill as the current page', () => {
		address.path = '/shop/sellers';
		const c = mount({ current: 'sellers' });
		expect(c.querySelector('nav')?.getAttribute('aria-label')).toBe('Shop');
		expect(links(c).map((a) => a.getAttribute('aria-current'))).toEqual([null, null, 'page']);
		expect(links(c)[2].classList.contains('bg-nostr-purple')).toBe(true);
		expect(links(c)[0].classList.contains('bg-nostr-purple')).toBe(false);
	});

	it("marks the open pill the current item, not the current page, at a section's address on it", () => {
		// /git/zaps opens Collaboration, whose link goes to /git/collaboration
		address.path = '/shop/prices';
		const c = mount({ current: 'deals' });
		expect(links(c).map((a) => a.getAttribute('aria-current'))).toEqual([null, 'true', null]);
		// still drawn as the open pill
		expect(links(c)[1].classList.contains('bg-nostr-purple')).toBe(true);
	});

	it('keeps the scroll and the focus, and never preloads: only a click asks the server', () => {
		for (const a of links(mount())) {
			// '' turns it on: 'false' is there too, and turns it off
			expect(a.getAttribute('data-sveltekit-noscroll'), a.id).toBe('');
			expect(a.hasAttribute('data-sveltekit-keepfocus'), a.id).toBe(true);
			expect(a.getAttribute('data-sveltekit-preload-data'), a.id).toBe('off');
		}
	});

	it('starts each page at its top where the pills are pages of their own, still keeping the focus', () => {
		const PAGES: SlugTable = { ...SHOP, pills: [SHOP.pills[0], { ...SHOP.pills[1], ownRoute: true }, SHOP.pills[2]] };
		for (const a of links(mount({ table: PAGES }))) {
			expect(a.getAttribute('data-sveltekit-noscroll'), a.id).toBe('false');
			expect(a.hasAttribute('data-sveltekit-keepfocus'), a.id).toBe(true);
			expect(a.getAttribute('data-sveltekit-preload-data'), a.id).toBe('off');
		}
	});

	it('opens the pill on a plain click, and leaves the click to the router', async () => {
		const onPick = vi.fn();
		const c = mount({ onPick });
		await fireEvent.click(links(c)[1], { detail: 1 });
		onceWith(onPick, 'deals', false);
		expect(prevented).toEqual([false]);
	});

	it("tells the page a click was the keyboard's (Enter, a click with no pointer behind it)", async () => {
		const onPick = vi.fn();
		const c = mount({ onPick });
		await fireEvent.click(links(c)[2], { detail: 0 });
		onceWith(onPick, 'sellers', true);
	});

	it.each([
		['the meta key', { metaKey: true }],
		['the control key', { ctrlKey: true }],
		['the shift key', { shiftKey: true }],
		['the alt key', { altKey: true }],
		['the middle button', { button: 1 }]
	])('opens nothing on a click with %s: a new tab or window is the browser\'s', async (_, init) => {
		const onPick = vi.fn();
		const c = mount({ onPick });
		await fireEvent.click(links(c)[1], init);
		expect(onPick).not.toHaveBeenCalled();
		expect(prevented).toEqual([false]);
	});

	it("takes the page's placement classes on its own", () => {
		const nav = mount({ class: 'order-first sm:order-none' }).querySelector('nav')!;
		expect([...nav.classList]).toEqual(expect.arrayContaining(['inline-flex', 'order-first', 'sm:order-none']));
	});
});
