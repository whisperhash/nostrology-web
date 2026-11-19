<script lang="ts">
	// The caption under a bucket chart (/git's, and /marketplaces' new listings per month,
	// through StackedBars): one key per special bucket state that the chart actually contains
	// (a faded swatch for pre-capture buckets, an outlined one for a partial bucket). It is
	// what makes the capture wall readable without hovering and without decoding opacity -
	// the chart draws the wall, this says what it means.
	import { fade, type BucketState } from '$lib/ngit/series';

	export let present: Set<BucketState>;
	export let color: string;
	export let variant: 'bar' | 'line' = 'bar';
	export let wallNote: string;
	export let partialFirstNote: string;
	export let partialNote: string;
	/** One key for both partial buckets, in place of their two notes; the hover still says
	 * which partial bucket is which. */
	export let partialLegend: string | null = null;

	$: partial = partialLegend
		? [present.has('partial_first') || present.has('partial_last') ? { key: 'partial', note: partialLegend, outlined: true } : null]
		: [
				present.has('partial_first') ? { key: 'partial_first', note: partialFirstNote, outlined: true } : null,
				present.has('partial_last') ? { key: 'partial_last', note: partialNote, outlined: true } : null
			];
	$: items = [present.has('wall') ? { key: 'wall', note: wallNote, outlined: false } : null, ...partial].filter(
		(x): x is { key: string; note: string; outlined: boolean } => x !== null
	);
</script>

{#if items.length}
	<ul class="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-400" data-testid="bucket-notes">
		{#each items as it (it.key)}
			<li class="flex items-center gap-1.5" data-note={it.key}>
				{#if variant === 'bar'}
					<span
						class="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
						style="background: {fade(color, 0.3)}; {it.outlined ? `box-shadow: inset 0 0 0 1.5px ${fade(color, 0.85)}` : ''}"
					></span>
				{:else}
					<span class="inline-block h-[2px] w-4 shrink-0 rounded-sm" style="background: {fade(color, 0.35)}"></span>
				{/if}
				<span>{it.note}</span>
			</li>
		{/each}
	</ul>
{/if}
