// @vitest-environment node
//
// The board's shaping, in two layers:
//   1. Real data: the surface pages' own data on 2026-10-15 (fixtures/board-inputs-*.json.gz),
//      the same functions' output the landing cache holds. Its figures and series were checked,
//      array for array, against an independent extractor on the same snapshot;
//      the expected values below are that extractor's.
//   2. Constructed inputs, one rule at a time: missing and malformed inputs, the fill, the
//      changes, the filters.
//
// The fixture was made from six operator-tagged loads of the surface pages, decoded to the
// data functions' shapes:
// zapstore {total, github, native}; marketplaces {summary, cum_listings}; git {summary,
// cum_repos, as_of_day, coverage}; nutzapsDaily; nutzapMints (period 'all');
// lightningProviders; lightningShare (top 20, as /lightning).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { getProviderColor } from '$lib/utils/providerColors';
import {
	addDays,
	buildBoard,
	chartDay,
	chartLength,
	DOMAINS,
	fillTrailingYear,
	gitChange,
	growthPct,
	type BoardChart,
	type BoardInputs,
	type BoardPanel
} from './board';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL: BoardInputs = JSON.parse(
	gunzipSync(readFileSync(resolve(HERE, 'fixtures/board-inputs-2026-10-15.json.gz'))).toString('utf8')
);

const byKey = (panels: BoardPanel[]) => Object.fromEntries(panels.map((p) => [p.key, p]));
const lastOf = <T>(a: T[]): T => a[a.length - 1];

describe('the board from real data (2026-10-15)', () => {
	const { board, problems } = buildBoard(REAL);
	const P = byKey(board.panels);

	it('shapes every input without a problem', () => {
		expect(problems).toEqual([]);
	});

	it('lists the surfaces in the nav order, Marketplaces open on load', () => {
		expect(board.panels.map((p) => p.key)).toEqual(['zapstore', 'marketplaces', 'git', 'lightning', 'nutzaps']);
		expect(board.initial).toBe('marketplaces');
		expect(board.panels.map((p) => p.href)).toEqual(['/zapstore', '/marketplaces', '/git', '/lightning', '/nutzaps']);
	});

	it('prints each surface page own figure, from the data', () => {
		expect(board.panels.every((p) => p.live)).toBe(true);
		expect(board.panels.map((p) => p.value)).toEqual([4773, 7848, 4873, 2250, 33]);
	});

	it('charts the trailing year each surface page charts', () => {
		expect(board.panels.map((p) => chartLength(p.chart!))).toEqual([366, 365, 365, 366, 366]);
		expect(board.panels.map((p) => p.chart!.start)).toEqual([
			'2025-10-15',
			'2025-10-16',
			'2025-10-15',
			'2025-10-15',
			'2025-10-15'
		]);
		// Each running total ends on the figure printed above it.
		expect(lastOf(P.zapstore.chart!.series[0].v)).toBe(4773);
		expect(lastOf(P.git.chart!.series[0].v)).toBe(4873);
		expect(lastOf(P.nutzaps.chart!.series[0].v)).toBe(1027);
		// Git's year ends on the document's as_of_day.
		expect(chartDay(P.git.chart!, chartLength(P.git.chart!) - 1)).toBe('2026-10-14');
	});

	it('shows the 12-month growth for Zapstore and Marketplaces, and 30 days for Git-on-Nostr', () => {
		expect(P.zapstore.change).toEqual({ pct: 123, per: 'in 12 months' });
		expect(P.marketplaces.change).toEqual({ pct: 370, per: 'in 12 months' });
		// 4,306 repositories on 2026-09-14, 4,873 on 2026-10-14.
		expect(P.git.change).toEqual({ pct: 13, per: 'in 30 days' });
		expect(P.lightning.change).toBeNull();
		expect(P.nutzaps.change).toBeNull();
	});

	it('draws no wall when observation began before the year shown, or on its first day', () => {
		for (const since of ['2025-01-01', '2025-10-15']) {
			const git = { ...REAL.git!, coverage: { ...REAL.git!.coverage, announcements_since: since } };
			const chart = byKey(buildBoard({ git }).board.panels).git.chart!;
			expect(chart.start).toBe('2025-10-15');
			expect([chart.wall, chart.wallText, chart.wallNote]).toEqual([undefined, undefined, undefined]);
		}
	});

	it('fades Git-on-Nostr before observation began (2026-05-02)', () => {
		const chart = P.git.chart!;
		expect(chartDay(chart, chart.wall!)).toBe('2026-05-02');
		expect(chart.wallText).toBe('observation began');
		expect(chart.wallNote).toBe('before observation began');
		// Only Git-on-Nostr has a wall.
		expect(board.panels.filter((p) => p.chart!.wall !== undefined).map((p) => p.key)).toEqual(['git']);
	});

	it("draws Zapstore's three running totals, all apps first", () => {
		const s = P.zapstore.chart!.series;
		expect(s.map((x) => x.label)).toEqual(['All apps', 'Republished from GitHub / F-Droid', 'Nostr-native']);
		expect(s.map((x) => x.short)).toEqual([undefined, 'Republished', undefined]);
		expect(s.map((x) => lastOf(x.v))).toEqual([4773, lastOf(REAL.zapstore!.github).value, lastOf(REAL.zapstore!.native).value]);
	});

	it("draws the five largest Lightning providers on the last day, in /lightning's colours", () => {
		const s = P.lightning.chart!.series;
		expect(s).toHaveLength(5);
		expect(s.map((x) => x.label)).not.toContain('other');
		const lastDay = lastOf([...new Set(REAL.lightningShare!.map((r) => r.day))].sort());
		const ranked = REAL.lightningShare!.filter((r) => r.day === lastDay && r.provider !== 'other').sort((a, b) => b.value - a.value);
		expect(s.map((x) => x.label)).toEqual(ranked.slice(0, 5).map((r) => r.provider));
		expect(s.map((x) => x.color)).toEqual(s.map((x) => getProviderColor(x.label)));
		expect(s.every((x) => x.pct && x.unit === 'of sats')).toBe(true);
		// Shares to one decimal, as /lightning prints them.
		expect(s.flatMap((x) => x.v).every((v) => v === null || Math.round(v * 10) === v * 10)).toBe(true);
	});

	it('crosses the wire small: every day spelt out would double it', () => {
		// The board goes into every landing page's SSR payload. 2026-10-15: 20.4 KB, 7.2 KB
		// gzipped; with every day spelt out it was 44 KB.
		expect(JSON.stringify(board).length).toBeLessThan(24_000);
	});
});

describe('the board without data', () => {
	it('shows every typed fallback, no chart and no change, when nothing has loaded', () => {
		const { board, problems } = buildBoard({});
		expect(problems).toEqual([]);
		expect(board.panels.map((p) => [p.key, p.value, p.live, p.chart, p.change])).toEqual(
			DOMAINS.map((d) => [d.key, d.fallback, false, null, null])
		);
	});

	it("keeps one surface's data when the others are missing", () => {
		const { board, problems } = buildBoard({ marketplaces: REAL.marketplaces });
		const P = byKey(board.panels);
		expect(problems).toEqual([]);
		expect(P.marketplaces.live).toBe(true);
		expect(P.marketplaces.value).toBe(7848);
		expect(P.marketplaces.chart).not.toBeNull();
		expect(board.panels.filter((p) => p.live).map((p) => p.key)).toEqual(['marketplaces']);
	});

	it('shows a figure without its chart when only the figure loaded, and the reverse', () => {
		const onlyFigures = byKey(buildBoard({ lightningProviders: REAL.lightningProviders, nutzapMints: REAL.nutzapMints }).board.panels);
		expect([onlyFigures.lightning.live, onlyFigures.lightning.value, onlyFigures.lightning.chart]).toEqual([true, 2250, null]);
		expect([onlyFigures.nutzaps.live, onlyFigures.nutzaps.value, onlyFigures.nutzaps.chart]).toEqual([true, 33, null]);

		const onlyCharts = byKey(buildBoard({ lightningShare: REAL.lightningShare, nutzapsDaily: REAL.nutzapsDaily }).board.panels);
		expect(onlyCharts.lightning.live).toBe(false);
		expect(onlyCharts.lightning.value).toBe(DOMAINS.find((d) => d.key === 'lightning')!.fallback);
		expect(onlyCharts.lightning.chart).not.toBeNull();
		expect(onlyCharts.nutzaps.chart).not.toBeNull();
	});
});

describe('a document that changed shape', () => {
	// Each of these falls back AND says why: a silent fallback would read as healthy in every
	// refresh line.
	it('falls back on a figure that is not a count, and names it', () => {
		const git = { ...REAL.git!, summary: { ...REAL.git!.summary, repos: '4873' as unknown as number } };
		const { board, problems } = buildBoard({ ...REAL, git });
		const P = byKey(board.panels);
		expect(problems).toEqual(['git figure: repos is not a count: "4873"']);
		expect(P.git.live).toBe(false);
		// The chart does not depend on the figure, so it stays.
		expect(P.git.chart).not.toBeNull();
		// Nothing else moves.
		expect(board.panels.filter((p) => p.key !== 'git').every((p) => p.live)).toBe(true);
	});

	it('falls back on a series with a gap', () => {
		const total = REAL.zapstore!.total.filter((_, i) => i !== 100);
		const { board, problems } = buildBoard({ zapstore: { ...REAL.zapstore!, total } });
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(/^zapstore chart: days skips from 2026-01-22 to 2026-01-24$/);
		expect(byKey(board.panels).zapstore).toMatchObject({ live: false, chart: null, change: null });
	});

	it('falls back on series of different lengths', () => {
		const { problems } = buildBoard({ zapstore: { ...REAL.zapstore!, native: REAL.zapstore!.native.slice(1) } });
		expect(problems).toEqual(['zapstore chart: native has 365 days, total has 366']);
	});

	it('falls back on a missing field rather than throwing', () => {
		const git = { ...REAL.git!, coverage: {} as NonNullable<BoardInputs['git']>['coverage'] };
		const { board, problems } = buildBoard({ git });
		expect(problems).toEqual(['git chart: announcements_since is not a YYYY-MM-DD day: undefined']);
		expect(byKey(board.panels).git.chart).toBeNull();
	});

	it('falls back on empty lists', () => {
		const { problems } = buildBoard({
			marketplaces: { ...REAL.marketplaces!, cum_listings: [] },
			lightningShare: [],
			nutzapsDaily: [],
			zapstore: { total: [], github: [], native: [] }
		});
		expect(problems).toEqual([
			'zapstore chart: no days',
			'marketplaces chart: no points',
			'lightning chart: no rows',
			'nutzaps chart: no days'
		]);
	});
});

describe('fillTrailingYear', () => {
	it('carries the running total over the days a document leaves out', () => {
		const { days, v } = fillTrailingYear(
			[
				{ d: '2026-01-01', v: 1 },
				{ d: '2026-01-04', v: 3 }
			],
			'2026-01-05'
		);
		expect(days.slice(-5)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05']);
		expect(v.slice(-5)).toEqual([1, 1, 1, 3, 3]);
	});

	it('is exactly the 365 days ending on the last day', () => {
		const { days } = fillTrailingYear([{ d: '2020-01-01', v: 5 }], '2026-10-14');
		expect(days).toHaveLength(365);
		expect(days[0]).toBe('2025-10-15');
		expect(lastOf(days)).toBe('2026-10-14');
	});

	it('counts what came before the year, and zero before the first point', () => {
		const old = fillTrailingYear([{ d: '2020-01-01', v: 7 }], '2026-10-14');
		expect(old.v[0]).toBe(7);
		const young = fillTrailingYear([{ d: '2026-10-01', v: 2 }], '2026-10-14');
		expect(young.v.slice(0, 2)).toEqual([0, 0]);
		expect(young.v.slice(-14)).toEqual(new Array(14).fill(2));
	});

	it('leaves an already daily series as it is', () => {
		const points = Array.from({ length: 400 }, (_, i) => ({ d: addDays('2025-09-01', i), v: i }));
		const { days, v } = fillTrailingYear(points, lastOf(points).d);
		expect(days).toEqual(points.slice(-365).map((p) => p.d));
		expect(v).toEqual(points.slice(-365).map((p) => p.v));
	});

	it('refuses points out of order or without a day', () => {
		expect(() => fillTrailingYear([{ d: '2026-01-02', v: 1 }, { d: '2026-01-01', v: 2 }], '2026-01-03')).toThrow(
			'points out of order at 2026-01-01'
		);
		expect(() => fillTrailingYear([{ d: '2026-1-2', v: 1 }], '2026-01-03')).toThrow('point day is not a YYYY-MM-DD day');
	});
});

describe('the changes in the pills', () => {
	it('growthPct: whole percent growth, none when flat, falling or from zero', () => {
		expect(growthPct([100, 223])).toBe(123);
		expect(growthPct([100, 100])).toBeNull();
		expect(growthPct([100, 90])).toBeNull();
		expect(growthPct([0, 50])).toBeNull();
		expect(growthPct([1000, 1004])).toBeNull(); // rounds to 0
		expect(growthPct([])).toBeNull();
		expect(growthPct([100])).toBeNull();
		expect(growthPct([100, Number.NaN])).toBeNull();
	});

	const chart = (start: string, v: number[]): BoardChart => ({
		start,
		series: [{ label: '', v, color: '#000', unit: '' }]
	});

	it('gitChange: the last 30 days', () => {
		const v = Array.from({ length: 40 }, (_, i) => 100 + i);
		// day 39 (139) against day 9 (109)
		expect(gitChange(chart('2026-08-01', v), '2026-05-02')).toEqual({ pct: 28, per: 'in 30 days' });
	});

	it('gitChange: none when 30 days back falls before observation began', () => {
		const v = Array.from({ length: 40 }, (_, i) => 100 + i);
		// 30 days back from 2026-05-20 is 2026-04-20, before 2026-05-02.
		expect(gitChange(chart('2026-04-11', v), '2026-05-02')).toBeNull();
	});

	it('gitChange: none on a chart shorter than 31 days', () => {
		expect(gitChange(chart('2026-08-01', [1, 2, 3]), '2026-05-02')).toBeNull();
	});
});

describe('the figures', () => {
	it('Nutzaps counts the mints /nutzaps/mints lists by default: those with sats', () => {
		const mints = [
			{ mint_url: 'https://a.test', config_count: 3, payment_count: 4, total_amount_sats: 10, has_page: true },
			{ mint_url: 'https://b.test', config_count: 3, payment_count: 2, total_amount_sats: 0, has_page: true },
			{ mint_url: 'https://c.test', config_count: 9, payment_count: 0, total_amount_sats: 0, has_page: true }
		];
		expect(byKey(buildBoard({ nutzapMints: mints }).board.panels).nutzaps.value).toBe(1);
	});

	it('Lightning counts every provider the provider table lists', () => {
		const providers = [{ domain: 'a.test', user_count: 1 }, { domain: 'b.test', user_count: 9 }];
		expect(byKey(buildBoard({ lightningProviders: providers }).board.panels).lightning.value).toBe(2);
	});

	it('Lightning: a provider without a row on a day reads null that day, and other never draws', () => {
		const rows = [
			{ day: '2026-10-13', provider: 'a.test', value: 50 },
			{ day: '2026-10-13', provider: 'other', value: 50 },
			{ day: '2026-10-14', provider: 'a.test', value: 40.04 },
			{ day: '2026-10-14', provider: 'b.test', value: 30 },
			{ day: '2026-10-14', provider: 'other', value: 30 }
		];
		const s = byKey(buildBoard({ lightningShare: rows }).board.panels).lightning.chart!.series;
		expect(s.map((x) => [x.label, x.v])).toEqual([
			['a.test', [50, 40]],
			['b.test', [null, 30]]
		]);
	});
});

describe('the copy', () => {
	// Plain ASCII (CLAUDE.md, Writing conventions) and no "measured" (the operator's: it reads as
	// "surveilled"), in everything the board puts on the page.
	const text = JSON.stringify(DOMAINS) + JSON.stringify(buildBoard(REAL).board);
	it('is plain ASCII', () => {
		expect(text).toMatch(/^[\x20-\x7e]*$/);
	});
	it('never says "measured"', () => {
		expect(text.toLowerCase()).not.toContain('measur');
	});
});
