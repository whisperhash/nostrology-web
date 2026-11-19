import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	bucketState,
	bucketTickLabels,
	bucketTitle,
	cumulative,
	fade,
	fillDaily,
	flooredWindowStart,
	hasValue,
	inWindow,
	isolatedPoint,
	isoMonday,
	LEADERBOARD_MIN_ROWS,
	MAX_FILL_DAYS,
	monthStepFor,
	POINT_RADIUS,
	rightLineDataset,
	secondAxisScale,
	showLeaderboard,
	smallLineDataset,
	sortRows,
	statesPresent,
	sumOf,
	SURFACE,
	totalLineDataset,
	valuesOf,
	wallBucket,
	windowWithTotal,
	yearWindowStart,
	type BucketState
} from './series';

describe('isoMonday / wallBucket', () => {
	it('finds the Monday of the ISO week, Sunday included in the week before it', () => {
		// The states wall: Sunday 2026-06-14 lies in the week of Monday 2026-06-08, which is
		// exactly the document's partial_first_week.
		expect(isoMonday('2026-06-14')).toBe('2026-06-08');
		expect(isoMonday('2026-06-08')).toBe('2026-06-08');
		expect(isoMonday('2026-06-09')).toBe('2026-06-08');
		// across a year boundary
		expect(isoMonday('2026-01-01')).toBe('2025-12-29');
	});

	it('places the announcements wall at each granularity', () => {
		expect(wallBucket('2026-05-02', 'month')).toBe('2026-05');
		expect(wallBucket('2026-05-02', 'week')).toBe('2026-04-27');
		expect(wallBucket('2026-05-02', 'day')).toBe('2026-05-02');
	});

});

describe('bucketState', () => {
	const marks = { dimBefore: '2026-05', partialLabel: '2026-09', partialFirstLabel: null };

	it('dims only buckets strictly before the wall bucket', () => {
		expect(bucketState('2026-04', marks)).toBe('wall');
		expect(bucketState('2025-12', marks)).toBe('wall');
		// the month containing the wall is mostly captured data: not dimmed
		expect(bucketState('2026-05', marks)).toBe('full');
		expect(bucketState('2026-08', marks)).toBe('full');
	});

	it('marks the trailing and the leading partial buckets', () => {
		expect(bucketState('2026-09', marks)).toBe('partial_last');
		expect(
			bucketState('2026-06-08', { partialFirstLabel: '2026-06-08', partialLabel: '2026-09-21' })
		).toBe('partial_first');
	});

	it('lets partial win over the wall, and treats absent marks as nothing', () => {
		expect(bucketState('2026-04', { dimBefore: '2026-05', partialLabel: '2026-04' })).toBe(
			'partial_last'
		);
		expect(bucketState('2026-04', {})).toBe('full');
		expect(bucketState('2026-04', { dimBefore: '' })).toBe('full');
	});

	it('reports which states a series actually contains', () => {
		const present = statesPresent(['2026-04', '2026-05', '2026-09'], marks);
		expect([...present].sort()).toEqual(['full', 'partial_last', 'wall']);
		expect([...statesPresent(['2026-06', '2026-07'], marks)]).toEqual(['full']);
	});
});

describe('monthStepFor / bucketTickLabels', () => {
	it('labels every month of a short monthly series', () => {
		expect(monthStepFor(4, 'month', 600)).toBe(1);
		expect(bucketTickLabels(['2026-06', '2026-07', '2026-08', '2026-09'], 'month', 600)).toEqual([
			['Jun', '2026'],
			'Jul',
			'Aug',
			'Sep'
		]);
	});

	it('thins a long monthly series and keeps every year', () => {
		const months: string[] = [];
		for (let y = 2024; y <= 2026; y++) for (let m = 1; m <= 12; m++) months.push(`${y}-${String(m).padStart(2, '0')}`);
		// 36 months in 640px: 17.8px per month -> a label every six months (plus every year)
		expect(monthStepFor(months.length, 'month', 640)).toBe(6);
		const ticks = bucketTickLabels(months, 'month', 640);
		expect(ticks[0]).toEqual(['Jan', '2024']);
		expect(ticks[12]).toEqual(['Jan', '2025']);
		expect(ticks[24]).toEqual(['Jan', '2026']);
		expect(ticks[6]).toBe('Jul');
		expect(ticks[3]).toBeUndefined();
	});

	it('labels weekly buckets at month changes', () => {
		const weeks = ['2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06', '2026-07-13'];
		expect(bucketTickLabels(weeks, 'week', 600)).toEqual([
			['Jun', '2026'],
			undefined,
			undefined,
			undefined,
			'Jul',
			undefined
		]);
	});

	it('drops a first label that would sit on the next one, passing its year on', () => {
		// /marketplaces' new listings: 40 months from Jul 2023. At phone width (316px of canvas
		// at 390) the step is a year, so the first label and Jan 2024 sit six months - 47px -
		// apart: "2023" and "2024" collided. The first gives way; Jan 2024 already has its year.
		const fromJul = Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(2023, 6 + i, 1)).toISOString().slice(0, 7));
		expect([fromJul[0], fromJul[39]]).toEqual(['2023-07', '2026-10']);
		expect(monthStepFor(40, 'month', 316)).toBe(12);
		const phone = bucketTickLabels(fromJul, 'month', 316);
		expect(phone.filter((t) => t !== undefined)).toEqual([
			['Jan', '2024'],
			['Jan', '2025'],
			['Jan', '2026']
		]);
		// wide enough for its step (every 2 months, 60px apart), the first label stays
		expect(bucketTickLabels(fromJul, 'month', 1206)[0]).toEqual(['Jul', '2023']);
		// a next label in the same year takes the year: 20 months from Aug 2023 at 400px step
		// every 3 months, and Oct is two months - 40px - after Aug
		const fromAug = Array.from({ length: 20 }, (_, i) => new Date(Date.UTC(2023, 7 + i, 1)).toISOString().slice(0, 7));
		const ticks = bucketTickLabels(fromAug, 'month', 400);
		expect(ticks.slice(0, 3)).toEqual([undefined, undefined, ['Oct', '2023']]);
		expect(ticks[5]).toEqual(['Jan', '2024']);
		// before layout (width 0) nothing is measured, so nothing is dropped
		expect(bucketTickLabels(fromJul, 'month', 0)[0]).toEqual(['Jul', '2023']);
	});

	it('falls back to yearly steps before layout (width 0) and for an empty series', () => {
		expect(monthStepFor(10, 'month', 0)).toBe(12);
		expect(monthStepFor(0, 'month', 800)).toBe(12);
		expect(bucketTickLabels([], 'day', 800)).toEqual([]);
	});
});

describe('bucketTitle', () => {
	it('names a month, a week and a day', () => {
		expect(bucketTitle('2026-06', 'month')).toBe('June 2026');
		expect(bucketTitle('2026-06-08', 'week')).toBe('Week of Jun 8, 2026');
		expect(bucketTitle('2026-06-14', 'day')).toBe('Jun 14, 2026');
		expect(bucketTitle('garbage', 'day')).toBe('garbage');
	});
});

describe('UTC labels', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('builds every day and month label without a local-time accessor', () => {
		// A label computed with getDate / getMonth / getFullYear / getHours is in the READER's
		// timezone (UTC-7 turns June 1 into May 31). Each of them throws here, so the tooltip
		// titles, the tick labels, the week Mondays and the gap-filled days must all be built
		// from UTC fields or from the ISO strings.
		for (const m of ['getDate', 'getMonth', 'getFullYear', 'getHours'] as const) {
			vi.spyOn(Date.prototype, m).mockImplementation(() => {
				throw new Error(`local-time accessor ${m} called`);
			});
		}
		expect(bucketTitle('2026-06', 'month')).toBe('June 2026');
		expect(bucketTitle('2026-06-08', 'week')).toBe('Week of Jun 8, 2026');
		expect(bucketTitle('2026-06-01', 'day')).toBe('Jun 1, 2026');
		expect(bucketTickLabels(['2026-05', '2026-06', '2026-07'], 'month', 600)).toEqual([['May', '2026'], 'Jun', 'Jul']);
		expect(isoMonday('2026-06-14')).toBe('2026-06-08');
		expect(fillDaily([{ d: '2026-06-30', v: 1 }], '2026-07-01').map((p) => p.d)).toEqual(['2026-06-30', '2026-07-01']);
	});

	it('names the UTC month whatever the reader timezone', () => {
		const tz = process.env.TZ;
		process.env.TZ = 'America/Los_Angeles';
		try {
			expect(new Date('2026-06-01T00:00:00Z').getMonth()).toBe(4); // May, locally: the switch took effect
			expect(bucketTitle('2026-06', 'month')).toBe('June 2026');
			expect(bucketTitle('2026-06-08', 'week')).toBe('Week of Jun 8, 2026');
			expect(bucketTickLabels(['2026-06', '2026-07'], 'month', 600)).toEqual([['Jun', '2026'], 'Jul']);
		} finally {
			if (tz === undefined) delete process.env.TZ;
			else process.env.TZ = tz;
		}
	});
});

describe('fillDaily', () => {
	it('forward-fills elided days through as_of_day', () => {
		expect(
			fillDaily(
				[
					{ d: '2026-09-20', v: 10 },
					{ d: '2026-09-22', v: 12 }
				],
				'2026-09-24'
			)
		).toEqual([
			{ d: '2026-09-20', v: 10 },
			{ d: '2026-09-21', v: 10 },
			{ d: '2026-09-22', v: 12 },
			{ d: '2026-09-23', v: 12 },
			{ d: '2026-09-24', v: 12 }
		]);
	});

	it('keeps a dense series as it is and sorts an unsorted one', () => {
		const dense = [
			{ d: '2026-09-21', v: 2 },
			{ d: '2026-09-20', v: 1 }
		];
		expect(fillDaily(dense)).toEqual([
			{ d: '2026-09-20', v: 1 },
			{ d: '2026-09-21', v: 2 }
		]);
	});

	it('never extends backwards past as_of_day and handles empty input', () => {
		expect(fillDaily([{ d: '2026-09-24', v: 3 }], '2026-09-01')).toEqual([{ d: '2026-09-24', v: 3 }]);
		expect(fillDaily([])).toEqual([]);
	});

	it('refuses to paper over a span of decades', () => {
		const pts = [
			{ d: '1970-01-01', v: 1 },
			{ d: '2026-09-24', v: 2 }
		];
		expect(fillDaily(pts)).toEqual(pts);
		expect(MAX_FILL_DAYS).toBeGreaterThan(3 * 365);
	});
});

describe('sortRows', () => {
	type Row = { name: string; pushes: number; last: string | null };
	const rows: Row[] = [
		{ name: 'gamma', pushes: 5, last: '2026-09-20' },
		{ name: 'Alpha', pushes: 9, last: null },
		{ name: 'beta', pushes: 5, last: '2026-09-01' }
	];
	const names = (rs: Row[]) => rs.map((r) => r.name);

	it('sorts numbers both ways', () => {
		expect(names(sortRows(rows, 'pushes', 'desc'))).toEqual(['Alpha', 'gamma', 'beta']);
		expect(names(sortRows(rows, 'pushes', 'asc'))).toEqual(['gamma', 'beta', 'Alpha']);
	});

	it('keeps INPUT order on equal keys, in both directions (never a tie-breaker of its own)', () => {
		// gamma and beta tie on pushes; the input (document) order has gamma first. A name or
		// key tie-breaker would put beta first - that is what scrambled the document ranking.
		const tied = sortRows(rows, 'pushes', 'asc');
		expect(names(tied).indexOf('gamma')).toBeLessThan(names(tied).indexOf('beta'));
		const tiedDesc = sortRows(rows, 'pushes', 'desc');
		expect(names(tiedDesc).indexOf('gamma')).toBeLessThan(names(tiedDesc).indexOf('beta'));
	});

	it('sorts text case-insensitively', () => {
		expect(names(sortRows(rows, 'name', 'asc'))).toEqual(['Alpha', 'beta', 'gamma']);
	});

	it('sinks missing values in BOTH directions', () => {
		expect(names(sortRows(rows, 'last', 'desc'))).toEqual(['gamma', 'beta', 'Alpha']);
		expect(names(sortRows(rows, 'last', 'asc'))).toEqual(['beta', 'gamma', 'Alpha']);
	});

	it('does not mutate its input', () => {
		const before = names(rows);
		sortRows(rows, 'pushes', 'asc');
		expect(names(rows)).toEqual(before);
	});
});

describe('isolatedPoint / smallLineDataset', () => {
	it('marks a value that has no finite neighbour on either side', () => {
		expect(isolatedPoint([5], 0)).toBe(true);
		expect(isolatedPoint([1, 2], 0)).toBe(false);
		expect(isolatedPoint([1, 2], 1)).toBe(false);
		expect(isolatedPoint([1, null, 3], 2)).toBe(true);
		expect(isolatedPoint([null, 4, null], 1)).toBe(true);
		expect(isolatedPoint([null], 0)).toBe(false);
		expect(isolatedPoint([Number.NaN, 4], 1)).toBe(true);
	});

	/** The dataset's pointRadius, evaluated the way Chart.js calls it for data point i. */
	const radius = (values: (number | null)[], states: BucketState[]) => {
		const ds = smallLineDataset({ label: 'Repositories', color: '#d1d5db', values }, states, false);
		const r = ds.pointRadius as (ctx: { dataIndex: number }) => number;
		return values.map((_, i) => r({ dataIndex: i }));
	};

	it('draws a visible point for a one-bucket series, which a line alone would not show', () => {
		const [r] = radius([42], ['partial_last']);
		// an 8px disc of the series colour inside a 2px ring of the card surface
		expect(r).toBe(POINT_RADIUS);
		expect(r).toBeGreaterThanOrEqual(4);
		const ds = smallLineDataset({ label: 'x', color: '#a78bfa', values: [42] }, ['full'], false);
		expect(ds.pointBackgroundColor).toBe('#a78bfa');
		expect(ds.pointBorderColor).toBe(SURFACE);
	});

	it('draws no point where the line shows the value, and one for a value between gaps', () => {
		expect(radius([1, 2, 3], ['full', 'full', 'full'])).toEqual([0, 0, 0]);
		expect(radius([1, 2, null, 4], ['full', 'full', 'full', 'full'])).toEqual([0, 0, 0, POINT_RADIUS]);
	});

	it('fades the stretches that leave the wall or enter the trailing partial bucket', () => {
		const ds = smallLineDataset(
			{ label: 'x', color: '#a78bfa', values: [1, 2, 3, 4] },
			['wall', 'full', 'full', 'partial_last'],
			false
		);
		// Chart.js types `segment` as scriptable itself; the dataset sets it as a plain object
		const segment = ds.segment as { borderColor: (ctx: { p0DataIndex: number; p1DataIndex: number }) => string | undefined };
		const seg = segment.borderColor;
		expect(seg({ p0DataIndex: 0, p1DataIndex: 1 })).toBe(fade('#a78bfa', 0.35));
		expect(seg({ p0DataIndex: 1, p1DataIndex: 2 })).toBeUndefined();
		expect(seg({ p0DataIndex: 2, p1DataIndex: 3 })).toBe(fade('#a78bfa', 0.35));
	});
});

describe('showLeaderboard', () => {
	it('hides a leaderboard below five rows and shows it from five', () => {
		expect(LEADERBOARD_MIN_ROWS).toBe(5);
		expect(showLeaderboard([1, 2, 3, 4])).toBe(false);
		expect(showLeaderboard([1, 2, 3, 4, 5])).toBe(true);
		expect(showLeaderboard([])).toBe(false);
		expect(showLeaderboard(null)).toBe(false);
	});
});

describe('sumOf', () => {
	it('sums a column and skips non-numbers', () => {
		expect(sumOf([{ v: 1 }, { v: 2 }, { v: Number.NaN }], (r) => r.v)).toBe(3);
	});
});

describe('fade', () => {
	it('turns a palette hex into rgba at the given opacity', () => {
		expect(fade('#a78bfa', 0.3)).toBe('rgba(167,139,250,0.3)');
		expect(fade('#64748B', 1)).toBe('rgba(100,116,139,1)');
	});

	it('returns anything that is not #rrggbb unchanged', () => {
		expect(fade('red', 0.5)).toBe('red');
		expect(fade('#abc', 0.5)).toBe('#abc');
	});
});

describe('yearWindowStart', () => {
	it('starts twelve complete months, 52 complete weeks or a year of days back', () => {
		// as_of on a month's last day: Oct 2025 .. Sep 2026, twelve full months
		expect(yearWindowStart('2026-09-30', 'month')).toBe('2025-10');
		expect(yearWindowStart('2026-09-30', 'week')).toBe('2025-09-29');
		expect(yearWindowStart('2026-09-30', 'day')).toBe('2025-10-01');
		// mid-month: still twelve complete months (Oct 2025 .. Sep 2026), then Oct 2026 filling
		expect(yearWindowStart('2026-10-15', 'month')).toBe('2025-10');
		expect(yearWindowStart('2026-10-15', 'day')).toBe('2025-10-16');
		// a Sunday ends its ISO week: the window then holds 52 complete weeks and no partial one
		expect(yearWindowStart('2026-10-04', 'week')).toBe('2025-10-06');
		// the year boundary and a leap day
		expect(yearWindowStart('2026-12-31', 'month')).toBe('2026-01');
		expect(yearWindowStart('2028-02-28', 'day')).toBe('2027-03-01');
	});
});

describe('flooredWindowStart', () => {
	it('starts at the bucket holding the floor day until the trailing year passes it', () => {
		// /git's weekly charts: Jul 1, 2026 is a Wednesday, its week starts on Monday Jun 29
		expect(flooredWindowStart('2026-09-24', 'week', '2026-07-01')).toBe('2026-06-29');
		expect(flooredWindowStart('2026-10-02', 'week', '2026-07-01')).toBe('2026-06-29');
		// a year on, the trailing 52 weeks start later than the floor and win
		expect(flooredWindowStart('2027-07-15', 'week', '2026-07-01')).toBe('2026-07-13');
		expect(yearWindowStart('2027-07-15', 'week')).toBe('2026-07-13');
		// the day they meet: as_of 2027-06-30 still starts with the floor's week
		expect(flooredWindowStart('2027-06-30', 'week', '2026-07-01')).toBe('2026-06-29');
		expect(flooredWindowStart('2027-07-06', 'week', '2026-07-01')).toBe('2026-07-06');
		// the same rule at the other granularities
		expect(flooredWindowStart('2026-09-24', 'month', '2026-07-01')).toBe('2026-07');
		expect(flooredWindowStart('2027-09-24', 'month', '2026-07-01')).toBe('2026-09');
		expect(flooredWindowStart('2026-09-24', 'day', '2026-07-01')).toBe('2026-07-01');
	});

	it('falls back to whichever end parses', () => {
		expect(flooredWindowStart('not a day', 'week', '2026-07-01')).toBe('2026-06-29');
		expect(flooredWindowStart('2026-09-24', 'week', 'not a day')).toBe('2025-09-22');
	});
});

describe('inWindow', () => {
	const months = [
		{ m: '2025-08', v: 1 },
		{ m: '2025-09', v: 0 },
		{ m: '2025-10', v: 3 },
		{ m: '2025-11', v: 2 }
	];

	it('drops the rows before the window', () => {
		const w = inWindow(months, (r) => r.m, '2025-10', 'month');
		expect(w.labels).toEqual(['2025-10', '2025-11']);
		expect(w.rows.map((r) => r?.v)).toEqual([3, 2]);
	});

	it('pads a series that starts after the window with null buckets, never zeros', () => {
		const w = inWindow(months, (r) => r.m, '2025-06', 'month');
		expect(w.labels).toEqual(['2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11']);
		expect(w.rows.map((r) => (r === null ? null : r.v))).toEqual([null, null, 1, 0, 3, 2]);
		const weeks = inWindow([{ w: '2026-06-08' }], (r) => r.w, '2026-05-25', 'week');
		expect(weeks.labels).toEqual(['2026-05-25', '2026-06-01', '2026-06-08']);
		const days = inWindow([{ d: '2026-01-01' }], (r) => r.d, '2025-12-30', 'day');
		expect(days.labels).toEqual(['2025-12-30', '2025-12-31', '2026-01-01']);
	});

	it('carries a year boundary and leaves an empty series empty', () => {
		expect(inWindow([{ m: '2026-01' }], (r) => r.m, '2025-11', 'month').labels).toEqual(['2025-11', '2025-12', '2026-01']);
		expect(inWindow([], (r: { m: string }) => r.m, '2025-11', 'month')).toEqual({ labels: [], rows: [] });
	});
});

describe('cumulative', () => {
	it('is the running total', () => {
		expect(cumulative([1, 0, 3, 2])).toEqual([1, 1, 4, 6]);
		expect(cumulative([])).toEqual([]);
	});
});

describe('valuesOf / windowWithTotal', () => {
	const months = [
		{ m: '2025-08', v: 1 },
		{ m: '2025-09', v: 0 },
		{ m: '2025-10', v: 3 },
		{ m: '2025-11', v: 2 }
	];

	it('keeps a padded bucket null, never zero', () => {
		expect(valuesOf([null, { v: 0 }, { v: 4 }], (r) => r.v)).toEqual([null, 0, 4]);
	});

	it('carries the running total from before the window into its first point', () => {
		const w = windowWithTotal(months, (r) => r.m, (r) => r.v, '2025-10', 'month');
		expect(w.labels).toEqual(['2025-10', '2025-11']);
		expect(w.values).toEqual([3, 2]);
		expect(w.totals).toEqual([4, 6]); // 1 + 0 before the window, then 3, then 2
	});

	it("starts the running total from a base: what precedes the series' first row", () => {
		// /git's GRASP list users: the weekly series starts at the states wall's week, and the
		// users first seen before it are the base the line starts from
		const w = windowWithTotal(months, (r) => r.m, (r) => r.v, '2025-10', 'month', 50);
		expect(w.values).toEqual([3, 2]);
		expect(w.totals).toEqual([54, 56]);
		expect(windowWithTotal(months, (r) => r.m, (r) => r.v, '2025-07', 'month', 50).totals).toEqual([null, 51, 51, 54, 56]);
	});

	it('pads both the values and the totals with null before a series begins', () => {
		const w = windowWithTotal(months, (r) => r.m, (r) => r.v, '2025-07', 'month');
		expect(w.labels[0]).toBe('2025-07');
		expect(w.values).toEqual([null, 1, 0, 3, 2]);
		expect(w.totals).toEqual([null, 1, 1, 4, 6]);
	});
});

describe('secondAxisScale / rightLineDataset', () => {
	it('puts a second measure on its own axis at the right, titled in its colour, with no grid', () => {
		const scale = secondAxisScale('threads', '#34d399');
		expect(scale.position).toBe('right');
		expect(scale.beginAtZero).toBe(true);
		expect(scale.grid.drawOnChartArea).toBe(false);
		expect(scale.title).toEqual({ display: true, text: 'threads', color: '#34d399' });
		expect(scale.ticks.callback(12345)).toBe('12,345');
	});

	it("draws SmallLine's right series on that axis, never washed", () => {
		const states: BucketState[] = ['full', 'full', 'partial_last'];
		const s = { label: 'Threads', color: '#34d399', values: [1, 2, 3] };
		const ds = rightLineDataset(s, states);
		expect(ds.yAxisID).toBe('y2');
		expect(ds.fill).toBe(false);
		expect(ds.label).toBe('Threads');
		// otherwise a left series' dataset: its own colour, no wash, the same faded stretch into
		// the partial week and none between full weeks
		expect(ds.borderColor).toBe('#34d399');
		expect(ds.backgroundColor).toBe('#34d399');
		const seg = (ds.segment as { borderColor: (c: { p0DataIndex: number; p1DataIndex: number }) => string | undefined })
			.borderColor;
		expect(seg({ p0DataIndex: 1, p1DataIndex: 2 })).toBe('rgba(52,211,153,0.35)');
		expect(seg({ p0DataIndex: 0, p1DataIndex: 1 })).toBeUndefined();
		expect(smallLineDataset(s, states, false).yAxisID).toBeUndefined();
	});
});

describe('hasValue', () => {
	it('drops the tooltip row of a null bucket and keeps a real zero', () => {
		expect(hasValue({ parsed: { y: null } })).toBe(false);
		expect(hasValue({ parsed: { y: Number.NaN } })).toBe(false);
		expect(hasValue({ parsed: { y: 0 } })).toBe(true);
		expect(hasValue({ parsed: { y: 12 } })).toBe(true);
	});
});

describe('totalLineDataset', () => {
	it('is a line on the second axis, over the bars, faded where the bars under it are', () => {
		const states: BucketState[] = ['wall', 'partial_first', 'full', 'full', 'partial_last'];
		const ds = totalLineDataset({ label: 'Total', color: '#fbbf24', values: [1, 2, 3, 4, 5] }, states);
		expect(ds.type).toBe('line');
		expect(ds.yAxisID).toBe('y2');
		expect(ds.order).toBe(0);
		expect(ds.data).toEqual([1, 2, 3, 4, 5]);
		const segment = ds.segment as { borderColor: (c: { p0DataIndex: number; p1DataIndex: number }) => string | undefined };
		const seg = (p0: number) => segment.borderColor({ p0DataIndex: p0, p1DataIndex: p0 + 1 });
		expect([0, 1, 2, 3].map(seg)).toEqual([fade('#fbbf24', 0.35), fade('#fbbf24', 0.35), undefined, fade('#fbbf24', 0.35)]);
	});
});

describe('malformed dates', () => {
	it('cut nothing and never throw', () => {
		expect(yearWindowStart('not-a-day', 'month')).toBe('');
		expect(yearWindowStart('', 'week')).toBe('');
		expect(isoMonday('2026-13-45')).toBe('');
		expect(wallBucket('garbage', 'week')).toBe('');
		expect(inWindow([{ m: '2026-01' }], (r) => r.m, yearWindowStart('bad', 'month'), 'month').labels).toEqual(['2026-01']);
	});
});
