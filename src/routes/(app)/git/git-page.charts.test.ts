// What each /git chart hands to Chart.js. jsdom has no canvas, so the page tests see a chart's
// DOM (its legend, caption and accessible name) but never what is drawn. Here a fake Chart
// records the configuration it is constructed with, and a stub 2D context lets each chart's
// onMount reach it, so these tests hold every time chart to its window, its axes and its
// values - the parts of the operator's requests a legend cannot show (2026-10-02: weekly
// charts from the week of Jul 1, 2026; first-time maintainers, the GRASP list total and
// comment threads each on a second axis).
import { fireEvent, render } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { HOST_KIND_LABEL } from '$lib/ngit/format';
import { AMBER, GRASP_COLOR, GREEN, HOST_KIND_COLOR, NEUTRAL_SERIES, OTHERS_COLOR, PINK } from '$lib/ngit/palette';
import { fade } from '$lib/ngit/series';
import { NGIT_NOT_SHOWN } from '$lib/ngit/shape';
import type { NgitSnapshot } from '$lib/shared/data-types';

type Dataset = {
	label: string;
	type?: string;
	yAxisID?: string;
	data: (number | null)[];
	borderDash?: number[];
	stack?: string;
	backgroundColor?: string[];
	barPercentage?: number;
};
type Scale = {
	display?: boolean | 'auto';
	position?: string;
	stacked?: boolean;
	title?: { text: string; color: string };
};
type Footer = (items: { dataIndex: number }[]) => string;
type Cfg = {
	data: { labels: string[]; datasets: Dataset[] };
	options: { scales: Record<string, Scale>; plugins: { tooltip: { callbacks: { footer: Footer } } } };
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
vi.mock('$app/stores', () => ({ page: readable({ url: new URL('https://site.test/git') }) }));
vi.mock('$app/navigation', () => ({ replaceState: vi.fn(), afterNavigate: vi.fn(), goto: vi.fn() }));

import NgitPage from './+page.svelte';
import { standInPillRouter } from '../pill-router.test-helper';

// A pill is a link: the router's part in a click is stood in for (pill-router.test-helper.ts).
standInPillRouter();
import { FIXTURE } from './fixture';

beforeAll(() => {
	// A non-null 2D context, so onMount reaches `new Chart`.
	HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
		return { canvas: this } as unknown as CanvasRenderingContext2D;
	} as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

let unmount: (() => void) | null = null;
afterEach(() => {
	unmount?.();
	unmount = null;
	configs.length = 0;
	window.history.replaceState(null, '', '/');
});

/** Renders the page on a pill; a pill's charts mount only while it is selected. */
const open = async (snapshot: NgitSnapshot, pill = 'overview') => {
	const r = render(NgitPage, { props: { data: { snapshot } } });
	unmount = r.unmount;
	if (pill !== 'overview') await fireEvent.click(r.container.querySelector(`#tab-${pill}`)!);
};
/** The configs of the charts mounted in a section, in page order. */
const chartsIn = (section: string): Cfg[] =>
	configs.filter((c) => document.body.contains(c.canvas) && c.canvas.closest(`#${section}`)).map((c) => c.cfg);
const dataset = (cfg: Cfg, label: string) => {
	const d = cfg.data.datasets.find((x) => x.label === label);
	if (!d) throw new Error(`no dataset ${label}: ${cfg.data.datasets.map((x) => x.label).join(', ')}`);
	return d;
};
const axisOf = (cfg: Cfg, label: string) => dataset(cfg, label).yAxisID ?? 'y';
/** A weekly series' rows from the week of Jun 29, 2026 on: what the fixture's charts show. */
const fromJun29 = <T extends { w: string }>(rows: T[]) => rows.filter((r) => r.w >= '2026-06-29');
/** The weeks the fixture's weekly charts span: Jun 29 to the week of as_of_day (Sep 21). */
const WEEKS = fromJun29(FIXTURE.pushes_weekly).map((r) => r.w);

describe('/git charts (the configuration handed to Chart.js)', () => {
	it('starts every weekly chart with the week of Jun 29, 2026, and the cumulative chart a year back', async () => {
		expect(WEEKS[0]).toBe('2026-06-29');
		expect(WEEKS[WEEKS.length - 1]).toBe('2026-09-21');
		await open(FIXTURE);
		for (const id of ['ngit-new-repos', 'ngit-pushes', 'ngit-pushed']) {
			const charts = chartsIn(id);
			expect(charts, id).toHaveLength(1);
			expect(charts[0].data.labels, id).toEqual(WEEKS);
		}
		const [cum] = chartsIn('ngit-cumulative');
		expect(cum.data.labels[0]).toBe('2025-09-25');
		expect(cum.data.labels[cum.data.labels.length - 1]).toBe('2026-09-24');
	});

	it('draws new repositories per week as thin bars side by side, one per kind of host, first-time maintainers as a line on its own right axis', async () => {
		await open(FIXTURE);
		const [cfg] = chartsIn('ngit-new-repos');
		const rows = fromJun29(FIXTURE.new_repos_weekly!);
		const bars = cfg.data.datasets.filter((d) => d.type === 'bar');
		// the five kinds in the operator's order (2026-10-12: Self-hosted before Forges), not the
		// document's, in the operator's words and the donut's colour of each kind (HOST_KIND_COLOR,
		// which Clone hosts wears too)
		expect(rows[0].by_host!.map((c) => c.k)).toEqual(['grasp', 'hashtree', 'forge', 'self_hosted', 'none']);
		const KINDS = ['grasp', 'hashtree', 'self_hosted', 'forge', 'none'] as const;
		expect(bars.map((d) => d.label)).toEqual(['GRASP', 'hashtree', 'Self-hosted', 'Forges', 'No public host']);
		expect(bars.map((d) => d.label)).toEqual(KINDS.map((k) => HOST_KIND_LABEL[k]));
		expect(bars.map((d) => d.backgroundColor![0])).toEqual([GRASP_COLOR, PINK, GREEN, AMBER, OTHERS_COLOR]);
		KINDS.forEach((k, i) => {
			const d = bars[i];
			expect(d.yAxisID ?? 'y', k).toBe('y');
			expect(d.data, k).toEqual(rows.map((r) => r.by_host!.find((c) => c.k === k)!.v));
			// a full week wears the kind's colour itself (the week still filling is faded)
			expect(d.backgroundColor![0], k).toBe(HOST_KIND_COLOR[k]);
			// side by side, not stacked: no shared stack; the gap between a group's bars is the
			// slot a bar leaves empty, never a surface-coloured edge (on a phone's thin bars an
			// edge covered the whole bar)
			expect(d.stack, k).toBeUndefined();
			expect(d.barPercentage, k).toBe(0.8);
			expect((d as { borderWidth?: unknown[] }).borderWidth!.slice(0, -1).every((b) => b === 0), k).toBe(true);
		});
		// a repository counts under each kind it is on, so the tooltip's footer gives the week's
		// own count, never the bars' sum
		const footer = cfg.options.plugins.tooltip.callbacks.footer;
		rows.forEach((r, w) => expect(footer([{ dataIndex: w }])).toBe(`New repositories: ${r.v.toLocaleString('en-US')}`));
		expect(cfg.options.scales.x.stacked).toBe(false);
		expect(cfg.options.scales.y.stacked).toBe(false);
		const line = dataset(cfg, 'First-time maintainers');
		expect([line.type, line.yAxisID]).toEqual(['line', 'y2']);
		expect(line.data).toEqual(rows.map((r) => r.s));
		expect(cfg.options.scales.y2).toMatchObject({
			display: 'auto',
			position: 'right',
			title: { text: 'first-time maintainers', color: NEUTRAL_SERIES }
		});
		// several series have no one colour: the left title stays neutral
		expect(cfg.options.scales.y.title).toMatchObject({ text: 'repositories', color: '#94a3b8' });
	});

	it("draws the kinds in the operator's order whatever the document's, each from its own counts, a kind it does not know yet after them", async () => {
		const doc = structuredClone(FIXTURE);
		const order = ['none', 'brand_new_kind', 'forge', 'self_hosted', 'hashtree', 'grasp'];
		// distinct counts per kind, so a bar that read another kind's counts shows it
		const count = (k: string, w: number) => (order.indexOf(k) + 1) * 100 + w;
		doc.new_repos_weekly = doc.new_repos_weekly!.map((r, w) => ({
			...r,
			by_host: order.map((k) => ({ k, v: count(k, w) })) as typeof r.by_host
		}));
		await open(doc);
		const [cfg] = chartsIn('ngit-new-repos');
		const bars = cfg.data.datasets.filter((d) => d.type === 'bar');
		const KINDS = ['grasp', 'hashtree', 'self_hosted', 'forge', 'none', 'brand_new_kind'];
		expect(bars.map((d) => d.label)).toEqual(['GRASP', 'hashtree', 'Self-hosted', 'Forges', 'No public host', 'brand_new_kind']);
		const rows = fromJun29(doc.new_repos_weekly!);
		expect(cfg.data.labels).toEqual(rows.map((r) => r.w));
		KINDS.forEach((k, i) => expect(bars[i].data, k).toEqual(rows.map((r) => r.by_host!.find((c) => c.k === k)!.v)));
		// the unknown kind wears the slate, like No public host
		expect(bars[5].backgroundColor![0]).toBe(OTHERS_COLOR);
		// the line stays last
		expect(cfg.data.datasets[cfg.data.datasets.length - 1].label).toBe('First-time maintainers');
	});

	it('fades the week still filling in every kind, outlined along the data end only', async () => {
		await open(FIXTURE);
		const [cfg] = chartsIn('ngit-new-repos');
		const last = cfg.data.labels.length - 1;
		expect(cfg.data.labels[last]).toBe(FIXTURE.coverage.partial_week);
		const bars = cfg.data.datasets.filter((d) => d.type === 'bar') as (Dataset & {
			borderWidth: unknown[];
			borderColor: string[];
		})[];
		(['grasp', 'hashtree', 'self_hosted', 'forge', 'none'] as const).forEach((k, i) => {
			expect(bars[i].backgroundColor![last], k).toBe(fade(HOST_KIND_COLOR[k], 0.35));
			expect(bars[i].backgroundColor![last - 1], k).toBe(HOST_KIND_COLOR[k]);
			// a phone's grouped bar is 1px wide or less: an outline all round would cover its faded fill
			expect(bars[i].borderWidth[last], k).toEqual({ top: 1.5, right: 0, bottom: 0, left: 0 });
			expect(bars[i].borderWidth[last - 1], k).toBe(0);
		});
	});

	it('draws every chart on every pill from the same data with or without the keys it no longer reads', async () => {
		const lean: NgitSnapshot = structuredClone(FIXTURE);
		const drop = (node: unknown, path: string): void => {
			const [head, ...rest] = path.split('.');
			const obj = node as Record<string, unknown>;
			if (head.endsWith('[]')) {
				for (const row of (obj[head.slice(0, -2)] as unknown[] | undefined) ?? []) drop(row, rest.join('.'));
				return;
			}
			if (rest.length === 0) delete obj[head];
			else drop(obj[head], rest.join('.'));
		};
		for (const path of NGIT_NOT_SHOWN) drop(lean, path);
		const drawn = async (doc: NgitSnapshot) => {
			const out: unknown[] = [];
			for (const pill of ['overview', 'repositories', 'hosting', 'maintainers', 'collaboration']) {
				configs.length = 0;
				await open(doc, pill);
				for (const c of configs) {
					const footer = c.cfg.options.plugins?.tooltip?.callbacks?.footer;
					out.push([
						pill,
						c.cfg.data.labels,
						c.cfg.data.datasets.map((d) => [d.label, d.data, d.backgroundColor]),
						c.cfg.data.labels.map((_l, i) => footer?.([{ dataIndex: i }]))
					]);
				}
				unmount?.();
				unmount = null;
				window.history.replaceState(null, '', '/');
			}
			return out;
		};
		const full = await drawn(FIXTURE);
		expect(full.length).toBeGreaterThan(5);
		expect(await drawn(lean)).toEqual(full);
	});

	it("gives the week's own new repositories in the footer, not the grasp and other it no longer reads", async () => {
		const lean: NgitSnapshot = structuredClone(FIXTURE);
		for (const r of lean.new_repos_weekly!) {
			delete r.grasp;
			delete r.other;
		}
		await open(lean);
		const [cfg] = chartsIn('ngit-new-repos');
		const footer = cfg.options.plugins.tooltip.callbacks.footer;
		fromJun29(FIXTURE.new_repos_weekly!).forEach((r, w) =>
			expect(footer([{ dataIndex: w }])).toBe(`New repositories: ${r.v.toLocaleString('en-US')}`)
		);
	});

	it('draws a kind a row lacks as a gap, never as a zero', async () => {
		const holed: NgitSnapshot = structuredClone(FIXTURE);
		const row = holed.new_repos_weekly!.find((r) => r.w === '2026-07-06')!;
		row.by_host = row.by_host!.filter((c) => c.k !== 'forge');
		await open(holed);
		const [cfg] = chartsIn('ngit-new-repos');
		const at = cfg.data.labels.indexOf('2026-07-06');
		expect(dataset(cfg, 'Forges').data[at]).toBeNull();
		expect(dataset(cfg, 'GRASP').data[at]).toBe(row.by_host!.find((c) => c.k === 'grasp')!.v);
	});

	it('reads each kind by its key in every row, whatever order a row lists them in', async () => {
		const shuffled: NgitSnapshot = structuredClone(FIXTURE);
		// later rows list their kinds in another order: each bar still reads its own kind
		for (const r of shuffled.new_repos_weekly!.slice(1)) r.by_host!.reverse();
		await open(shuffled);
		const [cfg] = chartsIn('ngit-new-repos');
		const rows = fromJun29(FIXTURE.new_repos_weekly!);
		expect(dataset(cfg, 'Forges').data).toEqual(rows.map((r) => r.by_host!.find((c) => c.k === 'forge')!.v));
		expect(dataset(cfg, 'GRASP').data).toEqual(rows.map((r) => r.by_host!.find((c) => c.k === 'grasp')!.v));
	});

	it('keeps a stack\'s footer the sum of its segments', async () => {
		await open(FIXTURE, 'collaboration');
		const [bars] = chartsIn('ngit-discussion');
		const r = fromJun29(FIXTURE.comments_weekly!)[0];
		expect(bars.options.plugins.tooltip.callbacks.footer([{ dataIndex: 0 }])).toBe(
			`Total: ${(r.issues + r.prs + r.patches + r.repo + r.other).toLocaleString('en-US')}`
		);
	});

	it('keeps the other bar charts stacked', async () => {
		await open(FIXTURE, 'collaboration');
		const [bars] = chartsIn('ngit-discussion');
		expect(bars.options.scales.x.stacked).toBe(true);
		expect(bars.options.scales.y.stacked).toBe(true);
		expect(bars.data.datasets.every((d) => d.stack === 'buckets')).toBe(true);
	});

	it('counts every push per week, and draws who pushed on one axis', async () => {
		await open(FIXTURE);
		const [pushes] = chartsIn('ngit-pushes');
		expect(dataset(pushes, 'Pushes').data).toEqual(fromJun29(FIXTURE.pushes_weekly).map((r) => r.pushes));
		expect(pushes.options.scales.y2).toBeUndefined();
		const [pushed] = chartsIn('ngit-pushed');
		expect(pushed.data.datasets.map((d) => [d.label, d.yAxisID ?? 'y'])).toEqual([
			['Repositories pushed', 'y'],
			['Maintainers pushing', 'y']
		]);
		expect(pushed.options.scales.y2).toBeUndefined();
	});

	it('runs the GRASP list total from the users first seen before the weekly series to every list user', async () => {
		await open(FIXTURE, 'maintainers');
		const [cfg] = chartsIn('ngit-grasp-lists');
		expect(cfg.data.labels).toEqual(WEEKS);
		const perWeek = FIXTURE.grasp_lists.per_week!;
		// the fixture: 77 users, 27 of them by week from the states wall's week (Jun 8) on
		const base = FIXTURE.grasp_lists.users - perWeek.reduce((a, r) => a + r.v, 0);
		expect(base).toBe(50);
		const beforeWindow = perWeek.filter((r) => r.w < '2026-06-29').reduce((a, r) => a + r.v, 0);
		const totals = dataset(cfg, 'Total').data;
		expect(totals[0]).toBe(base + beforeWindow + perWeek.find((r) => r.w === '2026-06-29')!.v);
		expect(totals[totals.length - 1]).toBe(FIXTURE.grasp_lists.users);
		expect(dataset(cfg, 'New users').data).toEqual(fromJun29(perWeek).map((r) => r.v));
		expect(axisOf(cfg, 'Total')).toBe('y2');
		expect(cfg.options.scales.y2).toMatchObject({ display: 'auto', title: { text: 'total', color: AMBER } });
		// one bar series: the left title takes its colour, as the right one takes the line's
		expect(cfg.options.scales.y.title).toMatchObject({ text: 'new users', color: GRASP_COLOR });
	});

	it('draws discussion per week as the five root kinds, and authors and threads each on its own axis', async () => {
		await open(FIXTURE, 'collaboration');
		const [bars, lines] = chartsIn('ngit-discussion');
		const rows = fromJun29(FIXTURE.comments_weekly!);
		expect(bars.data.labels).toEqual(WEEKS);
		expect(bars.data.datasets.map((d) => d.label)).toEqual(['Issues', 'Pull requests', 'Patches', 'Repository', 'Other']);
		expect(dataset(bars, 'Issues').data).toEqual(rows.map((r) => r.issues));
		expect(dataset(bars, 'Pull requests').data).toEqual(rows.map((r) => r.prs));
		expect(lines.data.labels).toEqual(WEEKS);
		expect(axisOf(lines, 'Authors')).toBe('y');
		expect(axisOf(lines, 'Threads')).toBe('y2');
		expect(dataset(lines, 'Authors').data).toEqual(rows.map((r) => r.authors));
		expect(dataset(lines, 'Threads').data).toEqual(rows.map((r) => r.threads));
		// both lines solid (2026-10-08): the right axis is titled with the series' name instead
		expect(dataset(lines, 'Threads').borderDash).toBeUndefined();
		expect(dataset(lines, 'Authors').borderDash).toBeUndefined();
		expect(lines.options.scales.y2).toMatchObject({ display: 'auto', position: 'right', title: { text: 'threads', color: GREEN } });
		expect(lines.options.scales.y).toMatchObject({ display: 'auto', title: { text: 'authors', color: AMBER } });
	});

	it('keeps every weekly chart to the trailing year once a year has passed since Jul 1, 2026', async () => {
		// as_of_day 2027-07-15: the 52 weeks before the week of 2027-07-16 start on 2026-07-13,
		// later than the floor; the series run on, as a year of nightly documents would carry them
		const later: NgitSnapshot = structuredClone(FIXTURE);
		later.as_of_day = '2027-07-15';
		later.coverage.partial_week = '2027-07-12';
		const more = <T extends { w: string }>(rows: T[]): T[] => {
			const out = [...rows];
			const last = rows[rows.length - 1];
			for (let t = Date.parse(`${last.w}T00:00:00Z`) + 7 * 86_400_000; t <= Date.parse('2027-07-12T00:00:00Z'); t += 7 * 86_400_000) {
				out.push({ ...last, w: new Date(t).toISOString().slice(0, 10) });
			}
			return out;
		};
		later.pushes_weekly = more(later.pushes_weekly);
		later.new_repos_weekly = more(later.new_repos_weekly!);
		later.comments_weekly = more(later.comments_weekly!);
		later.grasp_lists.per_week = more(later.grasp_lists.per_week!);
		const spans: [string, string, string][] = [];
		for (const pill of ['overview', 'maintainers', 'collaboration']) {
			configs.length = 0;
			await open(later, pill);
			for (const id of ['ngit-new-repos', 'ngit-pushes', 'ngit-pushed', 'ngit-grasp-lists', 'ngit-discussion']) {
				for (const cfg of chartsIn(id)) spans.push([id, cfg.data.labels[0], cfg.data.labels[cfg.data.labels.length - 1]]);
			}
			unmount?.();
			unmount = null;
		}
		expect(spans).toHaveLength(6);
		for (const [id, first, last] of spans) expect([id, first, last]).toEqual([id, '2026-07-13', '2027-07-12']);
	});
});
