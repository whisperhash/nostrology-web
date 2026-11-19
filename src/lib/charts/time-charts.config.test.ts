// The site's time charts through the real Chart.js ($lib/charts/real-chart.test-helper): their month
// labels neither overlapping nor leaving the canvas across a phone's widths and a desktop's,
// CumulativeLineChart's value axis, which only /nutzaps/mints shortens, and ActiveUsersChart's value
// axis and curve.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/svelte';
import type { LineElement } from 'chart.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { collisions, drawnLabels, drawReal, offCanvas, stubCanvasContext } from './real-chart.test-helper';

type Cfg = {
	data: { datasets: { label: string }[] };
	options: {
		scales: Record<'x' | 'y', { beginAtZero?: boolean; ticks: { precision?: number } }>;
		plugins: { tooltip: { callbacks: { label: (item: unknown) => string } } };
	};
};
const charts: { cfg: Cfg }[] = [];

vi.mock('chart.js', async (importOriginal) => {
	const real = await importOriginal<typeof import('chart.js')>();
	class FakeChart {
		static register() {}
		// two charts' legends read these while the real Chart draws them
		static defaults = real.Chart.defaults;
		cfg: Cfg;
		data: Cfg['data'];
		constructor(_ctx: unknown, cfg: Cfg) {
			this.cfg = cfg;
			this.data = cfg.data;
			charts.push(this);
		}
		isDatasetVisible() {
			return true;
		}
		destroy() {}
	}
	return { ...real, Chart: FakeChart };
});

import ActiveUsersChart from '$lib/components/ActiveUsersChart.svelte';
import CumulativeLineChart from '$lib/components/CumulativeLineChart.svelte';
import DailyBarChart from '$lib/components/DailyBarChart.svelte';
import PerAppZapChart from '$lib/components/PerAppZapChart.svelte';

beforeAll(stubCanvasContext);
afterEach(() => {
	charts.length = 0;
});

type Point = { timestamp: number; value: number };
const DAY = 86_400;
const year = (start: string): Point[] =>
	Array.from({ length: 366 }, (_, i) => ({ timestamp: Date.parse(`${start}T00:00:00Z`) / 1000 + i * DAY, value: 100 + i }));
const monthly = (startYear: number, startMonth: number): Point[] =>
	Array.from({ length: 13 }, (_, i) => ({ timestamp: Date.UTC(startYear, startMonth - 1 + i, 1) / 1000, value: 100 + i }));

// Each daily chart as its pages draw it, on the series it is given. ActiveUsersChart is monthly
// wherever it is drawn: below.
const DAILY_CHARTS: [string, (s: Point[]) => unknown][] = [
	[
		'PerAppZapChart',
		(s) =>
			render(PerAppZapChart, {
				props: {
					title: 't',
					dailySeries: s,
					cumulativeSeries: s,
					dailyLabel: 'Daily sats',
					cumulativeLabel: 'Cumulative sats',
					dailyColor: '#3498db',
					cumulativeColor: '#f39c12',
					rightAxisLabel: 'Cumulative sats'
				}
			})
	],
	[
		'CumulativeLineChart',
		(s) =>
			render(CumulativeLineChart, {
				props: { title: 't', yAxisLabel: 'Cumulative Apps', series: [{ label: 'a', data: s, color: '#1abc9c' }] }
			})
	],
	[
		'DailyBarChart',
		(s) =>
			render(DailyBarChart, {
				props: { title: 't', yAxisLabel: 'Daily releases', datasets: [{ label: 'a', color: '#3498db', series: s }] }
			})
	]
];
const cfgOf = (draw: (s: Point[]) => unknown, s: Point[]) => {
	draw(s);
	return charts[charts.length - 1].cfg;
};

// A trailing year starting at each kind of place in a month, the last days of a month being where
// the first label gives way and the next sits at the plot's edge; and a canvas from a small phone's
// up, either side of each width where a chart's label step changes.
const STARTS = ['2025-11-05', '2025-11-30', '2025-12-22', '2025-12-31', '2026-01-01', '2025-09-30'];
const WIDTHS = [288, 328, 336, 337, 343, 358, 363, 364, 398, 500, 673, 674, 727, 728, 900, 1248];

// A window of `n` days from `start`, as /lightning's range buttons cut it.
const span = (start: string, n: number) => year(start).slice(0, n);

describe('month labels', () => {
	describe.each(DAILY_CHARTS)('%s', (_name, draw) => {
		it.each(WIDTHS)('neither overlap nor leave a canvas %d px wide', async (width) => {
			for (const start of STARTS) {
				const chart = await drawReal(cfgOf(draw, year(start)), width);
				expect(collisions(chart), `overlap, a year from ${start}`).toEqual([]);
				expect(offCanvas(chart), `off the canvas, a year from ${start}`).toEqual([]);
				chart.destroy();
			}
		});

		it('draws every other month on a phone and every month on a desktop', async () => {
			const phone = await drawReal(cfgOf(draw, year('2025-11-05')), 343);
			expect(drawnLabels(phone, 'x')).toEqual(['Jan 2026', 'Mar', 'May', 'Jul', 'Sep', 'Nov']);
			phone.destroy();
			const desktop = await drawReal(cfgOf(draw, year('2025-11-05')), 1248);
			expect(drawnLabels(desktop, 'x')).toEqual([
				'Nov 2025', 'Dec', 'Jan 2026', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'
			]);
			desktop.destroy();
		});

		it('keeps a gridline for every day: only the labels thin', async () => {
			const chart = await drawReal(cfgOf(draw, year('2025-11-05')), 343);
			expect(chart.scales.x.ticks).toHaveLength(366);
			chart.destroy();
		});

		it.each([
			['a 30-day window across two months', '2026-10-16', 30, 'Oct 2026, Nov', 'Oct 2026, Nov'],
			['a 30-day window whose next month is days away: room on a desktop only', '2026-10-30', 30, 'Nov 2026', 'Oct 2026, Nov'],
			['a 30-day window inside one month', '2026-03-01', 30, 'Mar 2026', 'Mar 2026'],
			['a window across a new year', '2025-12-10', 40, 'Dec 2025, Jan 2026', 'Dec 2025, Jan 2026'],
			['a 3-month window', '2026-08-05', 92, 'Aug 2026, Sep, Oct, Nov', 'Aug 2026, Sep, Oct, Nov']
		])('labels %s', async (_title, start, n, phone, desktop) => {
			for (const [width, expected] of [[343, phone], [1248, desktop]] as const) {
				const chart = await drawReal(cfgOf(draw, span(start, n)), width);
				expect(drawnLabels(chart, 'x').join(', '), `at ${width} px`).toBe(expected);
				expect(collisions(chart)).toEqual([]);
				expect(offCanvas(chart)).toEqual([]);
				chart.destroy();
			}
		});

		it('copes with one point and with none', async () => {
			for (const s of [span('2026-03-15', 1), [] as Point[]]) {
				const chart = await drawReal(cfgOf(draw, s), 343);
				chart.destroy();
			}
		});
	});

	describe('ActiveUsersChart, by month, as /nutzaps draws it', () => {
		const draw = (s: Point[]) =>
			render(ActiveUsersChart, { props: { title: 't', granularity: 'month', series: [{ label: 'a', data: s, color: '#1abc9c' }] } });
		const gappy = [0, 1, 3, 5, 7, 9, 11].map((m) => monthly(2025, 11)[m]);

		it.each(WIDTHS)('neither overlap nor leave a canvas %d px wide', async (width) => {
			// 13 months, or 12 where the oldest has no sender, the common shape on a mint's page.
			for (const s of [monthly(2025, 11), monthly(2026, 2), monthly(2025, 12).slice(0, 12), gappy]) {
				const chart = await drawReal(cfgOf(draw, s), width);
				expect(collisions(chart)).toEqual([]);
				expect(offCanvas(chart)).toEqual([]);
				chart.destroy();
			}
		});

		it('reads as the daily charts stacked over it do', async () => {
			const phone = await drawReal(cfgOf(draw, monthly(2025, 11)), 358);
			expect(drawnLabels(phone, 'x')).toEqual(['Nov 2025', 'Jan 2026', 'Mar', 'May', 'Jul', 'Sep', 'Nov']);
			phone.destroy();
			const desktop = await drawReal(cfgOf(draw, monthly(2025, 11)), 1248);
			expect(drawnLabels(desktop, 'x')).toEqual([
				'Nov 2025', 'Dec', 'Jan 2026', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'
			]);
			desktop.destroy();
		});
	});
});

describe('ActiveUsersChart value axis and curve', () => {
	const months = (values: number[]): Point[] =>
		values.map((value, i) => ({ timestamp: Date.UTC(2025, 10 + i, 1) / 1000, value }));
	// mint.coinos.io on 2026-11-05, March and April filled, and November with no sender yet.
	const COINOS = [2, 3, 2, 5, 0, 0, 2, 2, 3, 4, 2, 4, 0];
	const draw = (s: Point[]) =>
		render(ActiveUsersChart, { props: { title: 't', granularity: 'month', series: [{ label: 'a', data: s, color: '#1abc9c' }] } });
	const yLabels = async (values: number[]) => {
		const chart = await drawReal(cfgOf(draw, months(values)), 358);
		const labels = drawnLabels(chart, 'y');
		chart.destroy();
		return labels;
	};

	it('runs from zero in whole people, even where every month has a sender', async () => {
		expect(await yLabels([2, 3, 2, 5, 2, 2, 3, 4, 2, 4])).toEqual(['0', '1', '2', '3', '4', '5']);
	});

	it('draws a mint with empty months on the same axis', async () => {
		expect(await yLabels(COINOS)).toEqual(['0', '1', '2', '3', '4', '5']);
	});

	it('draws a mint with no senders at all as 0 and 1, not as a column of zeros', async () => {
		expect(await yLabels(Array(13).fill(0))).toEqual(['0', '1']);
	});

	it('still draws a busy network chart in tens', async () => {
		expect(await yLabels([62, 9, 14, 7, 11, 5, 25, 18, 31, 22, 25, 4])).toEqual(['0', '10', '20', '30', '40', '50', '60', '70']);
	});

	it('never labels a fraction of a person, whatever the largest month', async () => {
		for (const largest of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 25]) {
			const labels = await yLabels([0, largest, 0]);
			expect(labels[0], `largest month ${largest}`).toBe('0');
			expect(labels.filter((label) => !/^\d+$/.test(label)), `largest month ${largest}`).toEqual([]);
		}
	});

	it('keeps the curve between each pair of months: no peak off its month, no dip under the data', async () => {
		const chart = await drawReal(cfgOf(draw, months(COINOS)), 1248);
		const meta = chart.getDatasetMeta(0);
		(meta.dataset as unknown as LineElement).updateControlPoints(chart.chartArea, 'x');
		const points = meta.data as unknown as { y: number; cp1y: number; cp2y: number }[];
		expect(points).toHaveLength(COINOS.length);
		for (let i = 0; i + 1 < points.length; i++) {
			const [lo, hi] = [Math.min(points[i].y, points[i + 1].y), Math.max(points[i].y, points[i + 1].y)];
			for (const cp of [points[i].cp2y, points[i + 1].cp1y]) {
				expect(cp, `month ${i} to ${i + 1}`).toBeGreaterThanOrEqual(lo - 1e-6);
				expect(cp, `month ${i} to ${i + 1}`).toBeLessThanOrEqual(hi + 1e-6);
			}
		}
		chart.destroy();
	});
});

describe('CumulativeLineChart value axis', () => {
	const sats = (from: number, to: number): Point[] => [
		{ timestamp: 0, value: from },
		{ timestamp: DAY, value: to }
	];
	const lineChart = (s: Point[], extra: Record<string, unknown> = {}) => {
		render(CumulativeLineChart, {
			props: { title: 't', yAxisLabel: 'y', series: [{ label: 'mint', data: s, color: '#f39c12' }], ...extra }
		});
		return charts[charts.length - 1].cfg;
	};

	it('stays in full figures unless asked: Zapstore Apps\' 6,000 is the operator\'s call (2026-11-04)', async () => {
		const chart = await drawReal(lineChart(sats(2200, 5100)), 358);
		expect(drawnLabels(chart, 'y')).toEqual(['2,000', '2,500', '3,000', '3,500', '4,000', '4,500', '5,000', '5,500']);
		chart.destroy();
	});

	it('leaves a percent axis free to start where it likes and to hold fractions', async () => {
		const cfg = lineChart(sats(8.2, 8.9), { formatValue: (n: number) => `${n.toFixed(1)}%` });
		const chart = await drawReal(cfg, 358);
		expect(drawnLabels(chart, 'y')).toEqual(['8.1%', '8.2%', '8.3%', '8.4%', '8.5%', '8.6%', '8.7%', '8.8%', '8.9%']);
		chart.destroy();
	});

	it('with compactAxis, reads as /nutzaps/mints\' sats should', async () => {
		const chart = await drawReal(lineChart(sats(0, 61_234), { compactAxis: true }), 358);
		expect(drawnLabels(chart, 'y')).toEqual(['0', '10k', '20k', '30k', '40k', '50k', '60k', '70k']);
		chart.destroy();
	});

	it('with compactAxis, runs from zero, the one thing that keeps a gridline\'s label its own', async () => {
		// From its own low point this axis would step by 10k from 1.01M, every label rounding to 1M or 1.1M.
		const chart = await drawReal(lineChart(sats(1_010_000, 1_105_000), { compactAxis: true }), 358);
		expect(drawnLabels(chart, 'y')).toEqual(['0', '200k', '400k', '600k', '800k', '1M', '1.2M']);
		chart.destroy();
	});

	it('with compactAxis, keeps the exact figure in the tooltip', () => {
		const { label } = lineChart(sats(0, 61_234), { compactAxis: true }).options.plugins.tooltip.callbacks as unknown as {
			label: (item: { dataset: { label: string }; parsed: { y: number }; dataIndex: number }) => string;
		};
		expect(label({ dataset: { label: 'mint' }, parsed: { y: 61_234 }, dataIndex: 1 })).toBe(`mint: ${(61_234).toLocaleString()}`);
	});

	it('is shortened on /nutzaps/mints and nowhere else, by the operator\'s choice', () => {
		const pages = (dir: string): string[] =>
			readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
				const p = join(dir, e.name);
				return e.isDirectory() ? pages(p) : e.name === '+page.svelte' ? [p] : [];
			});
		const using = pages('src/routes').filter((p) => /\bcompactAxis\b/.test(readFileSync(p, 'utf8')));
		expect(using).toEqual([join('src/routes/(app)/nutzaps/(shell)/mints/+page.svelte')]);
	});
});
