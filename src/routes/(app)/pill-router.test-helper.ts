import { afterEach, beforeEach } from 'vitest';

// A pill is a link (PillBar), and SvelteKit's router takes a link's click over in a listener of
// its own, after the link's own handler. A page test has no router, so this stands in for it on
// the pill links: it records where each pill click was headed and, as the router does, keeps
// jsdom from trying to follow the link (jsdom implements no navigation and says so on stderr).
// A click the page cancelled itself is not the router's, so it is not recorded.
//
// Call it at the top level of a test file; the clicks of each test are in `routed`.
export function standInPillRouter(): { routed: string[] } {
	const state = { routed: [] as string[] };
	const router = (e: Event) => {
		const a = (e.target as Element).closest('a[id^="tab-"]');
		if (!a || e.defaultPrevented) return;
		state.routed.push(a.getAttribute('href')!);
		e.preventDefault();
	};
	beforeEach(() => {
		state.routed = [];
		document.addEventListener('click', router);
	});
	afterEach(() => document.removeEventListener('click', router));
	return {
		get routed() {
			return state.routed;
		}
	};
}
