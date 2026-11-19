<script lang="ts">
	import { onMount } from 'svelte';
	import { Chart, registerables } from 'chart.js';
	import { compactTicks, monthTicks } from '$lib/charts/axes';

	Chart.register(...registerables);

	export let title: string;
	export let dailySeries: Array<{ timestamp: number; value: number }>;
	export let cumulativeSeries: Array<{ timestamp: number; value: number }>;
	export let dailyLabel: string;
	export let cumulativeLabel: string;
	export let dailyColor: string;
	export let cumulativeColor: string;
	export let rightAxisLabel: string;
	// Optional release markers — each becomes a single point overlaid on the
	// cumulative line at (release_day, cumulative_value_at_that_day). `label`
	// is what the tooltip shows on hover (e.g. version string).
	export let releases: Array<{ timestamp: number; label: string }> = [];
	// Outer container height in pixels. /zapstore wants 420 (header chart);
	// the per-app detail page keeps the default for two stacked charts.
	export let heightPx: number = 280;

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;
	// Per-dataset visibility, mirrored from Chart.js for the custom HTML
	// legend. Indexes match the datasets array we build below: 0=daily bars,
	// 1=cumulative line, 2=releases (only when releases.length > 0). All
	// three default to visible; Chart.js syncs again after onMount.
	let datasetVisibility: boolean[] = [true, true, true];
	// Pixel offsets from the canvas edges to the plot area's edges, kept in
	// sync with Chart.js's `chartArea` via the `legendInsetsPlugin` below.
	// Applied as inline padding on the legend so the center pair (cumulative
	// + daily) ends up truly centered over the plot, and the right-aligned
	// Releases item lines up with the plot's right edge — past the right
	// y-axis ticks/title.
	let plotLeftPx = 0;
	let plotRightInsetPx = 0;

	function hexToRgba(hex: string, alpha: number): string {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `rgba(${r},${g},${b},${alpha})`;
	}

	function toggleDataset(index: number) {
		if (!chart) return;
		if (chart.isDatasetVisible(index)) {
			chart.hide(index);
		} else {
			chart.show(index);
		}
		datasetVisibility = chart.data.datasets.map((_, i) => chart!.isDatasetVisible(i));
	}

	onMount(() => {
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		// Build a sorted union of all timestamps across both series so daily and
		// cumulative values line up under a shared x axis (the SQL already
		// zero-fills both series across an identical 365-day window, so this is
		// effectively a pass-through — but the union is correct even if that
		// invariant ever drifts).
		const tsSet = new Set<number>();
		for (const d of dailySeries) tsSet.add(d.timestamp);
		for (const d of cumulativeSeries) tsSet.add(d.timestamp);
		const allTimestamps = Array.from(tsSet).sort((a, b) => a - b);

		const dailyLookup = new Map<number, number>();
		for (const d of dailySeries) dailyLookup.set(d.timestamp, d.value);
		const cumulativeLookup = new Map<number, number>();
		for (const d of cumulativeSeries) cumulativeLookup.set(d.timestamp, d.value);

		const dailyData = allTimestamps.map((ts) => dailyLookup.get(ts) ?? 0);
		const cumulativeData = allTimestamps.map((ts) => cumulativeLookup.get(ts) ?? null);
		const labels = allTimestamps.map(() => '');

		// Bucket releases by UTC midnight day so multiple same-day releases
		// (e.g. two version bumps, or several catalog-only apps listed the same day) collapse into one tooltip entry.
		const SECONDS_PER_DAY = 86400;
		const releasesByDay = new Map<number, string[]>();
		for (const r of releases) {
			const day = Math.floor(r.timestamp / SECONDS_PER_DAY) * SECONDS_PER_DAY;
			const arr = releasesByDay.get(day) ?? [];
			arr.push(r.label);
			releasesByDay.set(day, arr);
		}
		// Per-index parallel arrays: y-value (anchored at 0 on y1 — the
		// chart's x-axis baseline since both y and y1 use beginAtZero) +
		// tooltip label string. null y-values render no point at that index,
		// which is the chart's "no release that day" state.
		const releaseData = allTimestamps.map((ts) => (releasesByDay.has(ts) ? 0 : null));
		const releaseLabelsByIndex = allTimestamps.map((ts) =>
			releasesByDay.get(ts)?.join(', ') ?? null
		);
		const releaseColor = '#ffffff';

		const datasets: any[] = [
			{
				type: 'bar',
				label: dailyLabel,
				data: dailyData,
				backgroundColor: dailyColor,
				borderColor: dailyColor,
				borderWidth: 0,
				yAxisID: 'y',
				order: 2
			},
			{
				type: 'line',
				label: cumulativeLabel,
				data: cumulativeData,
				borderColor: cumulativeColor,
				backgroundColor: hexToRgba(cumulativeColor, 0.05),
				tension: 0.4,
				fill: false,
				spanGaps: true,
				pointRadius: 0,
				pointHitRadius: 6,
				borderWidth: 2,
				yAxisID: 'y1',
				order: 1
			}
		];
		if (releases.length > 0) {
			// order: 0 puts the dots ON TOP of the cumulative line (lower
			// `order` is drawn last among line-layer datasets in Chart.js v4 —
			// the opposite of what the docs imply, but verified empirically
			// from the existing chart's bar/line stack).
			datasets.push({
				type: 'line',
				label: 'Releases',
				data: releaseData,
				borderColor: releaseColor,
				backgroundColor: releaseColor,
				showLine: false,
				pointRadius: 3,
				pointHoverRadius: 4.5,
				pointHitRadius: 6,
				pointBorderWidth: 0,
				pointStyle: 'circle',
				yAxisID: 'y1',
				order: 0
			});
		}

		// Recompute plot-area insets after every layout pass (initial render
		// + responsive resizes). chartArea + chart.width are in CSS pixels,
		// matching the canvas's CSS box, so we can use them verbatim as
		// padding on the legend container directly above the canvas.
		const legendInsetsPlugin = {
			id: 'legendInsets',
			afterLayout(chart: Chart) {
				const a = chart.chartArea;
				plotLeftPx = Math.round(a.left);
				plotRightInsetPx = Math.round(chart.width - a.right);
			}
		};

		chart = new Chart(ctx, {
			data: {
				labels,
				datasets
			},
			plugins: [legendInsetsPlugin],
			options: {
				responsive: true,
				maintainAspectRatio: false,
				interaction: {
					mode: 'index',
					intersect: false
				},
				plugins: {
					// Title rendered as HTML above the legend so the order
					// stays title → legend → plot. Chart.js's in-canvas title
					// is disabled.
					title: { display: false },
					// Built-in legend disabled — we render a custom HTML legend
					// above the canvas to mix center-aligned line items with a
					// right-aligned Releases item (Chart.js's legend.align is a
					// single value for all items, so there's no native way to
					// achieve this layout).
					legend: { display: false },
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
								if (context.dataset.label === 'Releases') {
									const tag = releaseLabelsByIndex[context.dataIndex];
									return tag ? `Released: ${tag}` : '';
								}
								const value = context.parsed.y;
								if (value === null || value === undefined) return '';
								return `${context.dataset.label}: ${Number(value).toLocaleString()}`;
							},
							labelColor: (context) => {
								// For bar datasets borderColor may be unset / 0-width; fall back
								// to backgroundColor so the tooltip swatch renders the series color.
								const color =
									(context.dataset.borderColor as string) ||
									(context.dataset.backgroundColor as string) ||
									'#ffffff';
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
							callback: monthTicks(allTimestamps)
						}
					},
					y: {
						type: 'linear',
						display: true,
						position: 'left',
						beginAtZero: true,
						grid: {
							color: 'rgba(75,85,99,0.3)'
						},
						// Both axes in k, M and B: one chart never reads 100,000 on one side and
						// 350k on the other. The tooltip above keeps the exact figure.
						ticks: {
							color: dailyColor,
							...compactTicks
						},
						title: {
							display: true,
							text: dailyLabel,
							color: dailyColor
						}
					},
					y1: {
						type: 'linear',
						display: true,
						position: 'right',
						beginAtZero: true,
						grid: {
							drawOnChartArea: false
						},
						ticks: {
							color: cumulativeColor,
							...compactTicks
						},
						title: {
							display: true,
							text: rightAxisLabel,
							color: cumulativeColor
						}
					}
				}
			}
		});

		// Sync legend state from the just-created chart so the custom HTML
		// legend below reflects each dataset's actual hidden flag.
		datasetVisibility = chart.data.datasets.map((_, i) => chart!.isDatasetVisible(i));

		return () => {
			if (chart) {
				chart.destroy();
			}
		};
	});
</script>

<div class="flex flex-col" style="height: {heightPx}px">
	<h3 class="text-sm font-medium text-gray-100 text-center shrink-0 pb-1">{title}</h3>
	<!-- Custom legend: line items center-aligned (true centering via mirrored
		flex-1 spacers on either side); the Releases item right-aligned to the
		plot area's right edge — past the right y-axis ticks/title. Padding is
		inline so it can track Chart.js's measured `chartArea` (driven by the
		legendInsetsPlugin in onMount). Click toggles dataset visibility,
		matching the Chart.js default behavior we replaced. -->
	<div
		class="flex items-center text-sm shrink-0 pb-1"
		style="padding-left: {plotLeftPx}px; padding-right: {plotRightInsetPx}px;"
	>
		<div class="flex-1"></div>
		<div class="flex items-center gap-6">
			<button
				type="button"
				class="flex items-center gap-2 transition-colors {datasetVisibility[1]
					? 'text-gray-300 hover:text-white'
					: 'text-gray-500 line-through hover:text-gray-400'}"
				on:click={() => toggleDataset(1)}
			>
				<span
					class="inline-block w-7 h-[3px] rounded-sm"
					style="background-color: {cumulativeColor}"
				></span>
				{cumulativeLabel}
			</button>
			<button
				type="button"
				class="flex items-center gap-2 transition-colors {datasetVisibility[0]
					? 'text-gray-300 hover:text-white'
					: 'text-gray-500 line-through hover:text-gray-400'}"
				on:click={() => toggleDataset(0)}
			>
				<span
					class="inline-block w-7 h-[3px] rounded-sm"
					style="background-color: {dailyColor}"
				></span>
				{dailyLabel}
			</button>
		</div>
		<div class="flex-1 flex justify-end">
			{#if releases.length > 0}
				<button
					type="button"
					class="flex items-center gap-2 transition-colors {datasetVisibility[2]
						? 'text-gray-300 hover:text-white'
						: 'text-gray-500 line-through hover:text-gray-400'}"
					on:click={() => toggleDataset(2)}
				>
					<span class="inline-block w-2 h-2 rounded-full bg-white"></span>
					Releases
				</button>
			{/if}
		</div>
	</div>
	<div class="flex-1 min-h-0">
		<canvas bind:this={canvas}></canvas>
	</div>
</div>
