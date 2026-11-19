<script lang="ts">
	import ActiveUsersChart from '$lib/components/ActiveUsersChart.svelte';
	import PerAppZapChart from '$lib/components/PerAppZapChart.svelte';
	import type { PageData } from './$types';
	import SocialMeta from '$lib/components/SocialMeta.svelte';
	import TransientNote from '$lib/components/TransientNote.svelte';
	import { domainPage } from '$lib/domain-page';
	import { NUTZAPS_SLUGS } from '$lib/slug-tables/nutzaps';

	export let data: PageData;
	// The shared logic of a domain page ($lib/domain-page): here, the note for a link whose
	// slug the server did not know - it sends those here with a 302 (found) and `#gone`.
	const { note } = domainPage(NUTZAPS_SLUGS, () => data.target);

	$: satsDaily = data.dailySeries.map((d) => ({ timestamp: d.timestamp, value: d.daily_sats }));
	$: satsCumulative = data.dailySeries.map((d) => ({
		timestamp: d.timestamp,
		value: d.cumulative_sats
	}));
	$: countDaily = data.dailySeries.map((d) => ({ timestamp: d.timestamp, value: d.daily_count }));
	$: countCumulative = data.dailySeries.map((d) => ({
		timestamp: d.timestamp,
		value: d.cumulative_count
	}));
</script>

<SocialMeta
	title="Nostrology - Nutzaps"
	socialTitle="Nutzaps on Nostr"
	description="Cashu nutzap activity on Nostr: senders, receivers, mints and volume, measured from actual events."
/>

<TransientNote text={$note} />

<div class="space-y-8">
	<div>
		<p class="text-gray-400 mb-2">
			The number of Nutzap transactions on Nostr across all mints in the past year.
		</p>
		<PerAppZapChart
			title="Nutzap Payments"
			dailySeries={countDaily}
			cumulativeSeries={countCumulative}
			dailyLabel="Daily payments"
			cumulativeLabel="Cumulative payments"
			dailyColor="#8e44ad"
			cumulativeColor="#1abc9c"
			rightAxisLabel="Cumulative payments"
		/>
	</div>

	<div class="pt-4">
		<p class="text-gray-400 mb-2">
			The amount of Nutzap sats transacted on Nostr across all mints in the past year:
			the face value of the Cashu ecash each nutzap carries in its proof tags. Test mints
			such as testnut.cashu.space and mints on private or loopback hosts are not counted.
		</p>
		<PerAppZapChart
			title="Nutzap Sats"
			dailySeries={satsDaily}
			cumulativeSeries={satsCumulative}
			dailyLabel="Daily sats"
			cumulativeLabel="Cumulative sats"
			dailyColor="#3498db"
			cumulativeColor="#f39c12"
			rightAxisLabel="Cumulative sats"
		/>
	</div>

	<div class="pt-4">
		<p class="text-gray-400 mb-2">
			The number of Nutzap active users on Nostr in the past year.
		</p>
		<ActiveUsersChart
			title="Nutzap Active Users"
			granularity="month"
			heightPx={280}
			wrapInCard={false}
			titleAbove={true}
			series={[{ label: 'Monthly Active Users', data: data.nutzapsMAU, color: '#e74c3c' }]}
		/>
	</div>
</div>
