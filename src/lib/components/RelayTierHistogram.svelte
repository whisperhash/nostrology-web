<script lang="ts">
	import { onMount } from 'svelte';
	import { Chart, registerables } from 'chart.js';

	Chart.register(...registerables);

	export let relays: Array<{ relay_url: string; user_count: number }>;
	// Server-side: distinct users who list ≥1 relay in each tier. A user can
	// appear in multiple tiers (whoever lists both a singleton and a mega-
	// relay counts in both), so the yellow bars do NOT sum to 100%.
	// Tier labels MUST match TIERS below.
	export let tierUserCounts: Array<{
		tier_label: string;
		users_in_tier: number;
		total_users: number;
	}>;
	export let heightPx: number = 380;

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;

	type Tier = { label: string; min: number; max: number };
	const TIERS: Tier[] = [
		{ label: '1', min: 1, max: 1 },
		{ label: '2–10', min: 2, max: 10 },
		{ label: '11–100', min: 11, max: 100 },
		{ label: '101–1k', min: 101, max: 1000 },
		{ label: '1k–10k', min: 1001, max: 10000 },
		{ label: '10k–100k', min: 10001, max: 100000 },
		{ label: '100k+', min: 100001, max: Number.POSITIVE_INFINITY }
	];

	onMount(() => {
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const totalRelays = relays.length;
		const totalUsers = tierUserCounts[0]?.total_users ?? 0;
		const usersByTier = new Map(tierUserCounts.map((t) => [t.tier_label, t.users_in_tier]));
		const tiers = TIERS.map((t) => {
			const inTier = relays.filter((r) => r.user_count >= t.min && r.user_count <= t.max);
			const usersInTier = usersByTier.get(t.label) ?? 0;
			return {
				...t,
				relay_count: inTier.length,
				users_in_tier: usersInTier,
				pct_relays: (inTier.length / totalRelays) * 100,
				pct_users: totalUsers > 0 ? (usersInTier / totalUsers) * 100 : 0
			};
		});

		chart = new Chart(ctx, {
			type: 'bar',
			data: {
				labels: tiers.map((t) => t.label),
				datasets: [
					{
						label: '% of relays',
						data: tiers.map((t) => t.pct_relays),
						backgroundColor: 'rgba(155, 89, 182, 0.85)',
						borderWidth: 0,
						borderRadius: 4,
						yAxisID: 'y'
					},
					{
						label: '% of users',
						data: tiers.map((t) => t.pct_users),
						backgroundColor: 'rgba(243, 156, 18, 0.85)',
						borderWidth: 0,
						borderRadius: 4,
						yAxisID: 'y'
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
						// Each bar gets its own one-line tooltip — `nearest` +
						// `intersect: true` prevents the default `index` mode
						// from showing both datasets at once.
						mode: 'nearest',
						intersect: true,
						callbacks: {
							// Title removed: the tier label is folded into the
							// single-line label below, so a separate header row
							// would be redundant.
							title: () => [],
							label: (context) => {
								const t = tiers[context.dataIndex];
								const tierUserWord = t.label === '1' ? 'user' : 'users';
								if (context.datasetIndex === 0) {
									const r = t.relay_count;
									const relayWord = r === 1 ? 'relay' : 'relays';
									return `${r.toLocaleString()} ${relayWord} (${t.pct_relays.toFixed(1)}%) with ${t.label} ${tierUserWord}`;
								}
								const u = t.users_in_tier;
								const userWord = u === 1 ? 'user' : 'users';
								return `${u.toLocaleString()} ${userWord} (${t.pct_users.toFixed(1)}%) list a relay with ${t.label} ${tierUserWord}`;
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
						grid: { display: false },
						ticks: { color: '#d1d5db' },
						title: {
							display: true,
							text: 'Relay users',
							color: '#9ca3af'
						}
					},
					y: {
						beginAtZero: true,
						grid: { color: 'rgba(75,85,99,0.3)' },
						ticks: {
							color: '#9ca3af',
							callback: (v) => `${v}%`
						},
						title: {
							display: true,
							text: '%',
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
		Distribution of relays and users
	</h3>
	<div class="flex-1 min-h-0">
		<canvas bind:this={canvas}></canvas>
	</div>
</div>
