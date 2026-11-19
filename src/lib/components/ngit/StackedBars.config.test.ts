// What StackedBars hands to Chart.js, and how its legend drives the chart. jsdom has no canvas,
// so StackedBars.test.ts sees only the DOM; here a fake Chart records the configuration and
// the calls a legend click makes, and a stub 2D context lets onMount reach it. The grouped
// mode (2026-10-08, /git's new repositories per week) is held to its own settings, and the
// default - stacked, which /marketplaces draws - to the ones it has always had.
import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

type Dataset = {
	label: string;
	type?: string;
	data: (number | null)[];
	stack?: string;
	barPercentage?: number;
	categoryPercentage?: number;
	maxBarThickness?: number;
	barThickness?: number | 'flex';
	skipNull?: boolean;
	borderRadius?: number;
	borderWidth: unknown[];
};
type Cfg = {
	data: { labels: string[]; datasets: Dataset[] };
	options: {
		scales: Record<string, { stacked?: boolean }>;
		plugins: { tooltip: { callbacks: { footer: (items: { dataIndex: number }[]) => string } } };
	};
};

const charts: FakeChartLike[] = [];
type FakeChartLike = { cfg: Cfg; data: Cfg['data']; visibility: [number, boolean][]; updates: number };

vi.mock('chart.js', async (importOriginal) => {
	const real = await importOriginal<typeof import('chart.js')>();
	class FakeChart {
		static register() {}
		cfg: Cfg;
		data: Cfg['data'];
		visibility: [number, boolean][] = [];
		updates = 0;
		constructor(_ctx: unknown, cfg: Cfg) {
			this.cfg = cfg;
			this.data = cfg.data;
			charts.push(this);
		}
		setDatasetVisibility(i: number, v: boolean) {
			this.visibility.push([i, v]);
		}
		update() {
			this.updates++;
		}
		destroy() {}
	}
	return { ...real, Chart: FakeChart };
});

import StackedBars from './StackedBars.svelte';

beforeAll(() => {
	HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
		return { canvas: this } as unknown as CanvasRenderingContext2D;
	} as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => {
	charts.length = 0;
});

const WEEKS = ['2026-09-07', '2026-09-14', '2026-09-21'];
const KINDS = [
	{ label: 'GRASP', color: '#a78bfa', values: [5, 6, 7] },
	{ label: 'Forges', color: '#fbbf24', values: [2, 0, 1] },
	{ label: 'Self-hosted', color: '#34d399', values: [1, 1, 0] }
];
const LINE = { label: 'First-time maintainers', color: '#d1d5db', values: [3, 2, 1], axisLabel: 'first-time maintainers' };
const legendButtons = (c: Element) => [...c.querySelectorAll('[data-testid="chart-legend"] button')] as HTMLElement[];

describe('StackedBars, grouped', () => {
	const grouped = (extra: Record<string, unknown> = {}) =>
		render(StackedBars, {
			props: {
				series: KINDS,
				line: LINE,
				labels: WEEKS,
				bucket: 'week',
				grouped: true,
				totals: [6, 7, null],
				totalLabel: 'New repositories',
				partialLabel: '2026-09-21',
				yAxisLabel: 'repositories',
				...extra
			}
		});

	it('draws thin bars packed side by side: no stack, each a fifth of its slot short, no edges', () => {
		grouped();
		const { cfg } = charts[0];
		expect(cfg.options.scales.x.stacked).toBe(false);
		expect(cfg.options.scales.y.stacked).toBe(false);
		const bars = cfg.data.datasets.filter((d) => d.type === 'bar');
		expect(bars).toHaveLength(3);
		for (const d of bars) {
			expect(d.stack).toBeUndefined();
			// a group takes 45% of its bucket and each bar 80% of its slot: with three series a bar
			// is 12% of a bucket and the gap between them 3% (the operator halved both on
			// 2026-10-08: 90% and a 14px cap before)
			expect([d.barPercentage, d.categoryPercentage, d.maxBarThickness, d.borderRadius]).toEqual([0.8, 0.45, 7, 1]);
			// either would undo that: a fixed thickness overrides both percentages, and skipNull
			// re-flows a group over its non-null bars, moving the others into a hidden series' slot
			expect([d.barThickness, d.skipNull]).toEqual([undefined, undefined]);
			// full weeks have no edge; the week still filling is outlined along its data end only
			expect(d.borderWidth).toEqual([0, 0, { top: 1.5, right: 0, bottom: 0, left: 0 }]);
		}
		// nor set for the whole chart, where every dataset would inherit it
		const o = cfg.options as Record<string, unknown>;
		expect([o.barThickness, o.skipNull, o.datasets]).toEqual([undefined, undefined, undefined]);
	});

	it("gives the bucket's own total in the footer, and none where the total is missing", () => {
		grouped();
		const footer = charts[0].cfg.options.plugins.tooltip.callbacks.footer;
		expect(footer([{ dataIndex: 0 }])).toBe('New repositories: 6');
		expect(footer([{ dataIndex: 2 }])).toBe('');
		expect(footer([])).toBe('');
		charts.length = 0;
		grouped({ totals: null });
		// without totals a grouped chart has no footer: its bars are not parts of one whole
		expect(charts[0].cfg.options.plugins.tooltip.callbacks.footer([{ dataIndex: 0 }])).toBe('');
	});

	it('keeps every bar in its slot when a series is hidden: emptied, not removed', async () => {
		const { container } = grouped();
		const chart = charts[0];
		await fireEvent.click(legendButtons(container)[1]);
		expect(chart.data.datasets[1].data).toEqual([null, null, null]);
		expect(chart.visibility).toEqual([]);
		expect(chart.updates).toBe(1);
		await fireEvent.click(legendButtons(container)[1]);
		expect(chart.data.datasets[1].data).toEqual([2, 0, 1]);
		// the line is a line: hidden the usual way, which takes its axis with it
		await fireEvent.click(legendButtons(container)[3]);
		expect(chart.visibility).toEqual([[3, false]]);
	});

	it('draws a legend for several series without a line, and survives a repeated label', () => {
		const { container } = render(StackedBars, {
			props: { series: [...KINDS, { ...KINDS[0] }], labels: WEEKS, grouped: true, yAxisLabel: 'repositories' }
		});
		expect(legendButtons(container).map((b) => b.textContent?.trim())).toEqual(['GRASP', 'Forges', 'Self-hosted', 'GRASP']);
	});

	it('renders with no series at all', () => {
		const { container } = render(StackedBars, {
			props: { series: [], line: LINE, labels: WEEKS, grouped: true, yAxisLabel: 'repositories' }
		});
		expect(container.querySelector('canvas')).not.toBeNull();
	});
});

describe('StackedBars, stacked (the default)', () => {
	it('stacks in one stack with a 2px surface edge, and sums the stack in the footer', () => {
		render(StackedBars, {
			props: { series: KINDS, labels: WEEKS, bucket: 'week', partialLabel: '2026-09-21', yAxisLabel: 'listings' }
		});
		const { cfg } = charts[0];
		expect(cfg.options.scales.x.stacked).toBe(true);
		expect(cfg.options.scales.y.stacked).toBe(true);
		for (const d of cfg.data.datasets) {
			expect(d.stack).toBe('buckets');
			expect(d.barPercentage).toBeUndefined();
			expect([d.maxBarThickness, d.borderRadius]).toEqual([24, 4]);
			expect(d.borderWidth).toEqual([{ top: 2, right: 0, bottom: 0, left: 0 }, { top: 2, right: 0, bottom: 0, left: 0 }, 1.5]);
		}
		expect(cfg.options.plugins.tooltip.callbacks.footer([{ dataIndex: 0 }])).toBe('Total: 8');
	});

	it('hides a stacked series the usual way', async () => {
		const { container } = render(StackedBars, { props: { series: KINDS, labels: WEEKS, yAxisLabel: 'listings' } });
		await fireEvent.click(legendButtons(container)[0]);
		expect(charts[0].visibility).toEqual([[0, false]]);
		expect(charts[0].data.datasets[0].data).toEqual([5, 6, 7]);
	});

	it('draws one series alone with no footer, as before', () => {
		render(StackedBars, { props: { series: [KINDS[0]], labels: WEEKS, yAxisLabel: 'pushes' } });
		const { cfg } = charts[0];
		expect(cfg.data.datasets[0].borderWidth).toEqual([0, 0, 0]);
		expect(cfg.options.plugins.tooltip.callbacks.footer([{ dataIndex: 0 }])).toBe('');
	});
});
