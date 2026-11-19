<script lang="ts">
	export let selected: string = '24hr';
	export let onChange: (period: string) => void;

	// Default to the full set; pass `periods=[...]` to render a subset (e.g.
	// `[{value:'7d',label:'7D'},{value:'30d',label:'30D'},{value:'1y',label:'1Y'}]`).
	export let periods: Array<{ value: string; label: string }> = [
		{ value: '1hr', label: '1H' },
		{ value: '24hr', label: '24H' },
		{ value: '7d', label: '7D' },
		{ value: '30d', label: '30D' },
		{ value: '90d', label: '90D' },
		{ value: '6m', label: '6M' },
		{ value: '1y', label: '1Y' }
	];
</script>

<div class="flex gap-1 bg-gray-800 rounded-lg p-1 border border-gray-700">
	{#each periods as period}
		<button
			on:click={() => onChange(period.value)}
			class="px-3 py-1.5 text-sm font-medium rounded-md transition-colors {selected === period.value
				? 'bg-nostr-purple text-white'
				: 'text-gray-400 hover:text-white hover:bg-gray-700'}"
		>
			{period.label}
		</button>
	{/each}
</div>
