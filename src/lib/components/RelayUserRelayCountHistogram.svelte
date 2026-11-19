<script lang="ts">
	import { onMount } from 'svelte';
	import { Chart, registerables } from 'chart.js';

	Chart.register(...registerables);

	export let buckets: Array<{ bucket: string; sort_key: number; user_count: number }>;
	export let heightPx: number = 380;

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;

	onMount(() => {
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		// Hide the synthetic "0 relays" bucket — it represents users whose
		// kind-10002 event landed with an empty relay list (not really an
		// adoption signal worth visualizing).
		const sorted = [...buckets].filter((b) => b.bucket !== '0').sort((a, b) => a.sort_key - b.sort_key);
		const totalUsers = sorted.reduce((acc, b) => acc + b.user_count, 0);
		const labels = sorted.map((b) => b.bucket);
		const counts = sorted.map((b) => b.user_count);
		const pcts = sorted.map((b) => (b.user_count / totalUsers) * 100);

		chart = new Chart(ctx, {
			type: 'bar',
			data: {
				labels,
				datasets: [
					{
						label: 'Number of users',
						data: counts,
						backgroundColor: 'rgba(52, 152, 219, 0.85)',
						borderWidth: 0,
						borderRadius: 4
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: {
					title: { display: false },
					legend: { display: false },
					tooltip: {
						backgroundColor: 'rgba(0, 0, 0, 0.6)',
						usePointStyle: true,
						boxWidth: 8,
						boxHeight: 8,
						boxPadding: 4,
						callbacks: {
							title: (items) => `${items[0].label} relay${items[0].label === '1' ? '' : 's'} listed`,
							label: (context) => {
								const idx = context.dataIndex;
								return `${counts[idx].toLocaleString()} users (${pcts[idx].toFixed(1)}%)`;
							},
							labelColor: () => ({
								borderColor: 'rgba(52, 152, 219, 0.85)',
								backgroundColor: 'rgba(52, 152, 219, 0.85)',
								borderWidth: 2
							})
						}
					}
				},
				scales: {
					x: {
						grid: { display: false },
						ticks: { color: '#d1d5db' },
						title: {
							display: true,
							text: 'Relays listed by user',
							color: '#9ca3af'
						}
					},
					y: {
						beginAtZero: true,
						grid: { color: 'rgba(75,85,99,0.3)' },
						ticks: {
							color: '#9ca3af',
							callback: (v) => Number(v).toLocaleString()
						},
						title: {
							display: true,
							text: 'Users',
							color: '#9ca3af'
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
	<h3 class="text-sm font-medium text-gray-100 text-center shrink-0 pb-1">
		How many relays do users list?
	</h3>
	<div class="flex-1 min-h-0">
		<canvas bind:this={canvas}></canvas>
	</div>
</div>
