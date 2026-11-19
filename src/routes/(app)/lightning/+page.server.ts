import {
	getLightningProviderStats,
	getLightningTrendsZapShare,
	getLightningTrendsSatsShare,
	getLightningTrendsSatsAbsolute,
	getLightningTrendsZapsAbsolute,
} from '$lib/db/postgres';
import type { PageServerLoad } from './$types';

// Always fetch the server-side top-20 candidate pool (max value the client
// chip selector exposes). The client then slices to the user's chosen N
// (5/10/20) by most-recent-date value; the selection is persisted in
// localStorage, not in the URL.
const FETCH_TOP_N = 20;

export const load: PageServerLoad = () => {
	// All five queries are streamed (returned as Promises). The loading-hint
	// machinery in +page.svelte (mirrors /relays) handles both cold-fetch
	// latency and the heavier rolling-30d trends queries (~1.5s warm).
	//
	// `trendsSatsAbsolute` / `trendsZapsAbsolute` are not rendered as their
	// own charts — they are joined client-side into the corresponding share
	// chart's tooltip (absolute value alongside % share) and into the rank
	// table's "Sats" / "Zaps" column.
	return {
		providers: getLightningProviderStats(),
		trendsZapShare: getLightningTrendsZapShare(FETCH_TOP_N),
		trendsSatsShare: getLightningTrendsSatsShare(FETCH_TOP_N),
		trendsSatsAbsolute: getLightningTrendsSatsAbsolute(FETCH_TOP_N),
		trendsZapsAbsolute: getLightningTrendsZapsAbsolute(FETCH_TOP_N),
	};
};
