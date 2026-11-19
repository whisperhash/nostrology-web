// What /marketplaces' new listings per month hands to Chart.js. jsdom has no canvas, so the
// page test sees the chart's legend, caption and accessible name but never what is drawn. As
// on /git (git-page.charts.test.ts), a fake Chart records the configuration it is constructed
// with and a stub 2D context lets onMount reach it, so the parts of the operator's request a
// legend cannot show are held here (2026-10-08: the partial month as /git draws its partial
// week - faded and outlined, the line dimmed into it - and no Chart.js legend circles).
import { fireEvent, render } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { fade } from '$lib/ngit/series';
import type { MarketsSnapshot } from '$lib/shared/data-types';

type Segment = { p0DataIndex: number; p1DataIndex: number };
type Dataset = {
	label: string;
	type?: string;
	yAxisID?: string;
	data: number[];
	backgroundColor?: string[];
	borderColor?: string;
	borderWidth?: unknown[];
	segment?: { borderColor?: (c: Segment) => string | undefined };
};
type Scale = { display?: boolean | 'auto'; position?: string; title?: { text: string; color: string } };
type Cfg = {
	data: { labels: string[]; datasets: Dataset[] };
	options: {
		plugins: {
			legend: { display: boolean };
			tooltip: { callbacks: { afterTitle: (items: { dataIndex: number }[]) => string } };
		};
		scales: Record<string, Scale>;
	};
};

const configs: { canvas: HTMLCanvasElement; cfg: Cfg }[] = [];

vi.mock('chart.js', async (importOriginal) => {
	const real = await importOriginal<typeof import('chart.js')>();
	class FakeChart {
		static register() {}
		constructor(ctx: { canvas: HTMLCanvasElement }, cfg: Cfg) {
			configs.push({ canvas: ctx.canvas, cfg });
		}
		destroy() {}
		setDatasetVisibility() {}
		update() {}
	}
	return { ...real, Chart: FakeChart };
});
vi.mock('$app/stores', () => ({ page: readable({ url: new URL('https://site.test/marketplaces') }) }));
vi.mock('$app/navigation', () => ({ replaceState: vi.fn(), afterNavigate: vi.fn(), goto: vi.fn() }));

import MarketplacesPage from './+page.svelte';
import { standInPillRouter } from '../pill-router.test-helper';

// A pill is a link: the router's part in a click is stood in for (pill-router.test-helper.ts).
standInPillRouter();
import { SNAPSHOT } from './fixture';

const PURPLE = '#a78bfa';
const TEAL = '#2dd4bf';
const BTC_ORANGE = '#f7931a';
const SLATE = '#64748b';

beforeAll(() => {
	// A non-null 2D context, so onMount reaches `new Chart`; the cumulative charts beside this
	// one also paint a gradient under their line.
	HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
		return { canvas: this, createLinearGradient: () => ({ addColorStop() {} }) } as unknown as CanvasRenderingContext2D;
	} as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

let unmount: (() => void) | null = null;
afterEach(() => {
	unmount?.();
	unmount = null;
	configs.length = 0;
	window.history.replaceState(null, '', '/');
});

/** Unmounts what was rendered so far, so the next render's config is the only one captured. A
 * function, not inline: after an inline `unmount = null` TypeScript narrows `unmount` to null
 * for the rest of the test, and the next `unmount?.()` no longer type-checks. */
function clearRender() {
	unmount?.();
	unmount = null;
	configs.length = 0;
}

/** The growth pill's new listings per month: the one chart in its card. */
async function newListingsChart(snapshot: MarketsSnapshot = SNAPSHOT): Promise<Cfg> {
	const r = render(MarketplacesPage, { props: { data: { snapshot } } });
	unmount = r.unmount;
	await fireEvent.click(r.container.querySelector('#tab-growth')!);
	const card = [...r.container.querySelectorAll('#panel-growth h2')]
		.find((h) => h.textContent?.trim() === 'New listings per month')!
		.closest('.rounded-xl')!;
	const mine = configs.filter((c) => card.contains(c.canvas));
	expect(mine).toHaveLength(1);
	return mine[0].cfg;
}
const dataset = (cfg: Cfg, label: string) => {
	const d = cfg.data.datasets.find((x) => x.label === label);
	if (!d) throw new Error(`no dataset ${label}: ${cfg.data.datasets.map((x) => x.label).join(', ')}`);
	return d;
};

describe('/marketplaces new listings per month (the configuration handed to Chart.js)', () => {
	it('draws the listings as bars and first-time sellers as a line on its own right axis', async () => {
		const cfg = await newListingsChart();
		expect(cfg.data.labels).toEqual(['2026-06', '2026-07', '2026-08']);
		const bars = dataset(cfg, 'New listings');
		expect([bars.type, bars.yAxisID ?? 'y']).toEqual(['bar', 'y']);
		expect(bars.data).toEqual(SNAPSHOT.new_monthly.map((r) => r.v));
		const line = dataset(cfg, 'First-time sellers');
		expect([line.type, line.yAxisID]).toEqual(['line', 'y2']);
		expect(line.data).toEqual(SNAPSHOT.new_monthly.map((r) => r.s));
		expect(line.borderColor).toBe(PURPLE);
		// one bar series: the left title takes its colour, as the right one takes the line's
		expect(cfg.options.scales.y.title).toMatchObject({ text: 'new listings', color: TEAL });
		expect(cfg.options.scales.y2).toMatchObject({
			display: 'auto',
			position: 'right',
			title: { text: 'first-time sellers', color: PURPLE }
		});
		// the keys are the page's own markup, a square and a stroke: no legend on the canvas
		expect(cfg.options.plugins.legend.display).toBe(false);
	});

	it('wears the colour of what each chart on the pill counts: listings teal, sellers purple', async () => {
		// The operator's pick, 2026-11-05. It was purple bars under an orange line, and orange is
		// bitcoin's on this site. Read across all three charts, because the point is that they agree.
		const r = render(MarketplacesPage, { props: { data: { snapshot: SNAPSHOT } } });
		unmount = r.unmount;
		await fireEvent.click(r.container.querySelector('#tab-growth')!);
		const chartIn = (title: string) => {
			const card = [...r.container.querySelectorAll('#panel-growth h2')]
				.find((h) => h.textContent?.trim() === title)!
				.closest('.rounded-xl')!;
			const mine = configs.filter((c) => card.contains(c.canvas));
			expect(mine).toHaveLength(1);
			return mine[0].cfg;
		};
		expect(chartIn('Cumulative sellers').data.datasets[0].borderColor).toBe(PURPLE);
		expect(chartIn('Cumulative listings').data.datasets[0].borderColor).toBe(TEAL);
		const newListings = chartIn('New listings per month');
		expect(dataset(newListings, 'First-time sellers').borderColor).toBe(PURPLE);
		expect(dataset(newListings, 'New listings').backgroundColor?.[0]).toBe(TEAL);
	});

	it('fades and outlines the partial month, dims the line into it, and names it on hover', async () => {
		const cfg = await newListingsChart();
		const bars = dataset(cfg, 'New listings');
		expect(bars.backgroundColor).toEqual([TEAL, TEAL, fade(TEAL, 0.35)]);
		expect(bars.borderWidth).toEqual([0, 0, 1.5]);
		const line = dataset(cfg, 'First-time sellers');
		const stretch = (p0: number) => line.segment!.borderColor!({ p0DataIndex: p0, p1DataIndex: p0 + 1 });
		// full strength between the complete months, dimmed on the way into the partial one
		expect([0, 1].map(stretch)).toEqual([undefined, fade(PURPLE, 0.35)]);
		const afterTitle = cfg.options.plugins.tooltip.callbacks.afterTitle;
		expect(afterTitle([{ dataIndex: 2 }])).toBe('partial month: data to Aug 23, 2026, 09:43 UTC');
		expect(afterTitle([{ dataIndex: 1 }])).toBe('');
	});

	it("marks the document's partial_month, the run's month, wherever it falls in the series", async () => {
		// The document is the one source: a partial_month that is not generated_utc's month (Jul,
		// with the run in Aug) is still the month marked - the page derives nothing from the clock.
		const doc = await newListingsChart({ ...SNAPSHOT, partial_month: '2026-07' });
		expect(dataset(doc, 'New listings').backgroundColor).toEqual([TEAL, fade(TEAL, 0.35), TEAL]);
		clearRender();

		// Sep 1, 02:16 UTC, nothing dated in September yet: partial_month is September, which has
		// no bar, so August, which the run saw whole, is not faded, dimmed or noted.
		const first = await newListingsChart({ ...SNAPSHOT, generated_utc: '2026-09-01 02:16:30Z', partial_month: '2026-09' });
		const bars = dataset(first, 'New listings');
		expect(bars.backgroundColor).toEqual([TEAL, TEAL, TEAL]);
		expect(bars.borderWidth).toEqual([0, 0, 0]);
		const line = dataset(first, 'First-time sellers');
		expect([0, 1].map((p0) => line.segment!.borderColor!({ p0DataIndex: p0, p1DataIndex: p0 + 1 }))).toEqual([undefined, undefined]);
		expect(first.options.plugins.tooltip.callbacks.afterTitle([{ dataIndex: 2 }])).toBe('');
	});
});

describe('/marketplaces currency donut (the configuration handed to Chart.js)', () => {
	/** What's for sale's currency card, and the one chart in it. */
	async function currencyCard(snapshot: MarketsSnapshot = SNAPSHOT) {
		const r = render(MarketplacesPage, { props: { data: { snapshot } } });
		unmount = r.unmount;
		await fireEvent.click(r.container.querySelector('#tab-catalogue')!);
		const card = [...r.container.querySelectorAll('#panel-catalogue h2')]
			.find((h) => h.textContent?.trim() === 'Currency')!
			.closest('.rounded-xl')!;
		const mine = configs.filter((c) => card.contains(c.canvas));
		expect(mine).toHaveLength(1);
		return { card, cfg: mine[0].cfg };
	}

	it("says what its centre's share is, and spells the currency's row as a label", async () => {
		const { card, cfg } = await currencyCard();
		const { labels, datasets } = cfg.data;
		// The operator, 2026-11-04: "let's stick with the current capitalization in the legend". So a
		// row draws the snapshot's own spelling, capital and all; the word is lowercase where it falls
		// mid-phrase, as in the centre below.
		expect(labels).toEqual(['Bitcoin (BTC / sats)', 'USD']);
		expect([...card.querySelectorAll('span.flex-1')].map((e) => e.textContent)).toEqual(labels);
		expect(datasets[0].backgroundColor).toEqual([BTC_ORANGE, '#4ade80']);
		// The whole ring is the priced listings, which the caption above it counts, so the centre
		// can say what the share is rather than what it is of.
		const centre = card.querySelector('.pointer-events-none')!;
		expect(centre.textContent?.replace(/\s+/g, ' ').trim()).toBe('47% priced in bitcoin');
	});

	it("gives BRL the slate of a currency with no colour of its own, because amber is bitcoin's", async () => {
		// BRL is not in every day's rows, so the day it is has to be built: it was amber until
		// 2026-11-05, and the live page cannot show this on a day it is not drawn.
		const { cfg } = await currencyCard({
			...SNAPSHOT,
			currency: [...SNAPSHOT.currency, { cur: 'BRL', listings: 21, sellers: 8 }, { cur: 'NGN', listings: 20, sellers: 3 }]
		});
		expect(cfg.data.labels).toEqual(['Bitcoin (BTC / sats)', 'USD', 'BRL', 'NGN']);
		expect(cfg.data.datasets[0].backgroundColor).toEqual([BTC_ORANGE, '#4ade80', SLATE, SLATE]);
	});
});
