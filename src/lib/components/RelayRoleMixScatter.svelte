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
	// Long tail (~7,800 singletons) drowns the segmentation signal — filter to
	// relays with at least this many users. 1k keeps ~80 relays which still
	// shows the three archetypes clearly.
	export let minUsers: number = 1000;
	// When `heightPx` is null the wrapper uses `h-full` so the chart fills
	// whatever vertical space its parent gives it (used by /relays where O1
	// shares a grid row with the taller O2 stacked-bar chart).
	//
	// That only works while something in the chain HAS a definite height. On
	// /relays the grid collapses to one column below `lg`, so O1 no longer
	// shares a row with the 450 px O2 chart, `h-full` resolves against an
	// auto-height parent, and the canvas fell back to its 150 px intrinsic
	// default — a third of its intended size. The `min-h-[450px] lg:min-h-0` on
	// the wrapper below restores a definite height exactly where the
	// row-sharing stops (below `lg`), and releases it again at `lg` so the
	// original fill-the-row behaviour is unchanged on desktop. 450 px matches
	// O2 (RelayRoleStackedBars' default heightPx) so the stacked pair reads as
	// a matched set on a phone.
	export let heightPx: number | null = 315;

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;

	function shortRelayUrl(url: string): string {
		return url.replace(/^wss?:\/\//, '');
	}

	onMount(() => {
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const filtered = relays.filter((r) => r.user_count >= minUsers);
		const maxUsers = Math.max(...filtered.map((r) => r.user_count), 1);
		const points = filtered.map((r) => {
			const ro = ((r.read_count - r.both_count) / r.user_count) * 100;
			const wo = ((r.write_count - r.both_count) / r.user_count) * 100;
			// Bubble radius scaled by sqrt of user share so area ~ users.
			const radius = 4 + 24 * Math.sqrt(r.user_count / maxUsers);
			return {
				x: ro,
				y: wo,
				r: radius,
				_relay: r.relay_url,
				_users: r.user_count,
				_both: r.both_count,
				_read: r.read_count,
				_write: r.write_count
			};
		});

		chart = new Chart(ctx, {
			type: 'bubble',
			data: {
				datasets: [
					{
						label: `Relays (≥${minUsers.toLocaleString()} users)`,
						data: points as unknown as { x: number; y: number; r: number }[],
						backgroundColor: 'rgba(155, 89, 182, 0.45)',
						borderColor: 'rgba(155, 89, 182, 0.9)',
						borderWidth: 1
					}
				]
			},
			options: {
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
						callbacks: {
							title: (items) => {
								const p = items[0].raw as (typeof points)[number];
								return shortRelayUrl(p._relay);
							},
							label: (context) => {
								const p = context.raw as (typeof points)[number];
								const ro = p.x.toFixed(1);
								const wo = p.y.toFixed(1);
								const both = (100 - p.x - p.y).toFixed(1);
								return [
									`Users: ${p._users.toLocaleString()}`,
									`Read & Write: ${both}%`,
									`Read-only: ${ro}%`,
									`Write-only: ${wo}%`
								];
							},
							labelColor: () => ({
								borderColor: 'rgba(155, 89, 182, 0.9)',
								backgroundColor: 'rgba(155, 89, 182, 0.45)',
								borderWidth: 2
							})
						}
					}
				},
				scales: {
					x: {
						type: 'linear',
						min: 0,
						max: 100,
						grid: { color: 'rgba(75,85,99,0.3)' },
						ticks: {
							color: '#9ca3af',
							callback: (v) => `${v}%`
						},
						title: {
							display: true,
							text: '% Read-only',
							color: '#9ca3af'
						}
					},
					y: {
						type: 'linear',
						min: 0,
						max: 100,
						grid: { color: 'rgba(75,85,99,0.3)' },
						ticks: {
							color: '#9ca3af',
							callback: (v) => `${v}%`
						},
						title: {
							display: true,
							text: '% Write-only',
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

<div
	class="flex flex-col {heightPx === null ? 'h-full min-h-[450px] lg:min-h-0' : ''}"
	style={heightPx === null ? '' : `height: ${heightPx}px`}
>
	<h3 class="text-sm font-medium text-gray-100 text-center shrink-0 pb-1">
		Role-mix segmentation — % Read-only vs % Write-only
	</h3>
	<div class="flex-1 min-h-0">
		<canvas bind:this={canvas}></canvas>
	</div>
</div>
