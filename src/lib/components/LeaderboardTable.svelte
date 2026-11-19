<script lang="ts">
	export let headers: string[];
	export let rows: any[][];
	export let loading: boolean = false;
	export let onLoadMore: (() => void) | undefined = undefined;
	export let hasMore: boolean = false;
	export let offset: number = 0;
	export let sortable: boolean = false;
	export let defaultSortIndex: number | null = null;
	export let defaultSortDirection: 'asc' | 'desc' = 'desc';
	// Optional column index (within `rows`, so 0 = first data column) that
	// starts a "group" — that column gets extra left padding so a subset of
	// numeric columns visually clusters together. Used by /relays to split
	// "Users" from the {Read & Write, Read, Write, Read-only, Write-only} group.
	export let groupBoundary: number | null = null;
	// Optional floor on the scrollable area's height so callers can reserve
	// the table's final dimensions before data arrives — prevents layout
	// shift when an initially empty table fills in. Used by /relays.
	export let minHeightPx: number | null = null;

	// Hex pubkeys and event IDs are 64 chars; anything over this threshold in the
	// first column is assumed to be an identifier and gets truncated for display.
	const ID_TRUNCATION_THRESHOLD = 30;

	let tableContainer: HTMLDivElement;
	let sortIndex: number | null = sortable ? defaultSortIndex : null;
	let sortDirection: 'asc' | 'desc' = defaultSortDirection;

	function handleScroll() {
		if (!tableContainer || !onLoadMore || !hasMore || loading) return;

		const { scrollTop, scrollHeight, clientHeight } = tableContainer;
		if (scrollTop + clientHeight >= scrollHeight - 100) {
			onLoadMore();
		}
	}

	function formatPubkey(pubkey: string): string {
		if (!pubkey) return 'Unknown';
		return `${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`;
	}

	// "Structured" cells carry a `label` plus optional `href` and/or
	// `barFraction`. With `href` the label renders as an in-table link
	// (used by /nutzaps/mints to link mint names to per-mint detail pages
	// and by /relays for per-relay detail). Without `href` it renders as
	// plain text so callers can opt into the proportional bar without
	// being forced into a link (used by /lightning, which has no
	// per-provider detail page yet). The optional `barFraction` (0..1)
	// renders a thin proportional bar under the label — used by /relays
	// and /lightning to visualize each row's count relative to the global
	// max. Sorting uses the `label` regardless of which sub-shape is in
	// play, so a column can mix shapes safely.
	function isStructuredCell(
		cell: unknown
	): cell is { label: string; href?: string; barFraction?: number } {
		return (
			typeof cell === 'object' &&
			cell !== null &&
			'label' in cell &&
			typeof (cell as { label: unknown }).label === 'string'
		);
	}

	// Strip thousands separators and known suffixes (e.g. " sats") so formatted
	// display strings still sort numerically. Falls back to NaN for non-numeric
	// cells, in which case we compare as strings instead.
	function parseSortValue(cell: unknown): number | string {
		if (cell === null || cell === undefined) return '';
		if (typeof cell === 'number') return cell;
		// Structured cells sort by their visible label, not the URL.
		if (isStructuredCell(cell)) return cell.label.toLowerCase();
		const s = String(cell);
		const cleaned = s.replace(/,/g, '').replace(/\s*sats$/i, '').trim();
		const n = parseFloat(cleaned);
		if (!isNaN(n) && isFinite(n) && /^-?\d/.test(cleaned)) return n;
		return s.toLowerCase();
	}

	function handleHeaderClick(i: number) {
		if (!sortable) return;
		if (sortIndex === i) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			sortIndex = i;
			sortDirection = 'desc';
		}
	}

	$: displayRows = (() => {
		if (!sortable || sortIndex === null) return rows;
		const idx = sortIndex;
		const dir = sortDirection === 'asc' ? 1 : -1;
		return [...rows].sort((a, b) => {
			const av = parseSortValue(a[idx]);
			const bv = parseSortValue(b[idx]);
			if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
			return String(av).localeCompare(String(bv)) * dir;
		});
	})();
</script>

<div class="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
	<div
		class="overflow-x-auto max-h-[600px] overflow-y-auto"
		style={minHeightPx === null ? '' : `min-height: ${minHeightPx}px`}
		bind:this={tableContainer}
		on:scroll={handleScroll}
	>
		<table class="w-full">
			<thead class="bg-gray-900 sticky top-0 z-10">
				<tr>
					<!-- The # column shrink-to-contents by default, so its width swings
					     with the largest row index in view ("5" vs "16,642") and shifts
					     every column to its right when the dataset changes. min-w-[6rem]
					     reserves enough space for /relays' max 5-digit index (~88 px
					     content+padding) with a small buffer, while keeping the column
					     visually tight.

					     Cell padding is halved below `lg`. At px-6 the horizontal padding
					     alone costs ~48 px per cell — on /relays' 8 columns that is more
					     than an entire phone viewport, which is what squeezed the first
					     column down to an ellipsis.

					     The breakpoint is `lg`, NOT `sm`: the min-w floor below costs
					     ~71 px at EVERY width, so relief that stops at 640 px leaves the
					     640–1023 px band paying the floor without the rebate — measured
					     as a regression there (/relays overflow 62→133 px at 768 px, and
					     /nutzaps/mints gaining scroll it never had). `lg` also matches
					     /relays' own `lg:grid-cols-2`, so the page has one breakpoint
					     story rather than two. -->
					<th class="px-3 lg:px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-px min-w-[6rem]">
						#
					</th>
					{#each headers as header, i}
						<!-- Non-first columns shrink to content (w-px) and right-align so
						     numbers line up by digit and cluster on the right edge. The
						     first column claims remaining space and truncates long URLs.
						     groupBoundary adds extra left padding to visually separate
						     column groups (e.g. /relays splits "Users" from the rest). -->
						<th
							class="py-3 text-xs font-medium text-gray-400 uppercase tracking-wider {i === 0
								? 'px-3 lg:px-6 text-left min-w-[10rem]'
								: 'pr-3 lg:pr-6 text-right w-px'} {groupBoundary !== null && i === groupBoundary
								? 'pl-6 lg:pl-12'
								: i === 0
									? ''
									: 'pl-3 lg:pl-6'} {sortable
								? 'cursor-pointer select-none hover:text-gray-200'
								: ''}"
							on:click={() => handleHeaderClick(i)}
						>
							{header}{#if sortable && sortIndex === i}<span class="ml-1 text-gray-500">{sortDirection === 'asc' ? '▲' : '▼'}</span>{/if}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody class="divide-y divide-gray-700">
				{#each displayRows as row, i}
					<tr class="hover:bg-gray-700/50 transition-colors">
						<td class="px-3 lg:px-6 py-4 whitespace-nowrap text-sm text-gray-300">
							{offset + i + 1}
						</td>
						{#each row as cell, j}
							<!-- First column claims leftover space and truncates so long
							     relay/mint URLs ellipsize instead of pushing numeric
							     columns off-screen. Other columns shrink to content
							     (`w-px`) and right-align so numbers line up by digit.
							     `max-w-0` is what makes the ellipsis work inside an
							     auto-layout table: it sets the column's PREFERRED width to
							     zero so it absorbs whatever is left over. On a phone there
							     is nothing left over, so without a floor it collapsed to
							     the ellipsis itself (89 px measured on /relays — narrower
							     than the # column beside it). min-w-[10rem] is that floor;
							     the cap and the floor have to coexist. -->
							<td
								class="py-4 text-sm text-gray-300 {j === 0
									? 'px-3 lg:px-6 max-w-0 min-w-[10rem] truncate'
									: 'pr-3 lg:pr-6 whitespace-nowrap w-px text-right'} {groupBoundary !== null &&
								j === groupBoundary
									? 'pl-6 lg:pl-12'
									: j === 0
										? ''
										: 'pl-3 lg:pl-6'}"
							>
								{#if isStructuredCell(cell)}
									{#if cell.href}
										<a
											href={cell.href}
											title={cell.label}
											class="text-nostr-purple hover:text-nostr-gold transition-colors"
										>
											{cell.label}
										</a>
									{:else}
										<span title={cell.label}>{cell.label}</span>
									{/if}
									{#if cell.barFraction !== undefined}
										<!-- Thin proportional bar under the label. Width is scaled to
										     the dataset's max so #1 fills the cell. The right margin
										     leaves room so the bar doesn't crowd the next column, and
										     tracks the cell padding across the `sm` breakpoint. -->
										<div
											class="h-0.5 bg-nostr-purple/60 rounded-full mt-1.5 mr-3 lg:mr-6"
											style="width: {Math.max(0, Math.min(1, cell.barFraction)) * 100}%"
										></div>
									{/if}
								{:else if j === 0 && typeof cell === 'string' && cell.length > ID_TRUNCATION_THRESHOLD}
									<code class="text-xs bg-gray-900 px-2 py-1 rounded">{formatPubkey(cell)}</code>
								{:else if typeof cell === 'string' && cell.endsWith(' sats')}
									<span class="font-mono text-nostr-gold">{cell}</span>
								{:else}
									{cell}
								{/if}
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if loading}
		<div class="px-6 py-4 text-center text-gray-400">
			<span class="inline-block animate-spin">⚡</span> Loading more...
		</div>
	{/if}
	{#if !loading && hasMore && onLoadMore}
		<div class="px-6 py-4 text-center">
			<button
				on:click={onLoadMore}
				class="text-nostr-purple hover:text-nostr-gold transition-colors text-sm font-medium"
			>
				Load More
			</button>
		</div>
	{/if}
</div>
