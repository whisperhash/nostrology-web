<script lang="ts">
	// The /routstr domain: the Routstr AI-inference marketplace (routstr.com) measured
	// from the Nozzl event archive. The server load hands this page the newest
	// routstr_snapshot row - the full dataset as ONE precomputed document, written
	// daily by nostrology-data's routstr_refresh Dagster job (pipeline/routstr.py).
	// Nothing on this page is computed per-request, and nothing renders that is not
	// in the snapshot (msats -> sats display conversion aside). The independent
	// cross-check of the numbers is nostrology-data's crosscheck/build_routstr_snapshot.py +
	// compare_routstr_snapshots.py.
	//
	// The usage numbers are SELF-REPORTED by each provider's node, in its
	// kind-38422 (routstr-analytics-snapshots) events, and unverifiable by construction -
	// the page says so wherever they appear.
	import { browser } from '$app/environment';
	import type { RoutstrSnapshot } from '$lib/shared/data-types';
	import { sortInk } from '$lib/sort-ink';
	import { METHODOLOGY } from '$lib/methodology';
	import PillBar from '$lib/components/PillBar.svelte';
	import TransientNote from '$lib/components/TransientNote.svelte';
	import { domainPage } from '$lib/domain-page';
	import { addressOf, pageTitle, type Target } from '$lib/slug-table';
	import { ROUTSTR_SLUGS } from '$lib/slug-tables/routstr';
	import MethodologySection from '$lib/components/MethodologySection.svelte';
	import LineChart from '$lib/components/markets/LineChart.svelte';
	import HBar from '$lib/components/markets/HBar.svelte';
	import Donut from '$lib/components/markets/Donut.svelte';
	import DailyBarChart from '$lib/components/DailyBarChart.svelte';
	import CumulativeLineChart from '$lib/components/CumulativeLineChart.svelte';
	import PeriodSelector from '$lib/components/PeriodSelector.svelte';
	import SocialMeta from '$lib/components/SocialMeta.svelte';
	import McpDerivableNote from '$lib/components/McpDerivableNote.svelte';
	import {
		defaultDir,
		foldProviderSeries,
		sortProviders,
		type ProviderSortKey,
		type SortDir
	} from '$lib/routstr/provider-series';

	/** `target`: what the address names, as the server answered it ($lib/slug-table) - the
	 * page is served at every /routstr/<slug> too. Absent where a test passes a snapshot
	 * alone, which is the bare /routstr. */
	export let data: { snapshot: RoutstrSnapshot; target?: Target };
	// Bound once at init. A move between this page's addresses (a pill click) keeps this
	// component and hands it new `data`, but the same snapshot: the layout's load, which
	// fetches it, does not run again (+layout.server.ts). Only `data.target` is read again
	// ($lib/domain-page); the derived consts below would not track `data` if it changed.
	const D = data.snapshot;

	// The pills are /routstr's slug table's (ROUTSTR_SLUGS), and so is everything about which
	// one is open, What is counted and the note: $lib/domain-page, shared by every domain page.
	// They are client-side rather than routes of their own because all four read the same
	// embedded snapshot - four routes would ship four copies of it - but each has an address
	// (/routstr/providers), answered by the server like any other.
	const { tab, methodologyOpen, note, pick } = domainPage(ROUTSTR_SLUGS, () => data.target);

	const n = (v: number) => v.toLocaleString('en-US');
	const sat = (msats: number) => Math.round(msats / 1000);
	const compact = (v: number) =>
		v >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M'
		: v >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : String(v);
	const s = D.summary;

	const BTC_ORANGE = '#f7931a';
	// One palette for every stacked chart; "(others)" always takes the neutral slate.
	// 20 hues so a Top-20 provider stack never repeats a color.
	const STACK_COLORS = [
		'#a78bfa', '#2dd4bf', '#60a5fa', '#f472b6', '#fbbf24', '#34d399',
		'#fb7185', '#38bdf8', '#c084fc', '#facc15', '#4ade80', '#f97316',
		'#818cf8', '#e879f9', '#22d3ee', '#a3e635', '#f87171', '#7dd3fc',
		'#d946ef', '#fde68a'
	];
	const OTHERS_COLOR = '#64748b';

	const dayTs = (d: string) => Date.parse(d + 'T00:00:00Z') / 1000;

	// Network daily revenue as a single bar series (sats/day).
	const revenueDaily = [
		{
			label: 'Revenue',
			color: BTC_ORANGE,
			series: D.daily.map((r) => ({ timestamp: dayTs(r.d), value: sat(r.msats) }))
		}
	];
	const requestsDaily = [
		{
			label: 'Requests',
			color: '#a78bfa',
			series: D.daily.map((r) => ({ timestamp: dayTs(r.d), value: r.req }))
		}
	];
	const tokensDaily = D.daily.map((r) => ({ d: r.d, v: r.tok }));

	// Stacked daily revenue by top providers / models: DailyBarChart zips datasets
	// index-by-index, so each sparse series is expanded to the full contiguous day
	// range of the network series (zero where absent).
	const allDays = D.daily.map((r) => r.d);
	function expand(series: { d: string; msats: number }[]) {
		const m = new Map(series.map((p) => [p.d, p.msats]));
		return allDays.map((d) => ({ timestamp: dayTs(d), value: sat(m.get(d) ?? 0) }));
	}
	const stackColor = (i: number, id: string) =>
		id === '(others)' ? OTHERS_COLOR : STACK_COLORS[i % STACK_COLORS.length];

	// Provider series ship rank-ordered (top 20 by 30d revenue) plus the pipeline's
	// "(others)" residual; the selector folds ranks N+1.. into that residual here. The
	// pipeline pins `sum(provider_daily_top) == daily` per day, so the fold is exact.
	const TOP_N_OPTIONS = [
		{ value: '5', label: 'Top 5' },
		{ value: '10', label: 'Top 10' },
		{ value: '20', label: 'Top 20' }
	];
	const TOP_N_VALUES = [5, 10, 20];
	const CHART_OPTIONS = [
		{ value: 'bars', label: 'Bars' },
		{ value: 'lines', label: 'Lines' }
	];
	const TOP_N_KEY = 'routstr:providersTopN';
	const CHART_KEY = 'routstr:providersChart';
	let providersTopN = 5;
	let providersChart: 'bars' | 'lines' = 'bars';
	if (browser) {
		try {
			const n = Number(localStorage.getItem(TOP_N_KEY));
			if (TOP_N_VALUES.includes(n)) providersTopN = n;
			const c = localStorage.getItem(CHART_KEY);
			if (c === 'bars' || c === 'lines') providersChart = c;
		} catch {
			// storage blocked: defaults stand
		}
	}
	function changeProvidersTopN(next: string) {
		const n = Number(next);
		if (!TOP_N_VALUES.includes(n)) return;
		providersTopN = n;
		try {
			localStorage.setItem(TOP_N_KEY, next);
		} catch {
			// ignore
		}
	}
	function changeProvidersChart(next: string) {
		if (next !== 'bars' && next !== 'lines') return;
		providersChart = next;
		try {
			localStorage.setItem(CHART_KEY, next);
		} catch {
			// ignore
		}
	}
	function providerStackFor(n: number) {
		return foldProviderSeries(D.provider_daily_top, n).map((p, i) => ({
			label: p.name,
			color: stackColor(i, p.id),
			series: expand(p.series)
		}));
	}
	const modelStack = D.model_daily_top.map((p, i) => ({
		label: p.id,
		color: stackColor(i, p.id),
		series: expand(p.series)
	}));

	const cumRevenue = D.cum_revenue.map((p) => ({ d: p.d, v: sat(p.msats) }));
	const catalogHistory = D.catalog.history.map((p) => ({ d: p.d, v: p.n }));

	const CLASS_LABEL: Record<string, string> = {
		clearnet: 'Clearnet',
		onion: 'Tor only',
		both: 'Clearnet + Tor',
		'private-only': 'Private endpoints only',
		none: 'No usable endpoint'
	};
	const POSITIVE = new Set(['trusted', 'verified', 'lgtm']);
	function reviewColor(label: string | null): string {
		if (label === null) return 'text-gray-500';
		return POSITIVE.has(label) ? 'text-emerald-400' : 'text-red-400';
	}

	const transportRows = D.transports.map((t) => ({
		label: CLASS_LABEL[t.k] ?? t.k,
		value: t.v
	}));
	const transportColors = D.transports.map(
		(t, i) => ({ both: '#a78bfa', clearnet: '#2dd4bf', onion: '#60a5fa' })[t.k]
			?? ['#f472b6', '#fbbf24', '#64748b'][i % 3]
	);

	const includedProviders = D.providers.filter((p) => !p.excluded);
	// "All providers" table sort: click a header to sort by it, click again to flip.
	const PROVIDER_COLUMNS: { key: ProviderSortKey; label: string; right?: boolean }[] = [
		{ key: 'name', label: 'Provider' },
		{ key: 'class', label: 'Endpoint' },
		{ key: 'version', label: 'Version' },
		{ key: 'review', label: 'Review' },
		{ key: 'first_seen', label: 'First seen' },
		{ key: 'last_report', label: 'Last report' },
		{ key: 'msats_30d', label: 'Sats (30d)', right: true },
		{ key: 'msats_alltime', label: 'Sats (all-time)', right: true }
	];
	let sortKey: ProviderSortKey = 'msats_30d';
	let sortDir: SortDir = 'desc';
	function toggleSort(key: ProviderSortKey) {
		if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else {
			sortKey = key;
			sortDir = defaultDir(key);
		}
	}
	$: sortedProviders = sortProviders(includedProviders, sortKey, sortDir);
	const excludedProviders = D.providers.filter((p) => p.excluded);
	const providerLeaderboard = includedProviders
		.filter((p) => p.msats_30d > 0)
		.sort((a, b) => b.msats_30d - a.msats_30d)
		.slice(0, 12)
		.map((p) => ({ label: p.name, value: sat(p.msats_30d), sub: p.req_30d }));

	const modelRows30d = D.models
		.filter((m) => m.msats_30d > 0 || m.req_30d > 0)
		.sort((a, b) => b.msats_30d - a.msats_30d);
	const modelRowsAll = D.models
		.filter((m) => m.msats_alltime > 0 || m.req_alltime > 0)
		.sort((a, b) => b.msats_alltime - a.msats_alltime);

	const successPct =
		s.success_rate_30d === null ? null : (s.success_rate_30d * 100).toFixed(1) + '%';

	const CARDS: { l: string; v: string; vc?: string; sub: string }[] = [
		{
			l: 'Providers',
			v: n(s.providers_announced),
			sub: `${n(s.providers_active_30d)} reported usage in the last 30 days`
		},
		{
			l: 'Revenue (30d)',
			v: n(s.revenue_30d_sats) + ' sats',
			vc: BTC_ORANGE,
			sub: `${n(s.revenue_alltime_sats)} sats observed all-time, self-reported`
		},
		{
			l: 'Requests (30d)',
			v: compact(s.requests_30d),
			sub: `${compact(s.tokens_30d)} tokens billed`
		},
		{
			l: 'Models in use (30d)',
			v: n(s.models_30d),
			sub:
				s.catalog_models === null
					? 'no curated catalog observed'
					: `${n(s.catalog_models)} in the curated catalog`
		}
	];
</script>

<SocialMeta
	title={pageTitle(ROUTSTR_SLUGS, 'Nostrology - Routstr', data.target)}
	socialTitle="Routstr, measured"
	description="The Routstr decentralized AI-inference marketplace measured from actual events: providers, self-reported revenue, model usage and curation."
	noindex
/>

<TransientNote text={$note} />

<div class="space-y-6">
	<h1 class="text-3xl font-bold text-white">Routstr</h1>
	<p class="max-w-3xl text-sm leading-relaxed text-gray-400">
		<a
			href="https://routstr.com"
			target="_blank"
			rel="noopener noreferrer"
			class="text-nostr-purple hover:text-nostr-gold transition-colors">Routstr</a
		>
		is a decentralized LLM-inference marketplace: provider nodes sell OpenAI-compatible API
		access for Cashu ecash and announce themselves over Nostr.
	</p>

	<PillBar table={ROUTSTR_SLUGS} current={$tab} label="Routstr" onPick={pick} />

	<!-- Headline numbers ride above the pills' panels: they are the frame for all four. -->
	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		{#each CARDS as c}
			<div class="rounded-xl border border-gray-700 bg-gray-800 p-4">
				<div class="text-xs uppercase tracking-wider text-gray-400">{c.l}</div>
				<div class="mt-1 text-3xl font-bold text-white" style:color={c.vc}>{c.v}</div>
				<div class="mt-1 text-sm text-gray-400">{c.sub}</div>
			</div>
		{/each}
	</div>

	{#if $tab === 'overview'}
		<div id="panel-overview" class="space-y-4">
			<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
				<div class="mb-1 flex flex-wrap items-baseline justify-between gap-2">
					<h2 class="text-lg font-semibold text-white">Daily network revenue</h2>
					<span class="text-sm text-gray-400">sats/day, self-reported</span>
				</div>
				<!-- One dataset, so no Total line: it would duplicate the dataset's own
					14d average point for point. -->
				<DailyBarChart title="" datasets={revenueDaily} yAxisLabel="sats" rollingAverageWindow={14} />
				<McpDerivableNote domain="routstr" metrics={['network_activity', 'network_summary']} />
			</div>

			<div class="grid gap-4 lg:grid-cols-2">
				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
					<div class="mb-1 flex flex-wrap items-baseline justify-between gap-2">
						<h2 class="text-lg font-semibold text-white">Successful requests per day</h2>
					</div>
					<DailyBarChart
						title=""
						datasets={requestsDaily}
						yAxisLabel="requests"
						rollingAverageWindow={14}
					/>
				</div>
				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
					<div class="mb-1 flex flex-wrap items-baseline justify-between gap-2">
						<h2 class="text-lg font-semibold text-white">Tokens billed per day</h2>
					</div>
					<LineChart series={tokensDaily} label="tokens" color="#60a5fa" heightPx={300} />
				</div>
			</div>

			<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
				<div class="mb-1 flex flex-wrap items-baseline justify-between gap-2">
					<h2 class="text-lg font-semibold text-white">Cumulative observed revenue</h2>
					<span class="text-sm text-gray-400">
						weekly buckets before {D.coverage.daily_from}, daily after
					</span>
				</div>
				<p class="mb-4 text-sm text-gray-400">
					Everything the network's nodes have reported earning since {s.first_activity},
					{n(s.revenue_alltime_sats)} sats over {compact(s.requests_alltime)} requests and
					{compact(s.tokens_alltime)} tokens. A flat stretch means no provider reported activity,
					not necessarily that none happened &mdash; a node that goes offline takes its
					unreported history with it.
				</p>
				<LineChart series={cumRevenue} label="sats" yAxisLabel="sats" color={BTC_ORANGE} heightPx={340} />
				<McpDerivableNote domain="routstr" metrics={['cumulative_revenue']} />
			</div>

			<!-- Last on the pill: What is counted closes the Overview, after the figures, collapsed
				 - as on /git and /marketplaces, since 2026-10-18 (it opened the pill, always open,
				 as "What is counted - and who is not" until then). It has an address of its own and
				 the icon that copies it (MethodologySection; $lib/methodology): /routstr/methodology
				 opens this pill with this section expanded, just under the nav. -->
			<MethodologySection bind:open={$methodologyOpen} href={addressOf(ROUTSTR_SLUGS, METHODOLOGY)}>
				<p class="mt-2 text-sm leading-relaxed text-gray-400">
					Every provider node publishes a replaceable announcement &mdash; kind-38421
					(routstr-provider-announcements) &mdash; and, if it runs the stock software, a
					kind-38422 (routstr-analytics-snapshots) usage snapshot every ~15 minutes whose
					trailing windows carry day-by-day activity buckets. The daily history on this page is
					<em>reconstructed</em> from those windows &mdash; each day's figure is the newest
					fully-covering report of that day. The numbers are
					<strong class="text-gray-300">self-reported by the providers</strong> and cannot be
					independently verified. Non-production nodes are kept out of the headline aggregates:
				</p>
				<div class="mt-4 space-y-2">
					{#each D.exclusions as e}
						<div class="flex items-baseline gap-3 border-l-2 border-gray-600 pl-3">
							<span class="w-16 shrink-0 text-right font-mono tabular-nums text-red-300"
								>&minus;{n(e.v)}</span
							>
							<span>
								<span class="text-gray-200">{e.k}</span>
								<span class="text-sm text-gray-400"> &mdash; {e.why}</span>
							</span>
						</div>
					{/each}
					<div class="flex items-baseline gap-3 border-l-2 border-nostr-purple pl-3 pt-1">
						<span class="w-16 shrink-0 text-right font-mono tabular-nums text-white"
							>{n(includedProviders.length)}</span
						>
						<span class="text-gray-200">Providers in the aggregates</span>
					</div>
				</div>
			</MethodologySection>
		</div>
	{/if}

	{#if $tab === 'providers'}
		<div id="panel-providers" class="space-y-4">
			<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
				<div class="mb-2 flex flex-wrap items-center justify-between gap-3">
					<h2 class="text-lg font-semibold text-white">Daily revenue by provider</h2>
					<div class="flex flex-wrap items-center gap-3 text-sm">
						<span class="text-gray-400">by 30-day revenue</span>
						<PeriodSelector
							selected={String(providersTopN)}
							onChange={changeProvidersTopN}
							periods={TOP_N_OPTIONS}
						/>
						<PeriodSelector
							selected={providersChart}
							onChange={changeProvidersChart}
							periods={CHART_OPTIONS}
						/>
					</div>
				</div>
				{#key `${providersTopN}-${providersChart}`}
					{#if providersChart === 'bars'}
						<DailyBarChart title="" datasets={providerStackFor(providersTopN)} yAxisLabel="sats" />
					{:else}
						<CumulativeLineChart
							title=""
							yAxisLabel="sats"
							series={providerStackFor(providersTopN).map((d) => ({
								label: d.label,
								color: d.color,
								data: d.series
							}))}
							legendPosition="bottom"
							heightPx={400}
						/>
					{/if}
				{/key}
				<McpDerivableNote domain="routstr" metrics={['provider_activity', 'provider_leaderboard']} />
			</div>

			<div class="grid gap-4 lg:grid-cols-2">
				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
					<h2 class="text-lg font-semibold text-white">Revenue leaders (30d)</h2>
					<p class="mb-3 mt-1 text-sm text-gray-400">
						Self-reported; the sub-figure is successful requests.
					</p>
					<HBar
						rows={providerLeaderboard}
						subLabel="requests"
						valueLabel="sats"
						color={BTC_ORANGE}
						labelWidth="minmax(8rem,13rem)"
					/>
				</div>
				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
					<h2 class="text-lg font-semibold text-white">Reading the table</h2>
					<p class="mt-2 text-sm leading-relaxed text-gray-400">
						A provider's identity is its Nostr pubkey. <span class="text-gray-300">First seen</span>
						is its earliest announcement or earliest reported activity;
						<span class="text-gray-300">last report</span> is its newest analytics snapshot &mdash;
						a provider can stay announced long after it stops serving.
						<span class="text-gray-300">Review</span> is the newest label the Routstr curation key
						published for the node (<span class="text-emerald-400">lgtm/trusted/verified</span>
						enable it in the official SDK; anything else disables it).
						{n(s.providers_reporting)} of the {n(D.providers.length)} providers listed have ever
						reported usage.
					</p>
				</div>
			</div>

			<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
				<h2 class="mb-3 text-lg font-semibold text-white">All providers</h2>
				<div class="overflow-x-auto">
					<table class="w-full min-w-[720px] text-left text-sm">
						<thead>
							<tr class="border-b border-gray-700 text-xs uppercase tracking-wider text-gray-400">
								{#each PROVIDER_COLUMNS as c (c.key)}
									<th
										class="py-2 pr-3 font-medium {c.right ? 'text-right' : ''}"
										aria-sort={sortKey === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
									>
										<button
											type="button"
											class="inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-white {sortKey === c.key ? 'text-white' : ''}"
											on:click={() => toggleSort(c.key)}
											aria-label="Sort by {c.label}"
										>
											{c.label}
											<span class="inline-block w-3 text-center">{sortKey === c.key ? (sortDir === 'desc' ? '\u2193' : '\u2191') : ''}</span>
										</button>
									</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each sortedProviders as p (p.id)}
								<tr class="border-b border-gray-700/50">
									<td class="py-2 pr-3 text-gray-200" title={p.id}>{p.name}</td>
									<!-- The bright ink is on the column sorted at the moment, every other dim
										 (the operator's rule of 2026-10-18, as on /git); the provider's name keeps
										 its own ink, and Review its colour, which says what the review is. -->
									<td class="py-2 pr-3 {sortInk(sortKey, 'class')}">{CLASS_LABEL[p.class] ?? p.class}</td>
									<td class="py-2 pr-3 font-mono text-xs {sortInk(sortKey, 'version')}">{p.version || '-'}</td>
									<td class="py-2 pr-3 {reviewColor(p.review)}">{p.review ?? '-'}</td>
									<td class="py-2 pr-3 tabular-nums {sortInk(sortKey, 'first_seen')}">{p.first_seen ?? '-'}</td>
									<td class="py-2 pr-3 tabular-nums {sortInk(sortKey, 'last_report')}">{p.last_report ?? '-'}</td>
									<td class="py-2 pr-3 text-right tabular-nums {sortInk(sortKey, 'msats_30d')}">{n(sat(p.msats_30d))}</td>
									<td class="py-2 text-right tabular-nums {sortInk(sortKey, 'msats_alltime')}">{n(sat(p.msats_alltime))}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{#if D.providers_total > D.providers.length}
					<p class="mt-3 text-sm text-gray-400">
						Showing {n(D.providers.length)} of {n(D.providers_total)} providers (the list is
						capped against announcement flooding; the headline counts cover all of them).
					</p>
				{/if}
				{#if excludedProviders.length}
					<h3 class="mb-2 mt-6 text-sm font-semibold uppercase tracking-wider text-gray-400">
						Excluded from the aggregates
					</h3>
					<div class="overflow-x-auto">
						<table class="w-full min-w-[560px] text-left text-sm">
							<tbody>
								{#each excludedProviders as p (p.id)}
									<tr class="border-b border-gray-700/50">
										<td class="py-2 pr-3 text-gray-400" title={p.id}>{p.name}</td>
										<td class="py-2 pr-3 text-gray-500">{CLASS_LABEL[p.class] ?? p.class}</td>
										<td class="py-2 pr-3 text-red-300/70">{p.reason}</td>
										<td class="py-2 text-right tabular-nums text-gray-500">{n(sat(p.msats_alltime))} sats reported</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	{#if $tab === 'models'}
		<div id="panel-models" class="space-y-4">
			<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
				<div class="mb-1 flex flex-wrap items-baseline justify-between gap-2">
					<h2 class="text-lg font-semibold text-white">Daily revenue by model</h2>
					<span class="text-sm text-gray-400">top {D.model_daily_top.filter((m) => m.id !== '(others)').length} by 30-day revenue, stacked</span>
				</div>
				<p class="mb-3 text-sm text-gray-400">
					Model identifiers are reported verbatim &mdash; the same model can appear both with and
					without its vendor prefix (<code class="text-gray-300">openai/gpt-...</code> vs
					<code class="text-gray-300">gpt-...</code>) depending on the provider. "(others)" also
					carries each provider's own below-top-N residual.
				</p>
				<DailyBarChart title="" datasets={modelStack} yAxisLabel="sats" />
				<McpDerivableNote domain="routstr" metrics={['model_activity', 'model_leaderboard']} />
			</div>

			<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
				<h2 class="mb-3 text-lg font-semibold text-white">Model leaderboard</h2>
				<div class="overflow-x-auto">
					<table class="w-full min-w-[680px] text-left text-sm">
						<thead>
							<tr class="border-b border-gray-700 text-xs uppercase tracking-wider text-gray-400">
								<th class="py-2 pr-3 font-medium">Model</th>
								<th class="py-2 pr-3 text-right font-medium">Sats (30d)</th>
								<th class="py-2 pr-3 text-right font-medium">Requests (30d)</th>
								<th class="py-2 pr-3 text-right font-medium">Tokens (30d)</th>
								<th class="py-2 pr-3 text-right font-medium">Providers (30d)</th>
								<th class="py-2 text-right font-medium">Sats (all-time)</th>
							</tr>
						</thead>
						<tbody>
							{#each modelRows30d.slice(0, 25) as m (m.model)}
								<tr class="border-b border-gray-700/50">
									<td class="py-2 pr-3 font-mono text-xs text-gray-200">{m.model}</td>
									<td class="py-2 pr-3 text-right tabular-nums text-gray-200">{n(sat(m.msats_30d))}</td>
									<td class="py-2 pr-3 text-right tabular-nums text-gray-400">{n(m.req_30d)}</td>
									<td class="py-2 pr-3 text-right tabular-nums text-gray-400">{compact(m.tok_30d)}</td>
									<td class="py-2 pr-3 text-right tabular-nums text-gray-400">{m.providers_30d}</td>
									<td class="py-2 text-right tabular-nums text-gray-400">{n(sat(m.msats_alltime))}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<p class="mt-3 text-sm text-gray-400">
					{n(s.models_30d)} distinct model identifiers saw activity in the last 30 days;
					the table lists the top {n(D.models.filter((m) => m.model !== '(other)').length)}
					all-time, with the long tail folded into "(other)" alongside each provider's own
					below-top-N residual. Rows are as-reported per provider &mdash; no normalization
					is applied to the identifiers.
				</p>
			</div>

			<div class="grid gap-4 lg:grid-cols-2">
				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
					<div class="mb-1 flex flex-wrap items-baseline justify-between gap-2">
						<h2 class="text-lg font-semibold text-white">The curated catalog</h2>
						<span class="text-sm text-gray-400">updated {D.catalog.updated ?? 'never'}</span>
					</div>
					<p class="mb-3 text-sm text-gray-400">
						The "routstr-21-models" list &mdash; kind-38423 (routstr-model-catalog) &mdash; the
						Routstr key publishes: the allowlist
						the official SDK treats as the network's real models. Currently
						{D.catalog.models.length} models.
					</p>
					<div class="flex flex-wrap gap-1.5">
						{#each D.catalog.models as m (m)}
							<span class="rounded-md border border-gray-700 bg-gray-900 px-2 py-0.5 font-mono text-xs text-gray-300">{m}</span>
						{/each}
					</div>
				</div>
				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
					<div class="mb-1 flex flex-wrap items-baseline justify-between gap-2">
						<h2 class="text-lg font-semibold text-white">Catalog size over time</h2>
						<span class="text-sm text-gray-400">{D.catalog.history.length} versions archived</span>
					</div>
					<LineChart series={catalogHistory} label="models" yAxisLabel="models" color="#a78bfa" heightPx={260} fill={false} />
				</div>
			</div>
		</div>
	{/if}

	{#if $tab === 'network'}
		<div id="panel-network" class="space-y-4">
			<div class="grid gap-4 lg:grid-cols-2">
				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
					<h2 class="text-lg font-semibold text-white">How providers are reachable</h2>
					<p class="mb-2 mt-1 text-sm text-gray-400">
						From the announced endpoint URLs of all {n(s.providers_announced)} providers. Tor
						mirrors are first-class here: paying in ecash over an onion endpoint is the
						network's whole privacy pitch.
					</p>
					<Donut
						rows={transportRows}
						colors={transportColors}
						heightPx={240}
						centerTitle={String(s.providers_announced)}
						centerSub="providers"
						unitLabel="providers"
					/>
					<div class="mt-4 space-y-1.5">
						{#each transportRows as t, i}
							<div class="flex items-center gap-2 text-sm">
								<span class="h-2.5 w-2.5 shrink-0 rounded-sm" style="background: {transportColors[i]}"></span>
								<span class="flex-1 truncate text-gray-300">{t.label}</span>
								<span class="tabular-nums text-gray-200">{n(t.value)}</span>
							</div>
						{/each}
					</div>
				</div>

				<div class="space-y-4">
					<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
						<h2 class="text-lg font-semibold text-white">Software versions</h2>
						<p class="mb-3 mt-1 text-sm text-gray-400">
							The <code class="text-gray-300">version</code> tag on each provider's current
							announcement &mdash; old announcements linger, so old versions here mean stale
							nodes, not necessarily running ones.
						</p>
						<HBar
							rows={D.versions.map((v) => ({ label: v.k, value: v.v }))}
							subLabel=""
							valueLabel="providers"
							color="#2dd4bf"
						/>
					</div>
					<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
						<h2 class="text-lg font-semibold text-white">Accepted Cashu mints</h2>
						<p class="mb-3 mt-1 text-sm text-gray-400">
							{n(s.mints)} distinct mint URLs across the announced providers, by host.
						</p>
						<HBar
							rows={D.mints_top.map((v) => ({ label: v.k, value: v.v }))}
							subLabel=""
							valueLabel="providers"
							color="#fbbf24"
							labelWidth="minmax(10rem,16rem)"
						/>
					</div>
				</div>
			</div>

			<div class="grid gap-4 lg:grid-cols-2">
				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
					<h2 class="text-lg font-semibold text-white">Reliability, as reported</h2>
					<dl class="mt-3 space-y-3 text-sm">
						<div class="flex justify-between gap-4 border-b border-gray-700 pb-2">
							<dt class="text-gray-400">Success rate, trailing 30 days</dt>
							<dd class="tabular-nums text-white">{successPct ?? 'n/a'}</dd>
						</div>
						<div class="flex justify-between gap-4 border-b border-gray-700 pb-2">
							<dt class="text-gray-400">Requests behind that figure</dt>
							<dd class="tabular-nums text-white">{n(D.success.requests_reported)}</dd>
						</div>
						<div class="flex justify-between gap-4 border-b border-gray-700 pb-2">
							<dt class="text-gray-400">...of which failed</dt>
							<dd class="tabular-nums text-white">{n(D.success.failed_reported)}</dd>
						</div>
						<div class="flex justify-between gap-4">
							<dt class="text-gray-400">Providers reporting within 7 days</dt>
							<dd class="tabular-nums text-white">{n(D.success.providers_fresh)}</dd>
						</div>
					</dl>
					<p class="mt-4 text-sm leading-relaxed text-gray-400">
						Aggregated from each fresh provider's own trailing-30-day summary. A node that went
						dark contributes nothing here &mdash; this measures the network that is still
						talking, which biases the figure upward.
					</p>
				</div>

				<div class="rounded-xl border border-gray-700 bg-gray-800 p-5">
					<h2 class="text-lg font-semibold text-white">Curation timeline</h2>
					<p class="mb-3 mt-1 text-sm text-gray-400">
						Provider reviews &mdash; kind-38425 (routstr-provider-reviews). The official SDK
						disables any node whose newest
						curated label is not positive &mdash; an allowlist, not a suggestion.
					</p>
					<div class="max-h-96 overflow-y-auto pr-1">
						<table class="w-full text-left text-sm">
							<tbody>
								{#each D.reviews as r, i (r.node + r.d + i)}
									<tr class="border-b border-gray-700/50">
										<td class="py-1.5 pr-3 tabular-nums text-gray-400">{r.d}</td>
										<td class="py-1.5 pr-3 text-gray-200">{r.name}</td>
										<td class="py-1.5 pr-3 {reviewColor(r.label)}">{r.label}</td>
										<td class="py-1.5 text-xs text-gray-500">{r.reviewer === 'curated' ? '' : 'non-curated key'}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<p class="border-t border-gray-700 pt-4 text-xs text-gray-400">
		Snapshot {D.generated_utc} &middot; ledger days end yesterday (UTC) once the day's
		refresh has landed &mdash; it runs at 02:45 UTC, so between 00:00 and 02:45 UTC the
		newest ledger day is the day before yesterday &middot; a snapshot that lands after the
		archive's periodic roll shows up the next day &middot; usage figures are
		self-reported by provider nodes &mdash; kind-38422 (routstr-analytics-snapshots) &mdash;
		and are not independently verifiable
	</p>
</div>
