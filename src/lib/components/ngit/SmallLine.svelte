<script lang="ts">
	// A small line chart over labelled buckets: the line charts of /git (cumulative
	// repositories, repositories pushed and maintainers pushing per week, comment authors and
	// threads). One or more series on one y-axis, plus optionally one series on its own axis
	// at the right (`rightSeries`), for two measures of different size in one chart - comment
	// authors and threads, where one axis flattened the authors - with a legend from two
	// series up. LineChart stays as it is for its callers; this adds what the bucketed series
	// here need: month/week labels, the capture wall and partial buckets drawn as faded
	// stretches of the line, and the same caption as StackedBars.
	import { onDestroy, onMount } from 'svelte';
	import { Chart, registerables } from 'chart.js';
	import type { DayTick } from '$lib/charts/day-axis-ticks';
	import {
		bucketState,
		bucketTickLabels,
		bucketTitle,
		rightLineDataset,
		secondAxisScale,
		smallLineDataset,
		statesPresent,
		type Bucket,
		type BucketState
	} from '$lib/ngit/series';
	import BucketNotes from './BucketNotes.svelte';

	Chart.register(...registerables);

	export let series: Array<{ label: string; color: string; values: (number | null)[] }>;
	/** One more series on its own y-axis at the right, titled `axisLabel`; both axis titles
	 * then take their series' colour, so each line reads against its own scale. */
	export let rightSeries: { label: string; color: string; values: (number | null)[]; axisLabel: string } | null = null;
	export let labels: string[];
	export let bucket: Bucket | null = null;
	export let dimBefore: string | null = null;
	export let partialLabel: string | null = null;
	export let partialFirstLabel: string | null = null;
	export let yAxisLabel: string = '';
	export let heightPx: number = 220;
	/** A 10% area wash under a single series. */
	export let fill: boolean = false;
	export let wallNote: string = 'before observation began: only what relays still served';
	export let partialNote: string = 'partial: the bucket is still filling';
	export let partialFirstNote: string = 'partial: data begins mid-bucket';
	/** One legend key for both partial buckets (BucketNotes); null keeps the two notes. */
	export let partialLegend: string | null = null;
	export let ariaLabel: string = '';

	const kind: Bucket = bucket ?? (/^\d{4}-\d{2}$/.test(labels[0] ?? '') ? 'month' : 'day');
	const marks = { dimBefore, partialLabel, partialFirstLabel };
	const states: BucketState[] = labels.map((l) => bucketState(l, marks));
	const present = statesPresent(labels, marks);

	// Faded-bucket keys in the caption use the series colour for one series, a neutral grey
	// for several: the caption explains fading, not identity.
	const NEUTRAL = '#94a3b8';

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;
	// One flag per dataset: the left-axis series, then the right one.
	const lines = [...series, ...(rightSeries ? [rightSeries] : [])];
	let hidden: boolean[] = lines.map(() => false);
	// The left axis title names its series in its colour when it holds exactly one.
	const leftTitleColor = rightSeries && series.length === 1 ? series[0].color : '#94a3b8';
	let tickCache: { w: number; labels: DayTick[] } = { w: -1, labels: [] };

	function toggle(i: number) {
		hidden[i] = !hidden[i];
		if (chart) {
			chart.setDatasetVisibility(i, !hidden[i]);
			chart.update();
		}
	}

	function noteFor(st: BucketState): string {
		return st === 'wall' ? wallNote : st === 'partial_first' ? partialFirstNote : st === 'partial_last' ? partialNote : '';
	}

	onMount(() => {
		const ctx = canvas?.getContext('2d');
		if (!ctx) return;
		const wash = fill && lines.length === 1;

		chart = new Chart(ctx, {
			type: 'line',
			data: {
				labels,
				// The faded stretches and the point drawn for an isolated value (a one-bucket
				// series): smallLineDataset, where they are unit-tested without a canvas.
				datasets: [
					...series.map((s) => smallLineDataset(s, states, wash)),
					...(rightSeries ? [rightLineDataset(rightSeries, states)] : [])
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				interaction: { mode: 'index', intersect: false },
				plugins: {
					legend: { display: false },
					tooltip: {
						callbacks: {
							title: (items) => (items.length ? bucketTitle(labels[items[0].dataIndex], kind) : ''),
							afterTitle: (items) => (items.length ? noteFor(states[items[0].dataIndex]) : ''),
							label: (item) => ` ${item.dataset.label}: ${Number(item.parsed.y).toLocaleString('en-US')}`
						}
					}
				},
				scales: {
					x: {
						grid: { color: 'rgba(148,163,184,0.08)' },
						ticks: {
							color: '#9ca3af',
							maxRotation: 0,
							minRotation: 0,
							autoSkip: false,
							callback(this: any, _v: unknown, i: number) {
								const w = this.chart?.width ?? 0;
								if (tickCache.w !== w) tickCache = { w, labels: bucketTickLabels(labels, kind, w) };
								return tickCache.labels[i];
							}
						}
					},
					y: {
						// drawn while a visible series uses it: hiding the only left series takes its axis away
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
					...(rightSeries ? { y2: secondAxisScale(rightSeries.axisLabel, rightSeries.color) } : {})
				}
			}
		});
	});

	onDestroy(() => chart?.destroy());
</script>

{#if lines.length > 1}
	<ul class="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="chart-legend">
		{#each lines as s, i (s.label)}
			<li>
				<button
					type="button"
					aria-pressed={!hidden[i]}
					class="flex items-center gap-2 transition-colors {hidden[i]
						? 'text-gray-400 line-through hover:text-gray-300'
						: 'text-gray-300 hover:text-white'}"
					on:click={() => toggle(i)}
				>
					<span class="inline-block h-[3px] w-5 shrink-0 rounded-sm" style="background-color: {s.color}"></span>
					{s.label}
				</button>
			</li>
		{/each}
	</ul>
{/if}
<!-- The accessible name sits on the wrapper: a canvas may not take role="img". -->
<div style="height: {heightPx}px" role="img" aria-label={ariaLabel || `${yAxisLabel} per ${kind}`}>
	<canvas bind:this={canvas}></canvas>
</div>
<BucketNotes
	{present}
	color={lines.length === 1 ? lines[0].color : NEUTRAL}
	variant="line"
	{wallNote}
	{partialNote}
	{partialFirstNote}
	{partialLegend}
/>
