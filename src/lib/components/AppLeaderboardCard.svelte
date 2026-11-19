<script lang="ts">
	import { onMount } from 'svelte';
	import PeriodSelector from '$lib/components/PeriodSelector.svelte';
	import AppIcon from '$lib/components/AppIcon.svelte';
	import type {
		AppLeaderboardRow,
		AppStackLeaderboardRow,
		ZapstoreAppLeaderboards,
		ZapstoreAppStackLeaderboards
	} from '$lib/shared/data-types';

	type AnyRow = AppLeaderboardRow | AppStackLeaderboardRow;
	type Period = '7d' | '30d' | '90d' | '6m' | '1y' | 'all';
	type ZapSort = 'sats' | 'count';
	type SortDir = 'asc' | 'desc';

	export let title: string;
	export let data: ZapstoreAppLeaderboards | ZapstoreAppStackLeaderboards;
	// 'sats'   = single-column: sats received > 0 (server sorts by sats DESC)
	// 'count'  = single-column: zaps > 0 (re-sorted client-side, ties by sats desc)
	// 'zaps'   = combined: two sortable columns (Sats, Zaps); default sort sats DESC
	// 'stacks' = every app appearing in ≥1 public stack (server sorts by stack_count DESC;
	//            stack_names → hover tooltip on the count cell)
	export let metric: 'sats' | 'count' | 'stacks' | 'zaps';
	export let initialPeriod: Period = '30d';
	// localStorage key base. When set, period is persisted at `${storageKey}.period`;
	// for metric='zaps', sort metric at `${storageKey}.sort` and direction at
	// `${storageKey}.dir`. Omit to opt out of persistence (e.g. embedded previews).
	export let storageKey: string | undefined = undefined;

	// The Zaps card (per-app zap totals) exposes the full window set including
	// 3-month and 6-month. App Stack Appearances is all-time only — kind-30267 is
	// replaceable, so a trailing window means "last edited", not activity; the
	// only honest metric is the current snapshot. Its data shape
	// (ZapstoreAppStackLeaderboards) carries a single `all` key and the selector
	// is hidden (one option → no chooser).
	const periodOptions =
		metric === 'zaps'
			? [
					{ value: '7d', label: '7D' },
					{ value: '30d', label: '30D' },
					{ value: '90d', label: '3M' },
					{ value: '6m', label: '6M' },
					{ value: '1y', label: '1Y' },
					{ value: 'all', label: 'All' }
				]
			: [{ value: 'all', label: 'All' }];

	const VALID_PERIODS: ReadonlySet<Period> =
		metric === 'zaps'
			? new Set<Period>(['7d', '30d', '90d', '6m', '1y', 'all'])
			: new Set<Period>(['all']);
	const VALID_SORTS: ReadonlySet<ZapSort> = new Set<ZapSort>(['sats', 'count']);
	const VALID_DIRS: ReadonlySet<SortDir> = new Set<SortDir>(['desc', 'asc']);

	// Stacks is single-period (all-time); ignore initialPeriod for it.
	let selected: Period = metric === 'stacks' ? 'all' : initialPeriod;
	let sortBy: ZapSort = 'sats';
	let sortDir: SortDir = 'desc';

	$: periodKey = storageKey ? `${storageKey}.period` : undefined;
	$: sortKey = storageKey ? `${storageKey}.sort` : undefined;
	$: dirKey = storageKey ? `${storageKey}.dir` : undefined;

	onMount(() => {
		// Stacks is single-period (all-time) — never restore a persisted period.
		if (periodKey && metric !== 'stacks') {
			try {
				const stored = localStorage.getItem(periodKey);
				if (stored && VALID_PERIODS.has(stored as Period)) {
					selected = stored as Period;
				}
			} catch (err) {
				console.warn(`AppLeaderboardCard: could not read ${periodKey} from localStorage`, err);
			}
		}
		if (metric === 'zaps' && sortKey) {
			try {
				const stored = localStorage.getItem(sortKey);
				if (stored && VALID_SORTS.has(stored as ZapSort)) {
					sortBy = stored as ZapSort;
				}
			} catch (err) {
				console.warn(`AppLeaderboardCard: could not read ${sortKey} from localStorage`, err);
			}
		}
		if (metric === 'zaps' && dirKey) {
			try {
				const stored = localStorage.getItem(dirKey);
				if (stored && VALID_DIRS.has(stored as SortDir)) {
					sortDir = stored as SortDir;
				}
			} catch (err) {
				console.warn(`AppLeaderboardCard: could not read ${dirKey} from localStorage`, err);
			}
		}
	});

	function changePeriod(p: Period): void {
		selected = p;
		if (!periodKey) return;
		try {
			localStorage.setItem(periodKey, p);
		} catch (err) {
			console.warn(`AppLeaderboardCard: could not persist ${periodKey} to localStorage`, err);
		}
	}

	// Click on the active column toggles direction; click on the inactive column
	// makes it active and resets direction to 'desc'.
	function toggleSort(s: ZapSort): void {
		if (sortBy === s) {
			sortDir = sortDir === 'desc' ? 'asc' : 'desc';
		} else {
			sortBy = s;
			sortDir = 'desc';
		}
		if (sortKey) {
			try {
				localStorage.setItem(sortKey, sortBy);
			} catch (err) {
				console.warn(`AppLeaderboardCard: could not persist ${sortKey} to localStorage`, err);
			}
		}
		if (dirKey) {
			try {
				localStorage.setItem(dirKey, sortDir);
			} catch (err) {
				console.warn(`AppLeaderboardCard: could not persist ${dirKey} to localStorage`, err);
			}
		}
	}

	function sortAppRows(rows: AppLeaderboardRow[], by: ZapSort, dir: SortDir): AppLeaderboardRow[] {
		const mul = dir === 'desc' ? 1 : -1;
		return [...rows].sort((a, b) => {
			if (by === 'count') {
				if (b.total_count !== a.total_count) return mul * (b.total_count - a.total_count);
				if (b.total_sats !== a.total_sats) return mul * (b.total_sats - a.total_sats);
			} else {
				if (b.total_sats !== a.total_sats) return mul * (b.total_sats - a.total_sats);
				if (b.total_count !== a.total_count) return mul * (b.total_count - a.total_count);
			}
			return a.app_d_tag.localeCompare(b.app_d_tag);
		});
	}

	function visibleRows(
		all: AnyRow[],
		byMetric: 'sats' | 'count' | 'stacks' | 'zaps',
		by: ZapSort,
		dir: SortDir
	): AnyRow[] {
		if (byMetric === 'sats') {
			// Drop apps whose zaps all had unparseable amounts (sats == 0).
			// Server already sorts by sats DESC, so no resort needed.
			return (all as AppLeaderboardRow[]).filter((r) => r.total_sats > 0);
		}
		if (byMetric === 'stacks') {
			// Server query only emits apps with stack_count ≥ 1, sorted DESC.
			return all;
		}
		if (byMetric === 'zaps') {
			// Combined view — drop apps with all-unparseable amounts when sorting
			// by sats (matches the old single-column 'sats' card).
			const rows = all as AppLeaderboardRow[];
			const filtered = by === 'sats' ? rows.filter((r) => r.total_sats > 0) : rows;
			return sortAppRows(filtered, by, dir);
		}
		// 'count' — server-grouping guarantees count ≥ 1; resort by count desc,
		// tie-break by sats then d_tag.
		return sortAppRows(all as AppLeaderboardRow[], 'count', 'desc');
	}

	function valueFor(row: AnyRow, byMetric: 'sats' | 'count' | 'stacks'): string {
		if (byMetric === 'sats') return `${(row as AppLeaderboardRow).total_sats.toLocaleString()} sats`;
		if (byMetric === 'count') return (row as AppLeaderboardRow).total_count.toLocaleString();
		return (row as AppStackLeaderboardRow).stack_count.toLocaleString();
	}

	function satsCell(row: AnyRow): string {
		return `${(row as AppLeaderboardRow).total_sats.toLocaleString()} sats`;
	}
	function zapsCell(row: AnyRow): string {
		return (row as AppLeaderboardRow).total_count.toLocaleString();
	}

	function tooltipFor(row: AnyRow, byMetric: 'sats' | 'count' | 'stacks' | 'zaps'): string | undefined {
		if (byMetric === 'stacks') {
			const names = (row as AppStackLeaderboardRow).stack_names;
			return names && names.length ? names.join(', ') : undefined;
		}
		return undefined;
	}

	// `data` is a union; the stacks shape lacks 90d/6m keys, but the stacks card
	// never selects them (its periodOptions exclude them). Index tolerantly.
	function rowsForPeriod(d: typeof data, p: Period): AnyRow[] {
		return (d as Record<string, AnyRow[]>)[p] ?? [];
	}

	function periodNoun(p: Period): string {
		switch (p) {
			case '7d':
				return '7 days';
			case '30d':
				return '30 days';
			case '90d':
				return '3 months';
			case '6m':
				return '6 months';
			case '1y':
				return 'year';
			case 'all':
				return 'all time';
		}
	}

	$: rows = visibleRows(rowsForPeriod(data, selected), metric, sortBy, sortDir);
	$: valueHeader =
		metric === 'sats' ? 'Sats' : metric === 'count' ? 'Zaps' : metric === 'stacks' ? 'Stacks' : '';
	$: emptyNoun =
		metric === 'stacks' ? 'public Zapstore app stacks' : 'Zapstore-attributed zaps';
</script>

<div class="bg-gray-800 rounded-lg border border-gray-700 p-4 space-y-3">
	<div class="flex items-center justify-between gap-3 flex-wrap">
		<h3 class="text-lg font-semibold text-white">{title}</h3>
		{#if periodOptions.length > 1}
			<PeriodSelector
				selected={selected}
				onChange={(p) => changePeriod(p as Period)}
				periods={periodOptions}
			/>
		{/if}
	</div>

	{#if rows.length === 0}
		<p class="text-sm text-gray-400 px-2 py-6 text-center">
			{#if selected === 'all'}
				No {emptyNoun} yet.
			{:else}
				No {emptyNoun} in the trailing {periodNoun(selected)}.
			{/if}
		</p>
	{:else}
		<div class="bg-gray-900/50 rounded-lg border border-gray-700 overflow-hidden">
			<div class="max-h-[38rem] overflow-y-auto">
				<table class="w-full table-fixed">
					<colgroup>
						<col class="w-10" />
						<col />
						{#if metric === 'zaps'}
							<col class="w-[6rem]" />
							<col class="w-[8rem]" />
						{:else}
							<col class="w-[7.5rem]" />
						{/if}
					</colgroup>
					<thead class="bg-gray-900 sticky top-0 z-10">
						<tr>
							<th
								class="pl-3 pr-1 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider"
							></th>
							<th
								class="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider"
							>
								App
							</th>
							{#if metric === 'zaps'}
								<th
									class="pl-3 pr-3 py-2 text-right text-xs font-medium uppercase tracking-wider"
								>
									<button
										type="button"
										class="inline-flex items-center gap-1 hover:text-white transition-colors {sortBy === 'count' ? 'text-white' : 'text-gray-400'}"
										on:click={() => toggleSort('count')}
										aria-label="Sort by zaps"
										aria-pressed={sortBy === 'count'}
									>
										Zaps
										<span class="w-3 inline-block text-center">
											{sortBy === 'count' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
										</span>
									</button>
								</th>
								<th
									class="pl-3 pr-[1.125rem] py-2 text-right text-xs font-medium uppercase tracking-wider"
								>
									<button
										type="button"
										class="inline-flex items-center gap-1 hover:text-white transition-colors {sortBy === 'sats' ? 'text-white' : 'text-gray-400'}"
										on:click={() => toggleSort('sats')}
										aria-label="Sort by sats"
										aria-pressed={sortBy === 'sats'}
									>
										Sats
										<span class="w-3 inline-block text-center">
											{sortBy === 'sats' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
										</span>
									</button>
								</th>
							{:else}
								<th
									class="pl-3 pr-[1.125rem] py-2 text-right text-xs font-medium text-gray-400 uppercase tracking-wider"
								>
									{valueHeader}
								</th>
							{/if}
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-700">
						{#each rows as row, i (row.app_pubkey + ':' + row.app_d_tag)}
							<tr class="hover:bg-gray-700/50 transition-colors">
								<td class="pl-3 pr-1 py-3 whitespace-nowrap text-sm text-gray-300">{i + 1}</td>
								<td class="px-3 py-3 text-sm text-gray-300">
									<a
										href="/zapstore/apps/{row.app_pubkey}/{encodeURIComponent(row.app_d_tag)}"
										class="flex items-center gap-2 min-w-0 hover:text-nostr-gold transition-colors"
										title={row.display_name}
									>
										<AppIcon iconUrl={row.icon_url} name={row.display_name} size="xs" />
										<span class="truncate">{row.display_name}</span>
									</a>
								</td>
								{#if metric === 'zaps'}
									<td class="pl-3 pr-3 py-3 text-sm">
										<div class="flex justify-end">
											<span class="text-gray-300 whitespace-nowrap">{zapsCell(row)}</span>
										</div>
									</td>
									<td class="pl-3 pr-[1.125rem] py-3 text-sm">
										<div class="flex justify-end">
											<span class="font-mono text-nostr-gold whitespace-nowrap">{satsCell(row)}</span>
										</div>
									</td>
								{:else}
									<td class="pl-3 pr-[1.125rem] py-3 text-sm">
										<div class="flex justify-end">
											{#if metric === 'sats'}
												<span class="font-mono text-nostr-gold whitespace-nowrap">{valueFor(row, metric)}</span>
											{:else}
												<span class="text-gray-300 whitespace-nowrap" title={tooltipFor(row, metric)}>
													{valueFor(row, metric)}
												</span>
											{/if}
										</div>
									</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}
</div>
