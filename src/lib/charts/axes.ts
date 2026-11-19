// Axis settings shared by the site's time charts, as Chart.js takes them.
import type { Scale } from 'chart.js';

import type { DayTick } from '$lib/charts/day-axis-ticks';
import { compact } from '$lib/ngit/format';
import { bucketTickLabels, type Bucket } from '$lib/ngit/series';

/**
 * A value axis in k, M and B, so a long figure does not take the plot's width on a phone. Spread
 * it into `ticks` on an axis with `beginAtZero: true`, for whole numbers only, and leave the
 * tooltip exact.
 *
 * `compact` rounds to one decimal, but no tick on such an axis has more digits than that: Chart.js
 * steps by 1, 2 or 5 of a power of ten, at most ten steps up from zero, so 1,250,000 is never a
 * gridline. A stepSize, a min or a max would end that. `precision: 0` because a max of 3 would
 * otherwise step by 0.5, and `compact` prints 0.5 as 1.
 */
export const compactTicks = {
	precision: 0,
	callback: (value: string | number) => compact(Number(value))
};

/**
 * The `ticks.callback` of a time chart's x-axis, its points given as unix seconds: a label for each
 * month change, thinned to what the chart's width has room for (`bucketTickLabels`, /git's rule). A
 * year of days gets every other month on most phones and every month on a desktop. Goes with
 * `autoSkip: false`.
 *
 * - An unlabelled point returns '', not undefined: Chart.js deletes a tick whose label is undefined
 *   and its gridline goes with it, which would redraw the chart's grid as well as its labels.
 * - The first label gives way by pixels alone (the 0), not also by the 20 days `dayTickLabels` uses
 *   when it has no width to go on: that left /lightning's 30-day view with a single label.
 * - A monthly series is a line, whose 13 points span 12 months. `bucketTickLabels` reckons 13, as for
 *   bars, which on /nutzaps labelled quarters under daily charts labelling every other month.
 * - A bad timestamp draws an odd label rather than throwing, which would stop the page's other charts.
 */
export function monthTicks(timestamps: number[], bucket: Bucket = 'day') {
	const labels = timestamps.map((ts) => {
		const at = new Date(ts * 1000);
		return Number.isNaN(at.getTime()) ? '' : at.toISOString().slice(0, bucket === 'month' ? 7 : 10);
	});
	const n = labels.length;
	let drawn: { width: number; ticks: DayTick[] } = { width: -1, ticks: [] };
	return function (this: Scale, _value: string | number, index: number) {
		const width = this.chart?.width ?? 0;
		if (drawn.width !== width) {
			const across = bucket === 'month' && n > 1 ? (width * n) / (n - 1) : width;
			drawn = { width, ticks: bucketTickLabels(labels, bucket, across, 0) };
		}
		return drawn.ticks[index] ?? '';
	};
}

/**
 * The `layout` of a time chart with no axis on the left of its plot, so that a month label near that
 * edge stays on the canvas. Chart.js reserves room for tick 0's label only; once that label has given
 * way to the next, the next can sit at the plot's edge and lose 9 px. 16 px is what it reserves for a
 * year's label, and it is a floor: a chart whose tick 0 has its label gets no more than it had.
 */
export const firstLabelRoom = { padding: { left: 16 } };
