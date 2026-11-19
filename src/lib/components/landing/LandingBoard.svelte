<!--
	The landing's board (the operator's pick of 2026-10-15): one
	surface's chart at a time, drawn across the page with its figure, its change and a way in over
	the chart's top-left corner; the roster of every surface under it, which switches the chart;
	"more domains on the way" over the roster's end; and whatever the page puts under the roster
	(the MCP bar).

	Every panel is rendered; the closed ones are only `hidden`, so a reader without script, and
	every crawler, gets all five figures, charts and links. Without script the tab open on load
	(Marketplaces) is the one that shows.

	A panel whose data has not loaded since the server started (board.ts `live`/`chart`) shows its
	typed fallback figure and, where the chart would be, a quiet note of the same height, so
	nothing below it moves.
-->
<script lang="ts">
	import HeroChart from './HeroChart.svelte';
	import type { Board, DomainKey } from '$lib/landing/board';

	export let board: Board;

	let open: DomainKey = board.initial;

	// The figure band's footprint over the chart, as measured when the board was designed:
	// about 64% of the width and 40% of the height at 1000 px, the narrowest width at which
	// the band sits over the chart; the chart's scale keeps every line under it, with a margin.
	const CLEAR = { x: 0.67, y: 0.45 };
	const nf = new Intl.NumberFormat('en-US');
	const fmt = (v: number) => nf.format(v);

	function keyed(e: KeyboardEvent, i: number) {
		// The tabs pattern's arrow keys, in addition to Tab: left/right (and Home/End) move
		// between the surfaces and open the one reached.
		const keys = board.panels.map((p) => p.key);
		let j = i;
		if (e.key === 'ArrowRight') j = (i + 1) % keys.length;
		else if (e.key === 'ArrowLeft') j = (i - 1 + keys.length) % keys.length;
		else if (e.key === 'Home') j = 0;
		else if (e.key === 'End') j = keys.length - 1;
		else return;
		e.preventDefault();
		open = keys[j];
		(document.getElementById(`bt-${keys[j]}`) as HTMLElement | null)?.focus();
	}
</script>

<div class="board rv">
	<div class="board-panels" data-fold="charts">
		{#each board.panels as p (p.key)}
			<div
				class="board-panel"
				id="bp-{p.key}"
				data-key={p.key}
				data-live={p.live}
				role="tabpanel"
				aria-labelledby="bt-{p.key}"
				style="--accent: {p.accent}; --on-accent: {p.onAccent}"
				hidden={open !== p.key}
			>
				<div class="wrap band">
					<span class="bo-k" data-hc-avoid><i></i>{p.label}</span>
					<div class="band-row">
						<span
							class="bo-n"
							class:num={p.key === board.initial}
							data-to={p.value}
							data-hc-avoid>{fmt(p.value)}</span
						>
						<!-- The {' '}s are for the accessible name ("123% in 12 months", not
						     "123%in 12 months"): between flex items a space is not drawn. -->
						<span class="bo-u" data-hc-avoid
							><span class="u1">{p.unit}</span>{#if p.change}{' '}<span class="u2"
									><span class="pill"
										><svg class="up" viewBox="0 0 10 8" aria-hidden="true"><path d="M5 0L10 8H0z" /></svg
										>{p.change.pct}%</span
									>{' '}{p.change.per}</span
								>{/if}</span
						>
						<a class="cta" href={p.href} data-hc-avoid
							>Explore {p.label}<span class="arr" aria-hidden="true">&rarr;</span></a
						>
					</div>
				</div>
				{#if p.chart}
					<HeroChart
						chart={p.chart}
						id="hc-{p.key}"
						label="{p.label}: {p.caption}, last 12 months"
						h={250}
						clear={CLEAR}
					/>
					<div class="board-cap">
						{#if p.chart.series.length === 1}<i class="ck1" style="background: {p.chart.series[0].color}"></i>{/if}<span
							class="cap-t">{p.caption}</span
						>{#if p.chart.series.length > 1}{#each p.chart.series as s}{' '}<span class="ck"
									><i style="background: {s.color}"></i>{s.label}</span
								>{/each}{/if}
					</div>
				{:else}
					<div class="hc-none"><p>Chart unavailable right now.</p></div>
					<div class="board-cap"><span class="cap-t">{p.caption}</span></div>
				{/if}
			</div>
		{/each}
	</div>
	<div class="wrap">
		<div class="roster-more"><span><i aria-hidden="true"></i>more domains on the way</span></div>
		<div class="board-tabs" role="tablist" aria-label="Surfaces" data-fold="roster">
			{#each board.panels as p, i (p.key)}
				<!-- The spaces between a cell's parts are for its accessible name ("Zapstore 4,773
				     apps", not "Zapstore4,773apps"): between grid items a space is not drawn. -->
				<button
					type="button"
					role="tab"
					id="bt-{p.key}"
					data-key={p.key}
					aria-selected={open === p.key}
					tabindex={open === p.key ? 0 : -1}
					aria-controls="bp-{p.key}"
					style="--accent: {p.accent}"
					on:click={() => (open = p.key)}
					on:keydown={(e) => keyed(e, i)}
					><i class="bt-dot"></i>{' '}<span class="bt-name"
						>{p.label}{#if p.isNew}{' '}<span class="bt-new">New</span>{/if}</span
					>{' '}<span class="bt-n">{fmt(p.value)}{' '}<small>{p.shortUnit}</small></span></button
				>
			{/each}
		</div>
		<slot />
	</div>
</div>

<style>
	/* The board's own rules. The palette and --maxw come
	   from the page's .landing; `--accent` and `--on-accent` are set per panel and per tab. */
	/* The page's reveal gate (+page.svelte), for this component's own .rv: hidden only once
	   has-gsap confirms the animation library loaded, so a failed asset leaves it visible. */
	:global(.has-gsap) .board.rv {
		opacity: 0;
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.has-gsap) .board.rv {
			opacity: 1;
		}
	}
	.wrap {
		width: 100%;
		max-width: var(--maxw);
		margin: 0 auto;
		padding: 0 22px;
	}

	/* ---------- the panels: one surface's chart, edge to edge, the figure over its corner ---------- */
	.board-panels {
		position: relative;
	}
	.board-panel {
		position: relative;
		padding: 0 22px;
		/* the plot's height, read by HeroChart */
		--hch: clamp(240px, 34vh, 330px);
	}
	.board-panel[hidden] {
		display: none;
	}
	/* A laptop's short viewport (about 690 px tall): a shorter plot keeps the MCP bar above the
	   fold. */
	@media (min-width: 1000px) and (max-height: 760px) {
		.board-panel {
			--hch: 200px;
		}
	}

	/* The figure band: over the chart's top-left corner from 1000 px (the chart's scale keeps
	   every line under it), above the chart below that. */
	.band {
		pointer-events: none;
	}
	.band a {
		pointer-events: auto;
	}
	@media (min-width: 1000px) {
		.band {
			position: absolute;
			left: 0;
			right: 0;
			top: 0;
			z-index: 2;
		}
	}
	@media (max-width: 999px) {
		.board-panel .band {
			padding: 0 0 12px;
		}
	}
	.bo-k {
		display: inline-flex;
		align-items: center;
		font-size: 13.5px;
		font-weight: 600;
		color: var(--muted);
		white-space: pre-wrap;
	}
	.bo-k i {
		width: 9px;
		height: 9px;
		margin-right: 8px;
		border-radius: 50%;
		background: var(--accent);
	}
	.band-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 10px 22px;
		margin-top: 6px;
	}
	.bo-n {
		display: block;
		margin: 0;
		font-size: clamp(44px, 6vw, 76px);
		font-weight: 650;
		letter-spacing: -0.035em;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}
	.bo-u {
		display: flex;
		flex-direction: column;
		gap: 7px;
		font-size: 15px;
		line-height: 1.35;
		color: var(--muted);
	}
	.u1 {
		font-size: 16px;
		font-weight: 550;
		color: var(--text);
	}
	.u2 {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		color: var(--muted);
	}
	/* The change, in a pill tinted with the surface's colour. */
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 9px 3px 8px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--accent) 24%, transparent);
		color: color-mix(in srgb, var(--accent) 40%, #fff);
		font-size: 13.5px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	/* Except Git-on-Nostr's: its colour is red, which reads as a fall. A neutral tint, the
	   number and the arrow in the text colour (11.7:1); the operator's pick. */
	.board-panel[data-key='git'] .pill {
		background: rgba(243, 244, 246, 0.12);
		color: var(--text);
	}
	.pill .up {
		width: 9px;
		height: 7px;
		fill: currentColor;
	}
	/* The way into the surface: a filled button in its colour. */
	.cta {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding: 13px 18px 13px 20px;
		border-radius: 11px;
		background: var(--accent);
		color: var(--on-accent);
		font-size: 15.5px;
		font-weight: 700;
		line-height: 1.2;
		white-space: nowrap;
		box-shadow:
			0 14px 32px -14px color-mix(in srgb, var(--accent) 85%, transparent),
			inset 0 1px 0 rgba(255, 255, 255, 0.2);
		transition:
			transform 0.18s,
			filter 0.18s;
	}
	.cta .arr {
		font-weight: 700;
		transition: transform 0.18s;
	}
	.cta:hover {
		filter: brightness(1.08);
		transform: translateY(-1px);
	}
	.cta:hover .arr {
		transform: translateX(3px);
	}
	.cta:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
	}
	@media (min-width: 1000px) and (max-height: 760px) {
		.bo-n {
			font-size: min(6vw, 64px);
		}
	}
	@media (max-width: 560px) {
		.bo-n {
			font-size: 42px;
		}
		.bo-u {
			font-size: 13.5px;
		}
		.u1 {
			font-size: 14.5px;
		}
		.cta {
			font-size: 14.5px;
			padding: 11px 16px 11px 18px;
		}
	}

	/* What the line counts, and the series' keys: one row under the chart. */
	.board-cap {
		max-width: 1076px;
		margin: 2px auto 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 18px;
		font-size: 13px;
		line-height: 1.4;
		color: var(--muted);
	}
	.board-cap i {
		display: inline-block;
		width: 14px;
		height: 3px;
		border-radius: 2px;
	}
	.board-cap .ck1 {
		margin-right: -10px;
	}
	.board-cap .ck {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		color: #d1d5db;
	}
	@media (max-width: 560px) {
		.board-cap {
			font-size: 12.5px;
			gap: 4px 14px;
		}
	}
	/* Where a chart has not loaded since the server started: a note of the chart's height. */
	.hc-none {
		display: flex;
		align-items: center;
		height: calc(var(--hch) + 32px);
		color: var(--dim);
		font-size: 13.5px;
	}
	.hc-none p {
		margin: 0 auto;
		max-width: var(--maxw);
		width: 100%;
		padding: 0 22px;
	}

	/* ---------- the roster ---------- */
	/* "more domains on the way", over the roster's end, where the next surface would go; its dot
	   lime, the one hue no surface uses. */
	.roster-more {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 4px 16px;
		margin: 14px 0 6px;
		font-size: 11.5px;
		line-height: 1.3;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--dim);
	}
	.roster-more span {
		display: inline-flex;
		align-items: center;
		gap: 9px;
		color: var(--muted);
	}
	.roster-more i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #a3e635;
	}
	/* Every surface's figure in one row; the open one underlined in its colour. */
	.board-tabs {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		border-top: 1px solid var(--line-2);
		border-bottom: 1px solid var(--line-2);
		margin: 0 0 34px;
	}
	.board-tabs [role='tab'] {
		position: relative;
		display: grid;
		grid-template-columns: 9px minmax(0, 1fr);
		grid-template-rows: auto auto;
		column-gap: 9px;
		row-gap: 2px;
		align-items: center;
		text-align: left;
		padding: 12px 12px 13px;
		border: 0;
		border-right: 1px solid var(--line-2);
		background: none;
		color: var(--muted);
		font: inherit;
		cursor: pointer;
		min-width: 0;
		transition:
			background 0.16s,
			color 0.16s;
	}
	.board-tabs [role='tab']:last-child {
		border-right: 0;
	}
	.board-tabs [role='tab']:hover {
		color: var(--text);
		background: #161e2c;
	}
	.board-tabs [role='tab']::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: -1px;
		height: 2px;
		background: var(--accent);
		opacity: 0;
		transition: opacity 0.16s;
	}
	.board-tabs [role='tab'][aria-selected='true'] {
		color: var(--text);
	}
	.board-tabs [role='tab'][aria-selected='true']::after {
		opacity: 1;
	}
	.bt-dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--accent);
		grid-row: 1 / 3;
	}
	.bt-name {
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* The spaces before "New" and before the unit are in the markup (for the accessible name);
	   these margins keep the drawn gaps at 7 px and 5 px. */
	.bt-new {
		font-size: 9.5px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--accent);
		margin-left: 3.6px;
		vertical-align: 1px;
	}
	.bt-n {
		font-size: 15.5px;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.bt-n small {
		margin-left: 1.2px;
		font-size: 11.5px;
		font-weight: 400;
		color: var(--dim);
	}
	@media (min-width: 1000px) and (max-height: 760px) {
		.roster-more {
			margin: 10px 0 5px;
		}
		.board-tabs {
			margin-bottom: 26px;
		}
	}
	@media (max-width: 999px) {
		.board-tabs {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
		.board-tabs [role='tab']:nth-child(3n) {
			border-right: 0;
		}
		.board-tabs [role='tab']:nth-child(n + 4) {
			border-top: 1px solid var(--line-2);
		}
	}
	@media (max-width: 560px) {
		.board-tabs {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.board-tabs [role='tab']:nth-child(3n) {
			border-right: 1px solid var(--line-2);
		}
		.board-tabs [role='tab']:nth-child(2n) {
			border-right: 0;
		}
		.board-tabs [role='tab']:nth-child(n + 3) {
			border-top: 1px solid var(--line-2);
		}
		/* five cells in two columns: the fifth spans both */
		.board-tabs [role='tab']:last-child {
			grid-column: 1 / -1;
		}
	}
	@media (max-width: 380px) {
		.roster-more {
			font-size: 10.5px;
			letter-spacing: 0.16em;
		}
	}
</style>
