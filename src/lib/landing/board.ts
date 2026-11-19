// The landing page's board: one panel per surface, its figure, its change and its chart,
// shaped from the surface pages' own data (the inputs are exactly what those pages load, read
// through the landing cache, $lib/server/landing).
//
// PURE. No I/O, no clock: the same inputs always give the same board, which is what lets the
// server rebuild it only when the cache's data changes, and what the tests pin. Each chart is a
// series its surface page draws, over the trailing year (365 days, or the 366 a page's own
// query returns); each figure is one that page prints:
//
//   Zapstore      apps listed, all / republished / Nostr-native, running totals    /zapstore
//   Marketplaces  live listings by the day each was listed (the page charts all of
//                 it, from 2023); the live-listings card                            /marketplaces
//   Git-on-Nostr  repositories by first-seen day (the line faded before observation
//                 began); the repositories card                                     /git
//   Lightning     share of sats, rolling 30 days, the five largest on the last day;
//                 every provider in the provider table (2,250 on 2026-10-15; the
//                 table opens filtered to 100+ users, 55 that day)                  /lightning
//   Nutzaps       payments, running total; the mints /nutzaps/mints lists by
//                 default (those with sats)                                         /nutzaps
//
// WHEN AN INPUT IS MISSING (never loaded since the server started) a panel shows its typed
// fallback figure from DOMAINS and no chart: `live` says which. When an input is present but
// cannot be shaped (its document changed shape), the panel falls back the same way and the
// problem is returned, so the server can log it - a silent fallback would read as healthy in
// every refresh line.

import type { NutzapMintStat, NutzapsDailyPoint, ZapstoreAppsCumulative } from '$lib/db/postgres';
import type {
	LightningProviderStat,
	LightningTrendsRow,
	MarketsSnapshot,
	NgitSnapshot
} from '$lib/shared/data-types';
import { getProviderColor } from '$lib/utils/providerColors';

export type DomainKey = 'zapstore' | 'marketplaces' | 'git' | 'lightning' | 'nutzaps';

/** What the board is built from: the landing cache's last good copies (any may be absent). */
export interface BoardInputs {
	marketplaces?: Pick<MarketsSnapshot, 'summary' | 'cum_listings'>;
	git?: Pick<NgitSnapshot, 'summary' | 'cum_repos' | 'as_of_day' | 'coverage'>;
	zapstore?: ZapstoreAppsCumulative;
	nutzapsDaily?: NutzapsDailyPoint[];
	nutzapMints?: NutzapMintStat[];
	lightningProviders?: LightningProviderStat[];
	lightningShare?: LightningTrendsRow[];
}

export interface BoardSeries {
	label: string;
	/** The end label's name when the chart has more than one line. */
	short?: string;
	color: string;
	/** One value per day of the chart; null where the series has no value that day. */
	v: (number | null)[];
	unit: string;
	/** A percentage: printed with one decimal and a % sign. */
	pct?: boolean;
	/** Drawn with a fill under the line. */
	fill?: boolean;
}

export interface BoardChart {
	/** The chart's first day. Its days are consecutive, one per series value, so the rest
	 * follow from this (chartDay): the board crosses the wire with every landing page, and the
	 * dates spelt out would be more than half of it. */
	start: string;
	series: BoardSeries[];
	/** Index of the first observed day: the line is faded before it (Git-on-Nostr). */
	wall?: number;
	wallText?: string;
	/** What the hover says about a day before the wall. */
	wallNote?: string;
}

export interface BoardPanel {
	key: DomainKey;
	label: string;
	href: string;
	/** CSS colour of the surface: its dot, its button, its tab's underline. */
	accent: string;
	/** Text colour on a filled accent (4.5:1 or better on all but the purple, 4.0:1 there). */
	onAccent: string;
	/** "New" beside the name in the roster. */
	isNew: boolean;
	/** The figure: from the data when `live`, else the typed fallback. */
	value: number;
	live: boolean;
	/** What the figure counts, under it on the band. */
	unit: string;
	/** The same, short, in the roster. */
	shortUnit: string;
	/** The change shown in the pill, when the chart supports one. */
	change: { pct: number; per: string } | null;
	chart: BoardChart | null;
	/** What the chart's line counts, under the chart. */
	caption: string;
}

export interface Board {
	panels: BoardPanel[];
	/** The tab open on load. */
	initial: DomainKey;
}

export interface BoardResult {
	board: Board;
	/** Inputs that were present but could not be shaped: "<panel> <part>: <error>". */
	problems: string[];
}

interface Domain {
	key: DomainKey;
	href: string;
	label: string;
	accent: string;
	onAccent: string;
	isNew: boolean;
	unit: string;
	shortUnit: string;
	caption: string;
	/** Shown while the data has not loaded since the server started: the surface page's figure
	 * on FALLBACK_AS_OF. Only a cold start with the database unreachable shows these. */
	fallback: number;
}

/** When the fallback figures below were read off the surface pages. */
export const FALLBACK_AS_OF = '2026-10-14';

/** The surfaces in the nav's order (src/lib/nav.ts). */
export const DOMAINS: readonly Domain[] = [
	{
		key: 'zapstore',
		href: '/zapstore',
		label: 'Zapstore',
		accent: 'var(--purple)',
		onAccent: '#fff',
		isNew: false,
		unit: 'apps listed on Zapstore',
		shortUnit: 'apps',
		caption: "Apps listed, counted from each app's first release",
		fallback: 4751
	},
	{
		key: 'marketplaces',
		href: '/marketplaces',
		label: 'Marketplaces',
		accent: 'var(--blue)',
		onAccent: '#0b1120',
		isNew: false,
		unit: 'live marketplace listings',
		shortUnit: 'live listings',
		caption: 'Live listings, by the day each was listed',
		fallback: 7832
	},
	{
		key: 'git',
		href: '/git',
		label: 'Git-on-Nostr',
		accent: 'var(--red)',
		onAccent: '#0b1120',
		isNew: true,
		unit: 'git repositories on Nostr',
		shortUnit: 'repositories',
		caption: 'Repositories, by the day each was first seen',
		fallback: 4803
	},
	{
		key: 'lightning',
		href: '/lightning',
		label: 'Lightning',
		accent: 'var(--gold)',
		onAccent: '#0b1120',
		isNew: false,
		unit: 'lightning-address providers',
		shortUnit: 'providers',
		caption: 'Share of sats received, rolling 30 days, for the five largest providers today',
		fallback: 2247
	},
	{
		key: 'nutzaps',
		href: '/nutzaps',
		label: 'Nutzaps',
		accent: 'var(--green)',
		onAccent: '#0b1120',
		isNew: false,
		unit: 'mints carrying nutzaps',
		shortUnit: 'mints',
		caption: 'Nutzap payments, running total',
		fallback: 33
	}
];

export const INITIAL_TAB: DomainKey = 'marketplaces';

// The lines' colours: Zapstore's three as /zapstore draws them, the rest in their surface's
// accent (Lightning's providers in the colours /lightning gives them, getProviderColor).
const ZAPSTORE_COLORS = { total: '#1abc9c', republished: '#3498db', native: '#9b59b6' };
const MARKETPLACES_COLOR = '#3498db';
const GIT_COLOR = '#e74c3c';
const NUTZAPS_COLOR = '#1abc9c';

const DAY_MS = 86_400_000;
/** The trailing year a chart shows: 365 days ending on its last day, inclusive. */
export const YEAR_DAYS = 365;
const LIGHTNING_LINES = 5;

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const dayOfSeconds = (seconds: number): string => isoDay(seconds * 1000);
export const addDays = (day: string, n: number): string =>
	isoDay(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS);

/** How many days a chart covers. */
export const chartLength = (chart: BoardChart): number => chart.series[0]?.v.length ?? 0;

/** The chart's `i`th day. */
export const chartDay = (chart: BoardChart, i: number): string => addDays(chart.start, i);

/** Throws unless the days run one after another with no gap: every chart's x axis is a day per
 * point, so a gap would stretch time unevenly. The series the board reads all come from a
 * generate_series or a fill, so a gap means a query changed. */
function assertConsecutive(days: string[], what: string): void {
	for (let i = 1; i < days.length; i++) {
		if (addDays(days[i - 1], 1) !== days[i]) {
			throw new Error(`${what} skips from ${days[i - 1]} to ${days[i]}`);
		}
	}
}

function assertDay(day: unknown, what: string): string {
	if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
		throw new Error(`${what} is not a YYYY-MM-DD day: ${JSON.stringify(day)}`);
	}
	return day;
}

function assertCount(value: unknown, what: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new Error(`${what} is not a count: ${JSON.stringify(value)}`);
	}
	return value;
}

/**
 * A running total given as {d, v} points, where equal consecutive days may be left out (the
 * first day and every change are present): filled to every day up to `lastDay`, carrying the
 * total over the days left out, then cut to the trailing year ending on `lastDay`. This is how
 * /git fills cum_repos; a series that is already daily comes out unchanged.
 */
export function fillTrailingYear(
	points: { d: string; v: number }[],
	lastDay: string
): { days: string[]; v: number[] } {
	if (points.length === 0) throw new Error('no points');
	points.forEach((p, k) => {
		assertDay(p.d, 'point day');
		if (k > 0 && p.d < points[k - 1].d) throw new Error(`points out of order at ${p.d}`);
	});
	const first = points[0].d;
	assertDay(lastDay, 'last day');
	const from = addDays(lastDay, -(YEAR_DAYS - 1));
	const days: string[] = [];
	const v: number[] = [];
	let total = 0;
	let i = 0;
	for (let d = first < from ? first : from; d <= lastDay; d = addDays(d, 1)) {
		while (i < points.length && points[i].d <= d) total = assertCount(points[i++].v, 'point value');
		if (d >= from) {
			days.push(d);
			v.push(total);
		}
	}
	return { days, v };
}

/** The growth of a running total over its chart, as a whole percentage. Null when there is no
 * growth to show (the pill's arrow points up, so a flat or empty series gets no pill). */
export function growthPct(v: number[]): number | null {
	const first = v[0];
	const last = v[v.length - 1];
	if (!(first > 0)) return null;
	// A fall, a flat line, a single point or a missing last value all come out as no pill:
	// NaN > 0 is false too.
	const pct = Math.round((last / first - 1) * 100);
	return pct > 0 ? pct : null;
}

function zapstoreChart(z: ZapstoreAppsCumulative): BoardChart {
	if (z.total.length === 0) throw new Error('no days');
	const days = z.total.map((p) => dayOfSeconds(p.timestamp));
	assertConsecutive(days, 'days');
	const align = (points: { timestamp: number; value: number }[], what: string) => {
		if (points.length !== days.length) throw new Error(`${what} has ${points.length} days, total has ${days.length}`);
		return points.map((p) => assertCount(p.value, what));
	};
	return {
		start: days[0],
		series: [
			{ label: 'All apps', v: align(z.total, 'total'), color: ZAPSTORE_COLORS.total, unit: '', fill: true },
			{
				label: 'Republished from GitHub / F-Droid',
				short: 'Republished',
				v: align(z.github, 'github'),
				color: ZAPSTORE_COLORS.republished,
				unit: ''
			},
			{ label: 'Nostr-native', v: align(z.native, 'native'), color: ZAPSTORE_COLORS.native, unit: '' }
		]
	};
}

function marketplacesChart(m: NonNullable<BoardInputs['marketplaces']>): BoardChart {
	const points = m.cum_listings;
	if (points.length === 0) throw new Error('no points');
	const { days, v } = fillTrailingYear(points, assertDay(points[points.length - 1].d, 'last point'));
	return { start: days[0], series: [{ label: '', v, color: MARKETPLACES_COLOR, unit: 'live listings', fill: true }] };
}

function gitChart(g: NonNullable<BoardInputs['git']>): BoardChart {
	const asOf = assertDay(g.as_of_day, 'as_of_day');
	const since = assertDay(g.coverage.announcements_since, 'announcements_since');
	const { days, v } = fillTrailingYear(g.cum_repos, asOf);
	const wall = days.indexOf(since);
	return {
		start: days[0],
		series: [{ label: '', v, color: GIT_COLOR, unit: 'repositories', fill: true }],
		// Only where observation began inside the year shown; a wall at day 0 would fade nothing.
		...(wall > 0 ? { wall, wallText: 'observation began', wallNote: 'before observation began' } : {})
	};
}

/**
 * Git-on-Nostr's change: the last 30 days, every one of them observed. A 12-month change would
 * mostly measure the start of observation (announcements are captured from 2026-05-02; the line
 * before that holds only what relays still served). Null if 30 days back falls before
 * observation began or outside the chart.
 */
export function gitChange(chart: BoardChart, since: string): { pct: number; per: string } | null {
	const v = chart.series[0].v;
	const last = v.length - 1;
	const then = last - 30;
	if (then < 0 || chartDay(chart, then) < since) return null;
	const from = v[then];
	const to = v[last];
	if (from === null || to === null) return null;
	const pct = growthPct([from, to]);
	return pct === null ? null : { pct, per: 'in 30 days' };
}

function lightningChart(rows: LightningTrendsRow[]): BoardChart {
	if (rows.length === 0) throw new Error('no rows');
	const days = [...new Set(rows.map((r) => assertDay(r.day, 'row day')))].sort();
	assertConsecutive(days, 'days');
	const byDay = new Map<string, LightningTrendsRow[]>(days.map((d) => [d, []]));
	for (const r of rows) byDay.get(r.day)!.push(r);
	const lastDay = days[days.length - 1];
	const top = byDay
		.get(lastDay)!
		.filter((r) => r.provider !== 'other')
		.sort((a, b) => b.value - a.value)
		.slice(0, LIGHTNING_LINES)
		.map((r) => r.provider);
	if (top.length === 0) throw new Error('no named provider on the last day');
	return {
		start: days[0],
		series: top.map((provider) => ({
			label: provider,
			color: getProviderColor(provider),
			unit: 'of sats',
			pct: true,
			v: days.map((d) => {
				const r = byDay.get(d)!.find((x) => x.provider === provider);
				return r ? Math.round(r.value * 10) / 10 : null;
			})
		}))
	};
}

function nutzapsChart(points: NutzapsDailyPoint[]): BoardChart {
	if (points.length === 0) throw new Error('no days');
	const days = points.map((p) => dayOfSeconds(p.timestamp));
	assertConsecutive(days, 'days');
	return {
		start: days[0],
		series: [
			{
				label: '',
				v: points.map((p) => assertCount(p.cumulative_count, 'cumulative_count')),
				color: NUTZAPS_COLOR,
				unit: 'payments',
				fill: true
			}
		]
	};
}

/** Run one part of one panel; a throw becomes a problem and the part's fallback. */
function part<T>(problems: string[], where: string, input: unknown, shape: () => T): T | null {
	if (input === undefined || input === null) return null;
	try {
		return shape();
	} catch (err) {
		problems.push(`${where}: ${err instanceof Error ? err.message : String(err)}`);
		return null;
	}
}

export function buildBoard(inputs: BoardInputs): BoardResult {
	const problems: string[] = [];
	const panels = DOMAINS.map((d): BoardPanel => {
		let value: number | null = null;
		let chart: BoardChart | null = null;
		let change: BoardPanel['change'] = null;
		switch (d.key) {
			case 'zapstore': {
				const z = inputs.zapstore;
				chart = part(problems, 'zapstore chart', z, () => zapstoreChart(z!));
				// The figure is the chart's own last value: /zapstore prints the same running total.
				value = chart ? (chart.series[0].v[chart.series[0].v.length - 1] as number) : null;
				const pct = chart ? growthPct(chart.series[0].v as number[]) : null;
				change = pct === null ? null : { pct, per: 'in 12 months' };
				break;
			}
			case 'marketplaces': {
				const m = inputs.marketplaces;
				value = part(problems, 'marketplaces figure', m, () => assertCount(m!.summary.active_listings, 'active_listings'));
				chart = part(problems, 'marketplaces chart', m, () => marketplacesChart(m!));
				const pct = chart ? growthPct(chart.series[0].v as number[]) : null;
				change = pct === null ? null : { pct, per: 'in 12 months' };
				break;
			}
			case 'git': {
				const g = inputs.git;
				value = part(problems, 'git figure', g, () => assertCount(g!.summary.repos, 'repos'));
				chart = part(problems, 'git chart', g, () => gitChart(g!));
				change = chart && g ? gitChange(chart, g.coverage.announcements_since) : null;
				break;
			}
			case 'lightning': {
				const providers = inputs.lightningProviders;
				value = part(problems, 'lightning figure', providers, () => {
					if (!Array.isArray(providers)) throw new Error('providers is not a list');
					return providers.length;
				});
				const rows = inputs.lightningShare;
				chart = part(problems, 'lightning chart', rows, () => lightningChart(rows!));
				break;
			}
			case 'nutzaps': {
				const mints = inputs.nutzapMints;
				// What /nutzaps/mints lists by default: the mints with sats (its includeZeroSats
				// toggle starts off).
				value = part(problems, 'nutzaps figure', mints, () => {
					if (!Array.isArray(mints)) throw new Error('mints is not a list');
					return mints.filter((m) => m.total_amount_sats > 0).length;
				});
				const daily = inputs.nutzapsDaily;
				chart = part(problems, 'nutzaps chart', daily, () => nutzapsChart(daily!));
				break;
			}
		}
		return {
			key: d.key,
			label: d.label,
			href: d.href,
			accent: d.accent,
			onAccent: d.onAccent,
			isNew: d.isNew,
			value: value ?? d.fallback,
			live: value !== null,
			unit: d.unit,
			shortUnit: d.shortUnit,
			change,
			chart,
			caption: d.caption
		};
	});
	return { board: { panels, initial: INITIAL_TAB }, problems };
}
