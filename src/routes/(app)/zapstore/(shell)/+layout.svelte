<script lang="ts">
	import { page } from '$app/stores';
	import PillBar from '$lib/components/PillBar.svelte';
	import { pillAt } from '$lib/slug-table';
	import { ZAPSTORE_SLUGS } from '$lib/slug-tables/zapstore';

	// The pill bar sits here, in the layout every pill's page shares, so the clicked link
	// survives the navigation and keeps the focus. Each of /zapstore's pills is a page of its own,
	// so the open pill is the address's (`pillAt`: at a section's address, its pill's).
	$: current = pillAt(ZAPSTORE_SLUGS, $page.url.pathname);
</script>

<div class="space-y-6">
	<div class="flex items-center gap-3">
		<img src="/zapstore/ic_launcher.png" alt="" class="w-10 h-10 rounded-lg" />
		<h1 class="text-3xl font-bold text-white">Zapstore</h1>
	</div>

	<!-- The pill bar (PillBar, from $lib/slug-tables/zapstore): each pill a page of its own. -->
	<PillBar table={ZAPSTORE_SLUGS} {current} label="Zapstore" />

	<div class="text-gray-400 text-sm space-y-1">
		<p>
			<span class="text-gray-300 font-medium">Nostr-native</span> — published by the app's own developer, under their own Nostr identity.
		</p>
		<p>
			<span class="text-gray-300 font-medium">Republished from GitHub / F-Droid</span> — republished from GitHub / F-Droid by the main Zapstore account.
		</p>
	</div>

	<slot />
</div>
