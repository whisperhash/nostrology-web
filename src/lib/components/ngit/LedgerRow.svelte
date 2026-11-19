<script lang="ts">
	// One row of the /git exclusion ledger: the count removed, the rule in words, its unit
	// (the rows are NOT all in one unit - announcements, state coordinates, pushes,
	// comments - so every row says what it counts), and the pipeline's one-line reason. A
	// zero row is shown without a minus sign: the ledger ships every key even at zero.
	import type { NgitExclusionRow } from '$lib/shared/data-types';
	import { labelFor, LEDGER_LABEL, n, unitFor } from '$lib/ngit/format';

	export let row: NgitExclusionRow;
	export let showUnit: boolean = true;
	/** Rows outside the announcement ledger proper are drawn a step quieter. */
	export let muted: boolean = false;
</script>

<div class="flex items-baseline gap-3 border-l-2 pl-3 {muted ? 'border-gray-700' : 'border-gray-600'}" data-ledger-row>
	<span class="w-20 shrink-0 text-right font-mono tabular-nums {muted ? 'text-red-300/80' : 'text-red-300'}"
		>{#if row.v !== 0}&minus;{/if}{n(row.v)}</span
	>
	<span>
		<span class="text-gray-200">{labelFor(LEDGER_LABEL, row.k)}</span>
		{#if showUnit}
			<span class="text-xs text-gray-400">({unitFor(row.unit, row.v)})</span>
		{/if}
		<span class="text-sm text-gray-400"> - {row.why}</span>
	</span>
</div>
