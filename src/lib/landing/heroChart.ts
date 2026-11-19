// The board's hero chart, as geometry: what HeroChart.svelte draws, computed from one panel's
// chart (board.ts) with no DOM, so the server renders the whole chart as SVG and markup - a
// reader without script, and every crawler, sees it - and the tests pin it.
//
// The options are those of the board design the operator picked on 2026-10-15: no guide values,
// no legend box (the caption row under the chart names the series), end labels that name their
// series, no colour chip on them, and every label placed clear of the lines in the browser.
//
// The drawing: a path per series over a 1000 x 1000 box that the CSS stretches to the chart's
// size (strokes do not scale with it), the fill a gradient to nothing, the series' last values
// at the lines' ends, the months along the bottom. A line is faded before the chart's wall
// (Git-on-Nostr: before observation began). At most about 400 points go into a path; the hover
// reads every day from the panel's own series.

import { chartDay, type BoardChart, type BoardSeries } from './board';

export const VIEW = 1000;

export interface ChartOptions {
	/** The plot's CSS height in px, for the end labels' static spacing only. */
	h: number;
	/** Headroom for the figure band drawn over the chart's top-left corner: across the first
	 * `x` of the width, every line stays under the top `y` of the plot. */
	clear?: { x: number; y: number };
}

export interface Segment {
	line: string;
	area: string | null;
	faded: boolean;
}

export interface EndLabel {
	/** The series' index. */
	s: number;
	/** The series' name, when the chart has more than one. */
	name: string | null;
	value: string;
	/** Top of the line's end, as a percentage of the plot's height. */
	top: number;
	/** Shown before the browser places it: the labels at least 16 px apart, top down. */
	shown: boolean;
}

export interface Tick {
	/** Left edge, as a percentage of the plot's width. */
	left: number;
	month: string;
	/** The year under the first tick and January's. */
	year: string | null;
	/** January, April, July, October: the ticks a phone keeps. */
	quarter: boolean;
	/** Right-aligned at its point: too close to the right edge to centre. */
	last: boolean;
}

export interface ChartGeometry {
	n: number;
	yMax: number;
	series: { color: string; fill: boolean; segments: Segment[] }[];
	/** One per series, in the series' order. */
	ends: EndLabel[];
	/** The end dots, top down. */
	dots: { color: string; top: number }[];
	wall: { left: number; text: string } | null;
	ticks: Tick[];
}

const nf = new Intl.NumberFormat('en-US');

/** A series value as the chart prints it: one decimal and % for a share, else a whole number. */
export const formatValue = (s: Pick<BoardSeries, 'pct'>, v: number): string =>
	s.pct ? `${v.toFixed(1)}%` : nf.format(Math.round(v));

function lastValue(v: (number | null)[]): number {
	for (let i = v.length - 1; i >= 0; i--) if (v[i] !== null) return v[i] as number;
	return 0;
}

function maxOf(v: (number | null)[], upTo = v.length - 1): number {
	let m = -Infinity;
	for (let i = 0; i <= upTo && i < v.length; i++) if (v[i] !== null && (v[i] as number) > m) m = v[i] as number;
	return m;
}

export function chartGeometry(chart: BoardChart, options: ChartOptions): ChartGeometry {
	const n = chart.series[0]?.v.length ?? 0;
	const top = Math.max(...chart.series.map((s) => maxOf(s.v)));
	let yMax = top * 1.14;
	if (options.clear) {
		const upTo = Math.floor(options.clear.x * (n - 1));
		const early = Math.max(...chart.series.map((s) => maxOf(s.v, upTo)));
		yMax = Math.max(yMax, early / (1 - options.clear.y));
	}
	if (!(yMax > 0)) yMax = 1;
	const X = (i: number) => +((i / (n - 1)) * VIEW).toFixed(2);
	const Y = (v: number) => +(VIEW - (v / yMax) * VIEW).toFixed(2);
	const wall = chart.wall !== undefined && chart.wall > 0 ? chart.wall : 0;
	const stride = Math.max(1, Math.ceil(n / 400));
	const pick = new Set<number>([0, n - 1, wall]);
	for (let i = 0; i < n; i += stride) pick.add(i);
	const idx = [...pick].sort((a, b) => a - b);
	const between = (a: number, b: number) => idx.filter((i) => i >= a && i <= b);

	const lineOf = (v: (number | null)[], a: number, b: number) => {
		let d = '';
		let pen = false;
		for (const i of between(a, b)) {
			if (v[i] === null) {
				pen = false;
				continue;
			}
			d += `${pen ? 'L' : 'M'}${X(i)} ${Y(v[i] as number)}`;
			pen = true;
		}
		return d;
	};
	const areaOf = (v: (number | null)[], a: number, b: number) => {
		const is = between(a, b).filter((i) => v[i] !== null);
		return is.length ? `${lineOf(v, a, b)}L${X(is[is.length - 1])} ${VIEW}L${X(is[0])} ${VIEW}Z` : null;
	};
	const spans: [number, number, boolean][] = wall ? [[0, wall, true], [wall, n - 1, false]] : [[0, n - 1, false]];

	const pctY = (v: number) => +((1 - v / yMax) * 100).toFixed(2);
	const multi = chart.series.length > 1;
	const byTop = chart.series
		.map((s, k) => ({ s, k, top: pctY(lastValue(s.v)) }))
		.sort((a, b) => a.top - b.top);
	// The last values, top down, each at least 16 px below the one shown above it; in the
	// browser every label is then placed clear of the lines, and these are only where a page
	// without script starts.
	const shown = new Set<number>();
	let prev = -1e9;
	for (const e of byTop) {
		const px = (e.top / 100) * options.h;
		if (px - prev >= 16) {
			shown.add(e.k);
			prev = px;
		}
	}

	// The months along the bottom: a label where the month changes, the year under the first
	// and under January's.
	const ticks: Tick[] = [];
	let firstTick = true;
	let prevMonth = n > 0 ? chartDay(chart, 0).slice(0, 7) : '';
	for (let i = 1; i < n; i++) {
		const day = chartDay(chart, i);
		const ym = day.slice(0, 7);
		if (ym === prevMonth) continue;
		prevMonth = ym;
		const m = Number(day.slice(5, 7));
		const left = (i / (n - 1)) * 100;
		ticks.push({
			left: +left.toFixed(2),
			month: new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
			year: firstTick || m === 1 ? day.slice(0, 4) : null,
			quarter: (m - 1) % 3 === 0,
			last: left > 94
		});
		firstTick = false;
	}

	return {
		n,
		yMax,
		series: chart.series.map((s) => ({
			color: s.color,
			fill: !!s.fill,
			segments: spans.map(([a, b, faded]) => ({ line: lineOf(s.v, a, b), area: s.fill ? areaOf(s.v, a, b) : null, faded }))
		})),
		ends: chart.series.map((s, k) => ({
			s: k,
			name: multi ? (s.short ?? s.label) : null,
			value: formatValue(s, lastValue(s.v)),
			top: pctY(lastValue(s.v)),
			shown: shown.has(k)
		})),
		dots: byTop.map((e) => ({ color: e.s.color, top: e.top })),
		wall: wall ? { left: +((wall / (n - 1)) * 100).toFixed(2), text: chart.wallText ?? 'observation began' } : null,
		ticks
	};
}
