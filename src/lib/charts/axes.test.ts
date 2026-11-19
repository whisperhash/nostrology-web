import type { Scale } from 'chart.js';
import { describe, expect, it } from 'vitest';

import { compactTicks, monthTicks } from './axes';

const DAY = 86_400;
const dayTs = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;
const days = (start: string, n: number) => Array.from({ length: n }, (_, i) => dayTs(start) + i * DAY);

// What Chart.js does: the scale as `this`, once per point.
const tickAt = (cb: ReturnType<typeof monthTicks>, width: number, i: number) =>
	cb.call({ chart: { width } } as unknown as Scale, 0, i);
function labelsAt(cb: ReturnType<typeof monthTicks>, width: number, n: number) {
	return Array.from({ length: n }, (_, i) => tickAt(cb, width, i)).filter((t) => t !== '');
}

describe('monthTicks', () => {
	// A year of days from the fifth of a month, as the charts' trailing windows are.
	const YEAR = days('2025-11-05', 366);

	it('draws every month with room for them, each year on its first label', () => {
		expect(labelsAt(monthTicks(YEAR), 1248, YEAR.length)).toEqual([
			['Nov', '2025'],
			'Dec',
			['Jan', '2026'],
			'Feb',
			'Mar',
			'Apr',
			'May',
			'Jun',
			'Jul',
			'Aug',
			'Sep',
			'Oct',
			'Nov'
		]);
	});

	it('draws every other month on a 343 px canvas, as on a 375pt-wide iPhone', () => {
		expect(labelsAt(monthTicks(YEAR), 343, YEAR.length)).toEqual([['Jan', '2026'], 'Mar', 'May', 'Jul', 'Sep', 'Nov']);
	});

	it('draws every third month on a 328 px canvas, where every other month has no room', () => {
		expect(labelsAt(monthTicks(YEAR), 328, YEAR.length)).toEqual([['Jan', '2026'], 'Apr', 'Jul', 'Oct']);
	});

	it('changes step at the exact width /git\'s rule says, for days as they are', () => {
		expect(labelsAt(monthTicks(YEAR), 336, YEAR.length)).toEqual([['Jan', '2026'], 'Apr', 'Jul', 'Oct']);
		expect(labelsAt(monthTicks(YEAR), 337, YEAR.length)).toEqual([['Jan', '2026'], 'Mar', 'May', 'Jul', 'Sep', 'Nov']);
	});

	it('follows the width when the chart is resized', () => {
		const cb = monthTicks(YEAR);
		expect(labelsAt(cb, 343, YEAR.length)).toHaveLength(6);
		expect(labelsAt(cb, 1248, YEAR.length)).toHaveLength(13);
		expect(labelsAt(cb, 343, YEAR.length)).toHaveLength(6);
	});

	it('returns an empty label for an unlabelled point, never undefined, which deletes its gridline', () => {
		const ticks = Array.from({ length: YEAR.length }, (_, i) => tickAt(monthTicks(YEAR), 343, i));
		expect(ticks).not.toContain(undefined);
		expect(ticks.filter((t) => t === '')).toHaveLength(YEAR.length - 6);
	});

	// The last second of February and the first of March, in UTC. Read in local time, the first is
	// already March in Tokyo and the second still February in Los Angeles.
	it.each(['America/Los_Angeles', 'Asia/Tokyo', 'UTC'])('reads the day in UTC under TZ=%s', (zone) => {
		const before = process.env.TZ;
		process.env.TZ = zone;
		try {
			const edge = [dayTs('2026-03-01') - 1, dayTs('2026-03-01')];
			expect(labelsAt(monthTicks(edge), 800, 2)).toEqual([['Feb', '2026'], 'Mar']);
		} finally {
			if (before === undefined) delete process.env.TZ;
			else process.env.TZ = before;
		}
	});

	it('takes a monthly series, a label per point with room for them', () => {
		const months = ['2025-11', '2025-12', '2026-01', '2026-02'].map((m) => dayTs(`${m}-01`));
		expect(labelsAt(monthTicks(months, 'month'), 1248, 4)).toEqual([['Nov', '2025'], 'Dec', ['Jan', '2026'], 'Feb']);
	});

	it('thins a monthly line as a line: 13 points span 12 months, so it reads as a daily year does', () => {
		const months = Array.from({ length: 13 }, (_, i) => Date.UTC(2025, 10 + i, 1) / 1000);
		const phone = [['Nov', '2025'], ['Jan', '2026'], 'Mar', 'May', 'Jul', 'Sep', 'Nov'];
		expect(labelsAt(monthTicks(months, 'month'), 343, 13)).toEqual(phone);
		// a daily year from the same month, as the charts stacked over it on /nutzaps draw
		expect(labelsAt(monthTicks(days('2025-11-01', 366)), 343, 366)).toEqual(phone);
	});

	it('takes a weekly series', () => {
		const weeks = Array.from({ length: 8 }, (_, i) => dayTs('2026-06-08') + i * 7 * DAY);
		expect(labelsAt(monthTicks(weeks, 'week'), 800, 8)).toEqual([['Jun', '2026'], 'Jul']);
	});

	it('gives way by pixels alone: a 30-day window keeps both its months, on a phone and a desktop', () => {
		const window = days('2026-10-16', 30);
		for (const width of [343, 1248]) expect(labelsAt(monthTicks(window), width, 30)).toEqual([['Oct', '2026'], 'Nov']);
	});

	it('still drops a first label with no room, and hands its year on', () => {
		expect(labelsAt(monthTicks(days('2026-10-30', 30)), 343, 30)).toEqual([['Nov', '2026']]);
	});

	it('copes with a series that has no points', () => {
		expect(tickAt(monthTicks([]), 343, 0)).toBe('');
	});

	it.each([NaN, Infinity, 1e15])('does not throw on a timestamp of %d: one bad point must not stop the page', (bad) => {
		const cb = monthTicks([bad, ...days('2026-01-01', 40)]);
		expect(() => labelsAt(cb, 800, 41)).not.toThrow();
	});
});

describe('compactTicks', () => {
	it('labels in k, M and B, whole numbers only', () => {
		expect(compactTicks.precision).toBe(0);
		expect([0, 500, 1000, 500_000, 1_500_000, 2_500_000_000].map(compactTicks.callback)).toEqual([
			'0',
			'500',
			'1k',
			'500k',
			'1.5M',
			'2.5B'
		]);
	});
});
