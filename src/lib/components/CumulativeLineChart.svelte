<script lang="ts">
	import { onMount } from 'svelte';
	import { Chart, registerables } from 'chart.js';
	import { compactTicks, firstLabelRoom, monthTicks } from '$lib/charts/axes';

	Chart.register(...registerables);

	export let title: string;
	export let series: Array<{
		label: string;
		// Optional `secondaryValue` per point is opaque to the chart's axes —
		// it surfaces only in the tooltip when `formatSecondaryValue` is set.
		// Used by /lightning share charts to surface the absolute counterpart
		// (sats for sats-share, zaps for zap-share) alongside the % share.
		data: Array<{ timestamp: number; value: number; secondaryValue?: number }>;
		color: string;
	}>;
	export let yAxisLabel: string;
	// Outer container height in pixels. /zapstore uses the default 357 (a
	// standalone hero chart); /nutzaps/mints overrides to 420 to give the
	// multi-line + bottom legend room to breathe.
	export let heightPx: number = 357;
	// Color for the right y-axis ticks + title. Defaults to the same neutral
	// gray Chart.js uses for the x-axis. /nutzaps/mints overrides this to
	// orange so the axis matches the orange "Cumulative sats" axis convention
	// established by the Nutzap Sats chart on the /nutzaps Overview tab.
	export let yAxisColor: string = '#9ca3af';
	// Chart.js legend position. 'top' is the Chart.js default; 'bottom' suits
	// charts with many series (e.g. /nutzaps/mints top-N mints) where a top
	// legend would dominate the canvas height.
	export let legendPosition: 'top' | 'bottom' = 'top';
	// Formatter for tooltip values and, unless compactAxis, y-axis ticks. Default
	// formats as a thousands-separated integer (matches the original "Cumulative
	// Apps" / "Cumulative Sats" use case). Override for percent series, etc.
	export let formatValue: (n: number) => string = (n) =>
		Math.trunc(n).toLocaleString();
	// Y-axis ticks in k, M and B, running from zero, for a chart of large whole
	// numbers (/nutzaps/mints). formatValue still writes the tooltip, so that
	// keeps the exact figure.
	export let compactAxis: boolean = false;
	// Optional formatter for a per-point secondary value (carried on each
	// data point as `secondaryValue`). When both the point's secondary value
	// and this formatter are present, the tooltip appends ` (<formatted>)`
	// after the primary value. Y-axis ticks are unaffected.
	export let formatSecondaryValue: ((n: number) => string) | null = null;

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;

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

		const tsSet = new Set<number>();
		for (const s of series) for (const d of s.data) tsSet.add(d.timestamp);
		const allTimestamps = Array.from(tsSet).sort((a, b) => a - b);
		const labels = allTimestamps.map(() => '');

		// Parallel to `datasets`: per-series lookup of secondary value by
		// timestamp. Closed-over by the tooltip label callback below.
		const secondaryLookups: Array<Map<number, number>> = series.map((s) => {
			const m = new Map<number, number>();
			for (const d of s.data) {
				if (d.secondaryValue !== undefined) m.set(d.timestamp, d.secondaryValue);
			}
			return m;
		});

		const datasets = series.map((s) => {
			const lookup = new Map<number, number | null>();
			for (const d of s.data) lookup.set(d.timestamp, d.value);
			return {
				label: s.label,
				data: allTimestamps.map((ts) => lookup.get(ts) ?? null),
				borderColor: s.color,
				backgroundColor: hexToRgba(s.color, 0.05),
				tension: 0.4,
				fill: false,
				spanGaps: true,
				pointRadius: 0,
				pointHitRadius: 6,
				borderWidth: 2
			};
		});

		chart = new Chart(ctx, {
			type: 'line',
			data: { labels, datasets },
			options: {
				responsive: true,
				maintainAspectRatio: false,
				layout: firstLabelRoom,
				interaction: {
					mode: 'index',
					intersect: false
				},
				plugins: {
					title: { display: false },
					legend: {
						position: legendPosition,
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
								const primary = `${context.dataset.label}: ${formatValue(Number(value))}`;
								if (!formatSecondaryValue) return primary;
								const ts = allTimestamps[context.dataIndex];
								const sv =
									ts !== undefined
										? secondaryLookups[context.datasetIndex]?.get(ts)
										: undefined;
								return sv === undefined
									? primary
									: `${primary} (${formatSecondaryValue(sv)})`;
							},
							labelColor: (context) => {
								const color = (context.dataset.borderColor as string) ?? '#ffffff';
								return { borderColor: color, backgroundColor: color, borderWidth: 2 };
							}
						}
					}
				},
				scales: {
					x: {
						grid: { color: 'rgba(75,85,99,0.3)' },
						ticks: {
							color: '#9ca3af',
							maxRotation: 0,
							minRotation: 0,
							autoSkip: false,
							callback: monthTicks(allTimestamps)
						}
					},
					y: {
						type: 'linear',
						display: true,
						position: 'right',
						beginAtZero: compactAxis,
						grid: { color: 'rgba(75,85,99,0.3)' },
						ticks: {
							color: yAxisColor,
							...(compactAxis
								? compactTicks
								: { callback: (value: string | number) => formatValue(Number(value)) })
						},
						title: {
							display: true,
							text: yAxisLabel,
							color: yAxisColor
						}
					}
				}
			}
		});

		return () => {
			if (chart) chart.destroy();
		};
	});
</script>

<div class="flex flex-col" style="height: {heightPx}px">
	<h3 class="text-sm font-medium text-gray-100 text-center shrink-0 pb-1">{title}</h3>
	<div class="flex-1 min-h-0">
		<canvas bind:this={canvas}></canvas>
	</div>
</div>
