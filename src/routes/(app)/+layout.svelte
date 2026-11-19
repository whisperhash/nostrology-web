<script>
	import SiteNav from '$lib/components/SiteNav.svelte';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	/**
	 * The server-verified Nostr session, from +layout.server.ts (cookie HMAC). Passed to
	 * the nav so the SERVER-RENDERED html already shows the right thing.
	 *
	 * The session STORE is hydrated in the ROOT layout, not here - the landing page lives
	 * outside this group and needs the same treatment.
	 */
	export let data;

	// The site chrome for every route EXCEPT the landing page, which renders the same
	// two components itself (it sits outside this group so it can drop the container
	// and run full-bleed).
	//
	// The nav and footer used to be written out here in Tailwind - a gray-800 bar with
	// a two-line brand, and a centred footer. They were replaced by the landing page's
	// chrome, moved into $lib/components, so the whole site reads as one product
	// rather than as a landing page bolted onto something else. Nav ITEMS live in
	// $lib/nav.ts; there is no second copy to keep in sync any more.
	//
	// `container mx-auto px-4` is passed through so the bar and the footer align with
	// the content width THIS layout uses. The landing passes its own narrower wrap.
	//
	// Global concerns (app.css, analytics, the analytics-off badge) stay in the ROOT layout
	// so the landing page gets them too - do not move them back here.
</script>

<div class="min-h-screen bg-gray-900 flex flex-col">
	<SiteNav container="container mx-auto px-4" ssrSession={data.session ?? null} />

	<!-- The TOP gutter is responsive: 32px above an h1 is a lot of nothing on a phone,
	     where vertical space is the scarce resource, so it halves to 16px below the sm
	     breakpoint and sits at 24px above it. -->
	<main class="container mx-auto px-4 flex-1 pt-4 sm:pt-6 pb-8">
		<slot />
	</main>

	<SiteFooter container="container mx-auto px-4" ssrSession={data.session ?? null} />
</div>
