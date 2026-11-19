<script lang="ts">
	import SocialMeta from '$lib/components/SocialMeta.svelte';
	// WIP index (/wip). These pages live at top-level URLs but are
	// intentionally NOT linked from any public page — reachable only from here or
	// by direct URL. (They still appear in the client route manifest — this is
	// obscurity, not true concealment.)
	const links = [
		{ href: '/zapstore/apps', label: 'Zapstore - All Apps' },
		// Buried rather than retired: /relays still builds, still gets its data,
		// and is unchanged. It just left the top-level nav on 2026-08-22.
		{ href: '/relays', label: 'Relay topology' },
		// Incubating (2026-08-24): full domain page, daily Dagster refresh, but not
		// yet in the top-level nav - graduation moves it to nav.ts + the landing's board
		// and REMOVES it from here.
		{ href: '/routstr', label: 'Routstr - AI-inference marketplace' }
		// Git on Nostr incubated here from 2026-09-25 and graduated on 2026-10-15: into the nav
		// and the landing's board, and out of this list, in one change.
	];
</script>

<SocialMeta
	title="Nostrology - Work in Progress / Experimental"
	socialTitle="Nostrology - work in progress"
	description="Experimental and in-progress Nostrology surfaces."
	noindex
/>

<div class="space-y-6">
	<h1 class="text-2xl font-bold text-white">Work in Progress / Experimental</h1>
	<ul class="list-none space-y-2 pl-0">
		{#each links as link}
			<li>
				<a
					href={link.href}
					class="text-nostr-purple hover:text-nostr-gold transition-colors"
				>
					{link.label}
				</a>
			</li>
		{/each}
	</ul>
</div>
