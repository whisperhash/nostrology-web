<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Chart, registerables } from 'chart.js';

	Chart.register(...registerables);

	export let rows: Array<{ label: string; value: number; sub?: number }>;
	export let colors: string[];
	export let heightPx: number = 300;
	export let centerTitle: string = '';
	export let centerSub: string = '';
	// What one unit of `value` is, for the hover tooltip ("12 listings (4.0%)"). Defaults
	// to /marketplaces' unit so that page is unchanged; other callers name their own.
	export let unitLabel: string = 'listings';
	// How a count is written in the tooltip: the viewer's locale unless the page passes its
	// own formatter (as HBar's `format`).
	export let format: (v: number) => string = (v) => v.toLocaleString();

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;
	let hovering = false;

	// Attached as an action rather than `on:mouseleave`, so a purely visual
	// reset on a presentational <div> does not trip the a11y lint that wants an
	// ARIA role on any element carrying a mouse handler. There is nothing here
	// for a keyboard user to reach: the same numbers are in the legend below.
	function resetOnLeave(node: HTMLElement) {
		const off = () => (hovering = false);
		node.addEventListener('mouseleave', off);
		return { destroy: () => node.removeEventListener('mouseleave', off) };
	}

	onMount(() => {
		const ctx = canvas?.getContext('2d');
		if (!ctx) return;
		const total = rows.reduce((a, r) => a + r.value, 0);

		chart = new Chart(ctx, {
			type: 'doughnut',
			data: {
				labels: rows.map((r) => r.label),
				datasets: [
					{
						data: rows.map((r) => r.value),
						backgroundColor: colors,
						borderColor: '#1f2937', // gray-800, the card's own background
						borderWidth: 2,
						hoverOffset: 6
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				cutout: '62%',
				onHover: (_e, els) => {
					hovering = els.length > 0;
				},
				plugins: {
					legend: { display: false },
					tooltip: {
						callbacks: {
							label: (item) => {
								const v = Number(item.parsed);
								const pct = total ? ((v / total) * 100).toFixed(1) : '0';
								return ` ${format(v)} ${unitLabel} (${pct}%)`;
							}
						}
					}
				}
			}
		});
	});

	onDestroy(() => chart?.destroy());
</script>

<div class="relative" style="height: {heightPx}px" use:resetOnLeave>
	<canvas bind:this={canvas}></canvas>
	{#if centerTitle}
		<div
			class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center
				transition-opacity duration-150 {hovering ? 'opacity-0' : 'opacity-100'}"
		>
			<div class="text-2xl font-bold text-white">{centerTitle}</div>
			<div class="text-xs text-gray-400">{centerSub}</div>
		</div>
	{/if}
</div>
