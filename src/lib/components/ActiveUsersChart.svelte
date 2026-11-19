<script lang="ts">
	import { onMount } from 'svelte';
	import { Chart, registerables } from 'chart.js';
	import { monthTicks } from '$lib/charts/axes';

	Chart.register(...registerables);

	export let series: Array<{
		label: string;
		data: Array<{ timestamp: number; value: number }>;
		color: string;
	}>;
	export let title: string;
	export let granularity: 'day' | 'week' | 'month';
	export let yAxisLabel: string = 'Unique Users';
	export let yAxisPosition: 'left' | 'right' = 'left';
	// When set, the built-in canvas legend is replaced by an HTML legend.
	// Each label in this array starts a new row.
	export let legendLineBreaks: string[] = [];
	// Labels listed here will be hidden (toggled off) on initial render.
	export let initiallyHidden: string[] = [];
	// Canvas height in pixels. Both live call sites - /nutzaps and the per-mint
	// page - pass 280, to match the sibling PerAppZapCharts beside them, so the
	// 400 default is inherited from the transplant and never exercised.
	export let heightPx: number = 400;
	// When true, wrap the canvas in the standard gray-800 card. Both live call
	// sites pass false, so the chart sits flush like its sibling PerAppZapCharts;
	// the `true` default is likewise unexercised. (Earlier comments here credited
	// both defaults to an /active-users page, which does not exist - see
	// nostrology-web#13.)
	export let wrapInCard: boolean = true;
	// When true, render the chart title as an HTML <h3> above the canvas
	// instead of via Chart.js's built-in plugins.title (which draws inside the
	// canvas). Matches the PerAppZapChart title treatment used on /nutzaps.
	export let titleAbove: boolean = false;

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;
	let hiddenDatasets = new Set<number>(
		series
			.map((s, i) => (initiallyHidden.includes(s.label) ? i : -1))
			.filter((i) => i >= 0)
	);

	function toggleDataset(index: number) {
		if (!chart) return;
		const ds = chart.data.datasets[index];
		ds.hidden = !ds.hidden;
		hiddenDatasets = ds.hidden
			? new Set([...hiddenDatasets, index])
			: new Set([...hiddenDatasets].filter((i) => i !== index));
		chart.update();
	}

	/**
	 * Convert a hex color like "#1abc9c" to "rgba(26,188,156,0.1)".
	 */
	function hexToRgba(hex: string, alpha: number): string {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `rgba(${r},${g},${b},${alpha})`;
	}

	onMount(() => {
		if (!canvas) return;

		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		// Build a sorted union of all timestamps across all series
		const tsSet = new Set<number>();
		for (const s of series) {
			for (const d of s.data) {
				tsSet.add(d.timestamp);
			}
		}
		const allTimestamps = Array.from(tsSet).sort((a, b) => a - b);

		// For each series, build a lookup and map values onto the shared timeline
		const datasets = series.map((s, i) => {
			const lookup = new Map<number, number>();
			for (const d of s.data) {
				lookup.set(d.timestamp, d.value);
			}
			return {
				label: s.label,
				data: allTimestamps.map((ts) => lookup.get(ts) ?? null),
				borderColor: s.color,
				backgroundColor: hexToRgba(s.color, 0.05),
				// Monotone: a smoothed curve must never dip or peak where the data does not
				// (a plain tension peaked above a month's value and off its month).
				cubicInterpolationMode: 'monotone' as const,
				fill: false,
				spanGaps: true,
				pointRadius: 0,
				pointHitRadius: 6,
				hidden: hiddenDatasets.has(i)
			};
		});

		const labels = allTimestamps.map(() => '');

		chart = new Chart(ctx, {
			type: 'line',
			data: { labels, datasets },
			options: {
				responsive: true,
				maintainAspectRatio: false,
				interaction: {
					mode: 'index',
					intersect: false
				},
				plugins: {
					title: {
						display: !titleAbove,
						text: title,
						color: '#f3f4f6',
						font: {
							size: 16
						}
					},
					legend: {
						// Disable the Chart.js canvas legend when titleAbove is set —
						// we render an HTML legend above the canvas instead, matching
						// the PerAppZapChart layout.
						display: !titleAbove && series.length > 1 && legendLineBreaks.length === 0,
						labels: {
							color: '#d1d5db',
							usePointStyle: true,
							pointStyle: 'line',
							generateLabels: (chart) =>
								Chart.defaults.plugins.legend.labels
									.generateLabels(chart)
									.map((item) => ({ ...item, lineWidth: 3 }))
						}
					},
					tooltip: {
						backgroundColor: 'rgba(0, 0, 0, 0.6)',
						usePointStyle: true,
						boxWidth: 8,
						boxHeight: 8,
						boxPadding: 4,
						callbacks: {
							title: (items) => {
								if (!items.length) return '';
								const idx = items[0].dataIndex;
								const ts = allTimestamps[idx];
								if (ts === undefined) return '';
								const date = new Date(ts * 1000);
								return date.toLocaleDateString('en-US', {
									year: 'numeric',
									month: 'long',
									day: 'numeric',
									timeZone: 'UTC'
								});
							},
							label: (context) => {
								const value = context.parsed.y;
								if (value === null || value === undefined) return '';
								return `${context.dataset.label}: ${Number(value).toLocaleString()}`;
							},
							labelColor: (context) => {
								const color = (context.dataset.borderColor as string) ?? '#ffffff';
								return {
									borderColor: color,
									backgroundColor: color,
									borderWidth: 2
								};
							}
						}
					}
				},
				scales: {
					x: {
						grid: {
							color: 'rgba(75,85,99,0.3)'
						},
						ticks: {
							color: '#9ca3af',
							maxRotation: 0,
							minRotation: 0,
							autoSkip: false,
							callback: monthTicks(allTimestamps, granularity)
						}
					},
					y: {
						type: 'linear',
						display: true,
						position: yAxisPosition,
						// From zero, in whole people. From its lowest value, a chart of 2 to 5 users
						// put 2 on the floor, where it read as none, and labelled 2.5 users.
						beginAtZero: true,
						grid: {
							color: 'rgba(75,85,99,0.3)'
						},
						ticks: {
							color: '#9ca3af',
							precision: 0
						},
						title: {
							display: true,
							text: yAxisLabel,
							color: '#9ca3af'
						}
					}
				}
			}
		});

		return () => {
			if (chart) {
				chart.destroy();
			}
		};
	});
</script>

<div class={wrapInCard ? 'bg-gray-800 rounded-lg p-6 border border-gray-700' : ''}>
	{#if titleAbove}
		<!-- titleAbove mode: heightPx covers the whole block (title + legend
		     + canvas) so the component matches the PerAppZapChart sibling on
		     /nutzaps. The HTML legend below the title takes the same vertical
		     space as PerAppZapChart's legend, ensuring the canvas (plot area)
		     ends up the same height as its siblings. -->
		<div class="flex flex-col" style="height: {heightPx}px">
			<h3 class="text-sm font-medium text-gray-100 text-center shrink-0 pb-1">{title}</h3>
			<div class="flex items-center justify-center gap-6 text-sm shrink-0 pb-1">
				{#each series as s, i}
					<button
						type="button"
						class="flex items-center gap-2 transition-colors {hiddenDatasets.has(i)
							? 'text-gray-500 line-through hover:text-gray-400'
							: 'text-gray-300 hover:text-white'}"
						on:click={() => toggleDataset(i)}
					>
						<span
							class="inline-block w-7 h-[3px] rounded-sm"
							style="background-color: {s.color}"
						></span>
						{s.label}
					</button>
				{/each}
			</div>
			<div class="flex-1 min-h-0">
				<canvas bind:this={canvas}></canvas>
			</div>
		</div>
	{:else}
		<div style="height: {heightPx}px">
			<canvas bind:this={canvas}></canvas>
		</div>
	{/if}
	{#if legendLineBreaks.length > 0 && series.length > 1}
		<div class="flex flex-wrap mt-3 gap-y-1.5">
			{#each series as s, i}
				{#if legendLineBreaks.includes(s.label)}
					<div class="basis-full"></div>
				{/if}
				<button
					class="flex items-center gap-1.5 mr-4 transition-opacity {hiddenDatasets.has(i) ? 'opacity-40' : ''}"
					on:click={() => toggleDataset(i)}
				>
					<svg width="24" height="12" class="shrink-0">
						<line x1="0" y1="6" x2="24" y2="6" stroke={s.color} stroke-width="3" />
					</svg>
					<span class="text-xs text-gray-300">{s.label}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>
