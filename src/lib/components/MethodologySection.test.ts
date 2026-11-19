import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MethodologySection from './MethodologySection.svelte';

// The section that every domain page's /<domain>/methodology address opens, and the link icon
// that copies that address (CLAUDE.md -> "Every domain page's What is counted has an
// address"). The pages' own tests drive it through each domain; this pins the component: its
// shape, and what a click on the icon does and must NOT do.

const body = createRawSnippet(() => ({ render: () => '<p data-body>The exclusion ledger</p>' }));
const mount = (props: Record<string, unknown> = {}) => {
	// The component is legacy-mode (`export let`, `<slot />`), which reads its default slot
	// from `$$slots` - a `children` snippet, the runes-mode spelling, renders nothing there.
	const r = render(MethodologySection, { props: { $$slots: { default: body }, href: '/git/methodology', ...props } as never });
	const details = r.container.querySelector('details') as HTMLDetailsElement;
	const link = r.container.querySelector('a[data-methodology-link]') as HTMLAnchorElement;
	const live = r.container.querySelector('[aria-live]') as HTMLElement;
	return { ...r, details, link, live };
};

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
	writeText = vi.fn(() => Promise.resolve());
	Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => {
	window.history.replaceState(null, '', '/');
	vi.useRealTimers();
	vi.restoreAllMocks();
});
/** Let the clipboard promise settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('MethodologySection', () => {
	it('is a closed <details> carrying its id, its heading and its content', () => {
		const { details } = mount();
		expect(details.id).toBe('methodology');
		expect(details.open).toBe(false);
		expect(details.querySelector(':scope > summary > h2')!.textContent).toBe('What is counted');
		// closed, the content is still in the DOM, only not drawn
		expect(details.querySelector('[data-body]')!.textContent).toBe('The exclusion ledger');
		// the head is the whole summary, padding included - all of the closed card - so the
		// padding is the summary's and the body has its own, never the <details>'s
		expect(details.querySelector('summary')!.classList).toContain('p-5');
		expect(details.className).not.toMatch(/(^|\s)p[xy]?-/);
		expect(details.querySelector('[data-body]')!.parentElement!.className).toBe('px-5 pb-5');
	});

	it('opens when the page says so, and keeps the one heading every domain page shares', () => {
		// /routstr's "What is counted - and who is not" became this on 2026-10-18; the heading
		// is no prop, so a page has nothing to pass that would make it differ
		const { details } = mount({ open: true, title: 'What is counted - and who is not' });
		expect(details.open).toBe(true);
		expect(details.querySelector('summary')!.textContent!.trim()).toBe('What is counted');
	});

	it('puts the link icon beside the summary, never inside it, as a real link to the address', () => {
		const { details, link } = mount();
		// inside the summary it would be a control in a control, and its name would join the
		// summary's ("What is counted Copy link to What is counted")
		expect(details.querySelector('a')).toBeNull();
		expect(details.querySelector('summary')!.textContent!.trim()).toBe('What is counted');
		// ahead of the section, so Tab reaches it before everything an open section holds
		expect(link.nextElementSibling).toBe(details);
		// without JavaScript, or on a right-click, it is the link itself: the section's own
		// address, the same a click copies
		expect(link.getAttribute('href')).toBe('/git/methodology');
		// named by its text, so nothing that reads the DOM finds a textless link
		expect(link.textContent!.trim()).toBe('Copy link to What is counted');
		expect(link.getAttribute('title')).toBe('Copy link to this section');
		expect(link.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
	});

	it('is never preloaded: the site preloads links on hover, and this one is not followed', () => {
		const { link } = mount();
		expect(link.getAttribute('data-sveltekit-preload-data')).toBe('off');
	});

	it('names and copies the address it is given, whatever address the page is at', async () => {
		// /git is served at every /git/<slug>: on /git/zaps the link still says /git/methodology
		window.history.replaceState(null, '', '/git/zaps');
		const { link } = mount();
		expect(link.getAttribute('href')).toBe('/git/methodology');
		expect(await fireEvent.click(link)).toBe(false);
		expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/git/methodology`);
		// another domain's, as given
		const other = mount({ href: '/marketplaces/methodology' });
		expect(other.link.getAttribute('href')).toBe('/marketplaces/methodology');
	});

	it.each([false, true])(
		"copies the section's address - and leaves the section (open: %s), the address bar and the scroll alone",
		async (open) => {
			window.history.replaceState(null, '', '/git?utm_source=nostr#hosting');
			const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
			const { details, link, live } = mount({ open });
			expect(live.textContent).toBe('');
			// fireEvent returns false when the handler prevented the default - the link is NOT
			// followed: a copy leaves the page as it was
			expect(await fireEvent.click(link)).toBe(false);
			// the section's address alone: the page's own query and hash are not part of it
			expect(writeText).toHaveBeenCalledTimes(1);
			expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/git/methodology`);
			await settle();
			expect(details.open).toBe(open);
			expect(window.location.hash).toBe('#hosting');
			expect(window.location.search).toBe('?utm_source=nostr');
			expect(scrollTo).not.toHaveBeenCalled();
			// and says so: a tick, a tooltip, and a polite announcement
			expect(live.textContent).toBe('Link copied');
			expect(link.getAttribute('title')).toBe('Link copied');
			expect(link.classList.contains('copied')).toBe(true);
			// shown even once the pointer has moved off, so the tick is seen
			expect(link.classList.contains('shown')).toBe(true);
		}
	);

	it('goes back to rest two seconds after the copy', async () => {
		vi.useFakeTimers();
		const { link, live } = mount();
		await fireEvent.click(link);
		await vi.advanceTimersByTimeAsync(0);
		expect(live.textContent).toBe('Link copied');
		await vi.advanceTimersByTimeAsync(1999);
		expect(live.textContent).toBe('Link copied');
		await vi.advanceTimersByTimeAsync(1);
		expect(live.textContent).toBe('');
		expect(link.classList.contains('shown')).toBe(false);
		expect(link.classList.contains('copied')).toBe(false);
		expect(link.getAttribute('title')).toBe('Copy link to this section');
	});

	it('restarts the two seconds on a second copy, and announces it again', async () => {
		vi.useFakeTimers();
		const { link, live } = mount();
		const heard: string[] = [];
		new MutationObserver(() => heard.push(live.textContent ?? '')).observe(live, { childList: true, characterData: true, subtree: true });
		await fireEvent.click(link);
		await vi.advanceTimersByTimeAsync(1500);
		await fireEvent.click(link);
		await vi.advanceTimersByTimeAsync(1500);
		expect(live.textContent).toBe('Link copied');
		// a live region speaks only when its text changes: the second copy empties it and
		// fills it again, rather than leaving "Link copied" standing and saying nothing
		expect(heard.filter((t) => t === 'Link copied')).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(500);
		expect(live.textContent).toBe('');
	});

	// A touchscreen whose primary pointer hovers (a touch laptop) passes the (hover: hover)
	// gate, so a finger can land on the armed icon while aiming at the head under it. That
	// click toggles the section, as the head would have, and copies nothing. Chrome says so on
	// the click itself (a PointerEvent); an engine whose click is a plain MouseEvent is told
	// by the pointerdown before it.
	const touchClick = (link: Element) =>
		fireEvent(link, new PointerEvent('click', { pointerType: 'touch', detail: 1, button: 0, bubbles: true, cancelable: true }));
	it.each([
		['the click says touch', async (link: Element) => touchClick(link)],
		['the pointerdown said touch', async (link: Element) => (await fireEvent.pointerDown(link, { pointerType: 'touch' }), fireEvent.click(link, { detail: 1 }))]
	])('toggles the section on a finger tap, and copies nothing (%s)', async (_, tap) => {
		const { details, link, live } = mount();
		expect(await tap(link)).toBe(false);
		await settle();
		expect(details.open).toBe(true);
		expect(await tap(link)).toBe(false);
		await settle();
		expect(details.open).toBe(false);
		expect(writeText).not.toHaveBeenCalled();
		expect(live.textContent).toBe('');
		expect(window.location.hash).toBe('');
	});

	it('copies for a mouse, a pen, or Enter after a tap - only a touch click toggles', async () => {
		const { details, link } = mount();
		await fireEvent.pointerDown(link, { pointerType: 'pen' });
		await fireEvent.click(link, { detail: 1 });
		await fireEvent(link, new PointerEvent('click', { pointerType: 'mouse', detail: 1, button: 0, bubbles: true, cancelable: true }));
		// a finger pressed it last, but Enter on the focused link (detail 0) is the keyboard
		await fireEvent.pointerDown(link, { pointerType: 'touch' });
		await fireEvent.click(link, { detail: 0 });
		expect(writeText).toHaveBeenCalledTimes(3);
		expect(details.open).toBe(false);
	});

	it('lets go of focus after a pointer click, and keeps it after Enter', async () => {
		// Chrome focuses a clicked link, and the next key press would make that
		// :focus-visible - the icon back on screen, for good, while the page scrolls
		const { link } = mount();
		link.focus();
		await fireEvent.click(link, { detail: 1 });
		expect(document.activeElement).not.toBe(link);
		link.focus();
		await fireEvent.click(link, { detail: 0 });
		expect(document.activeElement).toBe(link);
		expect(writeText).toHaveBeenCalledTimes(2);
	});

	it('says it could not copy when the clipboard refuses, and is still not followed', async () => {
		writeText.mockImplementation(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
		const { link, live } = mount();
		expect(await fireEvent.click(link)).toBe(false);
		await settle();
		expect(live.textContent).toBe('Could not copy the link');
		expect(link.getAttribute('title')).toBe('Could not copy the link');
		// seen as well as heard: a cross in its own colour, not the link glyph unchanged
		expect(link.classList.contains('copied')).toBe(false);
		expect(link.classList.contains('failed')).toBe(true);
		expect(link.querySelector('svg path')!.getAttribute('d')).toBe('M6 18 18 6M6 6l12 12');
		expect(window.location.hash).toBe('');
	});

	it('says it could not copy when there is no clipboard at all (an insecure context)', async () => {
		Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
		const { link, live } = mount();
		expect(await fireEvent.click(link)).toBe(false);
		await settle();
		expect(live.textContent).toBe('Could not copy the link');
	});

	it.each([
		['a middle click', { button: 1 }],
		['Cmd-click', { metaKey: true }],
		['Ctrl-click', { ctrlKey: true }],
		['Shift-click', { shiftKey: true }],
		['Alt-click', { altKey: true }]
	])('leaves %s to the browser - a new tab, a new window - and copies nothing', async (_, init) => {
		const { link } = mount();
		expect(await fireEvent.click(link, init)).toBe(true);
		expect(writeText).not.toHaveBeenCalled();
	});

	it('stops its timer when it goes away', async () => {
		vi.useFakeTimers();
		const { link, unmount } = mount();
		await fireEvent.click(link);
		await vi.advanceTimersByTimeAsync(0);
		expect(vi.getTimerCount()).toBe(1);
		unmount();
		expect(vi.getTimerCount()).toBe(0);
	});

	// jsdom has no :hover and no media queries for pointers, so it cannot see whether the
	// icon is drawn. The browser half is scripts/verify-methodology-link.mjs; this pins the
	// two properties whose loss nothing else here would notice. At rest the icon must take
	// NO pointer events as well as being transparent - on a phone there is no hover, so it
	// never shows, and a tap at the head's right end must toggle the section rather than land
	// on an invisible copy target. And it is drawn on hover only where a pointer CAN hover: a
	// touch browser's sticky tap-hover would otherwise arm it.
	it('rests transparent and untouchable, and arms only under a hovering pointer (source)', () => {
		const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'MethodologySection.svelte'), 'utf8');
		const css = src.slice(src.indexOf('<style>'));
		const rest = css.match(/\n\t\.copy-link \{[^}]*\}/)![0];
		expect(rest).toContain('opacity: 0;');
		expect(rest).toContain('pointer-events: none;');
		const armed = css.match(/@media \(hover: hover\) \{([^]*?)\n\t\}/)![1];
		expect(armed).toContain('.methodology:has(> details > summary:hover) .copy-link');
		expect(armed).toContain('pointer-events: auto;');
		// and nothing outside that gate gives it pointer events back
		expect(css.replace(armed, '').match(/pointer-events: auto/g)).toBeNull();
	});
});
