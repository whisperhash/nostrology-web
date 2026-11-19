<script lang="ts">
	import { page } from '$app/stores';
	import PillBar from '$lib/components/PillBar.svelte';
	import { pillAt } from '$lib/slug-table';
	import { NUTZAPS_SLUGS } from '$lib/slug-tables/nutzaps';

	// The pill bar sits here, in the layout every pill's page shares, so the clicked link
	// survives the navigation and keeps the focus. Each of /nutzaps' pills is a page of its own,
	// so the open pill is the address's (`pillAt`: at a section's address, its pill's).
	$: current = pillAt(NUTZAPS_SLUGS, $page.url.pathname);
</script>

<div class="space-y-6">
	<h1 class="text-3xl font-bold text-white">Nutzaps</h1>

	<!-- The pill bar (PillBar, from $lib/slug-tables/nutzaps): each pill a page of its own. -->
	<PillBar table={NUTZAPS_SLUGS} {current} label="Nutzaps" />

	<slot />
</div>
