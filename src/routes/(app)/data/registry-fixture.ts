// Shared registry fixture for the /data tests (the loaders' and the grids').
// Mirrors what nostrology-data's metric.registry_entries() serializes, trimmed
// to the shape these pages read - crucially including the app_zaps PAIR, the
// one metric that registers two grains and so the whole reason the listing
// grids group.
import type { RegistryMetric, RegistryPayload, RegistryRecord } from '$lib/server/mcpRegistry';

export const ENDPOINT = 'https://nostrolo.gy/mcp';

function entry(
	over: Partial<RegistryMetric> & Pick<RegistryMetric, 'metric' | 'grain'>
): RegistryMetric {
	return {
		key: `zapstore.${over.metric}@${over.grain}`,
		domain: 'zapstore',
		unit: 'zaps+msats',
		output: 'sparse',
		summary: `summary of ${over.metric}`,
		partition: '',
		caveats: [],
		methodology: '',
		as_of_source: '',
		params: {
			grain: { values: ['day', 'total'], default: 'day' },
			window: { accepted: true, from: 'from', to: 'to' },
			format: ['csv', 'markdown']
		},
		columns: [],
		...over
	};
}

/** app_zaps at both grains, plus a single-grain metric for contrast. */
export const METRICS: RegistryMetric[] = [
	entry({ metric: 'app_zaps', grain: 'day', output: 'sparse' }),
	entry({ metric: 'app_zaps', grain: 'total', output: 'entities' }),
	entry({
		metric: 'zap_count',
		grain: 'day',
		unit: 'zaps',
		output: 'dense',
		params: {
			grain: { values: ['day'], default: 'day' },
			window: { accepted: true, from: 'from', to: 'to' },
			format: ['csv', 'markdown']
		}
	})
];

/** The Routstr domain (2026-08-29): the second free domain, served by the SAME
 * two tools under domain "routstr". One metric here is enough to exercise the
 * presentation order (zapstore, routstr, then the rest alphabetical) and the
 * provider_pubkey entity filter the /data pages render generically. */
export const ROUTSTR_METRICS: RegistryMetric[] = [
	entry({
		key: 'routstr.provider_leaderboard@current',
		domain: 'routstr',
		metric: 'provider_leaderboard',
		grain: 'current',
		unit: 'msats+requests+tokens',
		output: 'entities',
		summary: 'Every Routstr provider with its 30d and all-time reported figures.',
		params: {
			grain: { values: ['current'], default: 'current' },
			window: { accepted: false, reason: 'current-state snapshot' },
			entity_filters: { provider_pubkey: 'optional 64-char lowercase hex Routstr provider key' },
			format: ['csv', 'markdown']
		}
	})
];

/** The nutzaps domain - GENERATED from the real registry, not written by hand.
 *
 * Every nutzaps entry exactly as nostrology-data's registry_entries() serializes it,
 * in its order (sorted by key), with two fields trimmed because no page reads them:
 * `methodology` is blanked (it is the summary, partition and caveats joined, and those
 * three are here verbatim) and `row_cap` is dropped (it is not on RegistryMetric).
 *
 * Generated, unlike the rest of this file, because the domain is MIXED - free metrics
 * beside the paid active_users - and every distinction the pages draw is a registry
 * fact that a hand copy drifts from: paid-ness (price_sats + tool present), the grains
 * each metric serves, the filters it takes. The first hand copy did drift: it kept
 * offering day and week buckets of mint_active_users after the 2026-09-30 review cut
 * that free metric to month (the operator restored them the same evening - which the
 * regenerated array below reflects, and a hand copy would again have had to track).
 *
 * Regenerate after any change to the domain's registry entries - do not hand-edit -
 * by pasting the array this prints over the one below:
 *
 *   cd nostrology-data && PYTHONPATH=$PWD .venv-mcp/bin/python -c "import json; from nostrology_mcp.metric import registry_entries as r; print(json.dumps([{k: ('' if k == 'methodology' else v) for k, v in e.items() if k != 'row_cap'} for e in r() if e['domain'] == 'nutzaps'], indent='\t'))"
 *
 * Last generated 2026-10-02 from the nostrology-data working tree.
 */
export const NUTZAPS_ENTRIES: RegistryMetric[] = [
	{
		"key": "nutzaps.active_users@day",
		"domain": "nutzaps",
		"metric": "active_users",
		"grain": "day",
		"unit": "users",
		"output": "sparse",
		"summary": "Counts DISTINCT sender pubkeys with at least one kind-9321 (nutzaps) event in each UTC bucket at the requested grain - daily (DAU), ISO-week (WAU) or calendar-month (MAU) - active users, not event volume.",
		"partition": "The population is the kind-9321 (nutzaps) events in this archive that carry at least one Cashu proof in a `proof` tag, a resolvable mint (`u` tag) and a sender that is not blocklisted (NIP-61 nutzaps: zap payments whose value moves as Cashu ecash inside the event, settled mint-side rather than over Lightning). Events without such a proof - the 2024 draft format with proofs in content, encrypted payloads, bare cashu tokens, events carrying no ecash - are not payments and are not counted, and neither are events missing a usable mint tag. Test and private mints are excluded too: mints on hosts a recipient elsewhere cannot reach (loopback, private-network and other non-public addresses and names) and public test mints reviewed as running a fake Lightning backend or no longer running. Any other mint counts, reviewed or not.",
		"caveats": [
			"Buckets are keyed by their UTC START; a from/to window includes exactly the buckets STARTING inside it - a bucket that began before 'from' is excluded whole even if it overlaps the window, and a bucket starting before 'to' is included whole even if it extends past it.",
			"created_at is sender-declared and unverified, as everywhere in Nostr; a spoofed timestamp lands the sender in the wrong bucket.",
			"The final bucket is still accumulating until the period ends.",
			"The series ends at as_of, and the most recent day or two may be absent rather than empty - a bucket appears once its events are in the archive.",
			"Series is sparse: buckets with zero active users are omitted."
		],
		"methodology": "",
		"as_of_source": "latest kind-9321 (nutzaps) event time",
		"series_type": "event",
		"additive_over_time": false,
		"params": {
			"grain": {
				"values": [
					"day",
					"week",
					"month"
				],
				"default": "month",
				"note": "omit to get the default"
			},
			"window": {
				"accepted": true,
				"from": "optional inclusive ISO UTC calendar day (YYYY-MM-DD); omit for the series start",
				"to": "optional inclusive ISO UTC calendar day (YYYY-MM-DD); omit for today UTC (that day still in progress)"
			},
			"format": [
				"csv",
				"markdown"
			]
		},
		"columns": [
			{
				"name": "period_start",
				"type": "date",
				"description": "UTC start of the bucket",
				"unit": null,
				"third_party": false
			},
			{
				"name": "unique_users",
				"type": "integer",
				"description": "Distinct pubkeys sending a nutzap in that bucket",
				"unit": null,
				"third_party": false
			}
		],
		"price_sats": 21,
		"tool": "nostrology_query_nutzaps"
	},
	{
		"key": "nutzaps.active_users@month",
		"domain": "nutzaps",
		"metric": "active_users",
		"grain": "month",
		"unit": "users",
		"output": "sparse",
		"summary": "Counts DISTINCT sender pubkeys with at least one kind-9321 (nutzaps) event in each UTC bucket at the requested grain - daily (DAU), ISO-week (WAU) or calendar-month (MAU) - active users, not event volume.",
		"partition": "The population is the kind-9321 (nutzaps) events in this archive that carry at least one Cashu proof in a `proof` tag, a resolvable mint (`u` tag) and a sender that is not blocklisted (NIP-61 nutzaps: zap payments whose value moves as Cashu ecash inside the event, settled mint-side rather than over Lightning). Events without such a proof - the 2024 draft format with proofs in content, encrypted payloads, bare cashu tokens, events carrying no ecash - are not payments and are not counted, and neither are events missing a usable mint tag. Test and private mints are excluded too: mints on hosts a recipient elsewhere cannot reach (loopback, private-network and other non-public addresses and names) and public test mints reviewed as running a fake Lightning backend or no longer running. Any other mint counts, reviewed or not.",
		"caveats": [
			"Buckets are keyed by their UTC START; a from/to window includes exactly the buckets STARTING inside it - a bucket that began before 'from' is excluded whole even if it overlaps the window, and a bucket starting before 'to' is included whole even if it extends past it.",
			"created_at is sender-declared and unverified, as everywhere in Nostr; a spoofed timestamp lands the sender in the wrong bucket.",
			"The final bucket is still accumulating until the period ends.",
			"The series ends at as_of, and the most recent day or two may be absent rather than empty - a bucket appears once its events are in the archive.",
			"Series is sparse: buckets with zero active users are omitted."
		],
		"methodology": "",
		"as_of_source": "latest kind-9321 (nutzaps) event time",
		"series_type": "event",
		"additive_over_time": false,
		"params": {
			"grain": {
				"values": [
					"day",
					"week",
					"month"
				],
				"default": "month",
				"note": "omit to get the default"
			},
			"window": {
				"accepted": true,
				"from": "optional inclusive ISO UTC calendar day (YYYY-MM-DD); omit for the series start",
				"to": "optional inclusive ISO UTC calendar day (YYYY-MM-DD); omit for today UTC (that day still in progress)"
			},
			"format": [
				"csv",
				"markdown"
			]
		},
		"columns": [
			{
				"name": "period_start",
				"type": "date",
				"description": "UTC start of the bucket",
				"unit": null,
				"third_party": false
			},
			{
				"name": "unique_users",
				"type": "integer",
				"description": "Distinct pubkeys sending a nutzap in that bucket",
				"unit": null,
				"third_party": false
			}
		],
		"price_sats": 21,
		"tool": "nostrology_query_nutzaps"
	},
	{
		"key": "nutzaps.active_users@week",
		"domain": "nutzaps",
		"metric": "active_users",
		"grain": "week",
		"unit": "users",
		"output": "sparse",
		"summary": "Counts DISTINCT sender pubkeys with at least one kind-9321 (nutzaps) event in each UTC bucket at the requested grain - daily (DAU), ISO-week (WAU) or calendar-month (MAU) - active users, not event volume.",
		"partition": "The population is the kind-9321 (nutzaps) events in this archive that carry at least one Cashu proof in a `proof` tag, a resolvable mint (`u` tag) and a sender that is not blocklisted (NIP-61 nutzaps: zap payments whose value moves as Cashu ecash inside the event, settled mint-side rather than over Lightning). Events without such a proof - the 2024 draft format with proofs in content, encrypted payloads, bare cashu tokens, events carrying no ecash - are not payments and are not counted, and neither are events missing a usable mint tag. Test and private mints are excluded too: mints on hosts a recipient elsewhere cannot reach (loopback, private-network and other non-public addresses and names) and public test mints reviewed as running a fake Lightning backend or no longer running. Any other mint counts, reviewed or not.",
		"caveats": [
			"Buckets are keyed by their UTC START; a from/to window includes exactly the buckets STARTING inside it - a bucket that began before 'from' is excluded whole even if it overlaps the window, and a bucket starting before 'to' is included whole even if it extends past it.",
			"created_at is sender-declared and unverified, as everywhere in Nostr; a spoofed timestamp lands the sender in the wrong bucket.",
			"The final bucket is still accumulating until the period ends.",
			"The series ends at as_of, and the most recent day or two may be absent rather than empty - a bucket appears once its events are in the archive.",
			"Series is sparse: buckets with zero active users are omitted."
		],
		"methodology": "",
		"as_of_source": "latest kind-9321 (nutzaps) event time",
		"series_type": "event",
		"additive_over_time": false,
		"params": {
			"grain": {
				"values": [
					"day",
					"week",
					"month"
				],
				"default": "month",
				"note": "omit to get the default"
			},
			"window": {
				"accepted": true,
				"from": "optional inclusive ISO UTC calendar day (YYYY-MM-DD); omit for the series start",
				"to": "optional inclusive ISO UTC calendar day (YYYY-MM-DD); omit for today UTC (that day still in progress)"
			},
			"format": [
				"csv",
				"markdown"
			]
		},
		"columns": [
			{
				"name": "period_start",
				"type": "date",
				"description": "UTC start of the bucket",
				"unit": null,
				"third_party": false
			},
			{
				"name": "unique_users",
				"type": "integer",
				"description": "Distinct pubkeys sending a nutzap in that bucket",
				"unit": null,
				"third_party": false
			}
		],
		"price_sats": 21,
		"tool": "nostrology_query_nutzaps"
	},
	{
		"key": "nutzaps.mint_active_users@day",
		"domain": "nutzaps",
		"metric": "mint_active_users",
		"grain": "day",
		"unit": "users",
		"output": "sparse",
		"summary": "Active nutzap senders PER MINT: distinct sender pubkeys with at least one payment on the mint in each UTC bucket - day, ISO week (Monday start) or calendar month (the default) - for any window and every mint (mint_url for one). grain=month is the Monthly Active Users chart of each nostrolo.gy/nutzaps/mints page.",
		"partition": "The population is the kind-9321 (nutzaps) PAYMENTS in this archive (NIP-61 (nutzaps): zaps whose value moves as Cashu ecash inside the event) - events carrying at least one Cashu proof in a `proof` tag, valued as the sum of those proofs in sats (never the `amount` tag, which was often millisats). Events without such a proof (the 2024 draft format, encrypted payloads, bare cashu tokens, zero-ecash events) are not payments. Test and private mints are excluded: hosts a recipient elsewhere cannot reach (loopback, private-network and other non-public names) and public test mints reviewed as running a fake Lightning backend or no longer running; any other mint counts, reviewed or not. A mint_url filter narrows within this population, so an excluded mint returns no rows. This is exactly the population nostrolo.gy/nutzaps draws.",
		"caveats": [
			"Distinct-sender counts are not additive: summing buckets does not give a longer period's count, and summing mints over-counts senders who use more than one mint. The network-wide active-user count (DAU/WAU/MAU across all mints) is the PAID nutzaps.active_users on the nostrology_query_nutzaps tool.",
			"Buckets are UTC: a day is a UTC calendar day, a week runs from Monday 00:00 UTC (ISO weeks, keyed by the Monday) and a month from the 1st. A from/to window includes exactly the buckets STARTING inside it, each whole - a week or month that began before 'from' is excluded even if it overlaps the window, and one starting before 'to' is included even if it extends past it.",
			"Each /nutzaps/mints page charts the month grain over the trailing 365 days on a TIMESTAMP cutoff, so its oldest month is partial; compare from the month after it.",
			"The series ends at as_of: the most recent bucket may be absent rather than empty (a bucket appears once its events are in the archive), and the final bucket is still accumulating until it ends.",
			"The mint_url column is the mint's normalized URL (lowercase scheme and host, no default port, no trailing slash, PATH CASE KEPT - https://mint.minibits.cash/Bitcoin and /bitcoin are different mints); it is what the mint_url filter takes, and it is third-party text copied from the senders' `u` tags.",
			"The event time (created_at) is sender-declared and unverified, as everywhere in Nostr; days are UTC calendar days of it.",
			"Responses are capped at 2,000 rows with an explicit truncated: line; pass from/to or mint_url to keep a response small. Series is sparse: a (bucket, mint) row exists only where the mint had a sender."
		],
		"methodology": "",
		"as_of_source": "latest kind-9321 (nutzaps) event time",
		"series_type": "event",
		"additive_over_time": false,
		"params": {
			"grain": {
				"values": [
					"day",
					"week",
					"month"
				],
				"default": "month",
				"note": "omit to get the default"
			},
			"window": {
				"accepted": true,
				"from": "optional inclusive ISO UTC calendar day (YYYY-MM-DD); omit for the series start",
				"to": "optional inclusive ISO UTC calendar day (YYYY-MM-DD); omit for today UTC (that day still in progress)"
			},
			"entity_filters": {
				"mint_url": "optional Cashu mint URL as nutzaps.mint_leaderboard lists it (e.g. https://mint.minibits.cash/Bitcoin); narrows rows to that mint. Scheme and host case, a default port and a trailing slash are normalized and a URL with no scheme is read as https, but the PATH is case-sensitive; an excluded (test or private) mint returns no rows"
			},
			"format": [
				"csv",
				"markdown"
			]
		},
		"columns": [
			{
				"name": "period_start",
				"type": "date",
				"description": "UTC start of the bucket - the day itself (grain=day), the Monday of the ISO week (week) or the 1st of the month (month)",
				"unit": null,
				"third_party": false
			},
			{
				"name": "mint_url",
				"type": "text",
				"description": "the mint's normalized URL - the value the mint_url filter takes",
				"unit": null,
				"third_party": true
			},
			{
				"name": "active_users",
				"type": "integer",
				"description": "distinct sender pubkeys with a payment on this mint in the bucket",
				"unit": "users",
				"third_party": false
			}
		]
	},
	{
		"key": "nutzaps.mint_active_users@month",
		"domain": "nutzaps",
		"metric": "mint_active_users",
		"grain": "month",
		"unit": "users",
		"output": "sparse",
		"summary": "Active nutzap senders PER MINT: distinct sender pubkeys with at least one payment on the mint in each UTC bucket - day, ISO week (Monday start) or calendar month (the default) - for any window and every mint (mint_url for one). grain=month is the Monthly Active Users chart of each nostrolo.gy/nutzaps/mints page.",
		"partition": "The population is the kind-9321 (nutzaps) PAYMENTS in this archive (NIP-61 (nutzaps): zaps whose value moves as Cashu ecash inside the event) - events carrying at least one Cashu proof in a `proof` tag, valued as the sum of those proofs in sats (never the `amount` tag, which was often millisats). Events without such a proof (the 2024 draft format, encrypted payloads, bare cashu tokens, zero-ecash events) are not payments. Test and private mints are excluded: hosts a recipient elsewhere cannot reach (loopback, private-network and other non-public names) and public test mints reviewed as running a fake Lightning backend or no longer running; any other mint counts, reviewed or not. A mint_url filter narrows within this population, so an excluded mint returns no rows. This is exactly the population nostrolo.gy/nutzaps draws.",
		"caveats": [
			"Distinct-sender counts are not additive: summing buckets does not give a longer period's count, and summing mints over-counts senders who use more than one mint. The network-wide active-user count (DAU/WAU/MAU across all mints) is the PAID nutzaps.active_users on the nostrology_query_nutzaps tool.",
			"Buckets are UTC: a day is a UTC calendar day, a week runs from Monday 00:00 UTC (ISO weeks, keyed by the Monday) and a month from the 1st. A from/to window includes exactly the buckets STARTING inside it, each whole - a week or month that began before 'from' is excluded even if it overlaps the window, and one starting before 'to' is included even if it extends past it.",
			"Each /nutzaps/mints page charts the month grain over the trailing 365 days on a TIMESTAMP cutoff, so its oldest month is partial; compare from the month after it.",
			"The series ends at as_of: the most recent bucket may be absent rather than empty (a bucket appears once its events are in the archive), and the final bucket is still accumulating until it ends.",
			"The mint_url column is the mint's normalized URL (lowercase scheme and host, no default port, no trailing slash, PATH CASE KEPT - https://mint.minibits.cash/Bitcoin and /bitcoin are different mints); it is what the mint_url filter takes, and it is third-party text copied from the senders' `u` tags.",
			"The event time (created_at) is sender-declared and unverified, as everywhere in Nostr; days are UTC calendar days of it.",
			"Responses are capped at 2,000 rows with an explicit truncated: line; pass from/to or mint_url to keep a response small. Series is sparse: a (bucket, mint) row exists only where the mint had a sender."
		],
		"methodology": "",
		"as_of_source": "latest kind-9321 (nutzaps) event time",
		"series_type": "event",
		"additive_over_time": false,
		"params": {
			"grain": {
				"values": [
					"day",
					"week",
					"month"
				],
				"default": "month",
				"note": "omit to get the default"
			},
			"window": {
				"accepted": true,
				"from": "optional inclusive ISO UTC calendar day (YYYY-MM-DD); omit for the series start",
				"to": "optional inclusive ISO UTC calendar day (YYYY-MM-DD); omit for today UTC (that day still in progress)"
			},
			"entity_filters": {
				"mint_url": "optional Cashu mint URL as nutzaps.mint_leaderboard lists it (e.g. https://mint.minibits.cash/Bitcoin); narrows rows to that mint. Scheme and host case, a default port and a trailing slash are normalized and a URL with no scheme is read as https, but the PATH is case-sensitive; an excluded (test or private) mint returns no rows"
			},
			"format": [
				"csv",
				"markdown"
			]
		},
		"columns": [
			{
				"name": "period_start",
				"type": "date",
				"description": "UTC start of the bucket - the day itself (grain=day), the Monday of the ISO week (week) or the 1st of the month (month)",
				"unit": null,
				"third_party": false
			},
			{
				"name": "mint_url",
				"type": "text",
				"description": "the mint's normalized URL - the value the mint_url filter takes",
				"unit": null,
				"third_party": true
			},
			{
				"name": "active_users",
				"type": "integer",
				"description": "distinct sender pubkeys with a payment on this mint in the bucket",
				"unit": "users",
				"third_party": false
			}
		]
	},
	{
		"key": "nutzaps.mint_active_users@week",
		"domain": "nutzaps",
		"metric": "mint_active_users",
		"grain": "week",
		"unit": "users",
		"output": "sparse",
		"summary": "Active nutzap senders PER MINT: distinct sender pubkeys with at least one payment on the mint in each UTC bucket - day, ISO week (Monday start) or calendar month (the default) - for any window and every mint (mint_url for one). grain=month is the Monthly Active Users chart of each nostrolo.gy/nutzaps/mints page.",
		"partition": "The population is the kind-9321 (nutzaps) PAYMENTS in this archive (NIP-61 (nutzaps): zaps whose value moves as Cashu ecash inside the event) - events carrying at least one Cashu proof in a `proof` tag, valued as the sum of those proofs in sats (never the `amount` tag, which was often millisats). Events without such a proof (the 2024 draft format, encrypted payloads, bare cashu tokens, zero-ecash events) are not payments. Test and private mints are excluded: hosts a recipient elsewhere cannot reach (loopback, private-network and other non-public names) and public test mints reviewed as running a fake Lightning backend or no longer running; any other mint counts, reviewed or not. A mint_url filter narrows within this population, so an excluded mint returns no rows. This is exactly the population nostrolo.gy/nutzaps draws.",
		"caveats": [
			"Distinct-sender counts are not additive: summing buckets does not give a longer period's count, and summing mints over-counts senders who use more than one mint. The network-wide active-user count (DAU/WAU/MAU across all mints) is the PAID nutzaps.active_users on the nostrology_query_nutzaps tool.",
			"Buckets are UTC: a day is a UTC calendar day, a week runs from Monday 00:00 UTC (ISO weeks, keyed by the Monday) and a month from the 1st. A from/to window includes exactly the buckets STARTING inside it, each whole - a week or month that began before 'from' is excluded even if it overlaps the window, and one starting before 'to' is included even if it extends past it.",
			"Each /nutzaps/mints page charts the month grain over the trailing 365 days on a TIMESTAMP cutoff, so its oldest month is partial; compare from the month after it.",
			"The series ends at as_of: the most recent bucket may be absent rather than empty (a bucket appears once its events are in the archive), and the final bucket is still accumulating until it ends.",
			"The mint_url column is the mint's normalized URL (lowercase scheme and host, no default port, no trailing slash, PATH CASE KEPT - https://mint.minibits.cash/Bitcoin and /bitcoin are different mints); it is what the mint_url filter takes, and it is third-party text copied from the senders' `u` tags.",
			"The event time (created_at) is sender-declared and unverified, as everywhere in Nostr; days are UTC calendar days of it.",
			"Responses are capped at 2,000 rows with an explicit truncated: line; pass from/to or mint_url to keep a response small. Series is sparse: a (bucket, mint) row exists only where the mint had a sender."
		],
		"methodology": "",
		"as_of_source": "latest kind-9321 (nutzaps) event time",
		"series_type": "event",
		"additive_over_time": false,
		"params": {
			"grain": {
				"values": [
					"day",
					"week",
					"month"
				],
				"default": "month",
				"note": "omit to get the default"
			},
			"window": {
				"accepted": true,
				"from": "optional inclusive ISO UTC calendar day (YYYY-MM-DD); omit for the series start",
				"to": "optional inclusive ISO UTC calendar day (YYYY-MM-DD); omit for today UTC (that day still in progress)"
			},
			"entity_filters": {
				"mint_url": "optional Cashu mint URL as nutzaps.mint_leaderboard lists it (e.g. https://mint.minibits.cash/Bitcoin); narrows rows to that mint. Scheme and host case, a default port and a trailing slash are normalized and a URL with no scheme is read as https, but the PATH is case-sensitive; an excluded (test or private) mint returns no rows"
			},
			"format": [
				"csv",
				"markdown"
			]
		},
		"columns": [
			{
				"name": "period_start",
				"type": "date",
				"description": "UTC start of the bucket - the day itself (grain=day), the Monday of the ISO week (week) or the 1st of the month (month)",
				"unit": null,
				"third_party": false
			},
			{
				"name": "mint_url",
				"type": "text",
				"description": "the mint's normalized URL - the value the mint_url filter takes",
				"unit": null,
				"third_party": true
			},
			{
				"name": "active_users",
				"type": "integer",
				"description": "distinct sender pubkeys with a payment on this mint in the bucket",
				"unit": "users",
				"third_party": false
			}
		]
	},
	{
		"key": "nutzaps.mint_activity@day",
		"domain": "nutzaps",
		"metric": "mint_activity",
		"grain": "day",
		"unit": "payments+sats",
		"output": "sparse",
		"summary": "Nutzap payments and sats per (UTC day, mint) - the per-mint daily ledger behind the 'Cumulative sats by mint' chart of nostrolo.gy/nutzaps/mints (that chart = the top mints by sats over the window, from nutzaps.mint_leaderboard, each with the running sum of its sats here).",
		"partition": "The population is the kind-9321 (nutzaps) PAYMENTS in this archive (NIP-61 (nutzaps): zaps whose value moves as Cashu ecash inside the event) - events carrying at least one Cashu proof in a `proof` tag, valued as the sum of those proofs in sats (never the `amount` tag, which was often millisats). Events without such a proof (the 2024 draft format, encrypted payloads, bare cashu tokens, zero-ecash events) are not payments. Test and private mints are excluded: hosts a recipient elsewhere cannot reach (loopback, private-network and other non-public names) and public test mints reviewed as running a fake Lightning backend or no longer running; any other mint counts, reviewed or not. A mint_url filter narrows within this population, so an excluded mint returns no rows. This is exactly the population nostrolo.gy/nutzaps draws.",
		"caveats": [
			"Responses are capped at 2,000 rows with an explicit truncated: line; pass from/to or mint_url to keep a response small.",
			"The page's charts cover the trailing 365 days on a TIMESTAMP cutoff, so their oldest day (or month) is partial; compare from the day after it.",
			"The mint_url column is the mint's normalized URL (lowercase scheme and host, no default port, no trailing slash, PATH CASE KEPT - https://mint.minibits.cash/Bitcoin and /bitcoin are different mints); it is what the mint_url filter takes, and it is third-party text copied from the senders' `u` tags.",
			"Values are sats, not millisats: the proof amounts summed as sats. Every keyset behind them that could still be resolved is a sat keyset; some mints no longer serve theirs, so a unit is inferred there, never read.",
			"The event time (created_at) is sender-declared and unverified, as everywhere in Nostr; days are UTC calendar days of it.",
			"The series ends at as_of, and the most recent day may be absent rather than empty - a day appears once its events are in the archive; with no 'to', the final day is still accumulating.",
			"For each day the rows sum to nutzaps.payment_activity@day. Series is sparse: a (day, mint) row exists only where that mint carried a payment that day."
		],
		"methodology": "",
		"as_of_source": "latest kind-9321 (nutzaps) event time",
		"series_type": "event",
		"additive_over_time": true,
		"params": {
			"grain": {
				"values": [
					"day"
				],
				"default": "day",
				"note": "omit to get the default"
			},
			"window": {
				"accepted": true,
				"from": "optional inclusive ISO UTC calendar day (YYYY-MM-DD); omit for the series start",
				"to": "optional inclusive ISO UTC calendar day (YYYY-MM-DD); omit for today UTC (that day still in progress)"
			},
			"entity_filters": {
				"mint_url": "optional Cashu mint URL as nutzaps.mint_leaderboard lists it (e.g. https://mint.minibits.cash/Bitcoin); narrows rows to that mint. Scheme and host case, a default port and a trailing slash are normalized and a URL with no scheme is read as https, but the PATH is case-sensitive; an excluded (test or private) mint returns no rows"
			},
			"format": [
				"csv",
				"markdown"
			]
		},
		"columns": [
			{
				"name": "utc_day",
				"type": "date",
				"description": "UTC calendar day",
				"unit": null,
				"third_party": false
			},
			{
				"name": "mint_url",
				"type": "text",
				"description": "the mint's normalized URL - the value the mint_url filter takes",
				"unit": null,
				"third_party": true
			},
			{
				"name": "payments",
				"type": "integer",
				"description": "payments on this mint that day",
				"unit": "payments",
				"third_party": false
			},
			{
				"name": "sats",
				"type": "integer",
				"description": "sats those payments carried",
				"unit": "sats",
				"third_party": false
			}
		]
	},
	{
		"key": "nutzaps.mint_leaderboard@total",
		"domain": "nutzaps",
		"metric": "mint_leaderboard",
		"grain": "total",
		"unit": "payments+sats+users",
		"output": "entities",
		"summary": "The nutzap mint leaderboard of nostrolo.gy/nutzaps/mints, for any window: one row per listed mint with its payments and sats in the from/to window and its Configured By count - omit from/to for the page's All view, pass mint_url for one mint's headline figures (its /nutzaps/mints page).",
		"partition": "The population is the kind-9321 (nutzaps) PAYMENTS in this archive (NIP-61 (nutzaps): zaps whose value moves as Cashu ecash inside the event) - events carrying at least one Cashu proof in a `proof` tag, valued as the sum of those proofs in sats (never the `amount` tag, which was often millisats). Events without such a proof (the 2024 draft format, encrypted payloads, bare cashu tokens, zero-ecash events) are not payments. Test and private mints are excluded: hosts a recipient elsewhere cannot reach (loopback, private-network and other non-public names) and public test mints reviewed as running a fake Lightning backend or no longer running; any other mint counts, reviewed or not. A mint_url filter narrows within this population, so an excluded mint returns no rows. This is exactly the population nostrolo.gy/nutzaps draws. A mint is listed when it has a payment in the window, or - with no window - at least 10 users configure it (the page's All floor against single-typo mints), or - with a window - at least one does. Excluded mints are never listed.",
		"caveats": [
			"The configured_by column counts ANNOUNCEMENTS, not usage: a pubkey counts when its latest kind-10019 (nutzap-configs) event lists the mint. A from/to window keeps only the pubkeys whose latest config was published inside it - the page's 7d / 30d / 1y reading ('configured by users who (re)published their config recently') - so it is not a historical snapshot of who configured the mint back then.",
			"With no from/to it reproduces the page's All view exactly as the page shows it with 'Include 0-sat mints' on; by default the page hides the mints with no sats, which this tool lists. The page's 7d / 30d / 1y periods are ROLLING (now minus N x 24 h); from/to here are whole UTC days, so a window matches them only up to the partial first day.",
			"Ordered by sats, payments and configured_by (all descending), then mint_url. Rows summed over mints give nutzaps.payment_activity@total for payments and sats. Distinct senders per mint are in nutzaps.mint_active_users, by day, week or month.",
			"The mint_url column is the mint's normalized URL (lowercase scheme and host, no default port, no trailing slash, PATH CASE KEPT - https://mint.minibits.cash/Bitcoin and /bitcoin are different mints); it is what the mint_url filter takes, and it is third-party text copied from the senders' `u` tags.",
			"Values are sats, not millisats: the proof amounts summed as sats. Every keyset behind them that could still be resolved is a sat keyset; some mints no longer serve theirs, so a unit is inferred there, never read.",
			"The event time (created_at) is sender-declared and unverified, as everywhere in Nostr; days are UTC calendar days of it."
		],
		"methodology": "",
		"as_of_source": "latest kind-9321 (nutzaps) event time",
		"series_type": "event",
		"additive_over_time": false,
		"params": {
			"grain": {
				"values": [
					"total"
				],
				"default": "total",
				"note": "omit to get the default"
			},
			"window": {
				"accepted": true,
				"from": "optional inclusive ISO UTC calendar day (YYYY-MM-DD); omit for the series start",
				"to": "optional inclusive ISO UTC calendar day (YYYY-MM-DD); omit for today UTC (that day still in progress)"
			},
			"entity_filters": {
				"mint_url": "optional Cashu mint URL as nutzaps.mint_leaderboard lists it (e.g. https://mint.minibits.cash/Bitcoin); narrows rows to that mint. Scheme and host case, a default port and a trailing slash are normalized and a URL with no scheme is read as https, but the PATH is case-sensitive; an excluded (test or private) mint returns no rows"
			},
			"format": [
				"csv",
				"markdown"
			]
		},
		"columns": [
			{
				"name": "mint_url",
				"type": "text",
				"description": "the mint's normalized URL - the value the mint_url filter takes",
				"unit": null,
				"third_party": true
			},
			{
				"name": "payments",
				"type": "integer",
				"description": "payments on this mint in the window",
				"unit": "payments",
				"third_party": false
			},
			{
				"name": "sats",
				"type": "integer",
				"description": "sats those payments carried",
				"unit": "sats",
				"third_party": false
			},
			{
				"name": "configured_by",
				"type": "integer",
				"description": "distinct pubkeys whose LATEST kind-10019 (nutzap-configs) lists this mint; with a window, only those whose latest config was published inside it",
				"unit": "users",
				"third_party": false
			}
		]
	},
	{
		"key": "nutzaps.payment_activity@day",
		"domain": "nutzaps",
		"metric": "payment_activity",
		"grain": "day",
		"unit": "payments+sats",
		"output": "sparse",
		"summary": "Nutzap payments and the sats they carried, across all counted mints or one (mint_url) - at grain=day one row per UTC day (the Nutzap Payments and Nutzap Sats charts on nostrolo.gy/nutzaps, and the daily charts of each /nutzaps/mints page with mint_url), at grain=total one row for the whole from/to window.",
		"partition": "The population is the kind-9321 (nutzaps) PAYMENTS in this archive (NIP-61 (nutzaps): zaps whose value moves as Cashu ecash inside the event) - events carrying at least one Cashu proof in a `proof` tag, valued as the sum of those proofs in sats (never the `amount` tag, which was often millisats). Events without such a proof (the 2024 draft format, encrypted payloads, bare cashu tokens, zero-ecash events) are not payments. Test and private mints are excluded: hosts a recipient elsewhere cannot reach (loopback, private-network and other non-public names) and public test mints reviewed as running a fake Lightning backend or no longer running; any other mint counts, reviewed or not. A mint_url filter narrows within this population, so an excluded mint returns no rows. This is exactly the population nostrolo.gy/nutzaps draws.",
		"caveats": [
			"The page's charts cover the trailing 365 days on a TIMESTAMP cutoff, so their oldest day (or month) is partial; compare from the day after it.",
			"Values are sats, not millisats: the proof amounts summed as sats. Every keyset behind them that could still be resolved is a sat keyset; some mints no longer serve theirs, so a unit is inferred there, never read.",
			"The event time (created_at) is sender-declared and unverified, as everywhere in Nostr; days are UTC calendar days of it.",
			"The series ends at as_of, and the most recent day may be absent rather than empty - a day appears once its events are in the archive; with no 'to', the final day is still accumulating.",
			"The page's cumulative lines are the running sums of these columns from the window's first day. Series is sparse: days with no payment are omitted."
		],
		"methodology": "",
		"as_of_source": "latest kind-9321 (nutzaps) event time",
		"series_type": "event",
		"additive_over_time": true,
		"params": {
			"grain": {
				"values": [
					"day",
					"total"
				],
				"default": "day",
				"note": "omit to get the default"
			},
			"window": {
				"accepted": true,
				"from": "optional inclusive ISO UTC calendar day (YYYY-MM-DD); omit for the series start",
				"to": "optional inclusive ISO UTC calendar day (YYYY-MM-DD); omit for today UTC (that day still in progress)"
			},
			"entity_filters": {
				"mint_url": "optional Cashu mint URL as nutzaps.mint_leaderboard lists it (e.g. https://mint.minibits.cash/Bitcoin); narrows rows to that mint. Scheme and host case, a default port and a trailing slash are normalized and a URL with no scheme is read as https, but the PATH is case-sensitive; an excluded (test or private) mint returns no rows"
			},
			"format": [
				"csv",
				"markdown"
			]
		},
		"columns": [
			{
				"name": "utc_day",
				"type": "date",
				"description": "UTC calendar day",
				"unit": null,
				"third_party": false
			},
			{
				"name": "payments",
				"type": "integer",
				"description": "kind-9321 (nutzaps) payments - per day at grain=day, over the window at grain=total",
				"unit": "payments",
				"third_party": false
			},
			{
				"name": "sats",
				"type": "integer",
				"description": "sats those payments carried (sum of their Cashu proofs) - per day at grain=day, over the window at grain=total",
				"unit": "sats",
				"third_party": false
			}
		]
	},
	{
		"key": "nutzaps.payment_activity@total",
		"domain": "nutzaps",
		"metric": "payment_activity",
		"grain": "total",
		"unit": "payments+sats",
		"output": "entities",
		"summary": "Nutzap payments and the sats they carried, across all counted mints or one (mint_url) - at grain=day one row per UTC day (the Nutzap Payments and Nutzap Sats charts on nostrolo.gy/nutzaps, and the daily charts of each /nutzaps/mints page with mint_url), at grain=total one row for the whole from/to window.",
		"partition": "The population is the kind-9321 (nutzaps) PAYMENTS in this archive (NIP-61 (nutzaps): zaps whose value moves as Cashu ecash inside the event) - events carrying at least one Cashu proof in a `proof` tag, valued as the sum of those proofs in sats (never the `amount` tag, which was often millisats). Events without such a proof (the 2024 draft format, encrypted payloads, bare cashu tokens, zero-ecash events) are not payments. Test and private mints are excluded: hosts a recipient elsewhere cannot reach (loopback, private-network and other non-public names) and public test mints reviewed as running a fake Lightning backend or no longer running; any other mint counts, reviewed or not. A mint_url filter narrows within this population, so an excluded mint returns no rows. This is exactly the population nostrolo.gy/nutzaps draws.",
		"caveats": [
			"This grain always returns exactly one row - zeros and NULL days when the window holds no payment. Its payments and sats equal the sum of the grain=day rows over the same window, and of nutzaps.mint_leaderboard's rows; its mints equals the number of those leaderboard rows with a payment.",
			"Across separate windows only payments and sats add up: mints is a distinct count (a mint paid through in both windows counts once over the two), and first_day and last_day combine as the earlier and the later - hence additive_over_time: false. For a longer period, call again with the longer window.",
			"Values are sats, not millisats: the proof amounts summed as sats. Every keyset behind them that could still be resolved is a sat keyset; some mints no longer serve theirs, so a unit is inferred there, never read.",
			"The event time (created_at) is sender-declared and unverified, as everywhere in Nostr; days are UTC calendar days of it.",
			"The total covers the events in the archive at as_of; with no 'to', today is still accumulating."
		],
		"methodology": "",
		"as_of_source": "latest kind-9321 (nutzaps) event time",
		"series_type": "event",
		"additive_over_time": false,
		"params": {
			"grain": {
				"values": [
					"day",
					"total"
				],
				"default": "day",
				"note": "omit to get the default"
			},
			"window": {
				"accepted": true,
				"from": "optional inclusive ISO UTC calendar day (YYYY-MM-DD); omit for the series start",
				"to": "optional inclusive ISO UTC calendar day (YYYY-MM-DD); omit for today UTC (that day still in progress)"
			},
			"entity_filters": {
				"mint_url": "optional Cashu mint URL as nutzaps.mint_leaderboard lists it (e.g. https://mint.minibits.cash/Bitcoin); narrows rows to that mint. Scheme and host case, a default port and a trailing slash are normalized and a URL with no scheme is read as https, but the PATH is case-sensitive; an excluded (test or private) mint returns no rows"
			},
			"format": [
				"csv",
				"markdown"
			]
		},
		"columns": [
			{
				"name": "payments",
				"type": "integer",
				"description": "kind-9321 (nutzaps) payments - per day at grain=day, over the window at grain=total",
				"unit": "payments",
				"third_party": false
			},
			{
				"name": "sats",
				"type": "integer",
				"description": "sats those payments carried (sum of their Cashu proofs) - per day at grain=day, over the window at grain=total",
				"unit": "sats",
				"third_party": false
			},
			{
				"name": "mints",
				"type": "integer",
				"description": "distinct mints with at least one payment in the window - a distinct count, so it does not add across windows",
				"unit": "mints",
				"third_party": false
			},
			{
				"name": "first_day",
				"type": "date",
				"description": "first UTC day with a payment in the window (NULL when there is none)",
				"unit": null,
				"third_party": false
			},
			{
				"name": "last_day",
				"type": "date",
				"description": "last UTC day with a payment in the window (NULL when there is none)",
				"unit": null,
				"third_party": false
			}
		]
	}
];

/** The PAID entries - all THREE grains of active_users, as production
 * serves them. A one-grain fixture with a hand-written summary was worse than no
 * fixture: it could not exhibit the bug it was meant to guard (the catalog collapses a
 * multi-grain metric to its DEFAULT grain's entry, so a grain-specific summary or
 * column description reaches every reader as if it described the metric), and it made
 * the paid metric look simpler than it is. Registry order: sorted by key, so day,
 * month, week - NOT default-first; the grouping helper has to find the default (month)
 * rather than take the first. */
export const PAID_METRICS: RegistryMetric[] = NUTZAPS_ENTRIES.filter((m) => m.price_sats != null);

/** The default-grain entry, for tests that render one metric page. */
export const PAID_METRIC: RegistryMetric = PAID_METRICS.find((m) => m.grain === 'month')!;

/** The FREE nutzaps metrics (2026-09-30, nostrology-data
 * docs/design/nutzaps-mcp-design.md): the third domain of the free metrics tool,
 * sharing the `nutzaps` domain with the paid active_users. They carry NO price_sats
 * and NO tool - their tool is the payload-level `tools.metrics`, called with
 * `domain: "nutzaps"` - and every one takes the `mint_url` entity filter.
 * mint_active_users is served at day, week and month (month the default): withdrawn
 * to month on the 2026-09-30 review, day and week were made free by the operator the
 * same evening. */
export const NUTZAPS_FREE_METRICS: RegistryMetric[] = NUTZAPS_ENTRIES.filter(
	(m) => m.price_sats == null
);

/** The mint_url filter's usage note, as the registry serves it. */
export const MINT_URL_NOTE: string =
	NUTZAPS_FREE_METRICS[0]?.params?.entity_filters?.mint_url ?? '';

/** Reference records, the second tool's half of the catalog. Two, deliberately:
 * one that shares a domain with the metrics (so the listing renders BOTH grids
 * under one selection), and one whose domain has no metrics at all.
 *
 * That second one is the load-bearing fixture. A reference-only domain must
 * appear in the pills and must not 404 at /data/<domain> - domainsOf unions the
 * two sets precisely so it does not become an orphan page - and with
 * `reference: []` here, as it was, nothing in these suites crossed that seam. */
function record(over: Partial<RegistryRecord> & Pick<RegistryRecord, 'domain' | 'record'>): RegistryRecord {
	return {
		key: `${over.domain}.${over.record}`,
		row_unit: `one row per ${over.record}`,
		summary: `summary of ${over.record}`,
		partition: '',
		caveats: [],
		methodology: '',
		as_of_source: '',
		params: {
			window: { accepted: false, reason: 'current-state snapshot' },
			format: ['csv', 'markdown'],
			row_cap: 1000
		},
		columns: [],
		...over
	};
}

export const RECORDS: RegistryRecord[] = [
	// Snapshot -> the grid labels it "current state".
	record({ domain: 'zapstore', record: 'app_catalog', snapshot_note: 'current catalog entry' }),
	// No snapshot_note -> "event listing". And `relays` has NO metrics: it exists
	// in this fixture only as a reference-only domain.
	record({ domain: 'relays', record: 'relay_profile' })
];

export const REGISTRY: RegistryPayload = {
	v: 2,
	server: { name: 'nostrology_mcp', version: '0.1.0', git_sha: 'deadbee' },
	tool: 'nostrology_query_metric',
	tools: {
		metrics: 'nostrology_query_metric',
		reference: 'nostrology_query_reference',
		nutzaps: 'nostrology_query_nutzaps'
	},
	metrics: [...METRICS, ...PAID_METRICS, ...NUTZAPS_FREE_METRICS, ...ROUTSTR_METRICS],
	reference: RECORDS
};
