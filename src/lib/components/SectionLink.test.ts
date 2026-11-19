import { fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SectionLink from './SectionLink.svelte';

// The link icon on a section with an address of its own (/git/zaps): a click copies the
// address, a finger's tap opens the phone's share menu (copying where the browser has none),
// and anything else is the plain link. Where it is drawn is CSS (hover) and the page's choice
// on a phone (git-section-links.test.ts); scripts/verify-section-link.mjs sees both in Chrome.

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
	writeText = vi.fn().mockResolvedValue(undefined);
	Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
	// a page opened with a query and a pill hash: neither belongs in the link
	window.history.replaceState(null, '', '/git/zaps?utm_source=nostr#hosting');
});
afterEach(() => {
	Reflect.deleteProperty(navigator, 'share');
	window.history.replaceState(null, '', '/');
	vi.useRealTimers();
	vi.restoreAllMocks();
});

const ADDRESS = () => `${window.location.origin}/git/zaps`;
const mount = (props: Record<string, unknown> = {}) => {
	const { container } = render(SectionLink, { props: { href: '/git/zaps', title: 'Zaps', ...props } });
	return {
		link: container.querySelector('a[data-section-link]') as HTMLAnchorElement,
		live: container.querySelector('[aria-live]') as HTMLElement
	};
};
/** Let the clipboard or share promise settle, and the live region refill. */
const settle = async () => {
	for (let i = 0; i < 4; i++) await tick();
	await new Promise((r) => setTimeout(r, 0));
	await tick();
};
const clickEvent = (pointerType: string, detail = 1) =>
	new PointerEvent('click', { pointerType, detail, button: 0, bubbles: true, cancelable: true });
const click = (link: Element, pointerType: string, detail = 1) => fireEvent(link, clickEvent(pointerType, detail));
/** A share menu, as the browser offers one: `result` decides how it ends. */
const shareMenu = (result: () => Promise<void>) => {
	const share = vi.fn(result);
	Object.defineProperty(navigator, 'share', { value: share, configurable: true });
	return share;
};
const abort = () => Promise.reject(Object.assign(new Error('closed'), { name: 'AbortError' }));
/** The clock the share guard reads. */
const clock = (start = 1_000_000) => {
	let now = start;
	vi.spyOn(Date, 'now').mockImplementation(() => now);
	return (ms: number) => (now += ms);
};

describe('SectionLink', () => {
	it('is the plain link to the section, named for it, and never preloaded', () => {
		const { link, live } = mount();
		expect(link.getAttribute('href')).toBe('/git/zaps');
		expect(link.textContent?.trim()).toBe('Copy link to Zaps');
		expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
		// a preload on hover or touchstart would run the page's server load and log a visit
		// to the section that never happened
		expect(link.getAttribute('data-sveltekit-preload-data')).toBe('off');
		expect(live.getAttribute('aria-live')).toBe('polite');
	});

	it("copies the section's address on a mouse click - no query, no hash - and is not followed, though the browser has a share menu", async () => {
		const share = shareMenu(() => Promise.resolve()); // desktop Safari and Chrome have one
		const { link, live } = mount();
		expect(await click(link, 'mouse')).toBe(false);
		expect(share).not.toHaveBeenCalled();
		expect(writeText).toHaveBeenCalledWith(ADDRESS());
		await settle();
		expect(live.textContent).toBe('Link copied');
		expect(link.classList.contains('copied')).toBe(true);
		expect(link.classList.contains('shown')).toBe(true); // drawn, so the tick is seen
		expect(link.getAttribute('title')).toBe('Link copied');
		expect(link.querySelector('svg path')!.getAttribute('d')).toBe('m4.5 12.75 6 6 9-13.5');
		expect(window.location.pathname + window.location.search + window.location.hash).toBe('/git/zaps?utm_source=nostr#hosting');
	});

	it('lets the tick go after two seconds, and says it again on a second copy', async () => {
		vi.useFakeTimers();
		const { link, live } = mount();
		const heard: string[] = [];
		new MutationObserver(() => heard.push(live.textContent ?? '')).observe(live, {
			childList: true,
			characterData: true,
			subtree: true
		});
		await click(link, 'mouse');
		await vi.advanceTimersByTimeAsync(1500);
		await click(link, 'mouse');
		await vi.advanceTimersByTimeAsync(1500);
		expect(live.textContent).toBe('Link copied');
		// a live region speaks only when its text changes: the second copy empties it first
		expect(heard.filter((t) => t === 'Link copied')).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(500);
		expect(live.textContent).toBe('');
		expect(link.classList.contains('copied')).toBe(false);
		expect(link.classList.contains('shown')).toBe(false);
		expect(link.getAttribute('title')).toBe('Copy link to this section');
	});

	it('lets go of focus after a pointer click, and keeps it after Enter', async () => {
		const { link } = mount();
		link.focus();
		await click(link, 'mouse');
		expect(document.activeElement).not.toBe(link);
		link.focus();
		await fireEvent.click(link, { detail: 0 });
		expect(document.activeElement).toBe(link);
	});

	it('copies on Enter too, even when a finger pressed it last', async () => {
		const share = shareMenu(() => Promise.resolve());
		const { link } = mount();
		await fireEvent.pointerDown(link, { pointerType: 'touch' });
		await fireEvent.click(link, { detail: 0 });
		expect(share).not.toHaveBeenCalled();
		expect(writeText).toHaveBeenCalledWith(ADDRESS());
	});

	it.each([
		['the clipboard refuses', () => writeText.mockRejectedValue(new Error('denied'))],
		[
			'there is no clipboard at all (an insecure context)',
			() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
		]
	])('says it could not copy when %s', async (_, arrange) => {
		arrange();
		const { link, live } = mount();
		expect(await click(link, 'mouse')).toBe(false);
		await settle();
		expect(live.textContent).toBe('Could not copy the link');
		expect(link.classList.contains('failed')).toBe(true);
		expect(link.querySelector('svg path')!.getAttribute('d')).toBe('M6 18 18 6M6 6l12 12');
	});

	it.each([
		['middle button', { button: 1 }],
		['Cmd', { metaKey: true }],
		['Ctrl', { ctrlKey: true }],
		['Shift', { shiftKey: true }],
		['Alt', { altKey: true }]
	])('leaves a %s click to the browser, as the plain link', async (_, init) => {
		const { link } = mount();
		const ev = new MouseEvent('click', { detail: 1, button: 0, bubbles: true, cancelable: true, ...init });
		expect(await fireEvent(link, ev)).toBe(true);
		expect(writeText).not.toHaveBeenCalled();
	});

	describe('a finger', () => {
		it.each([
			['the click says touch', (link: Element) => link.dispatchEvent(clickEvent('touch'))],
			[
				'only the pointerdown says touch - the click a plain MouseEvent',
				(link: Element) => (
					link.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true })),
					link.dispatchEvent(new MouseEvent('click', { detail: 1, button: 0, bubbles: true, cancelable: true }))
				)
			],
			[
				'the pointerdown says touch and the click says mouse (WebKit builds it from mouse events)',
				(link: Element) => (
					link.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true })),
					link.dispatchEvent(clickEvent('mouse'))
				)
			]
		])("opens the phone's share menu with the address alone, inside the tap (%s)", async (_, tap) => {
			const share = shareMenu(() => Promise.resolve());
			const { link, live } = mount();
			const followed = tap(link);
			// synchronously, inside the tap - iOS refuses a share started after an await - and
			// the link is not followed
			expect(share).toHaveBeenCalledTimes(1);
			expect(share).toHaveBeenCalledWith({ url: ADDRESS() });
			expect(followed).toBe(false);
			await settle();
			expect(writeText).not.toHaveBeenCalled();
			expect(live.textContent).toBe('');
		});

		it('does nothing more when the reader closes the menu, and shares again at the next tap', async () => {
			const advance = clock();
			const share = shareMenu(abort);
			const { link, live } = mount();
			await click(link, 'touch');
			await settle();
			expect(writeText).not.toHaveBeenCalled();
			expect(live.textContent).toBe('');
			expect(link.classList.contains('failed')).toBe(false);
			advance(5000);
			await click(link, 'touch');
			expect(share).toHaveBeenCalledTimes(2);
		});

		it('copies when the share fails, or throws before it starts', async () => {
			const advance = clock();
			const share = shareMenu(() => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })));
			const { link, live } = mount();
			await click(link, 'touch');
			await settle();
			expect(writeText).toHaveBeenCalledTimes(1);
			expect(writeText).toHaveBeenCalledWith(ADDRESS());
			expect(live.textContent).toBe('Link copied');
			advance(5000);
			share.mockImplementation(() => {
				throw new TypeError('share is not allowed here');
			});
			await click(link, 'touch');
			await settle();
			expect(writeText).toHaveBeenCalledTimes(2);
		});

		it('copies where the browser has no share menu (Android WebView)', async () => {
			const { link, live } = mount();
			await click(link, 'touch');
			expect(writeText).toHaveBeenCalledWith(ADDRESS());
			await settle();
			expect(live.textContent).toBe('Link copied');
		});

		it('ignores a second tap within a second of a share, and not after - whether or not the menu ever answers', async () => {
			const advance = clock();
			const share = shareMenu(() => new Promise<void>(() => {})); // never settles, as headless Chrome's
			const { link } = mount();
			await click(link, 'touch');
			advance(999);
			await click(link, 'touch');
			expect(share).toHaveBeenCalledTimes(1);
			advance(1);
			await click(link, 'touch');
			expect(share).toHaveBeenCalledTimes(2);
			expect(writeText).not.toHaveBeenCalled();
		});
	});

	it('is drawn on a phone only on the card the page chose', () => {
		expect(mount({ phoneShown: true }).link.classList.contains('phone-shown')).toBe(true);
		expect(mount({ phoneShown: false }).link.classList.contains('phone-shown')).toBe(false);
	});
});
