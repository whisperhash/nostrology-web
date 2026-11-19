import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	FOCUS_CLASS,
	GLOW_CLASS,
	GLOW_MS,
	focusSection,
	glowSection,
	nearestTop,
	openedFresh,
	revealElement
} from './section-link';

// Arriving at a section by its own address (/git/zaps): where the page ends up, the glow and
// how long it lasts, the focus, and when the page counts as opened fresh. The page's use of
// them is pinned in src/routes/(app)/git/git-section-links.test.ts.

const card = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};
afterEach(() => {
	document.body.innerHTML = '';
	vi.restoreAllMocks();
});

describe('revealElement', () => {
	it("puts the section's top just under the sticky nav, measured, less an 8 px gap", () => {
		document.body.insertAdjacentHTML('afterbegin', '<nav class="nav"></nav>');
		vi.spyOn(document.querySelector('nav.nav')!, 'getBoundingClientRect').mockReturnValue({ height: 61 } as DOMRect);
		const el = card();
		vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top: 2400 } as DOMRect);
		vi.spyOn(window, 'scrollY', 'get').mockReturnValue(300);
		const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
		revealElement(el);
		expect(scrollTo).toHaveBeenCalledWith({ top: 300 + 2400 - 61 - 8 });
	});
});

describe('glowSection', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('glows for GLOW_MS, then lets go', () => {
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
		const el = card();
		glowSection(el);
		expect(el.classList.contains(GLOW_CLASS)).toBe(true);
		vi.advanceTimersByTime(GLOW_MS - 1);
		expect(el.classList.contains(GLOW_CLASS)).toBe(true);
		vi.advanceTimersByTime(1);
		expect(el.classList.contains(GLOW_CLASS)).toBe(false);
	});

	it('waits for a hidden tab to be shown, then glows', () => {
		const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
		const el = card();
		glowSection(el);
		vi.advanceTimersByTime(60_000);
		expect(el.classList.contains(GLOW_CLASS)).toBe(false);
		visibility.mockReturnValue('visible');
		document.dispatchEvent(new Event('visibilitychange'));
		expect(el.classList.contains(GLOW_CLASS)).toBe(true);
		vi.advanceTimersByTime(GLOW_MS);
		expect(el.classList.contains(GLOW_CLASS)).toBe(false);
	});

	it('restarts on a second call rather than ending early', () => {
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
		const el = card();
		glowSection(el);
		vi.advanceTimersByTime(GLOW_MS - 500);
		glowSection(el);
		vi.advanceTimersByTime(600);
		expect(el.classList.contains(GLOW_CLASS)).toBe(true);
		vi.advanceTimersByTime(GLOW_MS - 600);
		expect(el.classList.contains(GLOW_CLASS)).toBe(false);
	});

	it('lasts as long as the animation in src/app.css', () => {
		const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../app.css'), 'utf8');
		expect(css).toContain(`animation: section-arrival ${GLOW_MS / 1000}s`);
	});
});

describe('focusSection', () => {
	it('focuses the section without scrolling, out of the tab order, with no outline', () => {
		const el = card();
		const focus = vi.spyOn(el, 'focus');
		focusSection(el);
		expect(document.activeElement).toBe(el);
		expect(focus).toHaveBeenCalledWith({ preventScroll: true });
		expect(el.tabIndex).toBe(-1);
		expect(el.classList.contains(FOCUS_CLASS)).toBe(true);
	});

	it('keeps a tabindex the element already has', () => {
		const el = card();
		el.tabIndex = 0;
		focusSection(el);
		expect(el.tabIndex).toBe(0);
	});
});

describe('openedFresh', () => {
	it.each([
		['navigate', true],
		['reload', false],
		['back_forward', false],
		['prerender', false]
	])('a document whose navigation was "%s": %s', (type, fresh) => {
		vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type }] as never);
		expect(openedFresh()).toBe(fresh);
	});

	it('a browser that keeps no navigation entry: fresh', () => {
		vi.spyOn(performance, 'getEntriesByType').mockReturnValue([]);
		expect(openedFresh()).toBe(true);
	});
});

describe('nearestTop (P1: the one card a phone draws the link icon on)', () => {
	const NAV = 61;
	const VH = 844;
	it('picks the heading nearest the top among those wholly on screen below the nav', () => {
		const heads = [
			{ name: 'zaps', top: 500, bottom: 528 },
			{ name: 'stars', top: 120, bottom: 148 }
		];
		expect(nearestTop(heads, NAV, VH)).toBe('stars');
	});
	it('passes over a heading under the nav or below the screen, even partly', () => {
		expect(nearestTop([{ name: 'a', top: 50, bottom: 78 }], NAV, VH)).toBeNull(); // under the nav
		expect(nearestTop([{ name: 'a', top: 830, bottom: 858 }], NAV, VH)).toBeNull(); // below the screen
		expect(nearestTop([{ name: 'a', top: 61, bottom: 89 }], NAV, VH)).toBe('a'); // just under the nav
		expect(nearestTop([{ name: 'a', top: 816, bottom: 844 }], NAV, VH)).toBe('a'); // the very bottom
		expect(
			nearestTop(
				[
					{ name: 'gone-under', top: 40, bottom: 68 },
					{ name: 'next', top: 700, bottom: 728 }
				],
				NAV,
				VH
			)
		).toBe('next');
	});
	it('passes over a heading with no height - not laid out - wherever its box claims to be, and gives none for none', () => {
		expect(nearestTop([{ name: 'hidden', top: 300, bottom: 300 }], NAV, VH)).toBeNull();
		expect(nearestTop([], NAV, VH)).toBeNull();
	});
});
