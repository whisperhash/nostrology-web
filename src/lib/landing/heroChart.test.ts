// @vitest-environment node
//
// The hero chart's geometry (heroChart.ts), against constructed charts one rule at a time,
// then against the real 2026-10-15 board (board.test.ts's fixture): what the server draws.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildBoard, type BoardChart } from './board';
import { chartGeometry, formatValue, VIEW } from './heroChart';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL = buildBoard(
	JSON.parse(gunzipSync(readFileSync(resolve(HERE, 'fixtures/board-inputs-2026-10-15.json.gz'))).toString('utf8'))
).board;
const panel = (key: string) => REAL.panels.find((p) => p.key === key)!;

const line = (v: (number | null)[], extra: Partial<BoardChart> = {}): BoardChart => ({
	start: '2026-01-01',
	series: [{ label: '', v, color: '#123456', unit: 'things', fill: true }],
	...extra
});

describe('the scale', () => {
	it('leaves 14% of headroom over the highest value', () => {
		expect(chartGeometry(line([0, 50, 100]), { h: 250 }).yMax).toBeCloseTo(114);
	});

	it('keeps every line under the figure band across its reach', () => {
		// The band covers the first 67% of the width and the top 45% of the height: a value
		// of 100 there must sit at or below 55% of the plot, so the scale grows to 100 / 0.55.
		const g = chartGeometry(line([100, 100, 100, 50]), { h: 250, clear: { x: 0.67, y: 0.45 } });
		expect(g.yMax).toBeCloseTo(100 / 0.55);
		// a peak only past the band's reach does not move the scale beyond the headroom rule
		const late = chartGeometry(line([10, 10, 10, 100]), { h: 250, clear: { x: 0.67, y: 0.45 } });
		expect(late.yMax).toBeCloseTo(114);
	});

	it('scales to the highest line, whichever line that is', () => {
		const chart: BoardChart = {
			start: '2026-01-01',
			series: [
				{ label: 'low', v: [1, 10], color: '#1', unit: '' },
				{ label: 'high', v: [1, 100], color: '#2', unit: '' }
			]
		};
		expect(chartGeometry(chart, { h: 250 }).yMax).toBeCloseTo(114);
	});

	it('never divides by zero on a flat-zero chart', () => {
		const g = chartGeometry(line([0, 0, 0]), { h: 250 });
		expect(g.yMax).toBe(1);
		expect(g.series[0].segments[0].line).toBe('M0 1000L500 1000L1000 1000');
	});
});

describe('the paths', () => {
	it('draws the line and its fill across the box', () => {
		// top 100, so the scale is 114: 57 sits halfway up, 100 at 1000 - 100 / 114 * 1000
		const g = chartGeometry(line([0, 57, 100]), { h: 250 });
		expect(g.series[0].segments).toEqual([
			{ line: 'M0 1000L500 500L1000 122.81', area: 'M0 1000L500 500L1000 122.81L1000 1000L0 1000Z', faded: false }
		]);
	});

	it('lifts the pen over a missing day, and draws no fill for a series without one', () => {
		const chart: BoardChart = {
			start: '2026-01-01',
			series: [{ label: 'a', v: [114, null, 114], color: '#000', unit: '', pct: true }]
		};
		const seg = chartGeometry(chart, { h: 250 }).series[0].segments[0];
		// two moves, no line between them: the pen lifts over the missing day
		expect(seg.line).toBe('M0 122.81M1000 122.81');
		expect(seg.area).toBeNull();
	});

	it('fades the line before the wall, and both parts meet at it', () => {
		const g = chartGeometry(line([10, 20, 30, 40, 50], { wall: 2, wallText: 'observation began' }), { h: 250 });
		const [faded, observed] = g.series[0].segments;
		expect(faded.faded).toBe(true);
		expect(observed.faded).toBe(false);
		expect(faded.line.endsWith('L500 473.68')).toBe(true);
		expect(observed.line.startsWith('M500 473.68')).toBe(true);
		expect(g.wall).toEqual({ left: 50, text: 'observation began' });
	});

	it('draws no wall at the first day, and fades nothing', () => {
		const g = chartGeometry(line([1, 2, 3], { wall: 0 }), { h: 250 });
		expect(g.wall).toBeNull();
		expect(g.series[0].segments.map((s) => s.faded)).toEqual([false]);
	});

	it("names the wall in the chart's own words", () => {
		expect(chartGeometry(line([1, 2, 3], { wall: 1, wallText: 'from here' }), { h: 250 }).wall!.text).toBe('from here');
	});

	it('keeps a path to about 400 points, whatever the length, ends and wall included', () => {
		// 1,001 days take every third (the stride); the wall (334) and the last day (1000) are
		// off it, so they are drawn only because they are always kept.
		const v = Array.from({ length: 1001 }, (_, i) => i);
		const g = chartGeometry(line(v, { wall: 334 }), { h: 250 });
		const points = g.series[0].segments.map((s) => s.line.split(/[ML]/).filter(Boolean).length);
		expect(points[0] + points[1]).toBeLessThanOrEqual(404);
		// the code's own rounding: two decimals, as a number
		const at = (i: number) => `${+((i / 1000) * VIEW).toFixed(2)} ${+(VIEW - (v[i] / g.yMax) * VIEW).toFixed(2)}`;
		expect(g.series[0].segments[0].line.endsWith(`L${at(334)}`)).toBe(true); // the wall is a point of both
		expect(g.series[0].segments[1].line.startsWith(`M${at(334)}`)).toBe(true);
		expect(g.series[0].segments[1].line.endsWith(`L${at(1000)}`)).toBe(true); // and so is the last day
	});
});

describe('the end labels', () => {
	const three: BoardChart = {
		start: '2026-01-01',
		series: [
			{ label: 'All apps', v: [10, 100], color: '#1', unit: '', fill: true },
			{ label: 'Republished from GitHub / F-Droid', short: 'Republished', v: [5, 96], color: '#2', unit: '' },
			{ label: 'Nostr-native', v: [1, 40], color: '#3', unit: '' }
		]
	};

	it('names each series, short where it has a short name, and prints its last value', () => {
		const g = chartGeometry(three, { h: 250 });
		expect(g.ends.map((e) => [e.s, e.name, e.value])).toEqual([
			[0, 'All apps', '100'],
			[1, 'Republished', '96'],
			[2, 'Nostr-native', '40']
		]);
	});

	it('ends a line at its last day with a value, and labels that', () => {
		const g = chartGeometry(line([10, 57, null]), { h: 250 });
		// top 57, so the scale is 57 x 1.14 = 64.98: 57 sits 12.28% from the top
		expect([g.ends[0].value, g.ends[0].top, g.dots[0].top]).toEqual(['57', 12.28, 12.28]);
	});

	it('names nothing on a one-line chart', () => {
		expect(chartGeometry(line([1, 2]), { h: 250 }).ends[0].name).toBeNull();
	});

	it('shows, before the browser places them, only labels 16 px apart, top down', () => {
		// at h = 250, 100 and 96 of 114 are 3.5% (8.8 px) apart: the lower one starts hidden
		expect(chartGeometry(three, { h: 250 }).ends.map((e) => e.shown)).toEqual([true, false, true]);
		// a taller plot spreads them past 16 px
		expect(chartGeometry(three, { h: 600 }).ends.map((e) => e.shown)).toEqual([true, true, true]);
	});

	it('puts one dot at each line end, top down', () => {
		expect(chartGeometry(three, { h: 250 }).dots.map((d) => d.color)).toEqual(['#1', '#2', '#3']);
	});

	it('prints shares with one decimal and a %, counts in en-US', () => {
		expect(formatValue({ pct: true }, 40.04)).toBe('40.0%');
		expect(formatValue({}, 4873)).toBe('4,873');
		expect(formatValue({}, 1027.6)).toBe('1,028');
	});
});

describe('the months', () => {
	it('labels each month where it starts, with the year under the first and January', () => {
		const chart: BoardChart = { start: '2025-11-30', series: [{ label: '', v: new Array(70).fill(1), color: '#0', unit: '' }] };
		const ticks = chartGeometry(chart, { h: 250 }).ticks;
		expect(ticks.map((t) => [t.month, t.year, t.quarter])).toEqual([
			['Dec', '2025', false],
			['Jan', '2026', true],
			['Feb', null, false]
		]);
		expect(ticks[0].left).toBeCloseTo((1 / 69) * 100, 1);
	});

	it('right-aligns a label too close to the right edge to centre', () => {
		const chart: BoardChart = { start: '2026-01-02', series: [{ label: '', v: new Array(31).fill(1), color: '#0', unit: '' }] };
		const ticks = chartGeometry(chart, { h: 250 }).ticks;
		expect(ticks).toEqual([{ left: 100, month: 'Feb', year: '2026', quarter: false, last: true }]);
	});
});

describe('the real board (2026-10-15)', () => {
	it('draws every panel', () => {
		for (const p of REAL.panels) {
			const g = chartGeometry(p.chart!, { h: 250, clear: { x: 0.67, y: 0.45 } });
			expect(g.n).toBe(p.chart!.series[0].v.length);
			expect(g.series.every((s) => s.segments.every((seg) => seg.line.startsWith('M')))).toBe(true);
			expect(g.ticks.length).toBeGreaterThanOrEqual(11);
		}
	});

	it("fades Git-on-Nostr before 2026-05-02 and names it 'observation began'", () => {
		const g = chartGeometry(panel('git').chart!, { h: 250 });
		expect(g.wall!.text).toBe('observation began');
		expect(g.series[0].segments.map((s) => s.faded)).toEqual([true, false]);
	});

	it("labels Zapstore's three lines and Lightning's five", () => {
		expect(chartGeometry(panel('zapstore').chart!, { h: 250 }).ends.map((e) => e.name)).toEqual([
			'All apps',
			'Republished',
			'Nostr-native'
		]);
		const ends = chartGeometry(panel('lightning').chart!, { h: 250 }).ends;
		expect(ends).toHaveLength(5);
		expect(ends.every((e) => /^\d+\.\d%$/.test(e.value))).toBe(true);
	});
});
