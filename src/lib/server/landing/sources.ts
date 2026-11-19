// What the landing's board reads: the surface pages' own data functions, with the arguments
// the surface pages pass, and nothing written for the landing alone. Each is rebuilt nightly by
// its surface's Dagster job (nostrology-data dagster_code/definitions.py), so an hourly read
// picks up a night's run within the hour:
//
//   marketplaces        getMarketplacesSnapshot          marketplaces_refresh  02:15 UTC
//   git                 getNgitSnapshot                  ngit_refresh          03:15 UTC
//   zapstore            getZapstoreAppsCumulativeDaily   zapstore_refresh      01:15 UTC
//   nutzapsDaily        getNutzapsDailySeries            nutzaps_refresh       01:45 UTC
//   nutzapMints         getNutzapMintStats('all')        nutzaps_refresh       01:45 UTC
//   lightningProviders  getLightningProviderStats        lightning_refresh     00:45 UTC
//   lightningShare      getLightningTrendsSatsShare(20)  lightning_refresh     00:45 UTC
//
// The cache reads them in this order, one at a time: Marketplaces is the tab open on load, and
// the Lightning share query, the heaviest (about 1.5 s warm), goes last.

import {
	getLightningProviderStats,
	getLightningTrendsSatsShare,
	getMarketplacesSnapshot,
	getNgitSnapshot,
	getNutzapMintStats,
	getNutzapsDailySeries,
	getZapstoreAppsCumulativeDaily
} from '$lib/db/postgres';

/** As /lightning fetches (its FETCH_TOP_N): the board keeps the five largest on the last day. */
export const LIGHTNING_TOP_N = 20;

/**
 * A read that finds its table empty fails, so the cache keeps its last good copy and tries again
 * a minute later. Zapstore and both Nutzaps sources read kind tables the nightly loader empties
 * and refills, and it commits the TRUNCATE before the COPY (nostrology-data
 * loader/load_jsonl_exports_into_postgres.py). Both tables load in one batch (28,167 and 5,544
 * rows on 2026-10-15; a batch is 50,000), so a read between the two finds nothing at all. Kept,
 * that read would show live zeros until the next hourly read: 0 apps and 0 mints, flat charts.
 *
 * Judged by content, not by rows: the Zapstore and Nutzaps daily queries pad the trailing year
 * with generate_series, so an empty table reads as 366 days of zeros, not as no rows (the review
 * of 2026-10-15 found that a row count let both through). Past 50,000 rows a read could find part
 * of a table, which this does not catch. The other sources read append-only snapshot tables, or
 * views refreshed CONCURRENTLY.
 */
export function nonEmpty<T>(value: T, found: boolean, what: string): T {
	if (!found) throw new Error(`${what}: an empty read, as between a nightly load's TRUNCATE and its COPY`);
	return value;
}

export const LANDING_SOURCES = {
	marketplaces: () => getMarketplacesSnapshot(),
	git: () => getNgitSnapshot(),
	zapstore: async () => {
		const apps = await getZapstoreAppsCumulativeDaily();
		return nonEmpty(apps, (apps.total[apps.total.length - 1]?.value ?? 0) > 0, 'no apps');
	},
	nutzapsDaily: async () => {
		const days = await getNutzapsDailySeries();
		return nonEmpty(days, days.some((d) => d.daily_count > 0), 'no payments');
	},
	// 'all', the period /nutzaps/mints opens on.
	nutzapMints: async () => {
		const mints = await getNutzapMintStats('all');
		return nonEmpty(mints, mints.some((m) => m.total_amount_sats > 0), 'no mint with sats');
	},
	lightningProviders: () => getLightningProviderStats(),
	lightningShare: () => getLightningTrendsSatsShare(LIGHTNING_TOP_N)
};

export type LandingSources = typeof LANDING_SOURCES;
