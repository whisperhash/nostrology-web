<script lang="ts">
	import { onMount } from 'svelte';
	import CumulativeLineChart from '$lib/components/CumulativeLineChart.svelte';
	import LeaderboardTable from '$lib/components/LeaderboardTable.svelte';
	import PeriodSelector from '$lib/components/PeriodSelector.svelte';
	import type { NutzapMintStatsPeriod } from '$lib/shared/data-types';
	import type { PageData } from './$types';
	import SocialMeta from '$lib/components/SocialMeta.svelte';
	import { mintHref, mintLabel } from '$lib/utils/mintUrl';

	export let data: PageData;

	// 20-color FlatUI-style categorical palette, applied in rank order — the
	// top mint by 365d sats gets MINT_COLORS[0], etc. Picked for distinct hues
	// that all read on the dark gray-900 background. Excluded:
	//   - Orange family (#f39c12, #e67e22) — clashes with the chart's orange
	//     y-axis ticks/title.
	//   - Purple family (#9b59b6, #8e44ad, #a29bfe, #6c5ce7) — purple is the
	//     Nostr brand color (`nostr-purple`) and reserved for app chrome.
	// The first 10 entries are ordered for max hue distinctiveness, since the
	// default selector view is Top 10. Rank 11–20 fill in with closer hues.
	const MINT_COLORS = [
		'#3498db', // blue
		'#e74c3c', // red
		'#2ecc71', // green
		'#f1c40f', // yellow
		'#e84393', // pink
		'#1abc9c', // turquoise
		'#bdc3c7', // silver
		'#fd79a8', // light pink
		'#5dade2', // light blue
		'#16a085', // green sea
		'#27ae60', // nephritis
		'#2980b9', // belize hole
		'#c0392b', // pomegranate
		'#00cec9', // cyan
		'#55efc4', // mint
		'#74b9ff', // sky blue
		'#ff7675', // coral red
		'#7f8c8d', // concrete gray
		'#00b894', // teal-green
		'#dfe6e9'  // pearl
	];

	const TOP_MINTS_COUNTS = [
		{ value: '5', label: 'Top 5' },
		{ value: '10', label: 'Top 10' },
		{ value: '20', label: 'Top 20' }
	];
	const TOP_MINTS_STORAGE_KEY = 'topMintsCount:nutzaps';
	const VALID_TOP_MINTS_COUNTS = new Set(TOP_MINTS_COUNTS.map((c) => c.value));
	let topMintsCount = '10';

	function changeTopMintsCount(next: string) {
		if (!VALID_TOP_MINTS_COUNTS.has(next) || next === topMintsCount) return;
		topMintsCount = next;
		localStorage.setItem(TOP_MINTS_STORAGE_KEY, next);
	}

	const periods = [
		{ value: '7d', label: '7D' },
		{ value: '30d', label: '30D' },
		{ value: '1y', label: '1Y' },
		{ value: 'all', label: 'All' }
	];

	const STORAGE_KEY = 'period:nutzaps';
	const ZERO_SATS_STORAGE_KEY = 'includeZeroSats:nutzaps';
	const VALID_PERIODS = new Set(periods.map((p) => p.value));

	let currentPeriod = data.period;
	let mintStats = data.mintStats;
	let includeZeroSats = false;
	let loading = false;

	// Only flip `loading=true` if the fetch takes longer than this threshold —
	// avoids a flicker on instant responses (which is the common case for this
	// dataset). 200 ms is the human "feels instant" boundary (Nielsen).
	const LOADING_INDICATOR_DELAY_MS = 200;

	function formatNumber(n: number): string {
		return n.toLocaleString();
	}

	function formatSats(sats: number): string {
		if (sats === 0) return '0 sats';
		return `${sats.toLocaleString()} sats`;
	}


	async function changePeriod(period: string) {
		if (!VALID_PERIODS.has(period) || period === currentPeriod) return;
		const next = period as NutzapMintStatsPeriod;
		currentPeriod = next;
		localStorage.setItem(STORAGE_KEY, next);
		const indicatorTimer = setTimeout(() => {
			loading = true;
		}, LOADING_INDICATOR_DELAY_MS);
		try {
			const response = await fetch(`/api/nutzaps?period=${next}`);
			const result = await response.json();
			mintStats = result.items;
		} catch (error) {
			console.error(`Failed to load nutzaps for period=${next}:`, error);
		} finally {
			clearTimeout(indicatorTimer);
			loading = false;
		}
	}

	onMount(() => {
		const savedPeriod = localStorage.getItem(STORAGE_KEY);
		if (savedPeriod && VALID_PERIODS.has(savedPeriod) && savedPeriod !== currentPeriod) {
			changePeriod(savedPeriod);
		}
		const savedZeroSats = localStorage.getItem(ZERO_SATS_STORAGE_KEY);
		if (savedZeroSats === 'true') includeZeroSats = true;
		const savedTopMintsCount = localStorage.getItem(TOP_MINTS_STORAGE_KEY);
		if (savedTopMintsCount && VALID_TOP_MINTS_COUNTS.has(savedTopMintsCount)) {
			topMintsCount = savedTopMintsCount;
		}
	});

	function toggleIncludeZeroSats() {
		localStorage.setItem(ZERO_SATS_STORAGE_KEY, includeZeroSats ? 'true' : 'false');
	}

	$: visibleStats = includeZeroSats
		? mintStats
		: mintStats.filter((m) => m.total_amount_sats > 0);

	$: rows = visibleStats.map((m) => [
		// LeaderboardTable renders {label, href} cells as in-table links. The label
		// keeps the port; the link keeps the scheme (mintUrl.ts). A windowed view can
		// list a mint on one config, which has no page: that row gets no link.
		m.has_page ? { label: mintLabel(m.mint_url), href: mintHref(m.mint_url) } : mintLabel(m.mint_url),
		formatNumber(m.config_count),
		formatNumber(m.payment_count),
		formatSats(m.total_amount_sats)
	]);
</script>

<SocialMeta
	title="Nostrology - Nutzap Mints"
	socialTitle="Cashu mints, by nutzap activity"
	description="Which Cashu mints carry Nostr nutzap traffic, ranked by activity and unique users."
/>

<div class="space-y-8">
	<div>
		<p class="text-gray-400 mb-2">
			Cumulative sats transacted on Nostr per Nutzap mint in the past year.
		</p>
		<div class="flex justify-end mb-2">
			<PeriodSelector
				selected={topMintsCount}
				onChange={changeTopMintsCount}
				periods={TOP_MINTS_COUNTS}
			/>
		</div>
		{#key topMintsCount}
			<CumulativeLineChart
				title="Cumulative sats by mint"
				yAxisLabel="Cumulative sats"
				yAxisColor="#f39c12"
				compactAxis
				legendPosition="bottom"
				heightPx={420}
				series={data.topMintsCumulative.slice(0, parseInt(topMintsCount)).map((m, i) => ({
					label: mintLabel(m.mint_url),
					color: MINT_COLORS[i % MINT_COLORS.length],
					data: m.daily.map((d) => ({
						timestamp: d.timestamp,
						value: d.cumulative_sats
					}))
				}))}
			/>
		{/key}
	</div>

	<div class="space-y-3 pt-4">
		<p class="text-gray-400">
			"Configured By" counts users whose latest kind-10019 (nutzap-configs) accepts the
			mint.
			"Payments" counts kind-9321 (nutzaps) events through the mint that carry
			Cashu ecash in their proof tags, the NIP-61 (nutzaps) form; "Total Amount" is the
			face value of that ecash. Test mints such as testnut.cashu.space and mints on
			private or loopback hosts such as 127.0.0.1 are not counted or listed.
		</p>
		<div class="flex justify-end items-center gap-4">
			<span class="text-gray-400 text-sm transition-opacity" class:opacity-0={!loading}>
				<span class="inline-block animate-spin">⚡</span> Loading…
			</span>
			<label class="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
				<span>Include 0-sat mints</span>
				<button
					type="button"
					role="switch"
					aria-checked={includeZeroSats}
					aria-label="Include 0-sat mints"
					on:click={() => { includeZeroSats = !includeZeroSats; toggleIncludeZeroSats(); }}
					class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors {includeZeroSats ? 'bg-purple-600' : 'bg-gray-600'}"
				>
					<span
						class="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform {includeZeroSats ? 'translate-x-4' : 'translate-x-1'}"
					></span>
				</button>
			</label>
			<PeriodSelector selected={currentPeriod} onChange={changePeriod} {periods} />
		</div>
		<LeaderboardTable
			headers={['Mint', 'Configured By', 'Payments', 'Total Amount']}
			{rows}
			sortable={true}
			defaultSortIndex={3}
			defaultSortDirection="desc"
		/>
	</div>
</div>
