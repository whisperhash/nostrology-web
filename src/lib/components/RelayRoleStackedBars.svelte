<script lang="ts">
	import { onMount } from 'svelte';
	import { Chart, registerables } from 'chart.js';

	Chart.register(...registerables);

	export let relays: Array<{
		relay_url: string;
		user_count: number;
		both_count: number;
		read_count: number;
		write_count: number;
	}>;
	export let topN: number = 20;
	export let heightPx: number = 450;

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;

	function shortRelayUrl(url: string): string {
		return url.replace(/^wss?:\/\//, '');
	}

	onMount(() => {
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const top = relays.slice(0, topN);
		const labels = top.map((r) => shortRelayUrl(r.relay_url));
		const both = top.map((r) => (r.both_count / r.user_count) * 100);
		const readOnly = top.map((r) => ((r.read_count - r.both_count) / r.user_count) * 100);
		const writeOnly = top.map((r) => ((r.write_count - r.both_count) / r.user_count) * 100);
		const userCounts = top.map((r) => r.user_count);

		// Per-segment borderRadius can't reliably round the OUTER edge of the
		// combined bar when the rightmost segment is too thin to fit the
		// radius. Instead, clip the canvas to a rounded shape that spans
		// the entire stacked bar before the segments are drawn — see the
		// `roundedStackedBarsMask` plugin below. Each segment renders as a
		// plain rectangle and the clip cuts the corners off the union.
		const ROUND_RADIUS = 4;
		const roundedStackedBarsMask = {
			id: 'roundedStackedBarsMask',
			beforeDatasetsDraw(c: Chart) {
				const meta0 = c.getDatasetMeta(0);
				const meta1 = c.getDatasetMeta(1);
				const meta2 = c.getDatasetMeta(2);
				if (!meta0?.data?.length) return;
				const ctx2 = c.ctx;
				ctx2.save();
				ctx2.beginPath();
				for (let i = 0; i < meta0.data.length; i++) {
					const e0 = meta0.data[i] as unknown as {
						x: number;
						y: number;
						base: number;
						height: number;
					};
					const e1 = meta1.data[i] as unknown as { x: number };
					const e2 = meta2.data[i] as unknown as { x: number };
					const yCenter = e0.y;
					const thickness = e0.height;
					const xLeft = e0.base;
					const xRight = Math.max(e0.x, e1.x, e2.x);
					const yTop = yCenter - thickness / 2;
					const w = xRight - xLeft;
					if (w <= 0 || thickness <= 0) continue;
					const r = Math.min(ROUND_RADIUS, w / 2, thickness / 2);
					ctx2.moveTo(xLeft + r, yTop);
					ctx2.lineTo(xLeft + w - r, yTop);
					ctx2.quadraticCurveTo(xLeft + w, yTop, xLeft + w, yTop + r);
					ctx2.lineTo(xLeft + w, yTop + thickness - r);
					ctx2.quadraticCurveTo(xLeft + w, yTop + thickness, xLeft + w - r, yTop + thickness);
					ctx2.lineTo(xLeft + r, yTop + thickness);
					ctx2.quadraticCurveTo(xLeft, yTop + thickness, xLeft, yTop + thickness - r);
					ctx2.lineTo(xLeft, yTop + r);
					ctx2.quadraticCurveTo(xLeft, yTop, xLeft + r, yTop);
				}
				ctx2.clip();
			},
			afterDatasetsDraw(c: Chart) {
				c.ctx.restore();
			}
		};

		// The component mounts inside an {#await ... :then} branch on /relays,
		// so onMount fires immediately after the placeholder is swapped out.
		// At that exact moment the parent grid column may still be resolving
		// its final width — Chart.js then sizes the canvas to the default
		// 300 px instead of the actual ~640 px and the bars render against a
		// canvas that's a fraction of the visible card. A resize on the next
		// animation frame, after layout has settled, fixes it.
		let destroyed = false;
		requestAnimationFrame(() => {
			if (!destroyed && chart) chart.resize();
		});

		chart = new Chart(ctx, {
			type: 'bar',
			plugins: [roundedStackedBarsMask],
			data: {
				labels,
				datasets: [
					{
						label: 'Read & Write',
						data: both,
						backgroundColor: 'rgba(155, 89, 182, 0.85)',
						borderWidth: 0,
						stack: 'role'
					},
					{
						label: 'Read-only',
						data: readOnly,
						backgroundColor: 'rgba(52, 152, 219, 0.85)',
						borderWidth: 0,
						stack: 'role'
					},
					{
						label: 'Write-only',
						data: writeOnly,
						backgroundColor: 'rgba(243, 156, 18, 0.85)',
						borderWidth: 0,
						stack: 'role'
					}
				]
			},
			options: {
				indexAxis: 'y',
				responsive: true,
				maintainAspectRatio: false,
				plugins: {
					title: { display: false },
					legend: {
						labels: {
							color: '#d1d5db',
							usePointStyle: true,
							pointStyle: 'circle'
						}
					},
					tooltip: {
						backgroundColor: 'rgba(0, 0, 0, 0.6)',
						usePointStyle: true,
						boxWidth: 8,
						boxHeight: 8,
						boxPadding: 4,
						mode: 'index',
						axis: 'y',
						intersect: false,
						callbacks: {
							title: (items) => `${items[0].label} — ${userCounts[items[0].dataIndex].toLocaleString()} users`,
							label: (context) => {
								const value = context.parsed.x ?? 0;
								return `${context.dataset.label}: ${value.toFixed(1)}%`;
							},
							labelColor: (context) => {
								const color = (context.dataset.backgroundColor as string) ?? '#ffffff';
								return { borderColor: color, backgroundColor: color, borderWidth: 2 };
							}
						}
					}
				},
				scales: {
					x: {
						stacked: true,
						min: 0,
						max: 100,
						grid: { color: 'rgba(75,85,99,0.3)' },
						ticks: {
							color: '#9ca3af',
							callback: (v) => `${v}%`
						},
						title: {
							display: true,
							text: '% of users by role on this relay',
							color: '#9ca3af'
						}
					},
					y: {
						stacked: true,
						grid: { display: false },
						ticks: {
							color: '#d1d5db',
							font: { size: 11 }
						}
					}
				}
			}
		});

		return () => {
			destroyed = true;
			if (chart) chart.destroy();
		};
	});
</script>

<div class="flex flex-col" style="height: {heightPx}px">
	<h3 class="text-sm font-medium text-gray-100 text-center shrink-0 pb-1">
		Role mix — top {topN} relays
	</h3>
	<div class="flex-1 min-h-0">
		<canvas bind:this={canvas}></canvas>
	</div>
</div>
