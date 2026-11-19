<script>
	import { page } from '$app/stores';
	import { visibleNavItems } from '$lib/nav';
	import { seesUnreleased } from '$lib/unreleased';
	import { session } from '$lib/auth/session';

	// Errors used to render inside the site chrome, because the chrome WAS the root
	// layout. Moving it into the (app) group (so the landing page could opt out) left
	// unmatched URLs - every 404 from a scanner, a stale link or a typo - rendering
	// SvelteKit's bare fallback on an empty dark page with no way onward. This is the
	// replacement: it lives at the root, so it covers both the landing page and every
	// (app) route that has no closer +error.svelte, and it carries the nav itself
	// rather than depending on a layout it may not be inside.
	//
	// Deliberately DB-free: a 404 is exactly the request we least want to spend a query
	// on. $lib/nav is a plain static array, so reading it costs nothing at request time.
	//
	// It USED to hand-copy that array, and drifted: the nav gained Marketplaces and
	// dropped Relays on 2026-08-22, and this page kept offering the buried page while
	// omitting the new one - so the surface whose entire job is "here is where to go
	// instead" pointed at the wrong set. Importing removes that failure mode for good.
	//
	// Gated the same way as the nav and the footer. There is no `data` on an error page,
	// so this reads the store alone and therefore shows an unreleased destination only
	// AFTER hydration, for the operator - never in the server-rendered HTML. That asymmetry
	// is the right way round: a 404 page is the last place to publish an entrance the nav
	// hides.
	$: LINKS = visibleNavItems(seesUnreleased($session.hydrated ? $session : null));
</script>

<svelte:head>
	<title>{$page.status} - nostrolo.gy</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="min-h-screen bg-gray-900 flex flex-col items-center justify-center px-4 py-16 text-center">
	<a href="/" class="flex items-center gap-3 mb-10">
		<img src="/nostr-logo.png" alt="" class="h-10 w-auto" />
		<span class="text-xl font-bold text-white">nostrolo&middot;gy</span>
	</a>

	<p class="font-mono text-sm text-teal-300 mb-3">{$page.status}</p>
	<h1 class="text-3xl font-bold text-white mb-3">
		{$page.status === 404 ? 'No such page' : 'Something went wrong'}
	</h1>
	<p class="text-gray-400 max-w-md mb-10">
		{$page.status === 404
			? 'That URL does not match anything on this site.'
			: ($page.error?.message ?? 'An unexpected error occurred.')}
	</p>

	<div class="flex flex-wrap items-center justify-center gap-2">
		{#each LINKS as link}
			<a
				href={link.href}
				class="px-4 py-2 rounded-md text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
			>
				{link.label}
			</a>
		{/each}
	</div>
</div>
