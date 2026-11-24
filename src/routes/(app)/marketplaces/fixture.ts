// A small, hand-written marketplaces snapshot document (the data of one marketplaces_snapshot
// row) for the /marketplaces page tests: every field of MarketsSnapshot, one to three rows per
// list, numbers chosen to be recognisable in rendered text rather than to reproduce any run.
import type { MarketsRecentListing, MarketsSnapshot } from '$lib/shared/data-types';

/** One Recent listings row as the server sends it: a listing a marketplace can open, so it
 *  survives the server's cut ($lib/markets/recent) and is drawn. */
export const LISTING: MarketsRecentListing = {
	pubkey: '2e7afe3f9af8c3dc90d6e8acaf5d7aa926a54f0c22f1c555707309c059fe831b',
	d_tag: 'barattolo-3195',
	event_id: null,
	effective_ts: 1792686600,
	title: 'Buono Amazon 25 scontato',
	status: 'active',
	client: '',
	location: 'Italia',
	cc: 'IT',
	categories: [],
	price: ['price', '23.50', 'EUR'],
	seller_name: null,
	market_image: null,
	expires_at: null,
	title_tag: null,
	visibility: '',
	content_warning: null,
	summary_len: null
};

export const SNAPSHOT: MarketsSnapshot = {
	generated_utc: '2026-08-23 09:43:05Z',
	summary: {
		archive_events: 12166,
		current_coordinates: 11784,
		active_listings: 4935,
		sellers: 1292,
		added_30d: 592,
		active_90d: 1518,
		sellers_90d: 410,
		countries: 54,
		first_listing: '2023-07-13',
		// A day before the snapshot, as before the day's first listing: the partial month's
		// caption is dated by generated_utc, never by this (see the page's comment).
		last_listing: '2026-08-22',
		withdrawn_any: 314,
		deleted_any: 708
	},
	exclusions: [
		{ k: 'Non-retail bulk publishers', v: 4860, why: 'three single accounts' },
		{ k: 'Carrier / staging clients', v: 325, why: 'transport for something else' },
		{ k: 'Unrenderable', v: 169, why: 'nothing a buyer could see' },
		{ k: 'Synthetic / test listings', v: 819, why: 'test-worded titles' },
		{ k: 'Deleted (NIP-09)', v: 566, why: 'author-published deletion' },
		{ k: 'Withdrawn', v: 98, why: 'status sold' },
		{ k: 'Product options', v: 12, why: 'a size or colour published as its own listing' }
	],
	cum_sellers: [{ d: '2023-07-13', v: 1 }],
	cum_listings: [{ d: '2023-07-13', v: 1 }],
	// Two full months, then the partial one (the month of generated_utc), as a run leaves it.
	new_monthly: [
		{ m: '2026-06', v: 30, s: 8 },
		{ m: '2026-07', v: 25, s: 5 },
		{ m: '2026-08', v: 10, s: 2 }
	],
	partial_month: '2026-08',
	categories: [{ cat: 'books', listings: 30, sellers: 6 }],
	categories_coverage: { with_tag: 100, total: 4935, distinct_tags: 40, min_sellers: 5 },
	// The two entries sum to currency_coverage.priced (the page derives the bitcoin share
	// from the array sum): 1800/3858 -> 47%.
	currency: [
		{ cur: 'Bitcoin (BTC / sats)', listings: 1800, sellers: 630 },
		{ cur: 'USD', listings: 2058, sellers: 400 }
	],
	currency_coverage: { priced: 3858, total: 4935 },
	countries: [{ cc: 'US', name: 'United States', listings: 430, sellers: 100 }],
	seller_countries: [{ cc: 'US', name: 'United States', sellers: 100 }],
	seller_geo_coverage: { placed: 382, total: 1292 },
	geo_nonattr: {
		NOTAG: { listings: 2901, sellers: 642 },
		NONGEO: { listings: 560, sellers: 237 },
		UNRES: { listings: 232, sellers: 88 },
		REGION: { listings: 81, sellers: 48 },
		AMBIG: { listings: 26, sellers: 13 }
	},
	geo_attributable: 1208,
	map_points: [
		{ lat: 39.5, lon: -98.35, cc: 'US', name: 'United States', prec: 'country', listings: 430, sellers: 100 }
	],
	shipping: [{ cc: 'US', name: 'United States', options: 40, sellers: 30, lat: 39.5, lon: -98.35 }],
	shipping_coverage: { options_total: 700, with_country: 650, sellers: 300 },
	clients: [{ client: 'shopstr', listings: 2000, sellers: 700 }]
};
