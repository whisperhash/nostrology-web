<script lang="ts">
	// One sortable column header in the /routstr providers-table grammar: click to sort by
	// the column, click again to flip; aria-sort says which column and which way.
	export let label: string;
	export let key: string;
	export let sortKey: string;
	export let sortDir: 'asc' | 'desc';
	export let right: boolean = false;
	export let onSort: (key: string) => void;
	/** Extra classes for the cell itself, for a column a narrow screen leaves out
	 * ("hidden sm:table-cell"): the header IS the `th`, so it cannot be wrapped in one. */
	export let cellClass: string = '';
</script>

<th
	class="py-2 pr-3 font-medium {right ? 'text-right' : ''} {cellClass}"
	aria-sort={sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
>
	<button
		type="button"
		class="inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-white {sortKey === key
			? 'text-white'
			: ''}"
		on:click={() => onSort(key)}
		aria-label="Sort by {label}"
	>
		{label}
		<span class="inline-block w-3 text-center">{sortKey === key ? (sortDir === 'desc' ? '\u2193' : '\u2191') : ''}</span>
	</button>
</th>
