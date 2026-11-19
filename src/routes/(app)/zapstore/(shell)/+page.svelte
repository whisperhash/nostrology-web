<script lang="ts">
	import CumulativeLineChart from '$lib/components/CumulativeLineChart.svelte';
	import DailyBarChart from '$lib/components/DailyBarChart.svelte';
	import PerAppZapChart from '$lib/components/PerAppZapChart.svelte';
	import McpDerivableNote from '$lib/components/McpDerivableNote.svelte';
	import type { PageData } from './$types';
	import SocialMeta from '$lib/components/SocialMeta.svelte';
	import TransientNote from '$lib/components/TransientNote.svelte';
	import { domainPage } from '$lib/domain-page';
	import { ZAPSTORE_SLUGS } from '$lib/slug-tables/zapstore';

	export let data: PageData;
	// The shared logic of a domain page ($lib/domain-page): here, the note for a link whose
	// slug the server did not know - it sends those here with a 302 (found) and `#gone`.
	const { note } = domainPage(ZAPSTORE_SLUGS, () => data.target);
</script>

<SocialMeta
	title="Nostrology - Zapstore"
	socialTitle="The Zapstore app economy"
	description="Zapstore app publishing and zap activity measured end to end, from actual events."
/>

<TransientNote text={$note} />

<div class="space-y-8">
	<div>
		<h2 class="text-2xl font-bold text-white mb-2">Zapstore Apps</h2>
		<p class="text-gray-400">
			Total number of apps in Zapstore over time.
		</p>
	</div>

	<!-- All three lines are running sums of the two daily new-app series, whose
	     partitions are exact complements: native + republished = total. -->
	<div>
		<CumulativeLineChart
			title="Zapstore Apps"
			yAxisLabel="Cumulative Apps"
			series={[
				{ label: 'Total', data: data.total, color: '#1abc9c' },
				{ label: 'Nostr-native', data: data.native, color: '#9b59b6' },
				{ label: 'Republished from GitHub / F-Droid', data: data.github, color: '#3498db' }
			]}
		/>
		<McpDerivableNote metrics={['new_native_app_count', 'new_republished_app_count']} />
	</div>

	<div>
		<h2 class="text-2xl font-bold text-white mb-2">Nostr-native Share</h2>
		<p class="text-gray-400">
			Cumulative Nostr-native apps as a share of the total Zapstore catalog over the past year.
		</p>
	</div>

	<!-- Ratio of the two running sums above, so the same pair of metrics yields it. -->
	<div>
		<CumulativeLineChart
			title="Nostr-native Apps as % of Total"
			yAxisLabel="% of catalog"
			series={[{ label: 'Nostr-native share', data: data.nativeShare.daily, color: '#9b59b6' }]}
			formatValue={(n) => `${n.toFixed(1)}%`}
		/>
		<McpDerivableNote metrics={['new_native_app_count', 'new_republished_app_count']} />
	</div>

	<div>
		<h2 class="text-2xl font-bold text-white mb-2">App Releases</h2>
		<p class="text-gray-400">
			Daily Zapstore app releases.
		</p>
	</div>

	<!-- Visual layout: two stack keys, three bar series.
		Stack 'releases' (default) sums vertically on each x: native (purple,
		bottom) + republished (blue, top). Their combined height is the day's
		total release events. Stack 'new-native' is independent: yellow draws
		from y=0 with its own height = newNative count, overlaying the lower
		portion of the purple bar. Because newNative ≤ native always, yellow
		never sticks out the top of purple. Bar draw order is dataset-array
		order at the same Chart.js order: native → new-native → republished,
		so yellow paints over purple's bottom; blue paints in its own y-range
		above purple. Yellow does NOT add to the total bar height — it only
		covers part of the purple. `includeInTotal: false` on new-native keeps
		it out of the teal grand-total rolling-average line so that line
		traces native+republished, not double-counted. -->
	<!-- Three bar series, three metrics: the two release counts stack to the day's
	     total, and the yellow overlay is the new-native APP count (a dedupe of the
	     native releases, hence bounded by it). -->
	<div>
		<DailyBarChart
			title="App Releases"
			datasets={[
				{ label: 'Nostr-native', color: '#9b59b6', series: data.releasesDaily.native },
				{
					label: 'New Nostr-native',
					color: '#f1c40f',
					series: data.releasesDaily.newNative,
					stack: 'new-native',
					includeInTotal: false
				},
				{ label: 'Republished from GitHub / F-Droid', color: '#3498db', series: data.releasesDaily.github }
			]}
			yAxisLabel="Daily releases"
			rollingAverageWindow={30}
			totalLineColor="#1abc9c"
		/>
		<McpDerivableNote
			metrics={['native_release_count', 'new_native_app_count', 'republished_release_count']}
		/>
	</div>

	<div>
		<h2 class="text-2xl font-bold text-white mb-2">Zapstore Zaps</h2>
		<p class="text-gray-400">
			All Zapstore-attributed zaps.
		</p>
	</div>

	<!-- Bars are zap_count, the cumulative line is the running sum of zapped_msats
	     converted to sats once at the end. Proven exactly reproducible from the two
	     series, all 366 points - see the metrics' own chart-reproduction caveat. -->
	<div>
		<PerAppZapChart
			title="Zapstore Zaps"
			dailySeries={data.aggZaps.daily}
			cumulativeSeries={data.aggZaps.cumulative}
			dailyLabel="Daily zap count"
			cumulativeLabel="Cumulative sats"
			dailyColor="#3498db"
			cumulativeColor="#f39c12"
			rightAxisLabel="Cumulative sats"
			heightPx={357}
		/>
		<McpDerivableNote metrics={['zap_count', 'zapped_msats']} />
	</div>

	<div class="flex justify-center pt-2">
		<a
			href="/zapstore/leaderboards"
			class="inline-flex items-center px-4 py-1.5 text-base font-medium rounded-md bg-nostr-purple text-white hover:opacity-90 transition-opacity"
		>
			Leaderboards →
		</a>
	</div>
</div>
