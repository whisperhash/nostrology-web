<script lang="ts">
	// A repository's label - its `name`, else its `d` identifier - linked to its viewer
	// (repoUrl: git.iris.to for the hashtree class, gitworkshop.dev otherwise; npub encoded
	// client-side). A pubkey that is not 64-hex gets no link at all rather than a broken one.
	// Third-party text: Svelte escapes it, repoLabel() removes the control and format
	// characters that would reorder or hide it (falling back to the identifier when nothing
	// visible is left), <bdi> isolates it, and the identifier is percent-encoded in the URL.
	import { repoLabel } from '$lib/ngit/format';
	import { repoUrl } from '$lib/ngit/links';

	export let pubkey: string;
	export let d: string;
	export let name: string;
	/** The repository's hosting class; absent from leaderboard rows before 2026-10-09. */
	export let cls: string | undefined = undefined;
	/** Break the label anywhere, for a table with no horizontal scroll (the Stars and Zaps
	 * cards). `break-words` only breaks a word that overflows after layout; it does not lower
	 * the cell's min-content width, so an 80-character name with no break in it widened a
	 * 300 px table to 613 px (measured in Chrome, 2026-10-18). `anywhere` does, and it has to
	 * be on this element: set on the cell, it would be inherited and then overridden here. */
	export let wrapAnywhere = false;

	$: href = repoUrl(pubkey, d, cls);
	$: wrap = wrapAnywhere ? '[overflow-wrap:anywhere]' : 'break-words';
	$: label = repoLabel({ name, d });
</script>

{#if href}
	<a
		{href}
		target="_blank"
		rel="noopener noreferrer"
		class="{wrap} text-gray-100 underline decoration-gray-600 underline-offset-2 transition-colors hover:text-nostr-gold hover:decoration-nostr-gold"
		><bdi>{label}</bdi></a
	>
{:else}
	<span class="{wrap} text-gray-100"><bdi>{label}</bdi></span>
{/if}
