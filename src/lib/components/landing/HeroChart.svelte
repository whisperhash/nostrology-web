<!--
	One panel's hero chart: the line, its fill, its last values and the months, drawn on the
	server from chartGeometry() ($lib/landing/heroChart), so the page carries the whole chart with
	no script. In the browser it adds what only a browser can: a hover readout (a crosshair, a dot
	on each line, the day's values in the surface page's own words), and each end label placed
	clear of the lines and of the figure band over the chart (the panel's [data-hc-avoid]
	elements), again whenever the plot's size changes - which includes its tab being opened.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { chartDay, type BoardChart } from '$lib/landing/board';
	import { chartGeometry, formatValue, VIEW } from '$lib/landing/heroChart';

	export let chart: BoardChart;
	/** Unique on the page: the fill gradients are referenced by id. */
	export let id: string;
	/** The chart's accessible name: what its lines count. */
	export let label: string;
	/** The plot's height in px, for the labels' static spacing. */
	export let h = 250;
	/** Headroom under the figure band (see ChartOptions.clear). */
	export let clear: { x: number; y: number } | undefined = undefined;

	$: g = chartGeometry(chart, { h, clear });

	let box: HTMLElement;
	let plot: HTMLElement;
	let labelEls: HTMLElement[] = [];

	// ---- the hover readout ----
	let hover: number | null = null;
	function onMove(e: PointerEvent) {
		const r = plot.getBoundingClientRect();
		if (!r.width || g.n < 2) return;
		const f = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
		hover = Math.round(f * (g.n - 1));
	}
	const longDay = (d: string) =>
		new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});
	$: hx = hover === null ? 0 : (hover / (g.n - 1)) * 100;
	$: when =
		hover === null
			? ''
			: longDay(chartDay(chart, hover)) +
				(chart.wall !== undefined && hover < chart.wall && chart.wallNote ? ` (${chart.wallNote})` : '');
	$: readout =
		hover === null
			? []
			: chart.series.map((s) => {
					const v = s.v[hover as number];
					return v === null || v === undefined
						? null
						: {
								color: s.color,
								name: s.label ? `${s.label}: ` : '',
								value: formatValue(s, v) + (s.unit ? ` ${s.unit}` : ''),
								top: (1 - v / g.yMax) * 100
							};
				});

	// ---- the end labels, placed clear of every line ----
	// Each label, in the series' order, takes the first of: above its line's end, below it, then
	// a step further out each way - the first spot where no line passes within 2 px, and no end
	// dot, other label or band text sits. A label with no such spot is hidden; the caption row
	// under the chart still names the series. `placed` is null until the browser has placed them
	// (the server's static rule decides until then).
	let placed: ({ top: number } | 'hidden')[] | null = null;
	function place() {
		if (!plot) return;
		const W = plot.clientWidth;
		const H = plot.clientHeight;
		if (!W || !H) return;
		const pr = plot.getBoundingClientRect();
		const taken: { l: number; r: number; t: number; b: number }[] = [];
		box.parentElement?.querySelectorAll('[data-hc-avoid]').forEach((el) => {
			const r = el.getBoundingClientRect();
			if (r.width) taken.push({ l: r.left - pr.left - 3, r: r.right - pr.left + 3, t: r.top - pr.top - 3, b: r.bottom - pr.top + 3 });
		});
		const yOf = (v: number) => (1 - v / g.yMax) * H;
		const endY = (k: number) => {
			const v = chart.series[k].v;
			for (let i = v.length - 1; i >= 0; i--) if (v[i] !== null) return yOf(v[i] as number);
			return null;
		};
		chart.series.forEach((_, k) => {
			const y = endY(k);
			if (y !== null) taken.push({ l: W - 7, r: W + 7, t: y - 7, b: y + 7 });
		});
		const n = g.n;
		const clearOf = (bx: { l: number; r: number; t: number; b: number }) => {
			if (bx.t < 0 || bx.b > H) return false;
			for (const o of taken) if (bx.l < o.r && bx.r > o.l && bx.t < o.b && bx.b > o.t) return false;
			for (const s of chart.series) {
				for (let x = Math.max(0, bx.l); x <= Math.min(W, bx.r); x += 2) {
					const val = s.v[Math.min(n - 1, Math.max(0, Math.round((x / W) * (n - 1))))];
					if (val === null || val === undefined) continue;
					const ly = yOf(val);
					if (ly >= bx.t - 2 && ly <= bx.b + 2) return false;
				}
			}
			return true;
		};
		const next: ({ top: number } | 'hidden')[] = [];
		g.ends.forEach((e, i) => {
			const el = labelEls[i];
			const y0 = endY(e.s);
			if (!el || y0 === null) {
				next.push('hidden');
				return;
			}
			// Measure it shown: a hidden label has no size. Then put `hidden` back as it was, so
			// the DOM stays what Svelte last set - Svelte skips an attribute it believes is
			// unchanged, and a label left un-hidden here would stay visible over its neighbour.
			const was = el.hidden;
			el.hidden = false;
			const w = el.offsetWidth;
			const lh = el.offsetHeight;
			el.hidden = was;
			let spot = null;
			for (const t of [y0 - 9 - lh, y0 + 9, y0 - 19 - lh, y0 + 19, y0 - 29 - lh, y0 + 29]) {
				const bx = { l: W - w, r: W, t, b: t + lh };
				if (clearOf(bx)) {
					spot = bx;
					break;
				}
			}
			if (!spot) {
				next.push('hidden');
				return;
			}
			next.push({ top: spot.t });
			taken.push({ l: spot.l - 4, r: spot.r + 4, t: spot.t - 3, b: spot.b + 3 });
		});
		placed = next;
	}

	onMount(() => {
		place();
		if (typeof ResizeObserver === 'undefined') return;
		const ro = new ResizeObserver(() => place());
		ro.observe(plot);
		return () => ro.disconnect();
	});
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
	class="hc"
	bind:this={box}
	role="img"
	aria-label={label}
	on:pointermove={onMove}
	on:pointerleave={() => (hover = null)}
>
	<div class="plot" bind:this={plot}>
		<svg viewBox="0 0 {VIEW} {VIEW}" preserveAspectRatio="none" aria-hidden="true">
			<defs>
				{#each g.series as s, k}
					{#if s.fill}
						<linearGradient id="{id}-g{k}" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0" style="stop-color: {s.color}; stop-opacity: 0.22" />
							<stop offset="1" style="stop-color: {s.color}; stop-opacity: 0" />
						</linearGradient>
					{/if}
				{/each}
			</defs>
			{#each g.series as s, k}
				{#each s.segments as seg}
					{#if seg.area}<path class="ha" class:faded={seg.faded} d={seg.area} fill="url(#{id}-g{k})" />{/if}
					<path class="hl" class:faded={seg.faded} d={seg.line} style="stroke: {s.color}" />
				{/each}
			{/each}
		</svg>
		{#each g.ends as e, i}
			<span
				class="hend"
				data-s={e.s}
				bind:this={labelEls[i]}
				style={placed && placed[i] !== 'hidden' ? `top: ${(placed[i] as { top: number }).top}px; transform: none` : `top: ${e.top}%`}
				hidden={placed ? placed[i] === 'hidden' : !e.shown}
				>{#if e.name}<em>{e.name}</em>{/if}{e.value}</span
			>
		{/each}
		{#if g.wall}
			<i class="hwall" style="left: {g.wall.left}%"><span>{g.wall.text}</span></i>
		{/if}
		{#each g.dots as d}
			<i class="hdot" style="top: {d.top}%; background: {d.color}"></i>
		{/each}
		{#if hover !== null}
			<i class="hguide" style="left: {hx}%"></i>
			{#each readout as r}
				{#if r}<i class="hpt" style="left: {hx}%; top: {r.top}%; background: {r.color}"></i>{/if}
			{/each}
			<div class="htip" class:flip={hx > 55} style="left: {hx}%">
				<b>{when}</b>
				{#each readout as r}
					{#if r}<span><i style="background: {r.color}"></i>{r.name}<b>{r.value}</b></span>{/if}
				{/each}
			</div>
		{/if}
	</div>
	<div class="hc-x" aria-hidden="true">
		{#each g.ticks as t}
			<span class:q={t.quarter} class:last={t.last} style="left: {t.left}%"
				>{t.month}{#if t.year}<small>{t.year}</small>{/if}</span
			>
		{/each}
	</div>
</div>

<style>
	/* The chart rules and the board's overrides, folded together for this chart as the board
	   draws it. `--hch`, the plot's height, comes from the board. */
	.hc [hidden] {
		display: none !important;
	}
	.hc {
		position: relative;
		height: calc(var(--hch, 240px) + 32px);
		cursor: crosshair;
		min-width: 0;
	}
	.plot {
		position: absolute;
		inset: 0 0 32px 0;
	}
	svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
		overflow: visible;
	}
	.hl {
		fill: none;
		stroke-width: 2.25;
		stroke-linejoin: round;
		stroke-linecap: round;
		vector-effect: non-scaling-stroke;
	}
	.faded {
		opacity: 0.35;
	}
	/* The last values, right, each at its line's end, named; the value in the text ink. */
	.hend {
		position: absolute;
		right: 0;
		transform: translateY(calc(-100% - 7px));
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12.5px;
		font-weight: 600;
		line-height: 1;
		color: var(--text);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
		pointer-events: none;
	}
	.hend em {
		font-style: normal;
		font-weight: 500;
		color: var(--muted);
		margin-right: 6px;
	}
	.hdot {
		position: absolute;
		right: -4px;
		width: 8px;
		height: 8px;
		margin-top: -4px;
		border-radius: 50%;
		box-shadow: 0 0 0 2px var(--bg);
		pointer-events: none;
	}
	/* The months, and the year under the first and January's. */
	.hc-x {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 32px;
	}
	.hc-x span {
		position: absolute;
		top: 7px;
		transform: translateX(-50%);
		font-size: 11px;
		line-height: 1;
		color: var(--dim);
		white-space: nowrap;
	}
	.hc-x span.last {
		transform: translateX(-100%);
	}
	.hc-x span small {
		display: block;
		margin-top: 3px;
		font-size: 10px;
		opacity: 0.8;
	}
	@media (max-width: 640px) {
		.hc-x span:not(.q) {
			display: none;
		}
	}
	/* Where observation began (Git-on-Nostr): the line is faded before it. Upright: the label
	   is an <i>, which a browser sets in italics (the operator's note, 2026-10-15). */
	.hwall {
		position: absolute;
		top: 0;
		bottom: 0;
		border-left: 1px dashed rgba(156, 163, 175, 0.5);
		pointer-events: none;
		font-style: normal;
	}
	/* It stops under the figure band, which sits over the chart from 1000 px. */
	@media (min-width: 1000px) {
		.hwall {
			top: 46%;
		}
	}
	.hwall span {
		position: absolute;
		left: 6px;
		bottom: 4px;
		font-size: 10px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--dim);
		white-space: nowrap;
	}
	/* The hover readout. */
	.hguide {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: rgba(229, 231, 235, 0.45);
		pointer-events: none;
	}
	.hpt {
		position: absolute;
		width: 8px;
		height: 8px;
		margin: -4px 0 0 -4px;
		border-radius: 50%;
		box-shadow: 0 0 0 2px var(--bg);
		pointer-events: none;
	}
	.htip {
		position: absolute;
		top: 6px;
		transform: translateX(10px);
		display: grid;
		gap: 2px;
		padding: 7px 10px 8px;
		border-radius: 8px;
		background: rgba(0, 0, 0, 0.82);
		color: #e5e7eb;
		font-size: 12px;
		line-height: 1.4;
		white-space: nowrap;
		pointer-events: none;
		z-index: 5;
	}
	.htip.flip {
		transform: translateX(calc(-100% - 10px));
	}
	.htip > b {
		color: #9ca3af;
		font-weight: 500;
		margin-bottom: 1px;
	}
	.htip span {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.htip span b {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.htip span i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex: 0 0 auto;
	}
</style>
