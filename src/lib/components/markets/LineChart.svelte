<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Chart, registerables } from 'chart.js';
	import { dayTickLabels, monthStepForWidth, type DayTick } from '$lib/charts/day-axis-ticks';

	Chart.register(...registerables);

	// Daily cumulative series: [{ d: '2026-01-31', v: 1234 }, ...]
	export let series: Array<{ d: string; v: number }>;
	export let label: string;
	export let color: string = '#a78bfa';
	export let heightPx: number = 320;
	export let fill: boolean = true;
	// Y-axis title (the unit). Empty = no title, the pre-/routstr default.
	export let yAxisLabel: string = '';

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;
	const dayLabels = series.map((p) => p.d);
	let tickCache: { step: number; labels: DayTick[] } = { step: 0, labels: [] };

	onMount(() => {
		const ctx = canvas?.getContext('2d');
		if (!ctx) return;

		// The daily series runs to ~1,100 points. Chart.js draws every one of
		// them happily, but a visible point marker per day turns the line into
		// a caterpillar -- markers are therefore hover-only.
		const grad = ctx.createLinearGradient(0, 0, 0, heightPx);
		grad.addColorStop(0, color + '55');
		grad.addColorStop(1, color + '00');

		chart = new Chart(ctx, {
			type: 'line',
			data: {
				labels: series.map((p) => p.d),
				datasets: [
					{
						label,
						data: series.map((p) => p.v),
						borderColor: color,
						backgroundColor: fill ? grad : 'transparent',
						borderWidth: 2,
						fill,
						pointRadius: 0,
						pointHoverRadius: 4,
						pointHoverBackgroundColor: color,
						tension: 0.15
					}
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
							title: (items) => items[0].label,
							label: (item) => ` ${Number(item.parsed.y).toLocaleString()} ${label}`
						}
					}
				},
				scales: {
					x: {
						// Category scale, not `type: 'time'` -- chart.js needs a date
						// adapter for a time scale and this project ships none, so the
						// labels are ISO day strings and the callback below does the
						// formatting and the thinning.
						grid: { color: 'rgba(148,163,184,0.08)' },
						ticks: {
							color: '#9ca3af',
							maxRotation: 0,
							minRotation: 0,
							// Density is decided HERE, not by autoSkip. autoSkip drops
							// ticks blindly, and at ~700px it removed exactly the January
							// ones -- which are the only ticks carrying the year, leaving
							// an axis of bare "Oct / Apr" with no year anywhere. Stepping
							// by canvas width instead guarantees January always survives.
							autoSkip: false,
							// Month-change labels (see day-axis-ticks.ts): works for the
							// dense ~1,100-day series AND for sparse ones (weekly buckets,
							// catalog versions) that may contain no first-of-month day.
							// Recomputed only when the width-driven step changes.
							callback(this: any, _v: unknown, i: number) {
								const step = monthStepForWidth(this.chart?.width ?? 0);
								if (tickCache.step !== step) {
									tickCache = { step, labels: dayTickLabels(dayLabels, step) };
								}
								return tickCache.labels[i];
							}
						}
					},
					y: {
						beginAtZero: true,
						grid: { color: 'rgba(148,163,184,0.08)' },
						ticks: { color: '#94a3b8', callback: (v) => Number(v).toLocaleString() },
						title: { display: yAxisLabel !== '', text: yAxisLabel, color: '#94a3b8' }
					}
				}
			}
		});
	});

	onDestroy(() => chart?.destroy());
</script>

<div style="height: {heightPx}px">
	<canvas bind:this={canvas}></canvas>
</div>
