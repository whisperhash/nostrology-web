export type NutzapMintStatsPeriod = 'all' | '7d' | '30d' | '1y';

export interface AppLeaderboardRow {
	app_pubkey: string;
	app_d_tag: string;
	display_name: string;
	icon_url: string | null;
	total_count: number;
	total_sats: number;
}

export type ZapstoreAppLeaderboards = {
	'7d': AppLeaderboardRow[];
	'30d': AppLeaderboardRow[];
	'90d': AppLeaderboardRow[];
	'6m': AppLeaderboardRow[];
	'1y': AppLeaderboardRow[];
	all: AppLeaderboardRow[];
};

export interface AppStackLeaderboardRow {
	app_pubkey: string;
	app_d_tag: string;
	display_name: string;
	icon_url: string | null;
	stack_count: number;
	stack_names: string[];
}

// App-stack appearances are surfaced all-time only: kind-30267 (zapstore-app-stacks) is
// parameterized-replaceable, so we keep just the latest revision per
// (pubkey, d_tag) and `created_at` is "last edited", not an activity signal.
// A trailing window would mean "stacks last edited in this window", which is
// not meaningful - so `all` is the only honest, populated metric. The 7d/30d/1y
// keys remain part of the type (the backend window machinery is preserved) but
// are not computed on page load; treat them as optional.
export type AppStackPeriod = '7d' | '30d' | '1y' | 'all';
export type ZapstoreAppStackLeaderboards = Partial<
	Record<Exclude<AppStackPeriod, 'all'>, AppStackLeaderboardRow[]>
> & {
	all: AppStackLeaderboardRow[];
};

export interface ZapstoreAppListRow {
	app_pubkey: string;
	app_d_tag: string;
	app_name: string;
	publisher_pubkey: string;
	publisher_name: string | null;
	summary: string | null;
	icon_url: string | null;
	// The catalog's `url` and `repository`, each a safe absolute http(s) URL or null:
	// getZapstoreAllApps passes both through sanitizeExternalUrl before /zapstore/apps links them.
	app_url: string | null;
	repo_url: string | null;
	first_release_at: number;
	first_release_is_release_event: boolean;
	is_zapstore_republished: boolean;
}

interface PublisherRowBase {
	pubkey: string;
	display_name: string;
	picture_url: string | null;
}

export interface PublisherAppCount extends PublisherRowBase {
	app_count: number;
}

export interface PublisherZapTotals extends PublisherRowBase {
	total_count: number;
	total_sats: number;
}

export type ZapstorePublisherZapsLeaderboards = {
	'7d': PublisherZapTotals[];
	'30d': PublisherZapTotals[];
	'90d': PublisherZapTotals[];
	'6m': PublisherZapTotals[];
	'1y': PublisherZapTotals[];
	all: PublisherZapTotals[];
};

export interface LightningProviderStat {
	domain: string;
	user_count: number;
}

export interface LightningTrendsRow {
	day: string;
	provider: string;
	value: number;
}

export interface RelayStat {
	relay_url: string;
	user_count: number;
	read_count: number;
	write_count: number;
	both_count: number;
}

// The /marketplaces snapshot document - one marketplaces_snapshot JSONB row, produced by
// nostrology-data's marketplaces_refresh job (pipeline/marketplaces.py) and served whole:
// the page renders nothing that is not in here. The shape is the contract between the
// pipeline's build_snapshot() and +page.svelte; the independent cross-check generator
// (nostrology-data's crosscheck/build_markets_snapshot.py) emits the identical shape.
export interface MarketsSnapshotSummary {
	archive_events: number;
	current_coordinates: number;
	active_listings: number;
	sellers: number;
	added_30d: number;
	active_90d: number;
	sellers_90d: number;
	countries: number;
	first_listing: string;
	last_listing: string;
	withdrawn_any: number;
	deleted_any: number;
}

export interface MarketsSnapshot {
	generated_utc: string;
	summary: MarketsSnapshotSummary;
	exclusions: { k: string; v: number; why: string }[];
	cum_sellers: { d: string; v: number }[];
	cum_listings: { d: string; v: number }[];
	new_monthly: { m: string; v: number; s: number }[];
	/** The month the run falls in (generated_utc's): the bucket still filling, and the last
	 * new_monthly row - absent while nothing is dated in it. Nothing is dated after the run
	 * (nostrology-data, since 2026-10-08), so no month follows it; until that
	 * day a listing dated past the month's end could, and this was the newest listing's month. */
	partial_month: string;
	categories: { cat: string; listings: number; sellers: number }[];
	categories_coverage: { with_tag: number; total: number; distinct_tags: number; min_sellers: number };
	currency: { cur: string; listings: number; sellers: number }[];
	currency_coverage: { priced: number; total: number };
	countries: { cc: string; name: string; listings: number; sellers: number }[];
	seller_countries: { cc: string; name: string; sellers: number }[];
	seller_geo_coverage: { placed: number; total: number };
	geo_nonattr: Record<string, { listings: number; sellers: number }>;
	geo_attributable: number;
	map_points: {
		lat: number;
		lon: number;
		cc: string;
		name: string;
		prec: string;
		listings: number;
		sellers: number;
	}[];
	shipping: {
		cc: string;
		name: string;
		options: number;
		sellers: number;
		lat: number;
		lon: number;
	}[];
	shipping_coverage: { options_total: number; with_country: number; sellers: number };
	clients: { client: string; listings: number; sellers: number }[];
}

/**
 * One row of /marketplaces' Recent listings table. NOT part of the snapshot document:
 * these come from `marketplaces_listings`, the per-coordinate table the same refresh
 * writes in the same transaction (SQL_MARKETPLACES_RECENT), so the table and the page's
 * figures are always the same run's. Reading a second table of that job is the shape
 * /git already uses for its Stars and Zaps lists.
 *
 * Every text field is third-party: a seller wrote it. The page puts each through
 * visibleText() and isolates it with <bdi>; nothing here is trusted.
 */
export interface MarketsRecentListing {
	/** Seller's pubkey, 64-hex. With `d_tag` it is the listing's coordinate. */
	pubkey: string;
	/** The listing's `d` identifier. The empty string is a legal identifier. */
	d_tag: string;
	/** The newest version's event id, where the table carries it: Plebeian Market
	 * addresses a listing by id, so a row without one cannot rotate onto that marketplace. */
	event_id: string | null;
	/** The listing's effective date, unix seconds: a plausible `published_at`, else
	 * `created_at`, never after the run - the same date the Growth charts count it on. */
	effective_ts: number;
	/** The title LOWERCASED, which is how the pipeline stores it: it is folded for the farm
	 * and synthetic classifiers. Not what to draw - `title_tag` is - and kept as the fallback
	 * for a row whose `title_tag` is null. */
	title: string;
	/** The `title` tag AS PUBLISHED, or null for a listing that carries none - a
	 * different case from the empty string, which Conduit's parse refuses
	 * ($lib/markets/links). What the page draws, and UNBOUNDED: no cap in SQL and none on the
	 * page, so a seller's whole title reaches the document (the lowercased `title` it replaced
	 * was the same length, so this is not new). Only Conduit's 200-character gate bounds it, and
	 * a row that rotates elsewhere is not bounded at all; the cell's max-width and break-words
	 * keep the table's shape either way. */
	title_tag: string | null;
	/** Lowercased `status` tag ('' when untagged): 'active', 'sold', 'withdrawn', ... */
	status: string;
	/** The publishing client's own name from the `client` tag ('' when untagged - which
	 * is most listings: 93% of the 400 newest on 2026-10-23). */
	client: string;
	/** The free-text `location` tag as published. */
	location: string;
	/** ISO-3166 alpha-2 the listing resolved to, or NONGEO/REGION/AMBIG, or null. The
	 * country's NAME is not carried: the page reads it from the snapshot's own country
	 * table, which holds every country a live listing resolved to. */
	cc: string | null;
	/** Every `t` tag, in tag order. */
	categories: string[];
	/** The first `price` tag verbatim: ['price', '1000', 'SAT'], sometimes without the
	 * currency, and null for a listing that quotes no price. A family's kept row with no price
	 * carries its newest priced child's (pipeline/marketplaces.fold_product_options). */
	price: string[] | null;
	/** The lowercased `visibility` tag, '' when untagged. 'hidden' is already out of the
	 * live pool (the pipeline counts it withdrawn), so this is a belt on that brace. */
	visibility: string;
	/** The `content-warning` tag value AS PUBLISHED - NOT lowercased, NOT trimmed - or null
	 * when untagged: Plebeian Market replaces an `nsfw` listing's page with a confirmation
	 * gate that deliberately names nothing, so a row carrying it does not rotate there. Raw,
	 * because their test is raw and case-sensitive (`?.[1] === 'nsfw'`), so a folded column
	 * would make us decline a listing they show in full. */
	content_warning: string | null;
	/** Whether the listing carries an image URL Conduit's own normalizePublicMediaUrl
	 * accepts, FROM THE SOURCE CONDUIT WOULD READ. Computed by the pipeline, which is the
	 * only side that has the event's content: Conduit reads its images from `content.images`
	 * whenever the content is JSON its product schema accepts (a title plus a price tag is
	 * enough) and only falls back to the `image` TAGS otherwise, so an `image` tag alone can
	 * be a false positive - the rule and the measurement behind it are
	 * nostrology-data's pipeline/markets_medialib.py. Conduit's Market shows no listing
	 * without one ($lib/markets/links), so a row that cannot say - null - takes no link
	 * there. */
	market_image: boolean | null;
	/** The listing's NIP-40 `expiration`, unix seconds, where it set one: relays delete an
	 * expired event, so no marketplace can open it and the page links nothing. The read cuts
	 * these rows in SQL (SQL_MARKETPLACES_RECENT), so a row reaching the page carries either
	 * null or a future moment - unless a caller passes rows uncut, which is why
	 * $lib/markets/links tests it too. */
	expires_at: number | null;
	/**
	 * The `summary` tag's length in UTF-16 code units (JavaScript's `String.length`, which is
	 * what Conduit's Zod cap counts), or null for a listing with no summary tag. The LENGTH
	 * and not the text: nothing on the page shows a summary, and a 5,000-character string per
	 * row would be the largest thing in the document. Conduit's product schema caps `summary`
	 * at 5,000 and its fallback parse passes the tag through unsliced, so a longer one throws
	 * at parse and the reader gets "Product not found" - a dead link, which is what this
	 * column is here to prevent. Longest in the live pool on 2026-10-23: 1,827.
	 */
	summary_len: number | null;
	/** The seller's kind-0 (profile-metadata) display name, where one is known. */
	seller_name: string | null;
}

// The /routstr snapshot document - one routstr_snapshot JSONB row, produced by
// nostrology-data's routstr_refresh job (pipeline/routstr.py) and served whole: the
// page renders nothing that is not in here (presentation-level derivations like
// msats -> sats aside). The shape is the contract between the pipeline's
// build_snapshot() and +page.svelte; the independent cross-check generator
// (nostrology-data's crosscheck/build_routstr_snapshot.py) emits the identical shape.
// Revenue values in series/tables are integer MILLISATS (the wire unit) - the page
// divides by 1000 for display; only the summary headline fields are pre-converted sats.
export interface RoutstrSnapshotSummary {
	archive_events: { announcements: number; analytics_daily: number; catalog: number; reviews: number };
	providers_announced: number;
	providers_reporting: number;
	providers_active_30d: number;
	revenue_30d_sats: number;
	requests_30d: number;
	tokens_30d: number;
	revenue_alltime_sats: number;
	requests_alltime: number;
	tokens_alltime: number;
	first_activity: string | null;
	last_activity: string | null;
	models_30d: number;
	catalog_models: number | null;
	mints: number;
	success_rate_30d: number | null;
}

export interface RoutstrProviderRow {
	id: string; // 12-hex pubkey prefix
	name: string;
	class: 'clearnet' | 'onion' | 'both' | 'private-only' | 'none';
	version: string;
	mints: number;
	review: string | null;
	first_seen: string | null;
	last_announce: string | null;
	last_report: string | null;
	msats_alltime: number;
	msats_30d: number;
	req_30d: number;
	tok_30d: number;
	excluded: boolean;
	reason: string | null;
}

export interface RoutstrModelRow {
	model: string;
	msats_30d: number;
	req_30d: number;
	tok_30d: number;
	msats_alltime: number;
	req_alltime: number;
	tok_alltime: number;
	providers_30d: number;
}

export interface RoutstrSnapshot {
	generated_utc: string;
	summary: RoutstrSnapshotSummary;
	exclusions: { k: string; v: number; why: string }[];
	daily: { d: string; msats: number; req: number; tok: number; prov: number }[];
	cum_revenue: { d: string; msats: number }[];
	// Rank-ordered top 20 by 30d revenue plus a trailing "(others)" residual; the series
	// partition `daily` exactly (pipeline invariant), which is what lets the page fold
	// ranks N+1.. into the residual for its Top 5/10/20 selector.
	provider_daily_top: { id: string; name: string; series: { d: string; msats: number }[] }[];
	model_daily_top: { id: string; series: { d: string; msats: number }[] }[];
	providers: RoutstrProviderRow[];
	// The providers list is capped pipeline-side (open kind, floodable); when
	// providers_total exceeds providers.length the page says so.
	providers_total: number;
	models: RoutstrModelRow[];
	catalog: { updated: string | null; models: string[]; history: { d: string; n: number }[] };
	reviews: { node: string; label: string; d: string; reviewer: 'curated' | 'other'; name: string }[];
	transports: { k: string; v: number }[];
	versions: { k: string; v: number }[];
	mints_top: { k: string; v: number }[];
	success: {
		rate_30d: number | null;
		requests_reported: number;
		failed_reported: number;
		providers_fresh: number;
	};
	coverage: { daily_from: string | null; weekly_from: string | null; snapshots_used: number };
	anomalies: { bad_snapshots: number; bad_buckets: number };
}

// The ngit snapshot document behind /git - one ngit_snapshot JSONB row, produced by nostrology-data's
// ngit_refresh job (pipeline/ngit.py build_snapshot()) and served whole: the page renders
// nothing that is not in here. The only client-side derivations are presentation (npub
// encoding for links, percentages, msats -> sats, Top-N folding of rank-ordered lists,
// forward-filling the elided days of cum_repos).
//
// This interface mirrors nostrology-data docs/design/ngit-design.md section 8 FIELD FOR FIELD,
// names verbatim. What each number counts is nostrology-data's docs/dataset-reference/ngit-dataset-reference.md,
// which wins wherever the two disagree. Evolution: additive fields land compute -> this
// file -> page; breaking changes land page-first.
//
// Units: dates are UTC "YYYY-MM-DD", months "YYYY-MM", weeks the ISO week's Monday
// "YYYY-MM-DD"; shares are fractions 0..1 (the page formats percentages); amounts are
// MILLISATS (the page divides by 1000). Every list whose cardinality a third party controls
// is capped in the document, and third-party strings are clipped there (name 80, host 100,
// topic 40, relay 100, display name 40) - the page still escapes them. `d` is never clipped:
// an identifier over 200 characters is excluded by ledger rule N0 instead.
//
// Several names collide between the summary and the lists - the summary field is always a
// COUNT, the top-level field of a similar name a LIST:
//   summary.grasp_servers (count of GRASP hosts)   vs  grasp_servers (per-host rows, top 20)
//   summary.fork_families (count of euc groups)    vs  fork_families_top (rows, top 15)
//   summary.stars_repos (count of starred repos)   vs  repos_starred (rows, top 20)
//   summary.zaps_repos (count of zapped repos)     vs  repos_zapped (rows, top 20)
//   summary.grasp_list_users (count)               vs  grasp_lists (object; .users is the same count)

/** A repository's hosting class (reference 4.4): exclusive, judged over its reachable clone
 * hosts, in this precedence. "GRASP-hosted" = grasp_only + grasp_mixed; the page's headline
 * share, GRASP or hashtree, adds the hashtree class (a repository on both is grasp_mixed). */
export type NgitRepoHostingClass =
	| 'grasp_only'
	| 'grasp_mixed'
	| 'hashtree'
	| 'forge_only'
	| 'other_hosts'
	| 'none';

/** One clone host's class (reference 4.2). private and non_network are unreachable. */
export type NgitHostClass = 'hashtree' | 'private' | 'grasp' | 'forge' | 'non_network' | 'self_hosted';

/** A kind of public host a repository is on (reference 7, by_host): a reachable host class,
 * or none for a repository with no public clone URL. Clone hosts reads a host's class as a
 * kind too (HOST_CLASS_KIND, $lib/ngit/format), private and non_network as none. */
export type NgitHostKind = 'grasp' | 'hashtree' | 'forge' | 'self_hosted' | 'none';

/** A bucket or class and its count - the `{ k, v }` shape the document uses throughout. */
export interface NgitKeyCount<K extends string = string> {
	k: K;
	v: number;
}

/** Per-kind event counts. The kinds are kind-30617 (repo-announcements),
 * kind-30618 (repo-states), kind-10317 (grasp-server-lists), kind-1111 (comments),
 * kind-7 (reactions), kind-17 (external-content-reactions), kind-9735 (zap-receipts) and
 * kind-5 (event-deletion-requests). */
export interface NgitPerKind {
	announcements: number;
	states: number;
	grasp_lists: number;
	comments: number;
	reactions: number;
	/** kind-17 (external-content-reactions): Iris Git's stars (dataset reference 6.2). Absent
	 * from a document written before the first run after the nostrology-data deploy of
	 * 2026-10-11, whose stars are kind-7 (reactions) alone: the page then describes the
	 * stars as it did before. */
	external_reactions?: number;
	zaps: number;
}

export interface NgitCoverage {
	/** First archived kind-30617 (repo-announcements) instant's date, "2026-05-02": the
	 * announcements capture wall. Earlier data is one surviving version per coordinate. */
	announcements_since: string;
	/** "2026-06-14": the capture wall of kind-30618 (repo-states) and of
	 * kind-10317 (grasp-server-lists). A push exists only on or after it. */
	states_since: string;
	/** "2026-06-18": the capture start of kind-1111 (comments). */
	comments_since: string;
	/** "2026-06-19": the earliest ingest partition of kind-7 (reactions) in the archive.
	 * Optional, like the next two: a document written before 2026-09-25 lacks all three,
	 * and the page then says "no date recorded" for them. */
	reactions_since?: string;
	/** "2026-10-11": the earliest ingest partition of kind-17 (external-content-reactions),
	 * the day nozzl began capturing it. Absent from a document written before the first
	 * run after the nostrology-data deploy of 2026-10-11, like every key of that kind. */
	external_reactions_since?: string;
	/** "2026-06-14": the earliest ingest partition of kind-9735 (zap-receipts) in the
	 * archive. Absent from a document written before 2026-09-25. */
	zaps_since?: string;
	/** "2026-07-01": the earliest ingest partition of kind-5 (event-deletion-requests) in
	 * the archive. Absent from a document written before 2026-09-25. */
	deletions_since?: string;
	/** "2026-06-14": the day relay.ngit.dev, which most GRASP-hosted repositories name,
	 * joined the capture (dataset reference 0.2). It equals states_since only by
	 * coincidence - a different fact. Absent from a document written before 2026-09-26;
	 * written, not shown since 2026-10-02 (see NGIT_NOT_SHOWN). */
	ngit_relay_since?: string;
	/** "2026-06-08": the Monday of the ISO week containing states_since - the first
	 * pushes_weekly bucket, which is partial (its data begins Sunday 06-14 03:22Z). Written,
	 * not shown since 2026-10-02: the weekly charts start after it. */
	partial_first_week?: string;
	/** Monday of the trailing week when as_of_day is not a Sunday, else null. */
	partial_week: string | null;
	/** "YYYY-MM" of as_of_day when as_of_day is not the month's last day, else null. Written,
	 * not shown since 2026-10-02: the page draws no monthly series. */
	partial_month?: string | null;
}

export interface NgitSnapshotSummary {
	/** Rows admitted per kind after id-dedup and the future-dated horizon: for comments,
	 * reactions, external reactions and zaps only the git subset the extracts select; for
	 * deletions the self-authored (author, coordinate) pairs. */
	archive_events: NgitPerKind & { deletions: number };
	/** Every kind-30617 (repo-announcements) coordinate (pubkey, d) in the archive. */
	announcements_total: number;
	/** Announcement coordinates that survived the noise ledger. */
	announcements_kept: number;
	/** Repositories: reciprocal same-d maintainer components of kept announcements. */
	repos: number;
	/** Explicit forks: a lead announcement with a `u` tag, or `t` = personal-fork with a state.
	 * Still written; shown only in the fork-families caption, which the page dropped on
	 * 2026-09-29, so it is optional here and nothing reads it. */
	forks?: number;
	/** Repositories with at least one kind-30618 (repo-states) version; the recency buckets
	 * sum to it, and no_state.total = repos - repos_with_state. */
	repos_with_state: number;
	/** Distinct repositories with a push in the 30 / 90 complete UTC days ending as_of_day
	 * (the headline activity figure). */
	repos_pushed_30d: number;
	repos_pushed_90d: number;
	/** Pushes in the window / all time: every push since 2026-10-02 (a document written
	 * before then counts at most 50 per repository per UTC day). */
	pushes_7d: number;
	pushes_30d: number;
	/** All time. Still written; the page stopped showing it on 2026-09-29 (it sat beside the
	 * Pushes per week title), so like forks it is optional here and nothing reads it. */
	pushes_total?: number;
	/** The pushes of pushes_30d that are hashtree's: a hashtree repository's announcement
	 * republished with a public push (dataset reference section 3). Every push figure counts
	 * them, with the state pushes. Absent from a document written before the first run after
	 * the nostrology-data deploy of 2026-10-12, which counts no hashtree push: the page then
	 * says so, as it did before. */
	pushes_hashtree_30d?: number;
	/** Distinct authors of kept announcements. */
	maintainers: number;
	/** Distinct pushing pubkeys in 30 d. */
	maintainers_active_30d: number;
	/** Repositories with more than one member under the RECIPROCAL listing rule. Written, not
	 * shown since 2026-10-02 (the Maintainers cards went), like the next one. */
	multi_maintainer_repos?: number;
	/** Multi-member components a ONE-WAY listing rule would form (reported, never used). */
	shared_listed_repos?: number;
	/** COUNT of euc values shared by more than one repository (list: fork_families_top).
	 * Optional and unread since 2026-09-29, like `forks`. */
	fork_families?: number;
	/** grasp_only + grasp_mixed. */
	grasp_repos: number;
	/** grasp_repos / repos, a fraction 0..1. Written, not shown since 2026-10-10: the headline
	 * share is GRASP or hashtree, (grasp_repos + the hashtree class) / repos, computed on the
	 * page (see NGIT_NOT_SHOWN). */
	grasp_share?: number;
	/** COUNT of hosts in the GRASP host set (list: the top-level grasp_servers). */
	grasp_servers: number;
	/** kind-10317 (grasp-server-lists) pubkeys whose current list names >= 1 valid server. */
	grasp_list_users: number;
	/** Counted kind-1111 (comments) - after the comment ledger - all time / in 30 d / in 90 d.
	 * comments_90d is absent from a document written before 2026-10-02. */
	comments_total: number;
	comments_30d: number;
	comments_90d?: number;
	/** Distinct root threads (first `E` values) over counted comments. */
	comment_threads: number;
	/** Distinct authors of counted comments. */
	comment_participants: number;
	/** Counted comments that name a kept repository's coordinate / counted comments, 0..1. */
	comments_attributable_share: number;
	/** Distinct (reactor, repository) star pairs: kind-7 (reactions) stars and, in a document
	 * that carries archive_events.external_reactions, Iris Git's
	 * kind-17 (external-content-reactions) stars too, a pair starred both ways counted once.
	 * Written, not shown since 2026-10-18, when the Stars heading lost it (see NGIT_NOT_SHOWN). */
	stars_total?: number;
	/** COUNT of repositories with at least one star (list: repos_starred). Not shown since
	 * 2026-10-18 either, but read: it decides whether the table's sort note shows. */
	stars_repos: number;
	/** The pairs of stars_total that come from kind-17 (external-content-reactions) stars,
	 * whether or not kind-7 (reactions) has them too. Written, not shown; absent before the
	 * first run after the nostrology-data deploy of 2026-10-11. */
	stars_iris?: number;
	/** Counted kind-9735 (zap-receipts) to kept repositories. */
	zap_receipts: number;
	/** Sum of counted amounts, MILLISATS, each receipt capped at 0.1 BTC. Written, not shown
	 * since 2026-10-18, when the Zaps heading lost it (see NGIT_NOT_SHOWN). */
	zap_msats?: number;
	/** Distinct zapper pubkeys (from the embedded zap request, when parseable). */
	zappers: number;
	/** COUNT of repositories with at least one counted zap (list: repos_zapped). */
	zaps_repos: number;
	/** Earliest first-seen date of any kept repository, "YYYY-MM-DD". */
	first_announcement: string;
	/** Newest kind-30618 (repo-states) date over kept repositories, or null. */
	newest_state: string | null;
	/** Newest push date, or null. */
	newest_push: string | null;
	/** Share (0..1) of repositories LED by the top 1 / top 10 leads by repositories led.
	 * Written, not shown: top1 since 2026-09-29, top10 since 2026-10-02 (its Maintainers
	 * card went), so the block is optional here and nothing reads it. */
	concentration?: { top1_share: number; top10_share: number };
}

/** The ledger's keys - exactly these, every one present even when zero (dataset reference
 * section 9): the twelve announcement rules N0-N10 (N8 is split a / b), two state-coordinate
 * rows and the three comment-ledger rows; a document written before 2026-10-02 also has the
 * daily push cap's row, which the page still words, and one written before the N10 deploy of
 * 2026-10-12 lacks N10's. */
export type NgitLedgerKey =
	| 'N0'
	| 'N1'
	| 'N2'
	| 'N3'
	| 'N4'
	| 'N5'
	| 'N6'
	| 'N7'
	| 'N8a'
	| 'N8b'
	| 'N9'
	| 'N10'
	| 'state_republish_loop'
	| 'orphan_states'
	| 'daily_cap'
	| 'ephemeral'
	| 'imported'
	| 'mirrored';

/** One row of the noise / comment ledger. `unit` says what `v` counts - the rows are NOT
 * all in one unit, so a page must never sum them. `k` is a key, not a label (the page
 * words it); `why` is the pipeline's one-line reason. */
export interface NgitExclusionRow {
	k: NgitLedgerKey;
	unit: 'announcements' | 'state coordinates' | 'pushes' | 'comments';
	v: number;
	why: string;
}

/** A repository row of the repository lists (repos_active, and the unread repos_recent_pushes
 * and repos_new). Dates are "YYYY-MM-DD" strings like the summary's (as the pipeline ships
 * them); the smoke test's shape check rejects any other representation. Rows arrive RANKED
 * - the page shows them in document order until the reader sorts, and keeps it among equal
 * keys. */
export interface NgitRepoRow {
	/** The lead's hex pubkey (64 chars): the repository key is `<pubkey>:<d>`. */
	pubkey: string;
	/** The `d` identifier, never clipped (over 200 characters is ledger rule N0). */
	d: string;
	/** The lead announcement's `name` (clipped 80); may be "" - the page falls back to d. */
	name: string;
	/** The lead's display name from kind-0 (profile-metadata); absent or null when unknown. */
	lead_name?: string | null;
	/** Counted pushes in 30 d / 90 d. */
	pushes_30d: number;
	pushes_90d: number;
	/** Newest push, or null (none since the capture wall). */
	last_push: string | null;
	/** Newest state publication of any kind - "last state seen", NOT a push. */
	last_state: string | null;
	/** refs/heads/* and refs/tags/* counts on the newest state; null without a state. */
	branches: number | null;
	tags: number | null;
	/** The repository's hosting class; it also picks the row's link (RepoLink). */
	cls: NgitRepoHostingClass;
	/** The kinds of public host its clone URLs are on (dataset reference 4.4's R), in the order
	 * grasp, hashtree, forge, self_hosted, or ['none'] when it has no public clone URL; they give
	 * `cls` exactly. The Hosting column names them. Absent from a document written before the
	 * first run after the nostrology-data deploy that added them (2026-10-11): the column then
	 * shows the class. */
	host_kinds?: NgitHostKind[];
	/** Clone hosts, at most 5. */
	hosts: string[];
}

/** repos_new rows: the repository row plus its first-seen date (post-wall only). */
export interface NgitNewRepoRow extends NgitRepoRow {
	first_seen: string;
}

/** A per-repository leaderboard row (discussed / starred / zapped). */
export interface NgitRepoRef {
	pubkey: string;
	d: string;
	name: string;
	/** The repository's hosting class, as on NgitRepoRow: it picks the row's link (hashtree's
	 * own viewer for the hashtree class). Absent from a document written before the first run
	 * after the nostrology-data deploy of 2026-10-09; such a row links to gitworkshop.dev. */
	cls?: NgitRepoHostingClass;
}

/** Counted comments in one bucket (`m` "YYYY-MM" or `w` an ISO week's Monday): the five
 * root kinds, and distinct authors and threads within the bucket. */
export type NgitCommentBucket<L extends 'm' | 'w'> = { [K in L]: string } & {
	issues: number;
	prs: number;
	patches: number;
	repo: number;
	other: number;
	authors: number;
	threads: number;
};

/** Where the /git page's Stars and Zaps lists came from (since 2026-10-18): ngit_repo_stats,
 * for the document's run, or the document's own lists (postgres.ts getNgitPage). */
export type NgitListsFrom = 'table' | 'document';

export interface NgitSnapshot {
	/** Run instant, "YYYY-MM-DD HH:MM:SSZ": the freshness stamp and the cross-check pin. */
	generated_utc: string;
	/** Last complete UTC day before the run; every window ends here. */
	as_of_day: string;
	coverage: NgitCoverage;
	/** Rows dropped per kind for an impossible timestamp, never admitted to a series:
	 * future_dated = after the run instant; past_dated = before 2023-01-01, when NIP-34 (git
	 * collaboration) did not exist (a broken clock or an attack on the time axis). Rows of
	 * the run's own, unfinished day are dropped too but are not anomalies. */
	anomalies: { future_dated: NgitPerKind; past_dated: NgitPerKind };
	summary: NgitSnapshotSummary;
	/** The noise ledger plus the other-unit rows (orphan states, state republish loops, the
	 * comment ledger, and before 2026-10-02 the pushes above the daily cap). */
	exclusions: NgitExclusionRow[];
	/** Repositories by month of first archived announcement: v = grasp + other, where
	 * grasp/other is the hosting class TODAY; s = maintainers whose first kept announcement
	 * falls in that month. Months before announcements_since hold survivors only. Written,
	 * not shown since 2026-10-02 (the chart went weekly). */
	new_repos_monthly?: { m: string; v: number; grasp: number; other: number; s: number }[];
	/** The same per ISO week (labelled by its Monday), from the week holding the
	 * announcements wall (2026-04-27) to as_of_day's week. Absent from a document written
	 * before 2026-10-02: the page then says the chart is not in the snapshot. by_host counts
	 * the week's repositories once in every kind of public host they are on today (a GRASP
	 * server and GitHub count under both), or under none, every kind present in order with
	 * zeros included, so it sums to v or more and its grasp is the row's grasp; absent from a
	 * document written before the first run after the 2026-10-08 deploy (the reference: any
	 * generated before 2026-10-09 may lack it), when the page says the count is not in the
	 * snapshot.
	 * grasp and other are still written, not shown since 2026-10-08 (see NGIT_NOT_SHOWN). */
	new_repos_weekly?: {
		w: string;
		v: number;
		grasp?: number;
		other?: number;
		s: number;
		by_host?: NgitKeyCount<NgitHostKind>[];
	}[];
	/** Daily cumulative repositories by first-seen day; equal consecutive days may be elided
	 * (the first day, every change and as_of_day are present). Ends at summary.repos. */
	cum_repos: { d: string; v: number }[];
	/** ISO weeks from partial_first_week: pushes (sums to pushes_total), distinct
	 * repositories pushing, distinct pushing pubkeys. */
	pushes_weekly: { w: string; pushes: number; repos: number; maintainers: number }[];
	/** Repositories WITH a state by age of their last state seen, in complete days. Written,
	 * not shown since 2026-10-02, like no_state. */
	recency?: NgitKeyCount<'30d' | '90d' | '180d' | '365d' | 'older'>[];
	/** Repositories without any state, split by hosting class. */
	no_state?: { total: number; by_class: NgitKeyCount<NgitRepoHostingClass>[] };
	/** Repositories per hosting class; sums to summary.repos. */
	hosting: NgitKeyCount<NgitRepoHostingClass>[];
	/** Top 30 clone hosts by repositories, with the HOST's class. */
	clone_hosts: { host: string; repos: number; cls: NgitHostClass }[];
	/** Per-host LIST of GRASP servers, top 20 by repos (count: summary.grasp_servers).
	 * users = kind-10317 (grasp-server-lists) current lists naming the host; first_choice =
	 * such lists naming it first (written, not shown: see NGIT_NOT_SHOWN). */
	grasp_servers: { host: string; repos: number; users: number; first_choice?: number }[];
	/** GRASP-hosted repositories by the number of distinct GRASP hosts they use. */
	grasp_per_repo: NgitKeyCount<'1' | '2' | '3' | '4+'>[];
	/** Top 25 normalized collaboration relays by repositories naming them. */
	relays: { relay: string; repos: number }[];
	relays_per_repo: NgitKeyCount<'0' | '1' | '2-3' | '4-5' | '6+'>[];
	/** Top 12 hosts of http(s) `web` values by repositories. */
	web_hosts: { host: string; repos: number }[];
	/** Over repositories with a state, from the newest state's HEAD. Still written by the
	 * pipeline; the page stopped showing it on 2026-09-29, so it is optional here and nothing
	 * reads it - the pipeline can drop it without a coordinated deploy. */
	default_branch?: NgitKeyCount<'main' | 'master' | 'other' | 'detached' | 'none'>[];
	branches_per_repo: NgitKeyCount<'0' | '1' | '2-5' | '6-20' | '21+'>[];
	tags_per_repo: NgitKeyCount<'0' | '1-5' | '6-20' | '21+'>[];
	/** Top 25 `t` values by repositories (tool and date tags excluded). */
	topics: { t: string; repos: number }[];
	/** Announcing tool - a HAND-KEPT heuristic. Still written by the pipeline; the page stopped
	 * showing it on 2026-10-08, so it is optional here and nothing reads it (see NGIT_NOT_SHOWN). */
	tools?: NgitKeyCount[];
	/** Top 25 by pushes_90d. */
	repos_active: NgitRepoRow[];
	/** Top 25 by last_push. Still written by the pipeline; the page stopped showing it on
	 * 2026-09-29, so like default_branch it is optional here and nothing reads it. */
	repos_recent_pushes?: NgitRepoRow[];
	/** Top 25 by first_seen, post-wall only. Optional and unread since 2026-09-29, like
	 * repos_recent_pushes. */
	repos_new?: NgitNewRepoRow[];
	/** Top 15 fork families: euc (40-hex commit), repositories, up to 5 lead names. Optional
	 * and unread since 2026-09-29, like repos_recent_pushes. */
	fork_families_top?: { euc: string; repos: number; names: string[] }[];
	/** Top 20 by pushes_90d, then repos, then pubkey (dataset reference 5.1): the most active
	 * maintainers. name is the kind-0 (profile-metadata) display
	 * name, absent or null when unknown. */
	maintainers_top: {
		pubkey: string;
		name?: string | null;
		repos: number;
		pushes_90d: number;
		last_push: string | null;
	}[];
	/** kind-10317 (grasp-server-lists) publishers: users by the month their list was first
	 * seen (dated by the list relays still served before states_since; written, not shown
	 * since 2026-10-02), by the ISO week from the states wall's week (2026-06-08; absent
	 * before 2026-10-02 - users first seen earlier are in no week, so the page's running
	 * total starts from users minus the weekly sum), list length, and the first-listed host
	 * (top 10; written, not shown: see NGIT_NOT_SHOWN). */
	grasp_lists: {
		users: number;
		per_month?: { m: string; v: number }[];
		per_week?: { w: string; v: number }[];
		length: NgitKeyCount<'1' | '2' | '3' | '4+'>[];
		first_choice?: { host: string; v: number }[];
	};
	/** Counted comments per month by root kind, with distinct authors and threads. Written,
	 * not shown since 2026-10-02 (the chart went weekly). */
	comments_monthly?: NgitCommentBucket<'m'>[];
	/** The same per ISO week, from the week holding the comments wall (2026-06-15); authors
	 * and threads are distinct within the week. Absent from a document written before
	 * 2026-10-02. */
	comments_weekly?: NgitCommentBucket<'w'>[];
	/** Top 10 by authors, attributable comments only. Written, not shown since 2026-10-02:
	 * ranking how often a repository is named read as how much it is discussed. */
	repos_discussed?: (NgitRepoRef & { comments: number; authors: number })[];
	/** Top 20 LIST by stars (count: summary.stars_repos); the top 10 before the first run after
	 * the nostrology-data deploy of 2026-10-18 06:14Z. The page's server replaces it
	 * with the same run's list from ngit_repo_stats when that table holds the run (postgres.ts
	 * getNgitPage, since 2026-10-18), so this one is the fallback. */
	repos_starred: (NgitRepoRef & { stars: number })[];
	/** Top 20 LIST by receipts, then msats (count: summary.zaps_repos); by msats, then receipts
	 * before the first run after the second nostrology-data deploy of 2026-10-18 (dataset
	 * reference 6.3 has its time), and the top 10 before the first run after its first, at
	 * 06:14Z. The page opens the table by receipts whatever the order, and its
	 * server replaces the list with the same run's from ngit_repo_stats as for repos_starred.
	 * msats is MILLISATS, capped. */
	repos_zapped: (NgitRepoRef & { receipts: number; msats: number })[];
}
