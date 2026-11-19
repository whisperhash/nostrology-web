// A small, hand-written Routstr snapshot document (the data of one routstr_snapshot row) for
// the /routstr page tests, jsdom and server render alike. Revenue fields in the document are
// integer MILLISATS - the sats the page shows are its own division, and the numbers are chosen
// so that conversion is visible (21,000,000 msats -> 21,000 sats).
import type { RoutstrSnapshot } from '$lib/shared/data-types';

export const SNAPSHOT: RoutstrSnapshot = {
	generated_utc: '2026-08-24 15:50:00Z',
	summary: {
		archive_events: { announcements: 5951, analytics_daily: 703, catalog: 23, reviews: 30 },
		providers_announced: 49,
		providers_reporting: 20,
		providers_active_30d: 8,
		revenue_30d_sats: 21000,
		requests_30d: 65713,
		tokens_30d: 1021167874,
		revenue_alltime_sats: 12433216,
		requests_alltime: 536044,
		tokens_alltime: 9124165077,
		first_activity: '2025-08-13',
		last_activity: '2026-08-23',
		models_30d: 49,
		catalog_models: 21,
		mints: 15,
		success_rate_30d: 0.9689
	},
	exclusions: [
		{ k: 'Test / staging nodes', v: 3, why: 'self-reported usage from non-production nodes' },
		{ k: 'Private-endpoint-only nodes', v: 2, why: 'no client could reach them' },
		{ k: 'Kind squatters', v: 1, why: 'not Routstr providers at all' }
	],
	daily: [
		{ d: '2026-08-21', msats: 21000000, req: 100, tok: 5000, prov: 3 },
		{ d: '2026-08-22', msats: 0, req: 0, tok: 0, prov: 0 },
		{ d: '2026-08-23', msats: 1000, req: 1, tok: 10, prov: 1 }
	],
	cum_revenue: [
		{ d: '2026-08-21', msats: 21000000 },
		{ d: '2026-08-23', msats: 21001000 }
	],
	provider_daily_top: [
		{ id: 'aaaaaaaaaaaa', name: 'Alpha Node', series: [{ d: '2026-08-21', msats: 21000000 }] },
		{ id: '(others)', name: '(others)', series: [{ d: '2026-08-23', msats: 1000 }] }
	],
	model_daily_top: [{ id: 'gpt-x', series: [{ d: '2026-08-21', msats: 21000000 }] }],
	providers: [
		{
			id: 'aaaaaaaaaaaa',
			name: 'Alpha Node',
			class: 'clearnet',
			version: '0.4.5',
			mints: 2,
			review: 'lgtm',
			first_seen: '2025-09-01',
			last_announce: '2026-08-20',
			last_report: '2026-08-23',
			msats_alltime: 21000000,
			msats_30d: 21000000,
			req_30d: 100,
			tok_30d: 5000,
			excluded: false,
			reason: null
		},
		{
			id: 'bbbbbbbbbbbb',
			name: 'Beta staging',
			class: 'clearnet',
			version: '0.4.4',
			mints: 0,
			review: null,
			first_seen: '2026-05-01',
			last_announce: '2026-08-01',
			last_report: '2026-08-23',
			msats_alltime: 999000,
			msats_30d: 999000,
			req_30d: 9,
			tok_30d: 90,
			excluded: true,
			reason: 'test'
		}
	],
	providers_total: 2,
	models: [
		{
			model: 'gpt-x',
			msats_30d: 21000000,
			req_30d: 100,
			tok_30d: 5000,
			msats_alltime: 21000000,
			req_alltime: 100,
			tok_alltime: 5000,
			providers_30d: 1
		}
	],
	catalog: {
		updated: '2026-08-21',
		models: ['gpt-x', 'claude-y'],
		history: [
			{ d: '2026-06-01', n: 1 },
			{ d: '2026-08-21', n: 2 }
		]
	},
	reviews: [
		{ node: 'aaaaaaaaaaaa', label: 'lgtm', d: '2026-06-06', reviewer: 'curated', name: 'Alpha Node' }
	],
	transports: [
		{ k: 'both', v: 18 },
		{ k: 'clearnet', v: 16 },
		{ k: 'onion', v: 13 },
		{ k: 'private-only', v: 2 }
	],
	versions: [{ k: '0.4.5', v: 10 }],
	mints_top: [{ k: 'mint.minibits.cash', v: 9 }],
	success: { rate_30d: 0.9689, requests_reported: 68000, failed_reported: 2100, providers_fresh: 7 },
	coverage: { daily_from: '2026-03-06', weekly_from: '2025-08-07', snapshots_used: 703 },
	anomalies: { bad_snapshots: 0, bad_buckets: 0 }
};
