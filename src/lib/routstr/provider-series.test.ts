import { describe, expect, it } from 'vitest';

import type { RoutstrProviderRow } from '$lib/shared/data-types';
import { defaultDir, foldProviderSeries, sortProviders } from './provider-series';

const ROWS = [
	{
		id: 'p1',
		name: 'One',
		series: [
			{ d: '2026-08-01', msats: 100 },
			{ d: '2026-08-02', msats: 10 }
		]
	},
	{ id: 'p2', name: 'Two', series: [{ d: '2026-08-01', msats: 50 }] },
	{ id: 'p3', name: 'Three', series: [{ d: '2026-08-03', msats: 7 }] },
	{ id: '(others)', name: '(others)', series: [{ d: '2026-08-02', msats: 1 }] }
];

describe('foldProviderSeries', () => {
	it('keeps the top N in rank order and folds the rest into the residual, day-sorted', () => {
		const out = foldProviderSeries(ROWS, 1);
		expect(out.map((p) => p.id)).toEqual(['p1', '(others)']);
		expect(out[1].series).toEqual([
			{ d: '2026-08-01', msats: 50 },
			{ d: '2026-08-02', msats: 1 },
			{ d: '2026-08-03', msats: 7 }
		]);
	});

	it('preserves the per-day total under any N (the partition the pipeline pins)', () => {
		const total = (rows: typeof ROWS) => {
			const m = new Map<string, number>();
			for (const p of rows) for (const pt of p.series) m.set(pt.d, (m.get(pt.d) ?? 0) + pt.msats);
			return [...m].sort();
		};
		for (const n of [0, 1, 2, 3, 20])
			expect(total(foldProviderSeries(ROWS, n))).toEqual(total(ROWS));
	});

	it('emits no residual when nothing is folded and the pipeline sent none', () => {
		expect(foldProviderSeries(ROWS.slice(0, 3), 20).map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
	});
});

const P = (over: Partial<RoutstrProviderRow>): RoutstrProviderRow => ({
	id: 'x',
	name: 'x',
	class: 'clearnet',
	version: '',
	mints: 0,
	review: null,
	first_seen: null,
	last_announce: null,
	last_report: null,
	msats_alltime: 0,
	msats_30d: 0,
	req_30d: 0,
	tok_30d: 0,
	excluded: false,
	reason: null,
	...over
});

describe('sortProviders', () => {
	const rows = [
		P({
			id: 'a',
			name: 'alpha',
			msats_30d: 5,
			version: '0.4.5',
			last_report: '2026-08-01'
		}),
		P({ id: 'b', name: 'beta', msats_30d: 50, version: '', last_report: null }),
		P({
			id: 'c',
			name: 'gamma',
			msats_30d: 5,
			version: '0.4.4',
			last_report: '2026-08-03'
		})
	];

	it('numeric columns default to descending, text to ascending', () => {
		expect(defaultDir('msats_30d')).toBe('desc');
		expect(defaultDir('name')).toBe('asc');
	});

	it('sorts numerically with a deterministic name tie-break', () => {
		expect(sortProviders(rows, 'msats_30d', 'desc').map((r) => r.id)).toEqual(['b', 'a', 'c']);
		expect(sortProviders(rows, 'msats_30d', 'asc').map((r) => r.id)).toEqual(['a', 'c', 'b']);
	});

	it('sinks null / empty values to the bottom in both directions', () => {
		expect(sortProviders(rows, 'last_report', 'asc').map((r) => r.id)).toEqual(['a', 'c', 'b']);
		expect(sortProviders(rows, 'last_report', 'desc').map((r) => r.id)).toEqual(['c', 'a', 'b']);
		expect(sortProviders(rows, 'version', 'asc').map((r) => r.id)).toEqual(['c', 'a', 'b']);
	});

	it('does not mutate its input', () => {
		const copy = [...rows];
		sortProviders(rows, 'name', 'desc');
		expect(rows).toEqual(copy);
	});
});
