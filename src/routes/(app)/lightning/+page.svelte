<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import LeaderboardTable from '$lib/components/LeaderboardTable.svelte';
	import PeriodSelector from '$lib/components/PeriodSelector.svelte';
	import CumulativeLineChart from '$lib/components/CumulativeLineChart.svelte';
	import LightningProviderRankTable from '$lib/components/LightningProviderRankTable.svelte';
	import type { LightningProviderStat, LightningTrendsRow } from '$lib/shared/data-types';
	import { getProviderColor } from '$lib/utils/providerColors';
	import type { PageData } from './$types';
	import SocialMeta from '$lib/components/SocialMeta.svelte';

	export let data: PageData;

	// Yield to the browser between marking "pending" and the heavy buildRows +
	// DOM reconciliation so the loading overlay actually paints. Mirrors the
	// pattern in /relays.
	function nextPaint(): Promise<void> {
		if (!browser) return Promise.resolve();
		return new Promise((resolve) => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
		});
	}

	// ─── Leaderboard threshold (existing v0 behavior — unchanged) ────────
	const userThresholds = [
		{ value: '1', label: '1+' },
		{ value: '10', label: '10+' },
		{ value: '100', label: '100+' },
		{ value: '1000', label: '1k+' },
		{ value: '10000', label: '10k+' }
	];
	const STORAGE_KEY = 'lightning:minUsers';
	let minUsers = 100;
	let persistReady = false;

	type TrendRange = '30d' | '3m' | '6m' | '1y';
	type TrendSeries = Array<{
		label: string;
		color: string;
		data: Array<{ timestamp: number; value: number; secondaryValue?: number }>;
	}>;

	const TREND_RANGE_OPTIONS = [
		{ value: '30d', label: '30D' },
		{ value: '3m', label: '3M' },
		{ value: '6m', label: '6M' },
		{ value: '1y', label: '1Y' }
	] satisfies Array<{ value: TrendRange; label: string }>;
	const TREND_RANGE_STORAGE_KEY = 'lightning:trendRange';
	let trendRange: TrendRange = '3m';

	// ─── Shared selectors for the trend charts ────────────────────────────
	// All three trend charts share the same top-N provider selector and
	// trailing-range selector, keeping the visual story consistent across
	// charts. The server fetches a fixed top-20 candidate pool; this
	// selector picks the visible subset (5/10/20) client-side, by each
	// chart's own most-recent-date value (same metric used for legend
	// ordering). Persisted in localStorage (no URL param), matching the
	// /zapstore leaderboards selector pattern.
	const TOP_N_OPTIONS = [
		{ value: '5',  label: 'Top 5' },
		{ value: '10', label: 'Top 10' },
		{ value: '20', label: 'Top 20' }
	];
	const TOP_N_VALUES = [5, 10, 20];
	const TOP_N_STORAGE_KEY = 'lightning:topN';
	let topN = 10;

	function changeTopN(next: string) {
		const n = Number(next);
		if (!TOP_N_VALUES.includes(n) || n === topN) return;
		topN = n;
		if (browser) localStorage.setItem(TOP_N_STORAGE_KEY, next);
	}

	function changeTrendRange(next: string) {
		if (!TREND_RANGE_OPTIONS.some((option) => option.value === next)) return;
		trendRange = next as TrendRange;
		if (browser) localStorage.setItem(TREND_RANGE_STORAGE_KEY, trendRange);
	}

	onMount(() => {
		// Leaderboard threshold persistence.
		const savedMin = localStorage.getItem(STORAGE_KEY);
		const m = savedMin === null ? NaN : Number(savedMin);
		if (Number.isFinite(m) && userThresholds.some((t) => t.value === String(m))) {
			minUsers = m;
		}
		persistReady = true;

		const savedTopN = localStorage.getItem(TOP_N_STORAGE_KEY);
		if (savedTopN !== null) {
			const n = Number(savedTopN);
			if (TOP_N_VALUES.includes(n)) topN = n;
		}

		const savedTrendRange = localStorage.getItem(TREND_RANGE_STORAGE_KEY);
		if (savedTrendRange !== null) changeTrendRange(savedTrendRange);
	});

	$: if (persistReady) localStorage.setItem(STORAGE_KEY, String(minUsers));

	$: selectedLabel = userThresholds.find((t) => t.value === String(minUsers))?.label ?? '1+';

	function formatNumber(n: number): string {
		return n.toLocaleString();
	}

	function filterProviders(providers: LightningProviderStat[], min: number): LightningProviderStat[] {
		return providers.filter((p) => p.user_count >= min);
	}

	function buildRows(providers: LightningProviderStat[], maxUsers: number) {
		return providers.map((p) => [
			{
				label: p.domain,
				barFraction: p.user_count / maxUsers
			},
			formatNumber(p.user_count)
		]);
	}

	const LARGE_ROW_COUNT = 1500;
	const EARLY_HINT_DELAY_MS = 200;
	let currentRows: ReturnType<typeof buildRows> = [];
	let filteredCount = 0;
	let initialLoaded = false;
	let loadFailed = false;
	let showLoadingHint = false;
	let buildToken = 0;

	async function rebuild(
		source: Promise<LightningProviderStat[]> | LightningProviderStat[],
		threshold: number
	): Promise<void> {
		const myToken = ++buildToken;

		let earlyTimer: ReturnType<typeof setTimeout> | null = null;
		if (browser) {
			earlyTimer = setTimeout(() => {
				if (myToken === buildToken) showLoadingHint = true;
			}, EARLY_HINT_DELAY_MS);
		}

		try {
			const providers = await Promise.resolve(source);
			if (myToken !== buildToken) return;

			const filtered = filterProviders(providers, threshold);
			const maxUsers = providers[0]?.user_count ?? 1;
			if (browser && !showLoadingHint && filtered.length > LARGE_ROW_COUNT) {
				showLoadingHint = true;
				await nextPaint();
				if (myToken !== buildToken) return;
			}

			currentRows = buildRows(filtered, maxUsers);
			filteredCount = filtered.length;
			initialLoaded = true;
			loadFailed = false;
		} catch (err) {
			// Same as /relays: say the query failed in place of the rows, and only for the
			// current build.
			if (myToken === buildToken) {
				loadFailed = true;
				currentRows = [];
				console.error('[lightning] could not load the provider table', err);
			}
		} finally {
			if (myToken === buildToken) {
				if (earlyTimer !== null) clearTimeout(earlyTimer);
				showLoadingHint = false;
			}
		}
	}

	// Browser only, for the reason given in /relays: on the server a rejected rebuild()
	// would exit Node and take every page down (failed-query.ssr.test.ts).
	$: if (browser) void rebuild(data.providers, minUsers);

	// ─── Trend-chart series construction ─────────────────────────────────
	// Convert flat (day, provider, value) rows from the SQL into the
	// CumulativeLineChart series shape: one entry per provider, with data
	// sorted by timestamp. Stable per-provider colors via providerColors.
	function isoDateToUnixSecondsNoonUtc(iso: string): number {
		// 'YYYY-MM-DD' → seconds since epoch at noon UTC of that day. Noon
		// (not midnight) keeps the chart's date axis labels unambiguous when
		// the user's local timezone shifts the rendered date.
		return Math.floor(new Date(iso + 'T12:00:00Z').getTime() / 1000);
	}

	function buildTrendSeries(rows: LightningTrendsRow[]) {
		// Bucket by provider. The SQL still computes an 'other' aggregate
		// (so share percentages remain "% of all zaps received" rather than
		// "% of top-N"); we drop the 'other' bucket here so it neither shows
		// as a line nor appears in the legend.
		const grouped = new Map<string, Array<{ timestamp: number; value: number }>>();
		for (const r of rows) {
			if (r.provider === 'other') continue;
			if (!grouped.has(r.provider)) grouped.set(r.provider, []);
			grouped.get(r.provider)!.push({
				timestamp: isoDateToUnixSecondsNoonUtc(r.day),
				value: r.value
			});
		}
		return Array.from(grouped, ([provider, data]) => ({
			label: provider,
			color: getProviderColor(provider),
			data: data.sort((a, b) => a.timestamp - b.timestamp)
		}));
	}

	// Row shape consumed by LightningProviderRankTable for the share charts.
	// `extraValue` is the absolute snapshot value at the latest date (sats
	// for the sats-share table, zap count for the zap-share table) — the
	// component renders it through the caller-supplied `extraColumn` config.
	type ShareRankRow = {
		provider: string;
		color: string;
		latestPct: number;
		extraValue?: number;
		rankDelta: number;
	};

	// Build the rank-table rows that sit beside a share-% chart.
	//
	// `rangedPool` is the full top-20 candidate set after range filtering
	// (the chart can render any of these), `visibleSeries` is the post-top-N
	// subset actually drawn. We compute ranks within `rangedPool` so that a
	// provider that JUST entered the visible top-N still has a meaningful
	// rank delta vs. period start (e.g. "↑3" coming from rank-7).
	//
	// If `absoluteSeries` is supplied (the same providers' rolling-30d
	// absolute series — sats for the sats-share table, zap count for the
	// zap-share table), each row's `extraValue` is the latest-date value
	// for that provider.
	function buildShareRankTableRows(
		rangedPool: TrendSeries,
		visibleSeries: TrendSeries,
		absoluteSeries?: TrendSeries
	): ShareRankRow[] {
		if (rangedPool.length === 0 || visibleSeries.length === 0) return [];

		// Calendar CROSS JOIN in SQL guarantees every provider has a row for
		// every day → first/last timestamps are the same across the pool.
		const allTs: number[] = [];
		for (const s of rangedPool) for (const p of s.data) allTs.push(p.timestamp);
		if (allTs.length === 0) return [];
		const firstTs = Math.min(...allTs);
		const lastTs = Math.max(...allTs);

		const valuesAtFirst = new Map<string, number>();
		const valuesAtLast = new Map<string, number>();
		for (const s of rangedPool) {
			valuesAtFirst.set(s.label, s.data.find((p) => p.timestamp === firstTs)?.value ?? 0);
			valuesAtLast.set(s.label, s.data.find((p) => p.timestamp === lastTs)?.value ?? 0);
		}

		const rankAtFirst = new Map<string, number>();
		[...rangedPool]
			.sort((a, b) => (valuesAtFirst.get(b.label) ?? 0) - (valuesAtFirst.get(a.label) ?? 0))
			.forEach((s, i) => rankAtFirst.set(s.label, i + 1));
		const rankAtLast = new Map<string, number>();
		[...rangedPool]
			.sort((a, b) => (valuesAtLast.get(b.label) ?? 0) - (valuesAtLast.get(a.label) ?? 0))
			.forEach((s, i) => rankAtLast.set(s.label, i + 1));

		// Optional join: latest-date absolute value per provider, from the
		// absolute-metric series. The latest date here is the absolute
		// series's own most-recent timestamp (same calendar as the share
		// series, so it lines up with the snapshot the table is showing).
		const latestExtraByProvider = new Map<string, number>();
		if (absoluteSeries && absoluteSeries.length > 0) {
			const allAbsTs: number[] = [];
			for (const s of absoluteSeries) for (const p of s.data) allAbsTs.push(p.timestamp);
			if (allAbsTs.length > 0) {
				const latestAbsTs = Math.max(...allAbsTs);
				for (const s of absoluteSeries) {
					const v = s.data.find((p) => p.timestamp === latestAbsTs)?.value;
					if (v !== undefined) latestExtraByProvider.set(s.label, v);
				}
			}
		}

		return visibleSeries.map((s) => ({
			provider: s.label,
			color: s.color,
			latestPct: valuesAtLast.get(s.label) ?? 0,
			extraValue: latestExtraByProvider.get(s.label),
			rankDelta: (rankAtFirst.get(s.label) ?? 0) - (rankAtLast.get(s.label) ?? 0)
		}));
	}

	// Per-chart ranking: order series by their value on the most-recent
	// emitted date (descending), then slice to top-N. Chart.js renders the
	// legend in dataset-array order, so this controls legend ordering too.
	// Rationale: matches the user's stated preference of legend-by-latest-
	// value, and keeps the top-N selection consistent with that ordering.
	function rankAndPickTopN(series: TrendSeries, n: number): TrendSeries {
		if (series.length === 0) return series;
		const latestTimestamp = Math.max(
			...series.flatMap((s) => s.data.map((p) => p.timestamp))
		);
		if (!Number.isFinite(latestTimestamp)) return series;
		return series
			.map((s) => ({
				series: s,
				score: s.data.find((p) => p.timestamp === latestTimestamp)?.value ?? 0
			}))
			.sort((a, b) => b.score - a.score)
			.slice(0, n)
			.map((x) => x.series);
	}

	function getUtcShiftedTimestamp(timestamp: number, monthsBack: number): number {
		const source = new Date(timestamp * 1000);
		const targetMonthStart = new Date(
			Date.UTC(source.getUTCFullYear(), source.getUTCMonth() - monthsBack, 1, 12, 0, 0)
		);
		const lastDayOfTargetMonth = new Date(
			Date.UTC(
				targetMonthStart.getUTCFullYear(),
				targetMonthStart.getUTCMonth() + 1,
				0,
				12,
				0,
				0
			)
		).getUTCDate();
		const targetDay = Math.min(source.getUTCDate(), lastDayOfTargetMonth);
		return Math.floor(
			Date.UTC(
				targetMonthStart.getUTCFullYear(),
				targetMonthStart.getUTCMonth(),
				targetDay,
				12,
				0,
				0
			) / 1000
		);
	}

	function getUtcShiftedDaysTimestamp(timestamp: number, daysBack: number): number {
		const source = new Date(timestamp * 1000);
		return Math.floor(
			Date.UTC(
				source.getUTCFullYear(),
				source.getUTCMonth(),
				source.getUTCDate() - daysBack,
				12,
				0,
				0
			) / 1000
		);
	}

	function filterTrendSeriesByRange(series: TrendSeries, range: TrendRange): TrendSeries {
		const latestTimestamp = Math.max(
			...series.flatMap((provider) => provider.data.map((point) => point.timestamp))
		);
		if (!Number.isFinite(latestTimestamp)) return series;

		const startTimestamp =
			range === '30d'
				? getUtcShiftedDaysTimestamp(latestTimestamp, 30)
				: getUtcShiftedTimestamp(latestTimestamp, range === '3m' ? 3 : range === '6m' ? 6 : 12);

		return series
			.map((provider) => ({
				...provider,
				data: provider.data.filter((point) => point.timestamp >= startTimestamp)
			}))
			.filter((provider) => provider.data.length > 0);
	}

	// Y-axis formatter for the share charts.
	const formatPercent = (n: number): string => `${n.toFixed(1)}%`;

	// Compact number formatter shared by both share charts' rank-table
	// "extra" column and chart-tooltip secondary value. Same scale at a
	// glance, so the table and tooltip read in the same units.
	function compactNumber(n: number): string {
		if (!Number.isFinite(n)) return '—';
		if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
		if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
		if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
		return Math.trunc(n).toLocaleString();
	}
	const formatSatsForTooltip = (n: number): string => `${compactNumber(n)} sats`;
	const formatZapsForTooltip = (n: number): string => `${compactNumber(n)} zaps`;

	// Annotate each point of `primary` with the matching `secondary` value
	// keyed on (label, timestamp). Used to surface the absolute metric
	// (sats or zap count) in each share chart's tooltip without touching
	// the chart's y-axis.
	function enrichWithSecondary(
		primary: TrendSeries,
		secondary: TrendSeries
	): TrendSeries {
		const lookup = new Map<string, Map<number, number>>();
		for (const s of secondary) {
			const m = new Map<number, number>();
			for (const p of s.data) m.set(p.timestamp, p.value);
			lookup.set(s.label, m);
		}
		return primary.map((s) => ({
			...s,
			data: s.data.map((p) => ({
				timestamp: p.timestamp,
				value: p.value,
				secondaryValue: lookup.get(s.label)?.get(p.timestamp)
			}))
		}));
	}
</script>

<SocialMeta
	title="Nostrology - Lightning"
	socialTitle="Nostr Lightning providers"
	description="Which Lightning providers sign Nostr zaps, ranked by receipts and volume, measured from actual events."
/>

<div class="space-y-8">
	<div>
		<h1 class="text-3xl font-bold text-white mb-2">Lightning</h1>
		<p class="text-gray-400 mb-3">Lightning provider trends on Nostr.</p>
	</div>

	<!-- Trend charts: shared range + top-N selectors. Two share-% charts
	     (sats-share on top, zap-share below), each paired with a rank table
	     (rank, provider, latest %, an "absolute" column — Sats for sats-share,
	     Zaps for zap-share — and rank Δ since period start). Each chart's
	     tooltip also shows the absolute counterpart per provider alongside %.
	     Per-provider colors are stable across both charts so a given provider
	     reads as the same color on each. -->

	<div class="space-y-6">
		<div class="flex items-center justify-between gap-4 flex-wrap">
			<div class="flex items-center gap-3">
				<PeriodSelector
					selected={trendRange}
					onChange={changeTrendRange}
					periods={TREND_RANGE_OPTIONS}
				/>
			</div>
			<div class="flex items-center gap-3">
				<span class="text-gray-400">Providers</span>
				<PeriodSelector
					selected={String(topN)}
					onChange={changeTopN}
					periods={TOP_N_OPTIONS}
				/>
			</div>
		</div>

		<p class="text-gray-400">Lightning provider share by total sats received.</p>

		{#await Promise.all([data.trendsSatsShare, data.trendsSatsAbsolute])}
			<div class="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
				<div
					class="bg-gray-800 rounded-lg p-4 border border-gray-700 lg:col-span-2"
					style="height: 432px"
				></div>
				<div
					class="bg-gray-800 rounded-lg p-4 border border-gray-700"
					style="height: 432px"
				></div>
			</div>
		{:then [shareRowsRaw, absRowsRaw]}
			{@const baseSeries = buildTrendSeries(shareRowsRaw)}
			{@const ranged = filterTrendSeriesByRange(baseSeries, trendRange)}
			{@const visibleSeries = rankAndPickTopN(ranged, topN)}
			{@const absSeries = buildTrendSeries(absRowsRaw)}
			{@const enrichedSeries = enrichWithSecondary(visibleSeries, absSeries)}
			{@const tableRows = buildShareRankTableRows(ranged, visibleSeries, absSeries)}
			<div class="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
				<div class="bg-gray-800 rounded-lg p-4 border border-gray-700 lg:col-span-2">
					{#key `sats-share-${trendRange}-${topN}`}
						<CumulativeLineChart
							title="Provider sats-share — rolling 30-day, % of sats received"
							yAxisLabel="% share"
							heightPx={400}
							legendPosition="bottom"
							formatValue={formatPercent}
							formatSecondaryValue={formatSatsForTooltip}
							series={enrichedSeries}
						/>
					{/key}
				</div>
				<div
					class="bg-gray-800 rounded-lg p-4 border border-gray-700"
					style="height: 432px"
				>
					<LightningProviderRankTable
						rows={tableRows}
						extraColumn={{
							header: 'Sats',
							formatValue: compactNumber,
							titleText:
								"Latest rolling-30-day sats received (snapshot of the chart's most-recent date)"
						}}
					/>
				</div>
			</div>
		{:catch}
			<!-- Same layout as the placeholder above, so the page does not reflow; and the
			     {:catch} itself matters: without one, Svelte rethrows in the browser. Both
			     blocks here await a Promise.all, a new promise that settles a tick late, so
			     they need no {#key} (see the Svelte 5.51 note in /relays). -->
			<div class="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
				<div
					class="bg-gray-800 rounded-lg p-4 border border-gray-700 lg:col-span-2 flex items-center justify-center text-sm italic text-gray-500"
					style="height: 432px"
				>
					Chart data unavailable.
				</div>
				<div
					class="bg-gray-800 rounded-lg p-4 border border-gray-700"
					style="height: 432px"
				></div>
			</div>
		{/await}

		<p class="text-gray-400">Lightning provider share by count of zaps.</p>

		{#await Promise.all([data.trendsZapShare, data.trendsZapsAbsolute])}
			<div class="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
				<div
					class="bg-gray-800 rounded-lg p-4 border border-gray-700 lg:col-span-2"
					style="height: 432px"
				></div>
				<div
					class="bg-gray-800 rounded-lg p-4 border border-gray-700"
					style="height: 432px"
				></div>
			</div>
		{:then [shareRowsRaw, absRowsRaw]}
			{@const baseSeries = buildTrendSeries(shareRowsRaw)}
			{@const ranged = filterTrendSeriesByRange(baseSeries, trendRange)}
			{@const visibleSeries = rankAndPickTopN(ranged, topN)}
			{@const absSeries = buildTrendSeries(absRowsRaw)}
			{@const enrichedSeries = enrichWithSecondary(visibleSeries, absSeries)}
			{@const tableRows = buildShareRankTableRows(ranged, visibleSeries, absSeries)}
			<div class="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
				<div class="bg-gray-800 rounded-lg p-4 border border-gray-700 lg:col-span-2">
					{#key `zap-share-${trendRange}-${topN}`}
						<CumulativeLineChart
							title="Provider zap-share — rolling 30-day, % of zaps received"
							yAxisLabel="% share"
							heightPx={400}
							legendPosition="bottom"
							formatValue={formatPercent}
							formatSecondaryValue={formatZapsForTooltip}
							series={enrichedSeries}
						/>
					{/key}
				</div>
				<div
					class="bg-gray-800 rounded-lg p-4 border border-gray-700"
					style="height: 432px"
				>
					<LightningProviderRankTable
						rows={tableRows}
						extraColumn={{
							header: 'Zaps',
							formatValue: compactNumber,
							titleText:
								"Latest rolling-30-day zap count (snapshot of the chart's most-recent date)"
						}}
					/>
				</div>
			</div>
		{:catch}
			<div class="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
				<div
					class="bg-gray-800 rounded-lg p-4 border border-gray-700 lg:col-span-2 flex items-center justify-center text-sm italic text-gray-500"
					style="height: 432px"
				>
					Chart data unavailable.
				</div>
				<div
					class="bg-gray-800 rounded-lg p-4 border border-gray-700"
					style="height: 432px"
				></div>
			</div>
		{/await}
	</div>

	<!-- Existing leaderboard (kind-0 lud16 snapshot) — unchanged below. -->
	<div class="space-y-3">
		<div class="flex justify-between items-center">
			<p class="text-gray-400">
				{#if loadFailed}
					Provider data unavailable - reload the page to try again.
				{:else if initialLoaded}
					{formatNumber(filteredCount)} {filteredCount === 1 ? 'provider' : 'providers'} with {selectedLabel} users.
				{/if}
			</p>
			<div class="flex items-center gap-3">
				<span class="text-gray-400">Lightning users</span>
				<PeriodSelector
					selected={String(minUsers)}
					onChange={(v) => (minUsers = Number(v))}
					periods={userThresholds}
				/>
			</div>
		</div>
		<div class="relative">
			{#if showLoadingHint}
				<div
					class="absolute left-1/2 -translate-x-1/2 -top-5 text-gray-400 text-sm pointer-events-none"
				>
					Loading…
				</div>
			{/if}
			<LeaderboardTable
				headers={['Provider', 'Users']}
				rows={currentRows}
				sortable={true}
				defaultSortIndex={1}
				defaultSortDirection="desc"
				minHeightPx={600}
			/>
		</div>
	</div>
</div>
