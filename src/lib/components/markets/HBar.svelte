<script lang="ts">
	// Horizontal bars rendered as plain DOM rather than a canvas: the rows
	// double as a table (label, count, seller count), stay selectable, and
	// need no chart library.
	// A row may carry its own `color`, for a list whose rows fall in categories (/git's Clone
	// hosts, by kind of host), and `category` then names the category in words for whoever
	// cannot see the colour: a screen reader reads it after the label, and the bar's hover
	// title ends with it. `labelTitle` is the label's hover title where the label is a short
	// form of something longer (/git's htree://npub1abcd...wxyz, whose title is htree:// and the
	// whole key);
	// without it the hover shows the label itself.
	export let rows: Array<{
		label: string;
		value: number;
		sub?: number;
		color?: string;
		category?: string;
		labelTitle?: string;
	}>;
	export let subLabel: string = 'sellers';
	// What `value` counts. Some callers pass sellers, not listings, and the
	// hover title has to say which.
	export let valueLabel: string = 'listings';
	export let color: string = '#a78bfa';
	// Panels whose labels ARE the content (full sentences) need a wider first
	// column than a list of country names does.
	export let labelWidth: string = 'minmax(6.5rem,9rem)';
	// How a count is written. The default is the viewer's locale, as /marketplaces and
	// /routstr have always shown it; a page that writes every other number in one locale
	// passes its own formatter (/git: en-US), or a German reader sees "2.837" in these bars
	// beside "4,304" on the cards of the same page.
	export let format: (v: number) => string = (v) => v.toLocaleString();
	// When the rows split one whole (every user, bucketed), pass that whole as `total` and each
	// row also shows its share of it. Unset or 0, no share is shown - most callers' rows are a
	// top-N cut, whose shares of their own sum would mislead.
	export let total: number | undefined = undefined;
	export let formatShare: (share: number) => string = (s) => `${Math.round(s * 100)}%`;
	// Spread the rows over the height the parent gives them, first row at the top and last
	// at the bottom. For a list in a card that a grid row stretches beside a taller card, so
	// the two end on one line (/git's Clone hosts beside the GRASP servers table). The parent
	// must be a flex column that gives this its height; where it gives none (a card stacked on
	// a phone is only as tall as its content) the rows sit as they would without it.
	export let fill = false;

	$: max = Math.max(1, ...rows.map((r) => r.value));
	$: share = (v: number) => (total ? formatShare(v / total) : '');
</script>

<!-- Below `sm` the three columns collapse to two rows: on a 390px screen a
	 three-column grid leaves the bar ~40px wide, which carries no information
	 at all. Stacked, the bar gets the full width and stays readable. -->
<div class={fill ? 'flex flex-1 flex-col justify-between gap-2 sm:gap-1.5' : 'space-y-2 sm:space-y-1.5'} data-fill={fill ? '' : undefined}>
	{#each rows as r, i (i)}
		<div
			class="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[var(--lw)_1fr_auto]"
			style="--lw: {labelWidth}"
		>
			<span class="min-w-0 text-gray-300" title={r.labelTitle ?? r.label}>
				{r.label}
			</span>
			{#if r.category}
				<!-- Read after the label. sr-only is absolutely positioned, so it takes no grid cell. -->
				<span class="sr-only" data-category>{r.category}</span>
			{/if}
			<span class="flex items-baseline justify-end gap-1 tabular-nums sm:order-3">
				<span class="text-gray-200">{format(r.value)}</span>
				{#if total}
					<span class="w-10 text-right text-xs text-gray-400" data-share>{share(r.value)}</span>
				{/if}
				{#if r.sub !== undefined && subLabel}
					<span class="w-24 text-right text-xs text-gray-400">
						/ {format(r.sub)}
						{subLabel}
					</span>
				{/if}
			</span>
			<!-- The hover title is on the whole track, not the bar: a short bar is a few pixels wide. -->
			<div
				class="col-span-2 h-5 rounded bg-gray-700/40 sm:order-2 sm:col-span-1"
				title="{format(r.value)} {valueLabel}{total ? ` (${share(r.value)})` : ''}{r.category ? ` - ${r.category}` : ''}"
			>
				<div class="h-5 rounded" style="width: {(r.value / max) * 100}%; background: {r.color ?? color}" data-bar></div>
			</div>
		</div>
	{/each}
</div>
