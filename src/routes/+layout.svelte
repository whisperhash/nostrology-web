<script>
	import '../app.css';
	import { onMount } from 'svelte';
	import { env } from '$env/dynamic/public';
	import { initAnalytics } from '$lib/analytics/ga';
	import { hasFloatingTabBar } from '$lib/analytics/badge';
	import { hydrate } from '$lib/auth/session';

	/**
	 * Server-verified Nostr session from +layout.server.ts (the cookie's HMAC).
	 *
	 * Hydrating the session store HERE rather than in (app)/+layout.svelte is deliberate:
	 * the landing page renders its own chrome outside that group, so a store hydrated
	 * there would leave the landing nav showing "Log in" to a logged-in user. This is a
	 * global concern, which is exactly what this layout is for.
	 *
	 * Analytics deliberately does NOT learn the pubkey: shipping a permanent public Nostr
	 * identity to Google was rejected.
	 */
	export let data;

	// ONCE, on mount, in the browser only. NOT `$: hydrate(data.session)` - see hydrate()'s
	// doc comment: that form both re-fires on every client-side navigation with a stale
	// `data.session` (logging the user out) and runs during SSR (firing a third-party
	// fetch per render and mutating a store shared across concurrent requests).
	onMount(() => {
		void hydrate(data.session ?? null);
	});

	// The ROOT layout is deliberately chrome-free: global stylesheet, analytics, and
	// the analytics-off badge, nothing else. The site's nav and footer live one level down
	// in (app)/+layout.svelte, which every route except the landing page renders
	// inside. That split exists because the landing page (src/routes/+page.svelte)
	// ships its own nav and footer in its own palette, and SvelteKit gives no way to
	// opt a route OUT of the root layout - so the shared chrome had to move into a
	// group the landing simply does not belong to. Route URLs are unchanged: a
	// directory in parentheses contributes nothing to the path.
	//
	// Anything that must apply to EVERY page, landing included, belongs here.

	// GA4 Measurement ID (`G-XXXXXXXXXX`), a PUBLIC value injected at runtime by the dev
	// compose. Empty => analytics stays dormant (local dev / not-yet-configured), so no code
	// path here fires until the env var is set. See src/lib/analytics/ga.ts for the design.
	const GA_MEASUREMENT_ID = env.PUBLIC_GA_MEASUREMENT_ID ?? '';

	// Drives the "analytics off" badge below: the server rendered this page for the
	// operator's session (hooks.server.ts), so GA stays unloaded and the badge shows. The
	// one way to be excluded; nothing in the URL or in browser storage can do it.
	// Legacy-mode reactive `let` (reassigned in onMount) - kept out of runes so the
	// component's `<slot />` stays valid.
	let analyticsOff = false;

	// iPhone Safari's floating tab bar reserves ~16px above the pill it draws and clips fixed
	// elements at the top of that band, so in portrait there the badge sits right on that
	// edge (bottom: 0) instead of 12px above it (see $lib/analytics/badge.ts).
	let badgeNudged = false;

	onMount(() => {
		// Decided once per full page load. Signing in or out as the operator reloads the page
		// ($lib/auth/session) so that this decision is made again.
		analyticsOff = data.analyticsOff === true;
		badgeNudged = hasFloatingTabBar(navigator.userAgent);
		initAnalytics(GA_MEASUREMENT_ID, { excluded: analyticsOff });
		// SPA route changes are measured by GA4 Enhanced Measurement (it hooks the History
		// API, which SvelteKit uses) - no manual page_view here, to avoid double-counting.
	});
</script>

<slot />

{#if analyticsOff}
	<!-- Only ever rendered for the operator's signed-in session - a private confirmation
	     that analytics are off. Fixed-position, so it sits correctly over the landing page
	     and the app chrome alike. Deliberately just a yellow dot in the bubble: the words
	     are visually hidden (sr-only, so a screen reader still reads them) and the title is
	     the hover tooltip, on a desktop only (touch browsers never show a title). The dot
	     says the page is excluded from analytics, not that the access log tags it: that is
	     the operator marker cookie's job, checked in the log. scripts/verify-ga.mjs measures
	     the dot in a real browser; the unit test cannot, because jsdom computes no CSS. -->
	<div
		class="fixed bottom-3 left-3 z-50 rounded-full border border-gray-700 bg-gray-800/90 p-1.5 shadow-lg {badgeNudged ? 'portrait:bottom-0' : ''}"
		title="Operator browser - excluded from analytics"
		data-testid="analytics-off-badge"
	>
		<span class="block h-2 w-2 rounded-full bg-yellow-400/80" aria-hidden="true" data-testid="analytics-off-dot"></span>
		<span class="sr-only">Analytics off in this browser</span>
	</div>
{/if}
