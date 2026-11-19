<script lang="ts">
	// A bar chart over labelled buckets - months "YYYY-MM", ISO weeks labelled by their
	// Monday, or days - with one series, or several STACKED in input order (the first at the
	// bottom) or, with `grouped`, side by side in input order (the first at the left, thin bars
	// packed into each bucket: /git's new repositories per week, one bar per kind of host,
	// 2026-10-08), and optionally one LINE on a second y-axis at the right (`line`: a running
	// total over the bars, or a second measure such as first-time maintainers over new
	// repositories), its axis title in the line's colour. Written for /git; since 2026-10-08
	// it also draws /marketplaces' new listings per month, first-time sellers as the line, so
	// the two pages mark a partial bucket, and key bars and lines, the same way.
	//
	// The capture wall is drawn by the chart itself: buckets before `dimBefore` are faded,
	// because before capture the archive holds only what relays still served, not the
	// activity as it happened. A partial bucket at either end (data beginning mid-bucket, or
	// a bucket still filling) is faded AND outlined. Both are named in the tooltip and in a
	// caption under the plot (BucketNotes), so neither is carried by colour alone, and the
	// line is dimmed on every stretch that touches a faded bucket (totalLineDataset). A null
	// value is a bucket with no data (before a series began): no bar, and no tooltip row.
	import { onDestroy, onMount } from 'svelte';
	import { Chart, registerables, type ChartDataset } from 'chart.js';
	import type { DayTick } from '$lib/charts/day-axis-ticks';
	import {
		bucketState,
		bucketTickLabels,
		bucketTitle,
		fade,
		hasValue,
		secondAxisScale,
		statesPresent,
		totalLineDataset,
		type Bucket,
		type BucketState
	} from '$lib/ngit/series';
	import BucketNotes from './BucketNotes.svelte';

	Chart.register(...registerables);

	/** Parallel to `labels`: values[i] is the bucket labels[i]. */
	export let series: Array<{ label: string; color: string; values: (number | null)[] }>;
	/** A line over the bars on its own y-axis at the right, titled `axisLabel`. */
	export let line: { label: string; color: string; values: (number | null)[]; axisLabel: string } | null = null;
	export let labels: string[];
	/** Label granularity; omitted, "YYYY-MM" labels read as months and anything else as days. */
	export let bucket: Bucket | null = null;
	/** Labels strictly before this one are pre-capture (see wallBucket). */
	export let dimBefore: string | null = null;
	/** The trailing bucket that is still filling. */
	export let partialLabel: string | null = null;
	/** A leading bucket whose data begins mid-bucket. */
	export let partialFirstLabel: string | null = null;
	export let yAxisLabel: string;
	export let heightPx: number = 300;
	export let wallNote: string = 'before observation began: only what relays still served';
	export let partialNote: string = 'partial: the bucket is still filling';
	export let partialFirstNote: string = 'partial: data begins mid-bucket';
	/** One legend key for both partial buckets (BucketNotes); null keeps the two notes. */
	export let partialLegend: string | null = null;
	/** Accessible name of the plot; the caption carries the details. */
	export let ariaLabel: string = '';
	/** Several series side by side in each bucket instead of stacked. */
	export let grouped: boolean = false;
	/** Each bucket's total for the tooltip's footer, parallel to `labels`, when the bars are
	 * not parts of one whole (grouped bars that can overlap): the footer then gives this, as
	 * `totalLabel`. Unset, a stack's footer sums its segments and grouped bars have none. */
	export let totals: (number | null)[] | null = null;
	export let totalLabel: string = 'Total';

	const kind: Bucket = bucket ?? (/^\d{4}-\d{2}$/.test(labels[0] ?? '') ? 'month' : 'day');
	const marks = { dimBefore, partialLabel, partialFirstLabel };
	const states: BucketState[] = labels.map((l) => bucketState(l, marks));
	const present = statesPresent(labels, marks);
	const several = series.length > 1;
	const stacked = several && !grouped;
	// gray-800, the card's own surface: a 2px top edge in it separates stacked segments.
	const SURFACE = '#1f2937';
	// Faded-bucket keys in the caption use the series colour for one series, a neutral grey
	// for several: the caption explains fading, not identity.
	const NEUTRAL = '#94a3b8';

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;
	// One flag per dataset: the bar series, then the line.
	let hidden: boolean[] = [...series, ...(line ? [line] : [])].map(() => false);
	const legend = several || line !== null;
	// With a second axis, the left one is titled in its bars' colour when there is one series
	// (several have no one colour), as the right one is in its line's.
	const leftTitleColor = line && !several ? (series[0]?.color ?? '#94a3b8') : '#94a3b8';
	let tickCache: { w: number; labels: DayTick[] } = { w: -1, labels: [] };

	function noteFor(st: BucketState): string {
		return st === 'wall' ? wallNote : st === 'partial_first' ? partialFirstNote : st === 'partial_last' ? partialNote : '';
	}
	function bucketTotal(i: number): number {
		let t = 0;
		for (const s of series) t += s.values[i] ?? 0;
		return t;
	}
	function toggle(i: number) {
		hidden[i] = !hidden[i];
		if (!chart) return;
		// Grouped bars keep their slots: a hidden series' bars are emptied, not removed, since
		// Chart.js re-flows a group over its visible bars and the others would move into its
		// place - where a reader has learnt to find another series.
		if (grouped && i < series.length) chart.data.datasets[i].data = hidden[i] ? series[i].values.map(() => null) : series[i].values;
		else chart.setDatasetVisibility(i, !hidden[i]);
		chart.update();
	}

	onMount(() => {
		const ctx = canvas?.getContext('2d');
		if (!ctx) return;

		// Bars plus, optionally, the line: a mixed chart, typed as one.
		chart = new Chart<'bar' | 'line', (number | null)[], string>(ctx, {
			type: 'bar',
			data: {
				labels,
				datasets: [
					...series.map(
						(s): ChartDataset<'bar', (number | null)[]> => ({
							type: 'bar',
							label: s.label,
							data: s.values,
							backgroundColor: states.map((st) =>
								st === 'full' ? s.color : fade(s.color, st === 'wall' ? 0.3 : 0.35)
							),
							borderColor: states.map((st) => (st.startsWith('partial') ? fade(s.color, 0.85) : SURFACE)),
							// A partial bucket is outlined; a grouped bar only along its data end, since a
							// 1.5px outline all round a phone's 1px (or thinner) bar covers the faded fill.
							borderWidth: states.map((st) =>
								st.startsWith('partial')
									? grouped
										? { top: 1.5, right: 0, bottom: 0, left: 0 }
										: 1.5
									: stacked
										? { top: 2, right: 0, bottom: 0, left: 0 }
										: 0
							),
							// Rounded data-end, square at the baseline; in a stack Chart.js rounds only
							// the segment at the stack's edge. Grouped bars are thin and packed tight: a
							// group takes 45% of its bucket and each bar 80% of its slot, so with five
							// series a bar is 7.2% of a bucket and the gap between a bucket's bars 1.8%
							// (half the first cut's, 2026-10-08, with the radius and the width cap) - at
							// 15 weeks, 5.3px bars 1.3px apart on a desktop card and 1px bars 0.25px apart
							// on a phone, thinner as weeks are added. The gap is the slot a bar leaves
							// empty, never an edge in the surface colour, which on a phone's thin bars left
							// nothing of the bar to see.
							borderRadius: grouped ? 1 : 4,
							borderSkipped: 'start',
							maxBarThickness: grouped ? 7 : 24,
							...(grouped ? { barPercentage: 0.8, categoryPercentage: 0.45 } : { stack: 'buckets' }),
							order: 1
						})
					),
					...(line ? [totalLineDataset(line, states)] : [])
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				interaction: { mode: 'index', intersect: false },
				plugins: {
					legend: { display: false },
					tooltip: {
						// A null bucket (before the series began) has no value to show; rows in
						// dataset order, so the bars come before the line's total.
						filter: hasValue,
						itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
						callbacks: {
							title: (items) => (items.length ? bucketTitle(labels[items[0].dataIndex], kind) : ''),
							afterTitle: (items) => (items.length ? noteFor(states[items[0].dataIndex]) : ''),
							label: (item) => ` ${item.dataset.label}: ${Number(item.parsed.y).toLocaleString('en-US')}`,
							footer: (items) => {
								if (!items.length) return '';
								const i = items[0].dataIndex;
								if (totals) return totals[i] == null ? '' : `${totalLabel}: ${Number(totals[i]).toLocaleString('en-US')}`;
								return stacked ? `${totalLabel}: ${bucketTotal(i).toLocaleString('en-US')}` : '';
							}
						}
					}
				},
				scales: {
					x: {
						stacked: !grouped,
						grid: { display: false },
						ticks: {
							color: '#9ca3af',
							maxRotation: 0,
							minRotation: 0,
							// Density is decided here from the series' own bucket width, not by
							// autoSkip (which drops ticks blindly, the year-carrying ones included).
							autoSkip: false,
							callback(this: any, _v: unknown, i: number) {
								const w = this.chart?.width ?? 0;
								if (tickCache.w !== w) tickCache = { w, labels: bucketTickLabels(labels, kind, w) };
								return tickCache.labels[i];
							}
						}
					},
					y: {
						stacked: !grouped,
						// drawn while visible bars use it
						display: 'auto',
						beginAtZero: true,
						grid: { color: 'rgba(148,163,184,0.08)' },
						ticks: {
							color: '#94a3b8',
							precision: 0,
							callback: (v) => Number(v).toLocaleString('en-US')
						},
						title: { display: yAxisLabel !== '', text: yAxisLabel, color: leftTitleColor }
					},
					...(line ? { y2: secondAxisScale(line.axisLabel, line.color) } : {})
				}
			}
		});
	});

	onDestroy(() => chart?.destroy());
</script>

{#if legend}
	<!-- Each key takes its mark's shape: a square for a bar series, a stroke for the line. -->
	<ul class="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="chart-legend">
		{#each series as s, i (i)}
			<li>
				<button
					type="button"
					aria-pressed={!hidden[i]}
					class="flex items-center gap-2 transition-colors {hidden[i]
						? 'text-gray-400 line-through hover:text-gray-300'
						: 'text-gray-300 hover:text-white'}"
					on:click={() => toggle(i)}
				>
					<span class="inline-block h-3 w-3 shrink-0 rounded-sm" style="background-color: {s.color}" data-swatch="bar"></span>
					{s.label}
				</button>
			</li>
		{/each}
		{#if line}
			{@const i = series.length}
			<li>
				<button
					type="button"
					aria-pressed={!hidden[i]}
					class="flex items-center gap-2 transition-colors {hidden[i]
						? 'text-gray-400 line-through hover:text-gray-300'
						: 'text-gray-300 hover:text-white'}"
					on:click={() => toggle(i)}
				>
					<span class="inline-block h-[3px] w-5 shrink-0 rounded-sm" style="background-color: {line.color}" data-swatch="line"></span>
					{line.label}
				</button>
			</li>
		{/if}
	</ul>
{/if}
<!-- The accessible name sits on the wrapper: a canvas may not take role="img". -->
<div style="height: {heightPx}px" role="img" aria-label={ariaLabel || `${yAxisLabel} per ${kind}`}>
	<canvas bind:this={canvas}></canvas>
</div>
<BucketNotes
	{present}
	color={series.length === 1 ? series[0].color : NEUTRAL}
	variant="bar"
	{wallNote}
	{partialNote}
	{partialFirstNote}
	{partialLegend}
/>
