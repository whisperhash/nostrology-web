<script lang="ts">
	// Per-chart rank table for the /lightning trend charts. Sits beside the
	// share-% charts; rows are pre-ranked by the parent (same order as the
	// chart's legend, i.e. descending by most-recent-date value).
	//
	// 'latestPct' is the current share % (percentage-point unit). 'extraValue'
	// is an opt-in absolute snapshot of the same date (the sats-share chart
	// passes absolute sats; the zap-share chart passes the zap count); the
	// `extraColumn` prop describes the header + formatter. 'rankDelta' is
	// positive when the provider moved UP the leaderboard since period start.
	// Rows arrive pre-sorted by latest value descending, so the row index
	// doubles as the current rank.
	export let rows: Array<{
		provider: string;
		color: string;
		latestPct: number;
		extraValue?: number;
		rankDelta: number;
	}>;
	export let title: string = '';
	export let extraColumn: {
		header: string;
		formatValue: (n: number) => string;
		titleText?: string;
	} | null = null;

	function fmtPct(n: number): string {
		return `${n.toFixed(1)}%`;
	}

	function fmtRankDelta(n: number): string {
		if (n === 0) return '—';
		const arrow = n > 0 ? '↑' : '↓';
		return `${arrow}${Math.abs(n)}`;
	}

	function rankDeltaClass(n: number): string {
		if (n === 0) return 'text-gray-500';
		return n > 0 ? 'text-emerald-400' : 'text-red-400';
	}
</script>

<div class="flex flex-col h-full">
	{#if title}
		<h3 class="text-sm font-medium text-gray-100 text-center shrink-0 pb-2">{title}</h3>
	{/if}
	<div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
		<table class="w-full table-fixed text-sm">
			<!-- Fixed numeric column widths + Provider absorbs remaining space.
			     Sized so headers stay single-line (no wrapping) at the table's
			     ~1/3-page footprint, with comfortable margin for the widest
			     header ("Rank Δ") and typical values ("100.0%", "8.2M", "↑12"). -->
			<colgroup>
				<col class="w-10" />
				<col />
				<col class="w-14" />
				{#if extraColumn}<col class="w-14" />{/if}
				<col class="w-16" />
			</colgroup>
			<thead class="sticky top-0 bg-gray-800 z-10">
				<tr class="text-[10px] uppercase tracking-wider text-gray-400">
					<th class="pl-1.5 pr-3 py-2 text-right font-medium whitespace-nowrap">Rank</th>
					<th class="px-1.5 py-2 text-left font-medium whitespace-nowrap">Provider</th>
					<th class="px-1.5 py-2 text-right font-medium whitespace-nowrap">Share</th>
					{#if extraColumn}
						<th
							class="px-1.5 py-2 text-right font-medium whitespace-nowrap"
							title={extraColumn.titleText ?? ''}
						>
							{extraColumn.header}
						</th>
					{/if}
					<th
						class="px-1.5 py-2 text-right font-medium whitespace-nowrap"
						title="Rank change since the start of the selected range (within the top-20 candidate pool)"
					>
						Rank Δ
					</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-gray-700">
				{#each rows as r, i (r.provider)}
					<tr class="hover:bg-gray-700/40 transition-colors">
						<td class="pl-1.5 pr-3 py-2 text-right font-mono text-gray-400 whitespace-nowrap"
							>{i + 1}</td
						>
						<td class="px-1.5 py-2 text-gray-200">
							<div class="flex items-center gap-2 min-w-0">
								<span
									class="inline-block w-4 h-[3px] shrink-0 rounded-sm"
									style="background-color: {r.color};"
								></span>
								<span class="truncate" title={r.provider}>{r.provider}</span>
							</div>
						</td>
						<td class="px-1.5 py-2 text-right font-mono text-gray-200 whitespace-nowrap"
							>{fmtPct(r.latestPct)}</td
						>
						{#if extraColumn}
							<td class="px-1.5 py-2 text-right font-mono text-gray-200 whitespace-nowrap"
								>{r.extraValue !== undefined ? extraColumn.formatValue(r.extraValue) : '—'}</td
							>
						{/if}
						<td
							class="px-1.5 py-2 text-right whitespace-nowrap {rankDeltaClass(r.rankDelta)}"
							>{fmtRankDelta(r.rankDelta)}</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
