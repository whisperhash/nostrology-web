<script lang="ts">
	// A domain page's pill bar: one link per pill of its slug table, in the table's order, each
	// to the pill's own address (/git/hosting; the default pill's is the domain's, /git).
	// Links, not buttons, since pills have addresses (2026-10-19): a click is a SvelteKit
	// navigation, so Back returns to the previous pill, and a pill opens in a new tab or has its
	// link copied like any link. The open pill is marked aria-current="page" at its own address,
	// as the main nav marks the open domain, and aria-current="true" at a section's address on it
	// (/git/zaps opens Collaboration, whose link goes to /git/collaboration: the open item of the
	// set, not the page the link is to). $lib/domain-page has the rest of the story.
	//
	// The page passes `onPick` to open the pill at once on a plain click: the router's
	// navigation then follows with the server's answer for the address, which names the same
	// pill. It is told whether the click was the keyboard's (Enter on the focused link), whose
	// focus stays on the pill and so must stay on screen. A click that opens a new tab or window
	// (a modifier key, the middle button) is the browser's alone and opens nothing here.
	//
	// Each link:
	//   - keeps the scroll (data-sveltekit-noscroll) where the pills are parts of one page: the
	//     reader stays where they were, as with the buttons before. Where each pill is a page of
	//     its own (a table with an `ownRoute` pill: /zapstore, /nutzaps) a new page starts at its
	//     top, as any page does. Read from the table, not passed in, so no page can get it wrong
	//     (a domain mixing the two kinds of pill, which none does, would want it per link);
	//   - keeps focus on itself (data-sveltekit-keepfocus), so the keyboard carries on from
	//     the pill bar;
	//   - never preloads (data-sveltekit-preload-data="off"). The site preloads a link's data
	//     on hover and on touchstart (app.html), and a preload is logged like a visit: hovering
	//     across the pill bar, or a finger landing on a pill to scroll the page, would put
	//     visits to pills nobody opened in the request log. Only a click asks the server.
	import { page } from '$app/stores';
	import { addressOf, type SlugTable } from '$lib/slug-table';

	/** The domain's slug table: the pills and their order. */
	export let table: SlugTable;
	/** The open pill's slug. */
	export let current: string;
	/** The navigation landmark's name, for a screen reader: the domain's own. */
	export let label: string;
	/** Opens a pill at once on a plain click (DomainPage's `pick`); `byKeyboard` for Enter. */
	export let onPick: ((slug: string, byKeyboard: boolean) => void) | undefined = undefined;
	/** Classes for the bar's placement on the page. */
	let className = '';
	export { className as class };

	/** Whether a click keeps the scroll: where the pills are parts of one page, not pages of their own. */
	$: keepScroll = !table.pills.some((p) => p.ownRoute);

	/** How the open pill is marked: the page itself at its own address, the open item elsewhere. */
	const currentness = (slug: string, open: string, path: string | undefined) =>
		slug !== open ? undefined : path === addressOf(table, slug) ? 'page' : 'true';

	function clicked(e: MouseEvent, slug: string) {
		if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		// a click with no pointer behind it (detail 0) is Enter on the focused link
		onPick?.(slug, e.detail === 0);
	}
</script>

<nav aria-label={label} class="inline-flex flex-wrap gap-1 rounded-lg border border-gray-700 bg-gray-800 p-1 {className}">
	{#each table.pills as p (p.slug)}
		<!-- No `transition-colors`: the open pill's colours flip during a navigation, and a CSS
		     transition on that class swap can re-trigger mid-animation, a purple flicker on the
		     pill that was open (seen on /zapstore's and /nutzaps' bars before this one). -->
		<a
			href={addressOf(table, p.slug)}
			id="tab-{p.slug}"
			aria-current={currentness(p.slug, current, $page?.url?.pathname)}
			data-sveltekit-noscroll={keepScroll ? '' : 'false'}
			data-sveltekit-keepfocus
			data-sveltekit-preload-data="off"
			on:click={(e) => clicked(e, p.slug)}
			class="rounded-md px-4 py-1.5 text-base font-medium
				{p.slug === current ? 'bg-nostr-purple text-white' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}"
		>
			{p.label}
		</a>
	{/each}
</nav>
