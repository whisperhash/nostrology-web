<script lang="ts">
	import AppLeaderboardCard from '$lib/components/AppLeaderboardCard.svelte';
	import PublisherLeaderboardCard from '$lib/components/PublisherLeaderboardCard.svelte';
	import McpDerivableNote from '$lib/components/McpDerivableNote.svelte';
	import type { PageData } from './$types';
	import SocialMeta from '$lib/components/SocialMeta.svelte';

	export let data: PageData;
</script>

<SocialMeta
	title="Nostrology - Zapstore - Leaderboards"
	socialTitle="Zapstore leaderboards"
	description="The most-zapped Zapstore apps and publishers, ranked from actual events."
/>

<div class="space-y-10">
	<section class="space-y-4">
		<h2 class="text-2xl font-bold text-white">Apps</h2>
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
			<!-- Each card is wrapped so its MCP note sits under ITS card. The
			     wrapper is itself a 1fr/auto grid: the card fills the 1fr row
			     (restoring the equal-height stretch the cards had as direct
			     grid items - a plain wrapper div left them content-sized and
			     the pair uneven), the note takes the auto row. -->
			<div class="grid grid-rows-[1fr_auto]">
				<AppLeaderboardCard
					title="App Stack Appearances"
					data={data.appStackLeaderboards}
					metric="stacks"
					storageKey="zapstore.leaderboards.stacks"
				/>
				<McpDerivableNote metrics={['app_stack_count']} />
			</div>
			<div class="grid grid-rows-[1fr_auto]">
				<AppLeaderboardCard
					title="Zaps"
					data={data.appLeaderboards}
					metric="zaps"
					storageKey="zapstore.leaderboards.zaps"
				/>
				<McpDerivableNote metrics={['app_zaps']} />
			</div>
		</div>
	</section>

	<section class="space-y-4">
		<h2 class="text-2xl font-bold text-white">Publishers</h2>
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
			<div class="grid grid-rows-[1fr_auto]">
				<PublisherLeaderboardCard
					title="Total Apps"
					metric="apps"
					appData={data.publisherAppCounts}
				/>
				<McpDerivableNote metrics={['publisher_app_count']} />
			</div>
			<div class="grid grid-rows-[1fr_auto]">
				<PublisherLeaderboardCard
					title="Total Zaps"
					metric="zaps"
					zapData={data.publisherZapLeaderboards}
					storageKey="zapstore.leaderboards.publisher.zaps"
				/>
				<!-- Card 4 is app_zaps filtered to is_nostr_native and grouped by
				     publisher_pubkey - one metric serves both zap cards. -->
				<McpDerivableNote metrics={['app_zaps']} />
			</div>
		</div>
	</section>
</div>
