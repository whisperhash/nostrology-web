// Series helpers for /git's charts and tables: bucket labels, the capture-wall and
// partial-bucket predicates, tick labels, gap-filling the cumulative series, sorting and
// the leaderboard floor. Pure and DOM-free so the charts' rules are unit-testable without
// a canvas (jsdom has none).
import type { ChartDataset } from 'chart.js';
import { dayTickLabels, type DayTick } from '$lib/charts/day-axis-ticks';

/** The granularity of a series' labels: "YYYY-MM" months, ISO weeks labelled by their
 * Monday "YYYY-MM-DD", or plain days "YYYY-MM-DD". */
export type Bucket = 'month' | 'week' | 'day';

const DAY_MS = 86_400_000;

function dayMs(day: string): number {
	return Date.parse(`${day.slice(0, 10)}T00:00:00Z`);
}

function isoDay(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

/** The Monday of the ISO week (Monday start) containing a UTC day; '' for a day that does
 * not parse (a malformed document date must not throw at page init). */
export function isoMonday(day: string): string {
	const t = dayMs(day);
	if (Number.isNaN(t)) return '';
	const offset = (new Date(t).getUTCDay() + 6) % 7; // Sunday (0) -> 6 days back
	return isoDay(t - offset * DAY_MS);
}

/**
 * The label a capture wall falls in, at a series' granularity. Labels strictly BEFORE it
 * hold pre-capture data only (what relays still served) and are dimmed. The bucket containing
 * the wall MIXES the two whenever the wall is not its first day.
 * Wall 2026-05-02 -> month "2026-05", week "2026-04-27", day "2026-05-02".
 */
export function wallBucket(wallDay: string, bucket: Bucket): string {
	if (bucket === 'month') return wallDay.slice(0, 7);
	if (bucket === 'week') return isoMonday(wallDay);
	return wallDay.slice(0, 10);
}

/** How a bucket is drawn: pre-wall (dimmed), partial at either end (outlined), or full. */
export type BucketState = 'wall' | 'partial_first' | 'partial_last' | 'full';

export interface BucketMarks {
	/** Labels strictly before this one are pre-wall. Same granularity as the labels. */
	dimBefore?: string | null;
	/** The trailing bucket that is still filling (partial_month / partial_week). */
	partialLabel?: string | null;
	/** A leading bucket whose data begins mid-bucket (partial_first_week). */
	partialFirstLabel?: string | null;
}

export function bucketState(label: string, marks: BucketMarks): BucketState {
	// Partial wins: a partial bucket is post-wall by construction, and saying "partial"
	// is the more specific truth when both could apply.
	if (marks.partialLabel != null && label === marks.partialLabel) return 'partial_last';
	if (marks.partialFirstLabel != null && label === marks.partialFirstLabel) return 'partial_first';
	if (marks.dimBefore != null && marks.dimBefore !== '' && label < marks.dimBefore) return 'wall';
	return 'full';
}

/**
 * A series colour at reduced opacity, for faded (pre-wall or partial) marks. Takes the
 * site's "#rrggbb" palette entries; anything else is returned unchanged rather than
 * guessed at.
 */
export function fade(hex: string, alpha: number): string {
	const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
	if (!m) return hex;
	const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
	return `rgba(${r},${g},${b},${alpha})`;
}

/** gray-800, the card's own surface: the gap between stacked segments, the ring around a
 * point. */
export const SURFACE = '#1f2937';

/**
 * True when the value at `i` has no finite neighbour on either side. A line joins points,
 * so such a value - the only bucket of a one-bucket series, or a value between gaps - has
 * no stretch of line to show it, and a chart that draws no point marks draws nothing there.
 */
export function isolatedPoint(values: readonly (number | null | undefined)[], i: number): boolean {
	const has = (j: number) => {
		const v = values[j];
		return typeof v === 'number' && Number.isFinite(v);
	};
	return has(i) && !has(i - 1) && !has(i + 1);
}

/** The radius of a drawn point: with its 2px surface ring, an 8px disc of the series colour. */
export const POINT_RADIUS = 5;

/**
 * One series of SmallLine as a Chart.js dataset. Points are not drawn on a line (the line
 * carries the values, the tooltip names them), except where there is no line - an isolated
 * value (isolatedPoint) gets a point, or a one-bucket series would show bare axes. A stretch
 * of line is faded when it LEAVES a pre-wall or leading-partial point, or ENTERS the trailing
 * partial point: it is full-strength only between buckets that are complete and captured.
 */
export function smallLineDataset(
	s: { label: string; color: string; values: (number | null)[] },
	states: readonly BucketState[],
	wash: boolean
): ChartDataset<'line', (number | null)[]> {
	const faded = (p0: number, p1: number) =>
		states[p0] === 'wall' || states[p0] === 'partial_first' || states[p1] === 'partial_last';
	return {
		label: s.label,
		data: s.values,
		borderColor: s.color,
		backgroundColor: wash ? fade(s.color, 0.1) : s.color,
		fill: wash ? 'origin' : false,
		borderWidth: 2,
		borderCapStyle: 'round',
		borderJoinStyle: 'round',
		pointRadius: (c) => (isolatedPoint(s.values, c.dataIndex) ? POINT_RADIUS : 0),
		pointBackgroundColor: s.color,
		pointBorderColor: SURFACE,
		pointBorderWidth: 2,
		pointHoverRadius: POINT_RADIUS,
		pointHoverBackgroundColor: s.color,
		pointHoverBorderColor: SURFACE,
		pointHoverBorderWidth: 2,
		// Monotone: a smoothed curve must never dip or peak where the data does not (a plain
		// tension overshoots before a jump, drawing a fall that never happened).
		cubicInterpolationMode: 'monotone',
		spanGaps: false,
		segment: {
			borderColor: (c) => (faded(c.p0DataIndex, c.p1DataIndex) ? fade(s.color, 0.35) : undefined),
			backgroundColor: (c) => (wash && faded(c.p0DataIndex, c.p1DataIndex) ? fade(s.color, 0.04) : undefined)
		}
	};
}

/** Which notes a chart's caption needs: only the states that actually occur in it. */
export function statesPresent(labels: string[], marks: BucketMarks): Set<BucketState> {
	return new Set(labels.map((l) => bucketState(l, marks)));
}

/** Minimum horizontal room a month label needs before its neighbour may be drawn. */
const MIN_LABEL_PX = 56;
const MONTH_STEPS = [1, 2, 3, 6, 12];
const BUCKETS_PER_MONTH: Record<Bucket, number> = { month: 1, week: 4.35, day: 30.44 };

/**
 * The month step for a series drawn at a given width: the smallest of 1 / 2 / 3 / 6 / 12
 * months whose labels get MIN_LABEL_PX each. Unlike monthStepForWidth (which assumes a
 * long daily series), this reads the series' own density, so four monthly bars get four
 * labels and three years of days get quarters. Width 0 (not laid out yet) -> 12.
 */
export function monthStepFor(count: number, bucket: Bucket, widthPx: number): number {
	if (!(widthPx > 0) || count <= 0) return 12;
	const pxPerMonth = (widthPx / count) * BUCKETS_PER_MONTH[bucket];
	return MONTH_STEPS.find((s) => pxPerMonth * s >= MIN_LABEL_PX) ?? 12;
}

/**
 * X-axis tick labels for a bucketed series, by the shared day-axis rule (label the first
 * point and every month change, the year on the first label and on every change, thinned
 * by the month step). Months are placed on their first day to reuse it unchanged.
 *
 * The first label is the rule's one unconditional label, so a series that starts off the
 * step can put the next label closer than a label's room: /marketplaces' new listings from
 * Jul 2023, thinned to Januaries at phone width, drew "2023" and "2024" six months apart,
 * touching at 390px and read as "20232024" at 360px. The first label then gives way, its
 * year passing to the next one. `firstLabelDays` is dayTickLabels' own such rule, which a
 * caller wanting only this one by pixels turns off with 0.
 */
export function bucketTickLabels(
	labels: string[],
	bucket: Bucket,
	widthPx: number,
	firstLabelDays?: number
): DayTick[] {
	const days = bucket === 'month' ? labels.map((m) => `${m}-01`) : labels;
	const ticks = dayTickLabels(days, monthStepFor(labels.length, bucket, widthPx), firstLabelDays);
	const next = ticks.findIndex((t, i) => i > 0 && t !== undefined);
	// The same estimate of a bucket's width as monthStepFor: the chart's, axes included.
	if (widthPx > 0 && ticks[0] !== undefined && next > 0 && (next * widthPx) / labels.length < MIN_LABEL_PX) {
		const t = ticks[next];
		ticks[next] = Array.isArray(t) ? t : [t as string, days[next].slice(0, 4)];
		ticks[0] = undefined;
	}
	return ticks;
}

/** The tooltip title of a bucket: "June 2026", "Week of Jun 8, 2026", "Jun 8, 2026". */
export function bucketTitle(label: string, bucket: Bucket): string {
	const t = dayMs(bucket === 'month' ? `${label}-01` : label);
	if (Number.isNaN(t)) return label;
	const d = new Date(t);
	if (bucket === 'month') {
		return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
	}
	const day = d.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC'
	});
	return bucket === 'week' ? `Week of ${day}` : day;
}

// --- The one-year window ------------------------------------------------------------------
//
// Every /git chart with time on its x-axis spans at most the trailing year, ending at the
// document's as_of_day - never the viewer's clock, so a stale snapshot does not shift its
// own window: the last 12 complete months, 52 complete weeks or year of days, plus the
// bucket still filling. The weekly charts also start no earlier than a floor day
// (flooredWindowStart), after every capture wall.

/**
 * The first label of the one-year window that ends at `asOfDay`: the bucket holding
 * (as_of_day + 1 day) one calendar year back. as_of 2026-09-30 -> month "2025-10", week
 * "2025-09-29", day "2025-10-01"; as_of 2026-10-15 -> month "2025-10" (twelve complete
 * months, then October 2026 still filling).
 */
export function yearWindowStart(asOfDay: string, bucket: Bucket): string {
	// A malformed as_of_day cuts nothing ('' sorts before every label) rather than throwing.
	if (Number.isNaN(dayMs(asOfDay))) return '';
	const next = new Date(dayMs(asOfDay) + DAY_MS);
	if (bucket === 'week') return isoDay(dayMs(isoMonday(isoDay(next.getTime()))) - 52 * 7 * DAY_MS);
	const y = next.getUTCFullYear() - 1;
	if (bucket === 'month') return `${y}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
	// The same calendar day a year back; Date.UTC rolls a Feb 29 over to Mar 1.
	return isoDay(Date.UTC(y, next.getUTCMonth(), next.getUTCDate()));
}

/**
 * The first label of a window that starts no earlier than the bucket holding `floorDay` and
 * spans at most the trailing year: the later of that bucket and yearWindowStart. Floor
 * 2026-07-01 -> week "2026-06-29" until the trailing year passes it, as_of 2027-07-15 ->
 * week "2026-07-13". A malformed as_of_day leaves the floor; a malformed floor, the year.
 */
export function flooredWindowStart(asOfDay: string, bucket: Bucket, floorDay: string): string {
	const floor = wallBucket(floorDay, bucket);
	const year = yearWindowStart(asOfDay, bucket);
	return year > floor ? year : floor;
}

/** The label after `label` at a granularity. */
function nextLabel(label: string, bucket: Bucket): string {
	if (bucket === 'month') {
		const y = Number(label.slice(0, 4));
		const m = Number(label.slice(5, 7));
		return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
	}
	return isoDay(dayMs(label) + (bucket === 'week' ? 7 : 1) * DAY_MS);
}

/**
 * Rows cut to the window that starts at `start`: rows labelled before it are dropped, and
 * when the rows begin after it - a series that starts with capture - the missing leading
 * buckets are added as null, so the chart still spans the whole window and the gap reads as
 * "not recorded", never as zero. Rows must be in label order.
 */
export function inWindow<T>(
	rows: readonly T[],
	label: (r: T) => string,
	start: string,
	bucket: Bucket
): { labels: string[]; rows: (T | null)[] } {
	const kept = rows.filter((r) => label(r) >= start);
	const labels: string[] = [];
	const out: (T | null)[] = [];
	// An empty start (an unparsable as_of_day) cuts nothing and pads nothing.
	if (kept.length && start !== '') {
		// Bounded: a window is at most 366 buckets, and a malformed label stops the walk.
		for (let l = start; l < label(kept[0]) && labels.length < 400; l = nextLabel(l, bucket)) {
			labels.push(l);
			out.push(null);
		}
	}
	for (const r of kept) {
		labels.push(label(r));
		out.push(r);
	}
	return { labels, rows: out };
}

/** Running totals of a series: [1, 0, 3] -> [1, 1, 4]. */
export function cumulative(values: readonly number[]): number[] {
	let t = 0;
	return values.map((v) => (t += v));
}

/** A windowed series' values: a padded bucket (null row) stays null, never a zero, as does a
 * value the row does not record (the callback's null). */
export function valuesOf<T>(rows: readonly (T | null)[], value: (r: T) => number | null): (number | null)[] {
	return rows.map((r) => (r === null ? null : value(r)));
}

/**
 * A series cut to the window together with its running total, the total taken over the
 * WHOLE series before the cut - so the window's first point counts everything earlier - plus
 * `base`, what precedes the series' first row (a series that starts at a capture wall leaves
 * everything first seen before it out of its rows).
 */
export function windowWithTotal<T>(
	rows: readonly T[],
	label: (r: T) => string,
	value: (r: T) => number,
	start: string,
	bucket: Bucket,
	base: number = 0
): { labels: string[]; values: (number | null)[]; totals: (number | null)[] } {
	const totals = cumulative(rows.map(value)).map((t) => t + base);
	const w = inWindow(
		rows.map((r, i) => ({ r, total: totals[i] })),
		(x) => label(x.r),
		start,
		bucket
	);
	return { labels: w.labels, values: valuesOf(w.rows, (x) => value(x.r)), totals: valuesOf(w.rows, (x) => x.total) };
}

/** Chart.js tooltip filter: a null bucket (padding before a series began) has no value to
 * show. Null bars are not skipped by Chart.js on their own. */
export function hasValue(item: { parsed: { y: number | null } }): boolean {
	return item.parsed.y !== null && !Number.isNaN(item.parsed.y);
}

/**
 * The line StackedBars draws over its bars on a second y-axis ('y2') - a running total, or a
 * second measure: faded where the bars under it are faded (pre-wall, or a partial bucket at
 * either end - the smallLineDataset rule), over the bars, with no point except under the
 * hover.
 */
export function totalLineDataset(
	line: { label: string; color: string; values: (number | null)[] },
	states: readonly BucketState[]
): ChartDataset<'line', (number | null)[]> {
	const faded = (p0: number, p1: number) =>
		states[p0] === 'wall' || states[p0] === 'partial_first' || states[p1] === 'partial_last';
	return {
		type: 'line',
		label: line.label,
		data: line.values,
		yAxisID: 'y2',
		borderColor: line.color,
		backgroundColor: line.color,
		borderWidth: 2,
		pointRadius: 0,
		pointHoverRadius: POINT_RADIUS,
		tension: 0,
		spanGaps: false,
		order: 0,
		segment: {
			borderColor: (c) => (faded(c.p0DataIndex, c.p1DataIndex) ? fade(line.color, 0.35) : undefined)
		}
	};
}

/**
 * The y-axis a chart's second measure is drawn against ('y2'): at the right, from zero, with
 * no grid of its own (the left axis draws the grid), and titled in its line's colour, so the
 * reader can tell which scale a line is read on. Drawn only while a visible dataset uses it
 * ('auto'): a line hidden from the legend takes its axis with it rather than leaving an
 * empty 0-to-1 scale. StackedBars' line and SmallLine's right series both use it.
 */
export function secondAxisScale(title: string, color: string) {
	return {
		display: 'auto' as const,
		position: 'right' as const,
		beginAtZero: true,
		grid: { drawOnChartArea: false },
		ticks: {
			color: '#94a3b8',
			precision: 0,
			callback: (v: string | number) => Number(v).toLocaleString('en-US')
		},
		title: { display: true, text: title, color }
	};
}

/** SmallLine's right-hand series: a smallLineDataset (never washed) on the 'y2' axis. Solid,
 * as every line on /git is since 2026-10-08 (it was dashed): the right axis is titled with
 * the series' name in its colour, and the legend names the series too. */
export function rightLineDataset(
	s: { label: string; color: string; values: (number | null)[] },
	states: readonly BucketState[]
): ChartDataset<'line', (number | null)[]> {
	return { ...smallLineDataset(s, states, false), yAxisID: 'y2' };
}

/** A gap-fill longer than this is not attempted (a series reaching back decades would be
 * a data problem to surface, not to paper over with thousands of flat points). */
export const MAX_FILL_DAYS = 3660;

/**
 * cum_repos may elide consecutive equal days (dataset reference section 7: the first day,
 * every change and as_of_day are present). On a category axis an elided stretch would be
 * drawn as ONE step, squeezing time, so the page forward-fills it back to one point per
 * day through `through` (as_of_day). Pure reconstruction: an elided day equals the day
 * before it by definition. Unsorted input is sorted; a span over MAX_FILL_DAYS is returned
 * as given.
 */
export function fillDaily(
	points: { d: string; v: number }[],
	through: string | null = null
): { d: string; v: number }[] {
	if (points.length === 0) return [];
	const sorted = [...points].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
	const start = dayMs(sorted[0].d);
	const lastPoint = sorted[sorted.length - 1].d;
	const endDay = through !== null && through > lastPoint ? through : lastPoint;
	const end = dayMs(endDay);
	if (Number.isNaN(start) || Number.isNaN(end)) return sorted;
	const span = Math.round((end - start) / DAY_MS);
	if (span > MAX_FILL_DAYS) return sorted;
	const byDay = new Map(sorted.map((p) => [p.d.slice(0, 10), p.v]));
	const out: { d: string; v: number }[] = [];
	let v = sorted[0].v;
	for (let i = 0; i <= span; i++) {
		const d = isoDay(start + i * DAY_MS);
		const hit = byDay.get(d);
		if (hit !== undefined) v = hit;
		out.push({ d, v });
	}
	return out;
}

export type SortDir = 'asc' | 'desc';

/**
 * Sort table rows by one column. Nulls, undefined and empty strings always sink to the
 * bottom whatever the direction (a repository with no push is not "the oldest push");
 * numbers compare numerically, everything else case-insensitively as text.
 *
 * Equal keys keep their INPUT order (the sort is stable), and callers pass the rows in
 * document order: the document's ranking is finer than any column the page shows (last
 * push is ranked by timestamp but shown as a day; maintainers by pushes in 90 d, then
 * repositories, then pubkey), so a tie-breaker of our own would scramble it.
 */
export function sortRows<T>(rows: readonly T[], key: keyof T, dir: SortDir): T[] {
	const mul = dir === 'asc' ? 1 : -1;
	const blank = (v: unknown) => v === null || v === undefined || v === '';
	return [...rows].sort((a, b) => {
		const va = a[key] as unknown;
		const vb = b[key] as unknown;
		const na = blank(va);
		const nb = blank(vb);
		if (na !== nb) return na ? 1 : -1;
		if (!na && va !== vb) {
			if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul;
			const sa = String(va).toLowerCase();
			const sb = String(vb).toLowerCase();
			if (sa !== sb) return (sa < sb ? -1 : 1) * mul;
		}
		return 0;
	});
}

/**
 * Leaderboards below this many rows are hidden and the page shows the summary figure
 * instead (ngit-design.md fork 8): the star, zap and discussion extracts may be nearly
 * empty, and a "top" list of two repositories ranks nothing.
 */
export const LEADERBOARD_MIN_ROWS = 5;

export function showLeaderboard(rows: readonly unknown[] | null | undefined): boolean {
	return Array.isArray(rows) && rows.length >= LEADERBOARD_MIN_ROWS;
}

/** Sum of one numeric column, ignoring non-numbers. */
export function sumOf<T>(rows: readonly T[], value: (r: T) => number): number {
	let s = 0;
	for (const r of rows) {
		const v = value(r);
		if (typeof v === 'number' && Number.isFinite(v)) s += v;
	}
	return s;
}
