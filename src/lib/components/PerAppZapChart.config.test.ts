// What PerAppZapChart hands to Chart.js for its two value axes and its tooltip. A fake Chart
// records the configuration, as in ngit/StackedBars.config.test.ts. The labels depend on which
// ticks Chart.js really picks, so that configuration then goes to the REAL Chart.js
// ($lib/charts/real-chart.test-helper): a label that only holds for a tick nobody draws, or misses
// one they do, proves nothing. Its month labels are in $lib/charts/time-charts.config.test.ts.
import { render } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { drawnLabels, drawReal, stubCanvasContext } from '$lib/charts/real-chart.test-helper';

type TooltipItem = { dataset: { label: string }; parsed: { y: number }; dataIndex: number };
type Cfg = {
	data: { datasets: { label: string }[] };
	options: {
		scales: Record<'y' | 'y1', { ticks: { callback: (value: number) => string } }>;
		plugins: { tooltip: { callbacks: { label: (item: TooltipItem) => string } } };
	};
};

const charts: { cfg: Cfg }[] = [];

vi.mock('chart.js', async (importOriginal) => {
	const real = await importOriginal<typeof import('chart.js')>();
	class FakeChart {
		static register() {}
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

import PerAppZapChart from './PerAppZapChart.svelte';

beforeAll(stubCanvasContext);
afterEach(() => {
	charts.length = 0;
});

const DAY = 86_400;
function configFor(dailyMax: number, cumulativeMax: number) {
	render(PerAppZapChart, {
		props: {
			title: 'Zapstore Zaps',
			dailySeries: [
				{ timestamp: 0, value: 0 },
				{ timestamp: DAY, value: dailyMax }
			],
			// Starting high, as a year's line does for anything older than the year: the axis
			// must still run from zero, whose whole steps are what keep its labels exact.
			cumulativeSeries: [
				{ timestamp: 0, value: Math.floor(cumulativeMax * 0.9) },
				{ timestamp: DAY, value: cumulativeMax }
			],
			dailyLabel: 'Daily zap count',
			cumulativeLabel: 'Cumulative sats',
			dailyColor: '#3498db',
			cumulativeColor: '#f39c12',
			rightAxisLabel: 'Cumulative sats'
		}
	});
	return charts[charts.length - 1].cfg;
}

// The ticks real Chart.js draws from this component's configuration, on a phone's canvas.
async function realTicks(dailyMax: number, cumulativeMax: number) {
	const chart = await drawReal(configFor(dailyMax, cumulativeMax), 358);
	const ticks = { y: drawnLabels(chart, 'y'), y1: drawnLabels(chart, 'y1'), y1Values: chart.scales.y1.ticks.map((t) => t.value) };
	chart.destroy();
	return ticks;
}

// What a label says its tick's value is.
function readBack(label: string): number {
	const size = { k: 1e3, M: 1e6, B: 1e9 }[label.slice(-1)];
	return size ? Number(label.slice(0, -1)) * size : Number(label);
}

describe('PerAppZapChart value axes', () => {
	it('draws the operator\'s series on the right, the Zapstore Zaps chart at its real scale', async () => {
		const { y, y1 } = await realTicks(30, 2_850_000);
		expect(y1.join(' ')).toBe('0 500k 1M 1.5M 2M 2.5M 3M');
		expect(y.join(' ')).toBe('0 5 10 15 20 25 30');
	});

	it('shortens the left axis as well: a chart of daily sats is as wide on that side', async () => {
		const { y, y1 } = await realTicks(100_000, 290_000);
		expect(y.join(' ')).toBe('0 10k 20k 30k 40k 50k 60k 70k 80k 90k 100k');
		expect(y1.join(' ')).toBe('0 50k 100k 150k 200k 250k 300k');
	});

	it('draws a small axis in whole numbers, one label to a value', async () => {
		// 0 0 1 1 2 2 3 and 0 0 0 0 0 0 0 0 0 0 1 until 2026-11-04: fractional ticks, printed whole.
		const { y, y1 } = await realTicks(1, 3);
		expect(y1.join(' ')).toBe('0 1 2 3');
		expect(y.join(' ')).toBe('0 1');
	});

	it('draws 0 and 1 for a chart with nothing on it yet', async () => {
		const { y, y1 } = await realTicks(0, 0);
		expect(y1.join(' ')).toBe('0 1');
		expect(y.join(' ')).toBe('0 1');
	});

	// Across the scales these charts can reach, including each unit's boundary and a max whose
	// step is 2 or 5. `compact` rounds, so this is what stands between a Chart.js upgrade or a new
	// axis option and a gridline labelled with a value it is not on.
	it.each([1, 3, 5, 9, 10, 12, 25, 99, 100, 120, 500, 999, 1000, 1300, 2400, 3500, 9000, 9999, 12_000, 25_000,
		125_000, 290_000, 800_000, 999_999, 1_000_000, 1_100_000, 2_230_000, 2_850_000, 6_500_000, 13_000_000,
		125_000_000, 1_200_000_000, 3_400_000_000])('labels every gridline with its own value at a max of %d', async (max) => {
		const { y1, y1Values } = await realTicks(1, max);
		y1.forEach((label, i) => expect(readBack(label), `${y1Values[i]} labelled ${label}`).toBe(y1Values[i]));
		expect(new Set(y1).size).toBe(y1.length);
		// the point of the change: no label wider than the widest one the operator asked for
		expect(Math.max(...y1.map((l) => l.length))).toBeLessThanOrEqual('2.5M'.length);
	});

	it('keeps the exact figure in the tooltip, the way to read a value off the chart', () => {
		const { label } = configFor(30, 2_850_000).options.plugins.tooltip.callbacks;
		const line = label({ dataset: { label: 'Cumulative sats' }, parsed: { y: 2_850_123 }, dataIndex: 1 });
		expect(line).toBe(`Cumulative sats: ${(2_850_123).toLocaleString()}`);
		expect(line).not.toMatch(/\dM\b/);
	});
});
