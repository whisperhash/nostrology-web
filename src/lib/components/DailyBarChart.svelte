<script lang="ts">
	import { onMount } from 'svelte';
	import { Chart, registerables } from 'chart.js';
	import { firstLabelRoom, monthTicks } from '$lib/charts/axes';

	Chart.register(...registerables);

	export let title: string;
	// One or more parallel daily series. Multiple datasets render as stacked
	// bars in input order (first dataset on bottom). Each series must share
	// the same timestamps as the others — they're zipped index-by-index.
	//
	// `stack` lets a dataset opt out of the default 'releases' stack and
	// render as an overlay bar at the same x position, in front of the
	// preceding bars (drawn-order = input-order, so put the overlay AFTER
	// the bar it should sit in front of). Datasets sharing a stack key
	// stack vertically and their heights sum; datasets in different stack
	// keys draw independently from y=0 and overlap. Example: bars
	// [{stack:'a'}, {stack:'b'}, {stack:'a'}] produce two stacked bars
	// (sum of stack 'a') with the 'b' overlay drawn over the lower one.
	//
	// `includeInTotal: false` excludes a dataset from the optional grand-
	// total rolling-average line. Use it for overlay subsets (e.g. a "new
	// apps" subset of "all native apps") to avoid double-counting.
	export let datasets: Array<{
		label: string;
		color: string;
		series: Array<{ timestamp: number; value: number }>;
		stack?: string;
		includeInTotal?: boolean;
	}>;
	export let yAxisLabel: string;
	// Optional N-day rolling-average overlay. When set, each input dataset
	// gets a corresponding line drawn on top of the stacked bars (same color
	// as the bar). If totalLineColor is also set, an additional Total line
	// is drawn for the rolling average of the per-day sum across all
	// datasets. Leading values (first window-1 indices) render as null so
	// the line begins at the first index where a full window of history is
	// available. Useful for revealing trend in noisy daily counts.
	export let rollingAverageWindow: number | undefined = undefined;
	export let totalLineColor: string | undefined = undefined;
	export let totalLineLabel: string = 'Total';

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;
	// Per-dataset visibility, mirrored from Chart.js for the custom HTML
	// legend below. Indices match the chartDatasets array we build in
	// onMount: bar datasets first (in input order), then optional rolling-
	// average lines (per-dataset, then optional Total). Every dataset starts
	// visible, and so does every key here, in the server's HTML too: an empty
	// array struck every key through until the chart mounted. The 2N + 1
	// entries cover every index the legend reads; after onMount and each
	// toggle the array is Chart.js's own flags.
	let datasetVisibility: boolean[] = Array(datasets.length * 2 + 1).fill(true);
	// Pixel offsets from the canvas edges to the plot area's edges, kept in
	// sync with Chart.js's `chartArea` via the `legendInsetsPlugin` below.
	// Applied as inline padding on the legend container so the bar items
	// (left) align with the plot's left edge and the line items (right)
	// align with the plot's right edge — past the right-axis ticks/title.
	let plotLeftPx = 0;
	let plotRightInsetPx = 0;

	function toggleDataset(index: number) {
		if (!chart) return;
		if (chart.isDatasetVisible(index)) {
			chart.hide(index);
		} else {
			chart.show(index);
		}
		datasetVisibility = chart.data.datasets.map((_, i) => chart!.isDatasetVisible(i));
	}

	// Index slices into the chart's dataset array, derived deterministically
	// from props so the HTML legend renders identically on SSR and client.
	// Layout in chartDatasets (built in onMount):
	//   [bars...] [per-dataset rolling-avg lines...] [optional avg Total line]
	$: barIndices = datasets.map((_, i) => i);
	// Lines appear in this fixed order: Total first (when present), then
	// per-dataset rolling-avg lines in input order. Mirrored in the tooltip
	// via `tooltipSortKey` below.
	$: lineIndices =
		rollingAverageWindow && rollingAverageWindow > 1
			? [
					...(totalLineColor ? [datasets.length * 2] : []),
					...datasets.map((_, i) => datasets.length + i)
				]
			: [];

	// Per-index label/color from props, mirroring exactly what onMount
	// pushes into chartDatasets. Single source of truth for the legend.
	function legendLabel(i: number): string {
		if (i < datasets.length) return datasets[i].label;
		const w = rollingAverageWindow ?? 0;
		if (i < datasets.length * 2) return `${datasets[i - datasets.length].label} - ${w}d avg`;
		return `${totalLineLabel} - ${w}d avg`;
	}
	function legendColor(i: number): string {
		if (i < datasets.length) return datasets[i].color;
		if (i < datasets.length * 2) return datasets[i - datasets.length].color;
		return totalLineColor ?? '#ffffff';
	}

	function rollingAvg(values: number[], window: number): Array<number | null> {
		return values.map((_, i) => {
			if (i + 1 < window) return null;
			let sum = 0;
			for (let j = i - window + 1; j <= i; j++) sum += values[j];
			// Round to nearest integer — the underlying data are integer
			// counts, so fractional averages add visual noise (sub-pixel
			// line positions) without information value, and tooltip
			// readouts read cleaner as whole numbers.
			return Math.round(sum / window);
		});
	}

	onMount(() => {
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const timestamps = datasets[0]?.series.map((d) => d.timestamp) ?? [];
		const labels = timestamps.map(() => '');

		// Mixed bar+line datasets — Chart.js's types make this awkward to
		// express precisely; matches the `any[]` pattern in PerAppZapChart.
		// `order` controls draw stacking: lower order is drawn LAST and
		// ends up ON TOP (Chart.js v4 quirk; see PerAppZapChart for the
		// same convention). Bars: order 2 (drawn first, behind). Lines:
		// order 1 (drawn after, on top of bars). Total line: order 0
		// (drawn last, on top of everything).
		const chartDatasets: any[] = datasets.map((ds) => ({
			type: 'bar',
			label: ds.label,
			data: ds.series.map((d) => d.value),
			backgroundColor: ds.color,
			borderColor: ds.color,
			borderWidth: 0,
			pointStyle: 'rect',
			stack: ds.stack ?? 'releases',
			order: 2
		}));

		if (rollingAverageWindow && rollingAverageWindow > 1) {
			// Per-dataset rolling-avg lines on top of the stacked bars.
			// Each line gets a unique `stack` value so the y-axis's
			// `stacked: true` (needed for the bars) does NOT also stack
			// the lines together — otherwise the lines plot at cumulative
			// y-positions instead of their own values.
			for (const [i, ds] of datasets.entries()) {
				const dailyValues = ds.series.map((d) => d.value);
				chartDatasets.push({
					type: 'line',
					label: `${ds.label} - ${rollingAverageWindow}d avg`,
					data: rollingAvg(dailyValues, rollingAverageWindow),
					borderColor: ds.color,
					backgroundColor: ds.color,
					// Hollow hover marker: only the point's fill is overridden
					// to transparent — the dataset's borderColor/backgroundColor
					// (and the tooltip swatch lookup that reads them) stay
					// untouched. pointBorderColor inherits ds.color via the
					// dataset's borderColor default.
					pointBackgroundColor: 'transparent',
					pointHoverBackgroundColor: 'transparent',
					pointHoverBorderWidth: 2,
					tension: 0.4,
					fill: false,
					spanGaps: false,
					pointRadius: 0,
					pointHitRadius: 6,
					borderWidth: 2,
					stack: `avg-${i}`,
					order: 1
				});
			}

			// Optional rolling-average of the per-day grand total across all
			// datasets — sits on top of the per-dataset avg lines. Datasets
			// with `includeInTotal: false` (e.g. overlay subsets of another
			// dataset) are excluded so they don't double-count.
			if (totalLineColor) {
				const totalDaily = timestamps.map((_, i) =>
					datasets.reduce(
						(sum, ds) => sum + (ds.includeInTotal === false ? 0 : ds.series[i]?.value ?? 0),
						0
					)
				);
				chartDatasets.push({
					type: 'line',
					label: `${totalLineLabel} - ${rollingAverageWindow}d avg`,
					data: rollingAvg(totalDaily, rollingAverageWindow),
					borderColor: totalLineColor,
					backgroundColor: totalLineColor,
					pointBackgroundColor: 'transparent',
					pointHoverBackgroundColor: 'transparent',
					pointHoverBorderWidth: 2,
					tension: 0.4,
					fill: false,
					spanGaps: false,
					pointRadius: 0,
					pointHitRadius: 6,
					borderWidth: 2,
					stack: 'avg-total',
					order: 0
				});
			}
		}

		// Inline plugin: draw line datasets with a soft black halo. The
		// rolling-average lines share colors with the bars they overlay
		// (same-color-as-the-bar by design); the halo separates the line
		// from the bar visually without changing line color.
		const lineHaloPlugin = {
			id: 'lineHalo',
			beforeDatasetDraw(chart: Chart, args: { index: number }) {
				const ds = chart.data.datasets[args.index] as any;
				if (ds?.type !== 'line') return;
				chart.ctx.save();
				chart.ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
				chart.ctx.shadowBlur = 6;
				chart.ctx.shadowOffsetX = 0;
				chart.ctx.shadowOffsetY = 0;
			},
			afterDatasetDraw(chart: Chart, args: { index: number }) {
				const ds = chart.data.datasets[args.index] as any;
				if (ds?.type !== 'line') return;
				chart.ctx.restore();
			}
		};

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
			type: 'bar',
			data: {
				labels,
				datasets: chartDatasets
			},
			plugins: [lineHaloPlugin, legendInsetsPlugin],
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
					// Built-in legend disabled — we render a custom HTML legend
					// above the canvas so the bar items can sit on the left and
					// the rolling-average lines right-aligned with proper line
					// glyphs (Chart.js's legend can't mix per-item alignment or
					// override individual swatch styles cleanly).
					legend: { display: false },
					tooltip: {
						backgroundColor: 'rgba(0, 0, 0, 0.6)',
						usePointStyle: true,
						boxWidth: 8,
						boxHeight: 8,
						boxPadding: 4,
						// Match the HTML legend ordering: bars first (in input
						// order), then Total avg, then per-dataset avg lines.
						// Chart.js's default sorts by the `order` property
						// (lowest first), which scrambles bars-vs-lines.
						itemSort: (a, b) => {
							const N = datasets.length;
							const key = (idx: number) => {
								if (idx < N) return idx; // bars: 0..N-1
								if (idx === N * 2) return N; // Total avg: slot N
								return idx + 1; // per-dataset avg: shifted past Total
							};
							return key(a.datasetIndex) - key(b.datasetIndex);
						},
						callbacks: {
							// Per-item swatch shape — line glyphs for line
							// datasets, rectangle for bars. Decoupled from the
							// dataset's pointStyle (which is left unset so the
							// canvas hover marker stays a circle).
							labelPointStyle: (context) => ({
								pointStyle: context.dataset.type === 'line' ? 'line' : 'rect',
								rotation: 0
							}),
							title: (items) => {
								if (!items.length) return '';
								const idx = items[0].dataIndex;
								const ts = timestamps[idx];
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
								const c =
									(context.dataset.backgroundColor as string) ||
									(context.dataset.borderColor as string) ||
									'#ffffff';
								return { borderColor: c, backgroundColor: c, borderWidth: 2 };
							}
						}
					}
				},
				scales: {
					x: {
						stacked: true,
						grid: {
							color: 'rgba(75,85,99,0.3)'
						},
						ticks: {
							color: '#9ca3af',
							maxRotation: 0,
							minRotation: 0,
							autoSkip: false,
							callback: monthTicks(timestamps)
						}
					},
					y: {
						stacked: true,
						type: 'linear',
						display: true,
						position: 'right',
						beginAtZero: true,
						grid: {
							color: 'rgba(75,85,99,0.3)'
						},
						ticks: {
							color: '#9ca3af',
							callback: (value) => Math.trunc(Number(value)).toLocaleString()
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

<!-- min-h (not fixed h) so a legend that wraps to multiple rows at narrow
	widths grows the container instead of stealing from the plot. Paired with
	the plot area's min-h floor below, this keeps the chart from collapsing to
	an atrophied height when the viewport narrows. -->
<div class="min-h-[357px] flex flex-col">
	<h3 class="text-sm font-medium text-gray-100 text-center shrink-0 pb-1">{title}</h3>
	<!-- Custom legend: bar items left-aligned to the plot area's left edge,
		rolling-average lines right-aligned to the plot area's right edge.
		Padding is inline rather than in Tailwind so it can track Chart.js's
		measured `chartArea` (driven by the legendInsetsPlugin in onMount).
		Click toggles dataset visibility, matching the Chart.js default
		behaviour we replaced. Each key says whether it is on in aria-pressed
		too, as /git's charts do, so a screen reader is told what the strike
		shows. -->
	<div
		class="flex items-center text-sm shrink-0 pb-1 gap-4"
		style="padding-left: {plotLeftPx}px; padding-right: {plotRightInsetPx}px;"
	>
		<div class="flex items-center gap-4 flex-wrap">
			{#each barIndices as i (i)}
				<button
					type="button"
					aria-pressed={datasetVisibility[i] === true}
					class="flex items-center gap-2 transition-colors {datasetVisibility[i]
						? 'text-gray-300 hover:text-white'
						: 'text-gray-500 line-through hover:text-gray-400'}"
					on:click={() => toggleDataset(i)}
				>
					<span
						class="inline-block w-3 h-3 rounded-sm shrink-0"
						style="background-color: {legendColor(i)}"
					></span>
					{legendLabel(i)}
				</button>
			{/each}
		</div>
		<div class="flex-1 flex items-center justify-end gap-4 flex-wrap">
			{#each lineIndices as i (i)}
				<button
					type="button"
					aria-pressed={datasetVisibility[i] === true}
					class="flex items-center gap-2 transition-colors {datasetVisibility[i]
						? 'text-gray-300 hover:text-white'
						: 'text-gray-500 line-through hover:text-gray-400'}"
					on:click={() => toggleDataset(i)}
				>
					<span
						class="inline-block w-7 h-[3px] rounded-sm shrink-0"
						style="background-color: {legendColor(i)}"
					></span>
					{legendLabel(i)}
				</button>
			{/each}
		</div>
	</div>
	<!-- min-h floor: at wide widths flex-1 gives the plot the full remaining
		budget (~309px) as before; at narrow widths, where the wrapped legend
		would otherwise squeeze this below usability, the floor holds the plot
		height and the container (min-h-[357px]) expands downward instead.
		The two magic numbers are coupled: at wide width the plot resolves to
		357 − title(~24px) − one legend row(~24px) ≈ 309px, and 280 sits below
		that with a ~29px buffer, so the floor stays inactive (and wide-width
		height is preserved bit-for-bit) until the legend wraps past two rows.
		If the title/legend typography changes, re-check that 280 < that
		remainder or the floor will silently shrink the wide-width chart. -->
	<div class="flex-1 min-h-[280px]">
		<canvas bind:this={canvas}></canvas>
	</div>
</div>
