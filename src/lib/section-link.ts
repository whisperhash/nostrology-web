// A section's own address (/git/zaps, $lib/slug-table), in the browser. Arriving at it: the
// page opens with the section just under the sticky nav and makes it glow once, so the reader
// sees at a glance which card the link meant (called once the section's pill is rendered).
// Passing it on: which card a phone draws the link icon on (nearestTop; SectionLink.svelte).

/** The class that draws the glow (src/app.css), and how long it stays. */
export const GLOW_CLASS = 'section-arrival';
export const GLOW_MS = 2000;

/** Scroll `el` so its top sits just under the sticky nav. The nav is measured, never assumed:
 * its height differs by width and by what it holds. */
export function revealElement(el: HTMLElement): void {
	const nav = document.querySelector('nav.nav')?.getBoundingClientRect().height ?? 0;
	window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - nav - 8 });
}

/** The class a section focused on arrival wears (src/app.css): no focus outline, since the
 * glow already marks it and an outline would outstay the glow. */
export const FOCUS_CLASS = 'section-arrival-target';

/** Give `el` focus without scrolling, so the next Tab and a screen reader carry on from the
 * section rather than from the top of the page. Focusable by script only (tabindex -1), so it
 * joins no tab order. */
export function focusSection(el: HTMLElement): void {
	if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
	el.classList.add(FOCUS_CLASS);
	el.focus({ preventScroll: true });
}

const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/** Make `el` glow once. It waits until the tab is visible - a link opened in a background tab
 * would otherwise glow unseen - and a second call restarts it rather than stacking. */
export function glowSection(el: HTMLElement): void {
	const start = () => {
		clearTimeout(timers.get(el));
		el.classList.remove(GLOW_CLASS);
		void el.offsetWidth; // a reflow, so the animation starts again from its first frame
		el.classList.add(GLOW_CLASS);
		timers.set(el, setTimeout(() => el.classList.remove(GLOW_CLASS), GLOW_MS));
	};
	if (document.visibilityState === 'visible') return start();
	const onVisible = () => {
		if (document.visibilityState !== 'visible') return;
		document.removeEventListener('visibilitychange', onVisible);
		start();
	};
	document.addEventListener('visibilitychange', onVisible);
}

/** Whether this document was opened fresh - a followed link, a typed address - rather than
 * reloaded or restored by Back and Forward. Those keep the reader's own scroll, so the page
 * must not jump to the section again. */
export function openedFresh(): boolean {
	const entry = performance.getEntriesByType?.('navigation')?.[0] as PerformanceNavigationTiming | undefined;
	return !entry || entry.type === 'navigate';
}

/** P1 (the operator's choice, 2026-10-19): on a phone the link icon is drawn on one card at a
 * time - of the sections with an address, the one whose heading is wholly on screen below the
 * sticky nav and nearest the top. Null when no such heading is on screen. A heading with no
 * height is not laid out (display: none), wherever its box claims to be. */
export function nearestTop(
	heads: readonly { name: string; top: number; bottom: number }[],
	navBottom: number,
	viewportHeight: number
): string | null {
	let best: { name: string; top: number } | null = null;
	for (const h of heads) {
		if (h.bottom <= h.top || h.top < navBottom || h.bottom > viewportHeight) continue;
		if (!best || h.top < best.top) best = h;
	}
	return best?.name ?? null;
}
