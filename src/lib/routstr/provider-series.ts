// Client-side helpers for the /routstr page, kept out of the component so they can be
// unit-tested without a canvas.
import type { RoutstrProviderRow, RoutstrSnapshot } from '$lib/shared/data-types';

export type ProviderSeries = RoutstrSnapshot['provider_daily_top'][number];

// The snapshot ships the provider chart series rank-ordered (top TOP_PROVIDERS by 30d
// revenue) plus the pipeline's "(others)" residual. The page's Top-N selector folds ranks
// N+1.. into that residual here; the pipeline invariant `sum(provider_daily_top) == daily`
// per day is what makes the fold exact rather than approximate.
export function foldProviderSeries(rows: ProviderSeries[], n: number): ProviderSeries[] {
	const named = rows.filter((p) => p.id !== '(others)');
	const residual = new Map<string, number>();
	for (const p of [...named.slice(n), ...rows.filter((p) => p.id === '(others)')]) {
		for (const pt of p.series) residual.set(pt.d, (residual.get(pt.d) ?? 0) + pt.msats);
	}
	const out = named.slice(0, n).map((p) => ({ id: p.id, name: p.name, series: p.series }));
	if (residual.size) {
		out.push({
			id: '(others)',
			name: '(others)',
			series: [...residual]
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([d, msats]) => ({ d, msats }))
		});
	}
	return out;
}

// Sortable "All providers" table. Text columns sort ascending first, numeric columns
// descending first (a click on "Sats" wants the biggest on top); nulls always sink to
// the bottom regardless of direction; ties fall back to name then id so the order is
// deterministic.
export type ProviderSortKey =
	| 'name'
	| 'class'
	| 'version'
	| 'review'
	| 'first_seen'
	| 'last_report'
	| 'msats_30d'
	| 'msats_alltime';
export type SortDir = 'asc' | 'desc';

const NUMERIC: ReadonlySet<ProviderSortKey> = new Set(['msats_30d', 'msats_alltime']);

export function defaultDir(key: ProviderSortKey): SortDir {
	return NUMERIC.has(key) ? 'desc' : 'asc';
}

export function sortProviders(
	rows: RoutstrProviderRow[],
	key: ProviderSortKey,
	dir: SortDir
): RoutstrProviderRow[] {
	const mul = dir === 'asc' ? 1 : -1;
	return [...rows].sort((a, b) => {
		const va = a[key];
		const vb = b[key];
		const na = va === null || va === '';
		const nb = vb === null || vb === '';
		if (na !== nb) return na ? 1 : -1;
		if (!na && va !== vb) {
			if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul;
			const sa = String(va).toLowerCase();
			const sb = String(vb).toLowerCase();
			if (sa !== sb) return (sa < sb ? -1 : 1) * mul;
		}
		return a.name === b.name ? (a.id < b.id ? -1 : 1) : a.name < b.name ? -1 : 1;
	});
}
