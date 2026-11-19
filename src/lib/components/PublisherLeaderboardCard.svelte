<script lang="ts">
	import { onMount } from 'svelte';
	import PeriodSelector from '$lib/components/PeriodSelector.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import type {
		PublisherAppCount,
		PublisherZapTotals,
		ZapstorePublisherZapsLeaderboards
	} from '$lib/shared/data-types';

	type Period = '7d' | '30d' | '90d' | '6m' | '1y' | 'all';
	type AnyRow = PublisherAppCount | PublisherZapTotals;
	type ZapSort = 'sats' | 'count';
	type SortDir = 'asc' | 'desc';

	export let title: string;
	export let metric: 'apps' | 'sats' | 'count' | 'zaps';
	// 'apps'  → static lifetime app counts (no period selector)
	// 'sats'  → single-column: windowed total sats received
	// 'count' → single-column: windowed total zap-event count
	// 'zaps'  → combined: two sortable columns (Sats, Zaps); default sort sats DESC
	export let appData: PublisherAppCount[] | undefined = undefined;
	export let zapData: ZapstorePublisherZapsLeaderboards | undefined = undefined;
	export let initialPeriod: Period = '30d';
	// localStorage key base. When set, period is persisted at `${storageKey}.period`;
	// for metric='zaps', sort metric at `${storageKey}.sort` and direction at
	// `${storageKey}.dir`.
	export let storageKey: string | undefined = undefined;

	// The Total Zaps card (metric='zaps') exposes the full window set including
	// 3-month, 6-month, and all-time. Total Apps (metric='apps') is a static
	// lifetime count → no periods (empty list ⇒ selector hidden by the
	// `periodOptions.length > 1` gate, matching AppLeaderboardCard). The legacy
	// single-column sats/count modes keep the original three windows.
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
			: metric === 'apps'
				? []
				: [
						{ value: '7d', label: '7D' },
						{ value: '30d', label: '30D' },
						{ value: '1y', label: '1Y' }
					];

	const VALID_PERIODS: ReadonlySet<Period> =
		metric === 'zaps'
			? new Set<Period>(['7d', '30d', '90d', '6m', '1y', 'all'])
			: new Set<Period>(['7d', '30d', '1y']);
	const VALID_SORTS: ReadonlySet<ZapSort> = new Set<ZapSort>(['sats', 'count']);
	const VALID_DIRS: ReadonlySet<SortDir> = new Set<SortDir>(['desc', 'asc']);

	let selected: Period = initialPeriod;
	let sortBy: ZapSort = 'sats';
	let sortDir: SortDir = 'desc';

	$: periodKey = storageKey ? `${storageKey}.period` : undefined;
	$: sortKey = storageKey ? `${storageKey}.sort` : undefined;
	$: dirKey = storageKey ? `${storageKey}.dir` : undefined;

	onMount(() => {
		if (periodKey && metric !== 'apps') {
			try {
				const stored = localStorage.getItem(periodKey);
				if (stored && VALID_PERIODS.has(stored as Period)) {
					selected = stored as Period;
				}
			} catch (err) {
				console.warn(
					`PublisherLeaderboardCard: could not read ${periodKey} from localStorage`,
					err
				);
			}
		}
		if (metric === 'zaps' && sortKey) {
			try {
				const stored = localStorage.getItem(sortKey);
				if (stored && VALID_SORTS.has(stored as ZapSort)) {
					sortBy = stored as ZapSort;
				}
			} catch (err) {
				console.warn(
					`PublisherLeaderboardCard: could not read ${sortKey} from localStorage`,
					err
				);
			}
		}
		if (metric === 'zaps' && dirKey) {
			try {
				const stored = localStorage.getItem(dirKey);
				if (stored && VALID_DIRS.has(stored as SortDir)) {
					sortDir = stored as SortDir;
				}
			} catch (err) {
				console.warn(
					`PublisherLeaderboardCard: could not read ${dirKey} from localStorage`,
					err
				);
			}
		}
	});

	function changePeriod(p: Period): void {
		selected = p;
		if (!periodKey) return;
		try {
			localStorage.setItem(periodKey, p);
		} catch (err) {
			console.warn(`PublisherLeaderboardCard: could not persist ${periodKey} to localStorage`, err);
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
				console.warn(
					`PublisherLeaderboardCard: could not persist ${sortKey} to localStorage`,
					err
				);
			}
		}
		if (dirKey) {
			try {
				localStorage.setItem(dirKey, sortDir);
			} catch (err) {
				console.warn(
					`PublisherLeaderboardCard: could not persist ${dirKey} to localStorage`,
					err
				);
			}
		}
	}

	function sortPublisherRows(
		rows: PublisherZapTotals[],
		by: ZapSort,
		dir: SortDir
	): PublisherZapTotals[] {
		const mul = dir === 'desc' ? 1 : -1;
		return [...rows].sort((a, b) => {
			if (by === 'count') {
				if (b.total_count !== a.total_count) return mul * (b.total_count - a.total_count);
				if (b.total_sats !== a.total_sats) return mul * (b.total_sats - a.total_sats);
			} else {
				if (b.total_sats !== a.total_sats) return mul * (b.total_sats - a.total_sats);
				if (b.total_count !== a.total_count) return mul * (b.total_count - a.total_count);
			}
			return a.pubkey.localeCompare(b.pubkey);
		});
	}

	// Args explicit so Svelte's `$:` block below tracks them as dependencies —
	// a no-arg call would only re-run on `metric` changes, not on `selected`.
	function visibleRows(
		m: 'apps' | 'sats' | 'count' | 'zaps',
		apps: PublisherAppCount[] | undefined,
		zaps: ZapstorePublisherZapsLeaderboards | undefined,
		period: Period,
		by: ZapSort,
		dir: SortDir
	): AnyRow[] {
		if (m === 'apps') {
			// Server already sorts by app_count DESC; lifetime count is always > 0.
			return apps ?? [];
		}
		const windowed = (zaps?.[period] ?? []) as PublisherZapTotals[];
		if (m === 'sats') {
			// Drop publisher pubkeys whose zaps all had unparseable amounts (sats == 0).
			return windowed.filter((r) => r.total_sats > 0);
		}
		if (m === 'zaps') {
			const filtered = by === 'sats' ? windowed.filter((r) => r.total_sats > 0) : windowed;
			return sortPublisherRows(filtered, by, dir);
		}
		// 'count' — server-grouping guarantees count ≥ 1; resort by count desc,
		// tie-break by sats then pubkey.
		return sortPublisherRows(windowed, 'count', 'desc');
	}

	function valueFor(row: AnyRow): string {
		if (metric === 'apps') return (row as PublisherAppCount).app_count.toLocaleString();
		if (metric === 'sats') return `${(row as PublisherZapTotals).total_sats.toLocaleString()} sats`;
		return (row as PublisherZapTotals).total_count.toLocaleString();
	}

	function satsCell(row: AnyRow): string {
		return `${(row as PublisherZapTotals).total_sats.toLocaleString()} sats`;
	}
	function zapsCell(row: AnyRow): string {
		return (row as PublisherZapTotals).total_count.toLocaleString();
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

	$: rows = visibleRows(metric, appData, zapData, selected, sortBy, sortDir);
	$: valueHeader =
		metric === 'sats' ? 'Sats' : metric === 'count' ? 'Zaps' : metric === 'apps' ? 'Apps' : '';
	$: emptyNoun = metric === 'apps' ? 'publishers' : 'Zapstore-attributed zaps';
</script>

<div class="bg-gray-800 rounded-lg border border-gray-700 p-4 space-y-3">
	<div class="flex items-center justify-between gap-3 flex-wrap min-h-[2.25rem]">
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
								Publisher
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
						{#each rows as row, i (row.pubkey)}
							<tr class="hover:bg-gray-700/50 transition-colors">
								<td class="pl-3 pr-1 py-3 whitespace-nowrap text-sm text-gray-300">{i + 1}</td>
								<td class="px-3 py-3 text-sm text-gray-300">
									<a
										href="/zapstore/publishers/{row.pubkey}"
										class="flex items-center gap-2 min-w-0 hover:text-nostr-gold transition-colors"
										title={row.display_name}
									>
										<Avatar pictureUrl={row.picture_url} name={row.display_name} size="xs" />
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
												<span class="font-mono text-nostr-gold whitespace-nowrap">{valueFor(row)}</span>
											{:else}
												<span class="text-gray-300 whitespace-nowrap">{valueFor(row)}</span>
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
