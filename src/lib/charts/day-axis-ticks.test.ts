import { describe, expect, it } from 'vitest';

import { dayTickLabels, monthStepForWidth } from './day-axis-ticks';

/**
 * The two /routstr axis defects this module replaced: a sparse series with no first-of-
 * month day got NO labels (catalog versions), and a series whose Jan 1 fell in a gap got
 * no year (cumulative revenue: weekly buckets around 2026-01-01). Both are pinned here.
 */
describe('dayTickLabels', () => {
	it('labels a sparse series with no first-of-month day at all', () => {
		const days = ['2025-11-13', '2025-12-04', '2026-02-19', '2026-03-05', '2026-05-14'];
		expect(dayTickLabels(days, 1)).toEqual([['Nov', '2025'], 'Dec', ['Feb', '2026'], 'Mar', 'May']);
	});

	it('carries the year on the first label and every year change even when thinning', () => {
		const days = ['2025-08-14', '2025-11-06', '2026-01-08', '2026-04-02', '2026-07-02'];
		// step 6: only months 1 and 7 survive the step - but the first label and the
		// year change are always kept.
		expect(dayTickLabels(days, 6)).toEqual([
			['Aug', '2025'],
			undefined,
			['Jan', '2026'],
			undefined,
			'Jul'
		]);
	});

	it('emits one label per month change on a dense daily series', () => {
		const days: string[] = [];
		for (let d = 28; d <= 31; d++) days.push(`2026-01-${d}`);
		for (let d = 1; d <= 3; d++) days.push(`2026-02-0${d}`);
		// Jan 28 -> Feb 1 is under 20 days, so the collision rule hands Feb the year.
		expect(dayTickLabels(days, 1)).toEqual([
			undefined,
			undefined,
			undefined,
			undefined,
			['Feb', '2026'],
			undefined,
			undefined
		]);
	});

	it('hands the year to the next label when the first would collide with it', () => {
		const days = ['2023-09-28', '2023-09-29', '2023-09-30', '2023-10-01', '2023-10-02'];
		expect(dayTickLabels(days, 3)).toEqual([
			undefined,
			undefined,
			undefined,
			['Oct', '2023'],
			undefined
		]);
		// but a first label with room to breathe stays
		expect(dayTickLabels(['2023-09-01', '2023-10-01'], 3)).toEqual([['Sep', '2023'], 'Oct']);
	});

	it('returns nothing for an empty series', () => {
		expect(dayTickLabels([], 3)).toEqual([]);
	});

	it('steps by width: quarters wide, half-years mid, years narrow', () => {
		expect(monthStepForWidth(1200)).toBe(3);
		expect(monthStepForWidth(700)).toBe(6);
		expect(monthStepForWidth(400)).toBe(12);
	});
});
