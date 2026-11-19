// Google Analytics 4 (gtag.js) integration.
//
// Wired from the root layout so every page is measured. Two design points worth
// calling out, because both are easy to get subtly wrong:
//
//  1. SPA page views are left to GA4 Enhanced Measurement (on by default). It
//     fires the initial page_view AND one on every History API change — and
//     SvelteKit's client router navigates via history.pushState, so in-app route
//     changes are captured out of the box. We deliberately do NOT also send
//     manual page_views: doing so would DOUBLE-COUNT every client navigation
//     against Enhanced Measurement's, and suppressing that from code isn't
//     possible (it's a server-side GA setting). One config, one page_view/route.
//
//  2. The operator is excluded without relying on IP (GA4's built-in "internal
//     traffic" filter keys off IP, useless behind rotating VPN exits). The server
//     decides it from the verified session (hooks.server.ts: signed in as the
//     operator), and the root layout passes `excluded: true`. Nobody else can switch
//     analytics off on this site: there is no query parameter or stored flag for it.
//     Excluded, GA is never loaded: no script tag, no network call to Google.
//
// This module is deliberately free of `$app/environment` / `$env` imports so it
// is a pure, unit-testable unit (see ga.test.ts). The measurement id is passed
// in by the layout, which owns the `$env/dynamic/public` read. Guards use
// `typeof window` so the functions are safe under SSR and exercisable in jsdom.

type GtagWindow = Window & typeof globalThis & {
	dataLayer?: unknown[];
	gtag?: (...args: unknown[]) => void;
};

/**
 * Load gtag.js and configure GA4 for `measurementId` — UNLESS we're not in a
 * browser, analytics is unconfigured (empty id), or the page was rendered for the
 * operator's session (`excluded`).
 * Idempotent: a second call once gtag is present is a no-op.
 */
export function initAnalytics(measurementId: string, options: { excluded?: boolean } = {}): void {
	if (typeof window === 'undefined' || typeof document === 'undefined') return;
	if (!measurementId) return; // not configured (e.g. local dev, unset env var)
	if (options.excluded) return; // the operator's session - load nothing at all
	const w = window as GtagWindow;
	if (typeof w.gtag === 'function') return; // already initialized this session

	w.dataLayer = w.dataLayer || [];
	// MUST be a `function` pushing its own `arguments` object - never an arrow with a
	// rest array. gtag.js only treats a dataLayer entry as a COMMAND when the entry is
	// arguments-like; its queue processor tests
	//     Object.prototype.toString.call(x) === '[object Arguments]'
	//       || Object.prototype.hasOwnProperty.call(x, 'callee')
	// and sends anything that fails down a legacy "call a method by dotted path" branch:
	// `['config','G-...']` becomes `h=[]`, `k='config'`, `p=DA('')`, and since resolving the
	// empty path yields undefined, the `if (p != null)` guard drops the command outright.
	// (There is a bare `catch` behind that guard, but it never even runs - traced through
	// gtag.js's `DA` -> `AA.get` -> `zA`, which does `''.split('.')` and returns undefined.)
	// A rest array therefore FAILS COMPLETELY SILENTLY: gtag.js still loads, window.gtag
	// still exists, dataLayer still fills up - and not one hit is ever sent, because the
	// property is never configured. That was live on this site from the GA4 rollout until
	// 2026-08-23; see ga.test.ts, which now pins the entry TYPE and not just its contents.
	// Do not "modernize" this into an arrow function.
	const gtag = function (): void {
		// eslint-disable-next-line prefer-rest-params
		w.dataLayer!.push(arguments);
	} as (...args: unknown[]) => void;
	w.gtag = gtag;
	gtag('js', new Date());
	// Default config sends the initial page_view; Enhanced Measurement carries the
	// rest (incl. SvelteKit's pushState client navigations). See the header note.
	gtag('config', measurementId);

	const script = document.createElement('script');
	script.async = true;
	script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
	document.head.appendChild(script);
}
