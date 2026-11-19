import pg from 'pg';
import { env } from '$env/dynamic/private';
import { sanitizeExternalUrl } from '$lib/utils/externalUrl';
import type {
	AppLeaderboardRow,
	AppStackLeaderboardRow,
	PublisherAppCount,
	PublisherZapTotals,
	LightningProviderStat,
	LightningTrendsRow,
	MarketsRecentListing,
	MarketsSnapshot,
	NgitListsFrom,
	NgitSnapshot,
	NutzapMintStatsPeriod,
	RelayStat,
	RoutstrSnapshot,
	ZapstoreAppLeaderboards,
	ZapstoreAppListRow,
	ZapstoreAppStackLeaderboards,
	ZapstorePublisherZapsLeaderboards
} from '$lib/shared/data-types';

export type {
	AppLeaderboardRow,
	AppStackLeaderboardRow,
	PublisherAppCount,
	PublisherZapTotals,
	LightningProviderStat,
	LightningTrendsRow,
	MarketsRecentListing,
	MarketsSnapshot,
	NgitSnapshot,
	NutzapMintStatsPeriod,
	RelayStat,
	RoutstrSnapshot,
	ZapstoreAppLeaderboards,
	ZapstoreAppListRow,
	ZapstoreAppStackLeaderboards,
	ZapstorePublisherZapsLeaderboards
} from '$lib/shared/data-types';

const { Pool } = pg;

const connectionString =
	env.DATABASE_URL || 'postgresql://nostr_brain:changeme@postgres:5432/nostr_brain';

// TLS for managed Aurora (rds.force_ssl=1). `pg` 8.22 changed connection-string SSL
// handling: an `sslmode=require` IN THE DSN now triggers CA verification (→ "unable to
// get local issuer certificate" against Aurora's managed RDS CA, which isn't in the Node
// container's trust store) AND it OVERRIDES a Pool-level `ssl` object — so the old
// `ssl:{rejectUnauthorized:false}` silently stopped taking effect and every server-side
// query 500s. Fix: STRIP sslmode from the DSN and drive TLS solely from the `ssl` object
// below, where rejectUnauthorized:false = "encrypt, don't pin the CA" — the `require`
// posture that satisfies force_ssl. A local non-TLS Postgres (the fallback DSN) has no
// sslmode → ssl:false unchanged. (Ship the AWS RDS CA bundle + sslmode=verify-full as
// later hardening.)
const wantsTls = /[?&]sslmode=(?!disable)/i.test(connectionString);
const cleanConnectionString = connectionString
	.replace(/([?&])sslmode=[^&]*/gi, '$1')
	.replace(/\?&/g, '?')
	.replace(/&&/g, '&')
	.replace(/[?&]$/g, '');

const pool = new Pool({
	connectionString: cleanConnectionString,
	// Cap the pool explicitly (node-pg defaults to 10) so the database's shared connection
	// budget stays predictable. The role limits that bear on it, from pg_roles.rolconnlimit
	// (an older comment here said this role was 8; it is 10):
	//
	//   nostrology_web 10   nostrology_mcp 32
	//   nostrology_ro   3   nostrology_hermes_ro 3
	//   nostrology     -1  <- UNBOUNDED, and that is drift: roles.sql applies
	//                        CONNECTION LIMIT 20 to the owner, which is not in force.
	//                        Worth chasing in nostrology-data - the one role that can
	//                        exhaust max_connections (194) is the uncapped one, which
	//                        makes every cap below it advisory.
	//
	// WHY 5 AND NOT 10. Not because of a deploy overlap - an earlier version of this
	// comment asserted an invariant of `max * 2 <= rolconnlimit` on the grounds that a
	// recreate briefly runs two containers with full pools. That does not happen: a
	// redeploy stops the old container before it starts the new one, so two of this app's
	// pools never hold connections at once. Pools are lazy besides: no `min` is set, so a
	// new container begins at zero connections and grows under load.
	//
	// So 5 is simply conservative against a shared Aurora capped at 1.0 ACU, not a
	// derived bound. Raising it toward 10 is permissible, but do it for a measured
	// reason - it is NOT where the time goes. The 13 concurrent queries a leaderboards
	// render issues run 0.4-162 ms each against tables of a few thousand rows, so three
	// serialized waves are ~0.15s of a ~0.7s render. That page's cost is its payload.
	max: 5,
	// NB: do NOT set a sub-~20s connectionTimeoutMillis — node-pg's wait-forever default
	// tolerates the scale-to-zero resume (~15s warm, ~30s after >24h idle).
	ssl: wantsTls ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
	console.error('PostgreSQL pool: idle client error', err);
});

export interface ActiveUserDataPoint {
	timestamp: number;
	value: number;
}

// Trailing windows for the active-user-count series.
//   - /nutzaps is the ONLY consumer. It calls getNutzapsUsersMonthly and shows the
//     trailing year, so it passes ACTIVE_USERS_1Y_WINDOW_SECONDS explicitly.
//   - The 4-year default exists so a getter could pull the widest window and let a
//     page filter down client-side without a round-trip. No page does.
//
// An earlier version of this comment described an `/active-users` page with a
// 1Y/2Y/3Y/4Y range selector. There is no such page and there never was one here -
// the transplant brought the getters but not the route. They also query tables
// that do not exist in Aurora, so they would throw if anything called them:
//
//   - 36 getters hit `active_user_counts_<kind>`. 12 of those 13 tables are
//     absent; the only real one is active_user_counts_kind_9321_nutzaps.
//   - the other 6 (Reposts and Polls, via queryMultiKindActiveUserCounts) hit
//     `daily_active_pubkeys`, which is ALSO absent.
//
// So 13 distinct tables are missing, not 12, and provisioning every
// `active_user_counts_*` table would still leave Reposts and Polls throwing.
// Tracked in nostrology-web#13 - do not treat the getters below as working code.
export const ACTIVE_USERS_1Y_WINDOW_SECONDS = 365 * 86400;
const ACTIVE_USERS_MAX_WINDOW_SECONDS = 4 * 365 * 86400;

async function queryActiveUserCounts(
	table: string,
	granularity: string,
	windowSeconds: number = ACTIVE_USERS_MAX_WINDOW_SECONDS
): Promise<ActiveUserDataPoint[]> {
	const windowStart = Math.floor(Date.now() / 1000) - windowSeconds;
	const result = await pool.query<{
		period_start: string;
		unique_users: string;
	}>(
		`SELECT period_start, unique_users FROM ${table}
		 WHERE granularity = $1 AND period_start >= $2
		 ORDER BY period_start ASC`,
		[granularity, windowStart]
	);

	return result.rows.map((r) => ({
		timestamp: parseInt(r.period_start),
		value: parseInt(r.unique_users)
	}));
}

// Combined (all event kinds)
export function getCombinedUsersDaily(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_combined', 'day');
}
export function getCombinedUsersWeekly(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_combined', 'week');
}
export function getCombinedUsersMonthly(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_combined', 'month');
}

// kind-1 (posts) - posts and replies
export function getPostsUsersDaily(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_1_posts', 'day');
}
export function getPostsUsersWeekly(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_1_posts', 'week');
}
export function getPostsUsersMonthly(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_1_posts', 'month');
}

// kind-7 (reactions)
export function getReactionsUsersDaily(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_7_reactions', 'day');
}
export function getReactionsUsersWeekly(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_7_reactions', 'week');
}
export function getReactionsUsersMonthly(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_7_reactions', 'month');
}

// kind-1111 (comments)
export function getCommentsUsersDaily(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_1111_comments', 'day');
}
export function getCommentsUsersWeekly(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_1111_comments', 'week');
}
export function getCommentsUsersMonthly(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_1111_comments', 'month');
}

// kind-9735 (zap-receipts)
export function getZapReceiptsUsersDaily(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_9735_zap_receipts', 'day');
}
export function getZapReceiptsUsersWeekly(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_9735_zap_receipts', 'week');
}
export function getZapReceiptsUsersMonthly(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_9735_zap_receipts', 'month');
}

// Nutzap mints that count (nostrology-data#9): see NUTZAP_REAL_MINT_FILTER above
// SQL_NUTZAPS_DAILY_SERIES. Interpolated into the query text, never a parameter.
const notExcludedMint = (col: string) =>
	`NOT EXISTS (SELECT 1 FROM nutzap_mint_classes c WHERE c.mint_url = ${col} AND c.excluded)`;

// The 'all' leaderboard lists a mint with no payment only when at least this many
// users' latest kind-10019 (nutzap-configs) names it. The per-mint page exists for
// exactly the mints the 'all' leaderboard lists, so both read this constant.
export const NUTZAP_ALL_TIME_CONFIG_FLOOR = 10;

// Nutzap Mint Stats
export interface NutzapMintStat {
	mint_url: string;
	config_count: number;
	payment_count: number;
	total_amount_sats: number;
	// The per-mint page exists; windowed views can list a mint (one config) that has none.
	has_page: boolean;
}

const NUTZAP_PERIOD_SECONDS: Record<Exclude<NutzapMintStatsPeriod, 'all'>, number> = {
	'7d': 7 * 86400,
	'30d': 30 * 86400,
	'1y': 365 * 86400
};

const NUTZAP_VALID_PERIODS: NutzapMintStatsPeriod[] = ['all', '7d', '30d', '1y'];
export const NUTZAP_DEFAULT_PERIOD: NutzapMintStatsPeriod = 'all';

// Shared by /nutzaps/mints page server + /api/nutzaps endpoint so both
// resolve `?period=` identically. Falls back to NUTZAP_DEFAULT_PERIOD on
// missing/invalid input.
export function parseNutzapMintStatsPeriod(url: URL): NutzapMintStatsPeriod {
	const requested = url.searchParams.get('period');
	return requested && (NUTZAP_VALID_PERIODS as string[]).includes(requested)
		? (requested as NutzapMintStatsPeriod)
		: NUTZAP_DEFAULT_PERIOD;
}

// State-based "Configured By":
//   For each pubkey we take their LATEST kind-10019 (nutzap-configs) event
//   (DISTINCT ON pubkey, created_at DESC) - that's their current config. A user counts toward a
//   mint if their latest config lists that mint. With a period window, we
//   additionally require that latest event's created_at to fall inside the
//   window — i.e. "currently configured by users who have (re)published their
//   config recently". For 'all' there is no recency filter.
//
// Payments / Total Amount are activity-based: count + sum amount_sats over
// kind-9321 (nutzaps) PAYMENTS whose created_at is in the window. A payment is a
// row with value_source = 'proof_tags' (the NUTZAP_PAYMENT_FILTER note above
// SQL_NUTZAPS_DAILY_SERIES).
//
// Excluded mints (test and private, NUTZAP_REAL_MINT_FILTER) are not listed at all:
// neither their payments nor their "Configured By".
//
// Mint-inclusion floor: 'all' keeps the historical 10-config minimum
// (NUTZAP_ALL_TIME_CONFIG_FLOOR) to suppress single-typo mints; windowed views drop to 1 since requiring 10
// config refreshes inside a short window would hide most legitimate mints.
export const SQL_NUTZAP_MINT_STATS = `WITH params AS (
		     SELECT $1::bigint AS window_seconds,
		            EXTRACT(EPOCH FROM NOW())::bigint AS now_epoch
		 ),
		 latest_configs AS (
		     SELECT DISTINCT ON (pubkey) pubkey, created_at, mint_urls
		     FROM events_kind_10019_nutzap_configs
		     ORDER BY pubkey, created_at DESC
		 ),
		 config_per_mint AS (
		     SELECT m AS mint_url, COUNT(DISTINCT lc.pubkey)::int AS config_count
		     FROM latest_configs lc
		     CROSS JOIN params p
		     CROSS JOIN LATERAL UNNEST(lc.mint_urls) AS m
		     WHERE p.window_seconds IS NULL
		        OR lc.created_at >= p.now_epoch - p.window_seconds
		     GROUP BY m
		 ),
		 payment_per_mint AS (
		     SELECT mint_url,
		            COUNT(*)::int AS payment_count,
		            COALESCE(SUM(amount_sats), 0)::bigint AS total_amount_sats
		     FROM events_kind_9321_nutzaps n
		     CROSS JOIN params p
		     WHERE n.value_source = 'proof_tags'
		       AND (p.window_seconds IS NULL
		            OR n.created_at >= p.now_epoch - p.window_seconds)
		     GROUP BY mint_url
		 ),
		 all_mints AS (
		     SELECT mint_url FROM config_per_mint
		     UNION
		     SELECT mint_url FROM payment_per_mint
		 ),
		 -- has_page: the per-mint page exists (nutzapMintIsListed), judged on ALL-TIME
		 -- counts whatever the window, so a windowed row listed for one config links
		 -- only when its page resolves.
		 all_time_payments AS (
		     SELECT mint_url, COUNT(*) AS n
		     FROM events_kind_9321_nutzaps
		     WHERE value_source = 'proof_tags'
		     GROUP BY mint_url
		 ),
		 all_time_configs AS (
		     SELECT m AS mint_url, COUNT(DISTINCT lc.pubkey) AS n
		     FROM latest_configs lc
		     CROSS JOIN LATERAL UNNEST(lc.mint_urls) AS m
		     GROUP BY m
		 )
		 SELECT am.mint_url,
		        COALESCE(c.config_count, 0)::text   AS config_count,
		        COALESCE(p.payment_count, 0)::text  AS payment_count,
		        COALESCE(p.total_amount_sats, 0)::text AS total_amount_sats,
		        (COALESCE(atp.n, 0) >= 1
		         OR COALESCE(atc.n, 0) >= ${NUTZAP_ALL_TIME_CONFIG_FLOOR}) AS has_page
		 FROM all_mints am
		 LEFT JOIN config_per_mint c USING (mint_url)
		 LEFT JOIN payment_per_mint p USING (mint_url)
		 LEFT JOIN all_time_payments atp USING (mint_url)
		 LEFT JOIN all_time_configs atc USING (mint_url)
		 WHERE (COALESCE(p.payment_count, 0) >= 1
		        OR COALESCE(c.config_count, 0) >= $2::int)
		   AND ${notExcludedMint('am.mint_url')}
		 -- Sort on the underlying numeric expressions, NOT the ::text-cast
		 -- aliases above — referencing the alias would lex-sort ("9" > "100").
		 ORDER BY COALESCE(p.total_amount_sats, 0) DESC,
		          COALESCE(p.payment_count, 0) DESC,
		          COALESCE(c.config_count, 0) DESC`;

export async function getNutzapMintStats(period: NutzapMintStatsPeriod = 'all'): Promise<NutzapMintStat[]> {
	const windowSeconds = period === 'all' ? null : NUTZAP_PERIOD_SECONDS[period];
	const minConfigFloor = period === 'all' ? NUTZAP_ALL_TIME_CONFIG_FLOOR : 1;

	const result = await pool.query<{
		mint_url: string;
		config_count: string;
		payment_count: string;
		total_amount_sats: string;
		has_page: boolean;
	}>(
		SQL_NUTZAP_MINT_STATS,
		[windowSeconds, minConfigFloor]
	);

	return result.rows.map((r) => ({
		mint_url: r.mint_url,
		config_count: parseInt(r.config_count),
		payment_count: parseInt(r.payment_count),
		total_amount_sats: parseInt(r.total_amount_sats),
		has_page: r.has_page
	}));
}

export interface NutzapsDailyPoint {
	timestamp: number;
	daily_count: number;
	cumulative_count: number;
	daily_sats: number;
	cumulative_sats: number;
}

// Trailing-365-day daily + cumulative series for nutzap activity across all
// mints. Powers the Nutzap Sats + Nutzap Payments charts on the /nutzaps
// Overview tab. Mirrors the shape of getZapstoreAppDetail.daily so the same
// PerAppZapChart component renders both.
//
// NUTZAP_PAYMENT_FILTER - every nutzap query here that counts payments, sums sats
// or counts senders reads ONLY rows with value_source = 'proof_tags'
// (nostrology-data#8). amount_sats is already sats: the loader sets it to the sum
// of the Cashu proofs in `proof` tags and never reads the `amount` tag, which was
// often millisats. Events carrying no countable proof (2024 draft-format, encrypted,
// content tokens, zero-ecash) stay in the table with value_source = 'none' but are
// not payments. See _nutzap_value in nostrology-data's
// loader/load_jsonl_exports_into_postgres.py.
//
// NUTZAP_REAL_MINT_FILTER - and every such query drops rows on EXCLUDED mints
// (nostrology-data#9): nutzap_mint_classes marks private hosts (loopback, private
// networks, .local names...: the July 2026 test harness on http://127.0.0.1:3338)
// and reviewed test mints with a fake Lightning backend or gone (testnut). Those
// mints are also off the leaderboard and have no per-mint page. A mint missing from
// nutzap_mint_classes counts: unreviewed is never presumed fake.
export const SQL_NUTZAPS_DAILY_SERIES = `WITH window_zaps AS (
			SELECT created_at, COALESCE(amount_sats, 0) AS amount_sats
			FROM events_kind_9321_nutzaps n
			WHERE value_source = 'proof_tags'
			  AND ${notExcludedMint('n.mint_url')}
			  AND created_at >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '365 days'))::bigint
		),
		day_series AS (
			SELECT generate_series(
				date_trunc('day', NOW() - INTERVAL '365 days'),
				date_trunc('day', NOW()),
				'1 day'::interval
			) AS day
		),
		daily AS (
			SELECT date_trunc('day', to_timestamp(created_at)) AS day,
				COUNT(*)::bigint          AS daily_count,
				SUM(amount_sats)::bigint  AS daily_sats
			FROM window_zaps
			GROUP BY 1
		),
		filled AS (
			SELECT ds.day,
				COALESCE(d.daily_count, 0) AS daily_count,
				COALESCE(d.daily_sats, 0)  AS daily_sats
			FROM day_series ds
			LEFT JOIN daily d ON d.day = ds.day
		)
		SELECT
			EXTRACT(EPOCH FROM day)::bigint::text                AS timestamp,
			daily_count::text                                     AS daily_count,
			SUM(daily_count) OVER (ORDER BY day)::bigint::text   AS cumulative_count,
			daily_sats::text                                      AS daily_sats,
			SUM(daily_sats) OVER (ORDER BY day)::bigint::text    AS cumulative_sats
		FROM filled
		ORDER BY day`;

export async function getNutzapsDailySeries(): Promise<NutzapsDailyPoint[]> {
	const result = await pool.query<{
		timestamp: string;
		daily_count: string;
		cumulative_count: string;
		daily_sats: string;
		cumulative_sats: string;
	}>(
		SQL_NUTZAPS_DAILY_SERIES
	);

	return result.rows.map((row) => ({
		timestamp: parseInt(row.timestamp),
		daily_count: parseInt(row.daily_count),
		cumulative_count: parseInt(row.cumulative_count),
		daily_sats: parseInt(row.daily_sats),
		cumulative_sats: parseInt(row.cumulative_sats)
	}));
}

export interface NutzapMintDetail {
	mint_url: string;
	total_sats: number;
	total_payments: number;
	// Distinct pubkeys whose LATEST kind-10019 (nutzap-configs) lists this mint (all-time, no
	// recency filter — matches the leaderboard's default 'All' view).
	config_count: number;
	// Payments and sats over all time, as the 'All' leaderboard row shows them. A
	// mint listed there for its past can have no activity in the past year.
	all_time_payments: number;
	all_time_sats: number;
	daily: NutzapsDailyPoint[];
	// Trailing-365d monthly active users for this mint. Same shape as
	// ActiveUserDataPoint so the per-mint page reuses ActiveUsersChart with
	// the per-mint series. Computed on-the-fly because the
	// active_user_counts_kind_9321_nutzaps aggregation table is cross-mint.
	mau: ActiveUserDataPoint[];
}

// Trailing-365-day daily + cumulative series for a single mint, plus headline
// totals. Powers /nutzaps/mints/[...mint]. Same shape as getNutzapsDailySeries so
// the same PerAppZapChart consumes both. The page exists for exactly the mints the
// 'All' leaderboard lists (SQL_NUTZAP_MINT_LISTING); a listed mint with no activity
// in the past year renders its charts at 0 rather than 404ing: nostrology-data#9 (nutzaps:
// no test/private-mint exclusion).
export const SQL_NUTZAP_MINT_DAILY = `WITH window_zaps AS (
			SELECT created_at, COALESCE(amount_sats, 0) AS amount_sats
			FROM events_kind_9321_nutzaps
			WHERE mint_url = $1
			  AND value_source = 'proof_tags'
			  AND created_at >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '365 days'))::bigint
		),
		day_series AS (
			SELECT generate_series(
				date_trunc('day', NOW() - INTERVAL '365 days'),
				date_trunc('day', NOW()),
				'1 day'::interval
			) AS day
		),
		daily AS (
			SELECT date_trunc('day', to_timestamp(created_at)) AS day,
				COUNT(*)::bigint          AS daily_count,
				SUM(amount_sats)::bigint  AS daily_sats
			FROM window_zaps
			GROUP BY 1
		),
		filled AS (
			SELECT ds.day,
				COALESCE(d.daily_count, 0) AS daily_count,
				COALESCE(d.daily_sats, 0)  AS daily_sats
			FROM day_series ds
			LEFT JOIN daily d ON d.day = ds.day
		)
		SELECT
			EXTRACT(EPOCH FROM day)::bigint::text                AS timestamp,
			daily_count::text                                     AS daily_count,
			SUM(daily_count) OVER (ORDER BY day)::bigint::text   AS cumulative_count,
			daily_sats::text                                      AS daily_sats,
			SUM(daily_sats) OVER (ORDER BY day)::bigint::text    AS cumulative_sats
		FROM filled
		ORDER BY day`;

// Distinct senders per UTC month, for the page's Monthly Active Users chart. Its x-axis has
// one slot per row, so every month has a row, 0 where it had no sender. Without that, a month
// with none vanished from the axis with no sign: nostrology-web#33 (Per-mint monthly users
// chart hides months with no activity). That includes the current month, still accumulating,
// as on the site's other charts. The one exception is the oldest month, which the 365-day
// window cuts: it has a row only where it has a sender, because it counts only from the cutoff,
// so a 0 there could be false. created_at has no upper bound and is whatever the event's author
// wrote, so the months come from the clock, never from the rows: a forged date cannot add a
// month past now.
//
// nostrology-data's verification battery restates this rule (Truth.web_mint_mau in
// nostrology_mcp/verification/nutzaps_truth.py) and compares it with the live page: change
// both together.
export const SQL_NUTZAP_MINT_MAU = `WITH window_zaps AS (
			SELECT pubkey, created_at
			FROM events_kind_9321_nutzaps
			WHERE mint_url = $1
			  AND value_source = 'proof_tags'
			  AND created_at >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '365 days'))::bigint
		),
		monthly AS (
			SELECT date_trunc('month', to_timestamp(created_at) AT TIME ZONE 'UTC') AS month,
				COUNT(DISTINCT pubkey)::bigint AS unique_users
			FROM window_zaps
			GROUP BY 1
		),
		edges AS (
			SELECT date_trunc('month', (NOW() - INTERVAL '365 days') AT TIME ZONE 'UTC') AS oldest,
				date_trunc('month', NOW() AT TIME ZONE 'UTC') AS newest
		),
		months AS (
			SELECT generate_series(oldest, newest, '1 month'::interval) AS month, oldest
			FROM edges
		)
		SELECT
			EXTRACT(EPOCH FROM m.month)::bigint::text AS timestamp,
			COALESCE(u.unique_users, 0)::text          AS unique_users
		FROM months m
		LEFT JOIN monthly u ON u.month = m.month
		WHERE u.month IS NOT NULL OR m.month <> m.oldest
		ORDER BY m.month`;

// Everything that decides whether a mint has a page, plus its all-time totals:
// its "Configured By" count (latest kind-10019 (nutzap-configs) per pubkey, no recency
// filter), its
// all-time payments and sats, and whether nutzap_mint_classes excludes it.
export const SQL_NUTZAP_MINT_LISTING = `WITH latest_configs AS (
			SELECT DISTINCT ON (pubkey) pubkey, mint_urls
			FROM events_kind_10019_nutzap_configs
			ORDER BY pubkey, created_at DESC
		)
		SELECT
			(SELECT COUNT(*) FROM latest_configs WHERE $1 = ANY(mint_urls))::text AS config_count,
			COUNT(*)::text                                                         AS all_time_payments,
			COALESCE(SUM(amount_sats), 0)::text                                    AS all_time_sats,
			NOT ${notExcludedMint('$1')}                                           AS excluded
		FROM events_kind_9321_nutzaps
		WHERE mint_url = $1
		  AND value_source = 'proof_tags'`;

// A mint has a per-mint page exactly when the 'All' leaderboard lists it: not
// excluded, and at least one payment ever or NUTZAP_ALL_TIME_CONFIG_FLOOR configs.
export function nutzapMintIsListed(
	excluded: boolean,
	allTimePayments: number,
	configCount: number
): boolean {
	return !excluded && (allTimePayments >= 1 || configCount >= NUTZAP_ALL_TIME_CONFIG_FLOOR);
}

export async function getNutzapMintDetail(
	mint_url: string
): Promise<NutzapMintDetail | null> {
	const dailyPromise = pool.query<{
		timestamp: string;
		daily_count: string;
		cumulative_count: string;
		daily_sats: string;
		cumulative_sats: string;
	}>(
		SQL_NUTZAP_MINT_DAILY,
		[mint_url]
	);

	const listingPromise = pool.query<{
		config_count: string;
		all_time_payments: string;
		all_time_sats: string;
		excluded: boolean;
	}>(SQL_NUTZAP_MINT_LISTING, [mint_url]);

	// Per-mint MAU: distinct sender pubkeys per month over the trailing 365
	// days. The cross-mint active_user_counts_kind_9321_nutzaps aggregation
	// can't give us per-mint counts, so we compute on the fly from the raw
	// events. Output shape matches ActiveUserDataPoint.
	const mauPromise = pool.query<{ timestamp: string; unique_users: string }>(
		SQL_NUTZAP_MINT_MAU,
		[mint_url]
	);

	const [dailyRes, listingRes, mauRes] = await Promise.all([
		dailyPromise,
		listingPromise,
		mauPromise
	]);

	const listing = listingRes.rows[0];
	const configCount = parseInt(listing?.config_count ?? '0');
	const allTimePayments = parseInt(listing?.all_time_payments ?? '0');
	if (!nutzapMintIsListed(listing?.excluded ?? false, allTimePayments, configCount)) {
		return null;
	}
	const totalPayments = dailyRes.rows.reduce((acc, r) => acc + parseInt(r.daily_count), 0);
	const lastRow = dailyRes.rows[dailyRes.rows.length - 1];
	const totalSats = lastRow ? parseInt(lastRow.cumulative_sats) : 0;

	return {
		mint_url,
		total_sats: totalSats,
		total_payments: totalPayments,
		config_count: configCount,
		all_time_payments: allTimePayments,
		all_time_sats: parseInt(listing?.all_time_sats ?? '0'),
		mau: mauRes.rows.map((row) => ({
			timestamp: parseInt(row.timestamp),
			value: parseInt(row.unique_users)
		})),
		daily: dailyRes.rows.map((row) => ({
			timestamp: parseInt(row.timestamp),
			daily_count: parseInt(row.daily_count),
			cumulative_count: parseInt(row.cumulative_count),
			daily_sats: parseInt(row.daily_sats),
			cumulative_sats: parseInt(row.cumulative_sats)
		}))
	};
}

export interface NutzapsMintSeries {
	mint_url: string;
	total_sats: number;
	daily: Array<{ timestamp: number; cumulative_sats: number }>;
}

// Top-N mints by trailing-365-day total nutzap sats, each with a per-mint
// daily cumulative-sats series over the same 365-day window. Powers the
// "Cumulative sats by mint" multi-line chart on /nutzaps/mints. Returned in
// rank order (highest total_sats first), so the caller can assign colors /
// render the legend in the order users expect.
export const SQL_NUTZAPS_TOP_MINTS_CUMULATIVE = `WITH top_mints AS (
			SELECT mint_url,
				SUM(amount_sats)::bigint AS total_sats,
				ROW_NUMBER() OVER (ORDER BY SUM(amount_sats) DESC) AS mint_rank
			FROM events_kind_9321_nutzaps n
			WHERE value_source = 'proof_tags'
			  AND ${notExcludedMint('n.mint_url')}
			  AND created_at >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '365 days'))::bigint
			GROUP BY mint_url
			ORDER BY total_sats DESC
			LIMIT $1
		),
		day_series AS (
			SELECT generate_series(
				date_trunc('day', NOW() - INTERVAL '365 days'),
				date_trunc('day', NOW()),
				'1 day'::interval
			) AS day
		),
		mint_day_pairs AS (
			SELECT m.mint_url, m.mint_rank, m.total_sats, ds.day
			FROM top_mints m CROSS JOIN day_series ds
		),
		daily AS (
			SELECT n.mint_url,
				date_trunc('day', to_timestamp(n.created_at)) AS day,
				SUM(n.amount_sats)::bigint AS daily_sats
			FROM events_kind_9321_nutzaps n
			JOIN top_mints m ON m.mint_url = n.mint_url
			WHERE n.value_source = 'proof_tags'
			  AND n.created_at >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '365 days'))::bigint
			GROUP BY n.mint_url, 2
		),
		filled AS (
			SELECT mdp.mint_url,
				mdp.mint_rank,
				mdp.total_sats,
				mdp.day,
				COALESCE(d.daily_sats, 0) AS daily_sats
			FROM mint_day_pairs mdp
			LEFT JOIN daily d ON d.mint_url = mdp.mint_url AND d.day = mdp.day
		)
		SELECT
			mint_url,
			total_sats::text                                                             AS total_sats,
			EXTRACT(EPOCH FROM day)::bigint::text                                        AS timestamp,
			SUM(daily_sats) OVER (PARTITION BY mint_url ORDER BY day)::bigint::text      AS cumulative_sats
		FROM filled
		ORDER BY filled.mint_rank, day`;

export async function getNutzapsTopMintsCumulativeSeries(
	limit: number = 10
): Promise<NutzapsMintSeries[]> {
	const result = await pool.query<{
		mint_url: string;
		total_sats: string;
		timestamp: string;
		cumulative_sats: string;
	}>(
		SQL_NUTZAPS_TOP_MINTS_CUMULATIVE,
		[limit]
	);

	const byMint = new Map<string, NutzapsMintSeries>();
	for (const row of result.rows) {
		let entry = byMint.get(row.mint_url);
		if (!entry) {
			entry = {
				mint_url: row.mint_url,
				total_sats: parseInt(row.total_sats),
				daily: []
			};
			byMint.set(row.mint_url, entry);
		}
		entry.daily.push({
			timestamp: parseInt(row.timestamp),
			cumulative_sats: parseInt(row.cumulative_sats)
		});
	}
	return Array.from(byMint.values());
}

// kind-9321 (nutzaps) - NIP-61 (nutzaps)
// windowSeconds is overridable so /nutzaps can pin its MAU chart to the trailing
// year instead of the default, which is ACTIVE_USERS_MAX_WINDOW_SECONDS = 4 years
// (an earlier comment here said 3Y; it never matched the constant).
export function getNutzapsUsersDaily(
	windowSeconds: number = ACTIVE_USERS_MAX_WINDOW_SECONDS
): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_9321_nutzaps', 'day', windowSeconds);
}
export function getNutzapsUsersWeekly(
	windowSeconds: number = ACTIVE_USERS_MAX_WINDOW_SECONDS
): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_9321_nutzaps', 'week', windowSeconds);
}
export function getNutzapsUsersMonthly(
	windowSeconds: number = ACTIVE_USERS_MAX_WINDOW_SECONDS
): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_9321_nutzaps', 'month', windowSeconds);
}

// kind-30023 (long-form-content) - NIP-23 (long-form content)
export function getLongFormUsersDaily(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_30023_long_form_content', 'day');
}
export function getLongFormUsersWeekly(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_30023_long_form_content', 'week');
}
export function getLongFormUsersMonthly(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_30023_long_form_content', 'month');
}

// kind-0 (profile-metadata)
export function getKind0ProfileMetadataUsersDaily(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_0_profile_metadata', 'day');
}
export function getKind0ProfileMetadataUsersWeekly(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_0_profile_metadata', 'week');
}
export function getKind0ProfileMetadataUsersMonthly(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_0_profile_metadata', 'month');
}

// kind-3 (follow-lists)
export function getKind3FollowListsUsersDaily(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_3_follow_lists', 'day');
}
export function getKind3FollowListsUsersWeekly(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_3_follow_lists', 'week');
}
export function getKind3FollowListsUsersMonthly(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_3_follow_lists', 'month');
}

// kind-10002 (relay-list-metadata)
export function getKind10002RelayListMetadataUsersDaily(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_10002_relay_list_metadata', 'day');
}
export function getKind10002RelayListMetadataUsersWeekly(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_10002_relay_list_metadata', 'week');
}
export function getKind10002RelayListMetadataUsersMonthly(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_10002_relay_list_metadata', 'month');
}

// kind-10000 (mute-lists)
export function getKind10000MuteListsUsersDaily(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_10000_mute_lists', 'day');
}
export function getKind10000MuteListsUsersWeekly(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_10000_mute_lists', 'week');
}
export function getKind10000MuteListsUsersMonthly(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_10000_mute_lists', 'month');
}

// kind-10003 (bookmark-lists)
export function getKind10003BookmarkListsUsersDaily(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_10003_bookmark_lists', 'day');
}
export function getKind10003BookmarkListsUsersWeekly(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_10003_bookmark_lists', 'week');
}
export function getKind10003BookmarkListsUsersMonthly(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_10003_bookmark_lists', 'month');
}

// kind-10050 (dm-relay-lists)
export function getKind10050DmRelayListsUsersDaily(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_10050_dm_relay_lists', 'day');
}
export function getKind10050DmRelayListsUsersWeekly(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_10050_dm_relay_lists', 'week');
}
export function getKind10050DmRelayListsUsersMonthly(): Promise<ActiveUserDataPoint[]> {
	return queryActiveUserCounts('active_user_counts_kind_10050_dm_relay_lists', 'month');
}

// Multi-kind combined query: dedupes pubkeys across multiple kinds per period.
// Defaults to the same 4-year window as queryActiveUserCounts so its series would
// line up with the single-kind ones.
//
// Six getters DO call this (Reposts and Polls, below) - it is those six that
// nothing calls. It reads `daily_active_pubkeys`, a DIFFERENT table from the
// `active_user_counts_*` set, and one that is likewise absent from Aurora. See
// the note at the head of the active-user section, and nostrology-web#13.
async function queryMultiKindActiveUserCounts(
	granularity: string,
	kinds: number[],
	windowSeconds: number = ACTIVE_USERS_MAX_WINDOW_SECONDS
): Promise<ActiveUserDataPoint[]> {
	const windowStart = Math.floor(Date.now() / 1000) - windowSeconds;

	let groupExpr: string;
	if (granularity === 'day') {
		groupExpr = 'active_date';
	} else if (granularity === 'week') {
		groupExpr = "DATE_TRUNC('week', active_date)";
	} else {
		groupExpr = "DATE_TRUNC('month', active_date)";
	}

	const result = await pool.query<{ period_start: string; unique_users: string }>(
		`SELECT EXTRACT(EPOCH FROM ${groupExpr})::BIGINT AS period_start,
		        COUNT(DISTINCT pubkey) AS unique_users
		 FROM daily_active_pubkeys
		 WHERE kind = ANY($1)
		   AND active_date >= TO_TIMESTAMP($2)::DATE
		 GROUP BY ${groupExpr}
		 ORDER BY period_start ASC`,
		[kinds, windowStart]
	);

	return result.rows.map((r) => ({
		timestamp: parseInt(r.period_start),
		value: parseInt(r.unique_users)
	}));
}

// Reposts: kind-6 (reposts) + kind-16 (generic-reposts) combined
export function getRepostsUsersDaily(): Promise<ActiveUserDataPoint[]> {
	return queryMultiKindActiveUserCounts('day', [6, 16]);
}
export function getRepostsUsersWeekly(): Promise<ActiveUserDataPoint[]> {
	return queryMultiKindActiveUserCounts('week', [6, 16]);
}
export function getRepostsUsersMonthly(): Promise<ActiveUserDataPoint[]> {
	return queryMultiKindActiveUserCounts('month', [6, 16]);
}

// Polls and responses: kind-1068 (poll-definitions) - NIP-88 (polls) - plus
// kind-1018 (poll-responses) and kind-6969 (zap-poll-definitions), Primal's
// variant. kind-1018 (poll-responses) covers both standard NIP-88 (polls) votes
// and Primal zap-poll votes (extracted from kind-9735 (zap-receipts) and
// stored as kind-1018 (poll-responses) in daily_active_pubkeys).
export function getPollsUsersDaily(): Promise<ActiveUserDataPoint[]> {
	return queryMultiKindActiveUserCounts('day', [1068, 1018, 6969]);
}
export function getPollsUsersWeekly(): Promise<ActiveUserDataPoint[]> {
	return queryMultiKindActiveUserCounts('week', [1068, 1018, 6969]);
}
export function getPollsUsersMonthly(): Promise<ActiveUserDataPoint[]> {
	return queryMultiKindActiveUserCounts('month', [1068, 1018, 6969]);
}

// ---------------------------------------------------------------------------
// Zapstore — kind-32267 (zapstore-app-catalog) app catalog
// ---------------------------------------------------------------------------
// The Zapstore main account (npub10r8xl2njyepcw2zwv3a6dyufj4e4ajx86hz6v4ehu4gnpupxxp7stjt2p8,
// kind-0 (profile-metadata) name "Zapstore", nip-05 _@zapstore.dev) republishes GitHub/F-Droid
// Android apps as kind-32267 (zapstore-app-catalog) events. ~93% of catalog entries come from this
// single pubkey; the rest are independent publishers publishing directly via
// zapstore-cli.
export const ZAPSTORE_PUBKEY = '78ce6faa72264387284e647ba6938995735ec8c7d5c5a65737e55130f026307d';

// kind-32267 (zapstore-app-catalog) d_tags that the Zapstore main account publishes as its own
// software (the Zapstore Android client and its alpha-track build, plus
// the zapstore-cli tool) — these are NOT republishes from GitHub/F-Droid
// even though they share the publisher pubkey, so the "republished"
// partition rule must exempt them.
export const ZAPSTORE_OWN_D_TAGS = ['dev.zapstore.app', 'dev.zapstore.alpha', 'zapstore'];

export interface ZapstoreAppsCumulative {
	total: ActiveUserDataPoint[];
	github: ActiveUserDataPoint[];
	native: ActiveUserDataPoint[];
}

// Cumulative count of distinct apps that have at least one release event,
// using each app's EARLIEST kind-30063 (zapstore-app-releases) release as its first-appearance date.
// Partitioned three ways:
//   total  — every distinct app
//   github — apps published by the Zapstore account, EXCLUDING the account's
//            own software (see ZAPSTORE_OWN_D_TAGS); these are the genuine
//            republishes from GitHub/F-Droid
//   native — apps published by anyone else (Nostr-native independent
//            publishers) PLUS the Zapstore account's own apps in
//            ZAPSTORE_OWN_D_TAGS, which are also natively published
//
// Source: events_kind_30063_app_releases (kind-30063-zapstore-app-releases).
//
// We deliberately do NOT use events_kind_32267_app_catalog despite that being
// the more obvious "catalog" table. kind-32267 (zapstore-app-catalog) is parameterized-replaceable
// per (pubkey, d_tag) and the loader retains only the latest revision. So
// MIN(created_at) on the catalog actually returns the LATEST republication
// date — apps slide forward on the chart every time a publisher (or the
// curator's GitHub-scrape pipeline) re-publishes them. Mean lag on natives
// alone was 57.7 days; 44% appeared >30 days late.
//
// kind-30063 (zapstore-app-releases) is also parameterized-replaceable but its d_tag includes the
// version, so each version is its own row. MIN(created_at) GROUP BY
// (pubkey, app_d_tag) is therefore stable over time and is a true
// "first appearance on Zapstore" signal.
//
// Trade-off: ~138 catalog stubs (apps in kind-32267 (zapstore-app-catalog) with no kind-30063 (zapstore-app-releases) release
// yet) drop off — almost all are GitHub-republished placeholders. Defensible:
// "in the catalog but no installable release" is a weaker signal than
// "has at least one release on Zapstore".
//
// Computed JIT (~5–15 ms) — at ~10K release rows there's no benefit to a
// pre-aggregated rollup.
//
// Design contract: the chart plots the trailing 365 days, but the cumulative
// metric is computed since the beginning of time (over all kind-30063 (zapstore-app-releases) events
// in the DB). The left-edge value on any given day is "all apps that had a
// first release on or before that day", not "apps that first released within
// the visible window". day_series therefore spans LEAST(MIN(day), NOW()-365d)
// through today; the WHERE clause at the bottom trims the OUTPUT, not the
// cumulative. SQL_ZAPSTORE_NATIVE_SHARE follows the same pattern. Any future
// cumulative-style chart on /zapstore must too — pinned by regression tests
// in zapstore-charts.test.ts.
//
// SQL is exported separately so tests can run the exact production query
// against a synthetic-data fixture; see zapstore-charts.test.ts.
export const SQL_ZAPSTORE_APPS_CUMULATIVE = `WITH first_release AS (
	SELECT pubkey, app_d_tag, MIN(created_at) AS first_release_at
	FROM events_kind_30063_app_releases
	GROUP BY pubkey, app_d_tag
),
daily_added AS (
	SELECT
		date_trunc('day', to_timestamp(first_release_at)) AS day,
		COUNT(*)                                                              AS total_added,
		COUNT(*) FILTER (WHERE pubkey =  $1 AND app_d_tag <> ALL($2))         AS github_added,
		COUNT(*) FILTER (WHERE pubkey <> $1 OR  app_d_tag =  ANY($2))         AS native_added
	FROM first_release
	GROUP BY 1
),
day_series AS (
	SELECT generate_series(
		LEAST(
			(SELECT MIN(day) FROM daily_added),
			date_trunc('day', NOW() - INTERVAL '365 days')
		),
		date_trunc('day', NOW()),
		'1 day'::interval
	) AS day
),
filled AS (
	SELECT ds.day,
		COALESCE(da.total_added,  0) AS total_added,
		COALESCE(da.github_added, 0) AS github_added,
		COALESCE(da.native_added, 0) AS native_added
	FROM day_series ds
	LEFT JOIN daily_added da USING (day)
),
cum AS (
	SELECT day,
		SUM(total_added)  OVER (ORDER BY day) AS total_cum,
		SUM(github_added) OVER (ORDER BY day) AS github_cum,
		SUM(native_added) OVER (ORDER BY day) AS native_cum
	FROM filled
)
SELECT
	EXTRACT(EPOCH FROM day)::bigint AS timestamp,
	total_cum::int                  AS total,
	github_cum::int                 AS github,
	native_cum::int                 AS native
FROM cum
WHERE day >= date_trunc('day', NOW() - INTERVAL '365 days')
ORDER BY day`;

export async function getZapstoreAppsCumulativeDaily(): Promise<ZapstoreAppsCumulative> {
	const result = await pool.query<{
		timestamp: string;
		total: string;
		github: string;
		native: string;
	}>(SQL_ZAPSTORE_APPS_CUMULATIVE, [ZAPSTORE_PUBKEY, ZAPSTORE_OWN_D_TAGS]);

	return {
		total: result.rows.map((r) => ({ timestamp: parseInt(r.timestamp), value: parseInt(r.total) })),
		github: result.rows.map((r) => ({ timestamp: parseInt(r.timestamp), value: parseInt(r.github) })),
		native: result.rows.map((r) => ({ timestamp: parseInt(r.timestamp), value: parseInt(r.native) }))
	};
}

// Daily series of (cumulative native) / (cumulative native + github) * 100,
// over the trailing 365 days. Same data source and partition rule as
// getZapstoreAppsCumulativeDaily — kind-30063 (zapstore-app-releases) first-release dates, NOT
// kind-32267 (zapstore-app-catalog) catalog dates (see that function's comment for why). Cumulative
// totals are computed from the earliest release-day to today, then the
// result set is trimmed to the trailing 365-day window so the percentage at
// each point is the true running ratio.
//
// SQL exported for tests; see zapstore-charts.test.ts.
export const SQL_ZAPSTORE_NATIVE_SHARE = `WITH first_release AS (
	SELECT pubkey, app_d_tag, MIN(created_at) AS first_release_at,
		CASE WHEN pubkey =  $1 AND app_d_tag <> ALL($2) THEN 'github' ELSE 'native' END AS bucket
	FROM events_kind_30063_app_releases
	GROUP BY pubkey, app_d_tag
),
daily_added AS (
	SELECT date_trunc('day', to_timestamp(first_release_at)) AS day,
		COUNT(*) FILTER (WHERE bucket = 'native') AS native_added,
		COUNT(*) FILTER (WHERE bucket = 'github') AS github_added
	FROM first_release
	GROUP BY 1
),
day_series AS (
	SELECT generate_series(
		LEAST(
			(SELECT MIN(day) FROM daily_added),
			date_trunc('day', NOW() - INTERVAL '365 days')
		),
		date_trunc('day', NOW()),
		'1 day'::interval
	) AS day
),
filled AS (
	SELECT ds.day,
		COALESCE(da.native_added, 0) AS native_added,
		COALESCE(da.github_added, 0) AS github_added
	FROM day_series ds
	LEFT JOIN daily_added da USING (day)
),
cum AS (
	SELECT day,
		SUM(native_added) OVER (ORDER BY day) AS native_cum,
		SUM(github_added) OVER (ORDER BY day) AS github_cum
	FROM filled
)
SELECT EXTRACT(EPOCH FROM day)::bigint AS timestamp,
	CASE WHEN (native_cum + github_cum) > 0
		THEN ROUND(100.0 * native_cum / (native_cum + github_cum), 2)::text
		ELSE '0'
	END AS native_pct
FROM cum
WHERE day >= date_trunc('day', NOW() - INTERVAL '365 days')
ORDER BY day`;

export async function getZapstoreNativeShareDaily(): Promise<{
	daily: Array<{ timestamp: number; value: number }>;
}> {
	const result = await pool.query<{ timestamp: string; native_pct: string }>(
		SQL_ZAPSTORE_NATIVE_SHARE,
		[ZAPSTORE_PUBKEY, ZAPSTORE_OWN_D_TAGS]
	);

	return {
		daily: result.rows.map((r) => ({
			timestamp: parseInt(r.timestamp),
			value: parseFloat(r.native_pct)
		}))
	};
}

export interface ZapstoreZapsAggregateDaily {
	daily: Array<{ timestamp: number; value: number }>;       // daily zap count
	cumulative: Array<{ timestamp: number; value: number }>;  // cumulative sats
}

// Aggregate "Zapstore Zaps" series across the trailing 365 days, dense day-by-day.
// Returns parallel daily-count and cumulative-sats arrays for /zapstore's
// dual-axis aggregate chart. Window-function cumulative + generate_series
// zero-fill mirrors getZapstoreAppDetail's shape, just without the per-app
// filter. msats → sats conversion happens at this API boundary.
export async function getZapstoreZapsAggregateDaily(): Promise<ZapstoreZapsAggregateDaily> {
	const result = await pool.query<{
		timestamp: string;
		daily_count: string;
		cumulative_msats: string;
	}>(
		`WITH window_zaps AS (
			SELECT created_at, COALESCE(amount_msats, 0) AS amount_msats
			FROM events_kind_9735_zaps_zapstore
			WHERE created_at >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '365 days'))::bigint
		),
		day_series AS (
			SELECT generate_series(
				date_trunc('day', NOW() - INTERVAL '365 days'),
				date_trunc('day', NOW()),
				'1 day'::interval
			) AS day
		),
		daily AS (
			SELECT date_trunc('day', to_timestamp(created_at)) AS day,
				COUNT(*)::bigint          AS daily_count,
				SUM(amount_msats)::bigint AS daily_msats
			FROM window_zaps
			GROUP BY 1
		),
		filled AS (
			SELECT ds.day,
				COALESCE(d.daily_count, 0) AS daily_count,
				COALESCE(d.daily_msats, 0) AS daily_msats
			FROM day_series ds
			LEFT JOIN daily d ON d.day = ds.day
		)
		SELECT
			EXTRACT(EPOCH FROM day)::bigint::text                AS timestamp,
			daily_count::text                                    AS daily_count,
			SUM(daily_msats) OVER (ORDER BY day)::bigint::text   AS cumulative_msats
		FROM filled
		ORDER BY day`
	);

	const msatsToSats = (msats: number): number => Math.round(msats / 1000);
	const daily: Array<{ timestamp: number; value: number }> = [];
	const cumulative: Array<{ timestamp: number; value: number }> = [];
	for (const row of result.rows) {
		const ts = parseInt(row.timestamp);
		daily.push({ timestamp: ts, value: parseInt(row.daily_count) });
		cumulative.push({ timestamp: ts, value: msatsToSats(parseInt(row.cumulative_msats)) });
	}

	return { daily, cumulative };
}

export interface ZapstoreAppReleasesDaily {
	github: Array<{ timestamp: number; value: number }>;
	native: Array<{ timestamp: number; value: number }>;
	// Subset of `native`: per-day count of Nostr-native apps debuting on that
	// day — i.e., distinct (pubkey, app_d_tag) whose all-history MIN(created_at)
	// falls on that day, restricted to the native partition. By construction
	// always ≤ native[i] on the same day. Rendered as an overlay bar IN FRONT
	// OF the native bar in the "App Releases" chart (separate Chart.js stack);
	// not double-counted into the chart's grand-total rolling average.
	newNative: Array<{ timestamp: number; value: number }>;
}

// Daily Zapstore app-release counts across the trailing 365 days, dense
// day-by-day, partitioned by publisher: "github" = published by the Zapstore
// account except for its own software in ZAPSTORE_OWN_D_TAGS (republished
// from GitHub/F-Droid), "native" = everyone else plus those Zapstore-own apps
// (Nostr-native publishers via zapstore-cli, including the Zapstore client
// and CLI themselves). Same partition rule as getZapstoreAppsCumulativeDaily;
// powers the stacked "App Releases" bar chart.
//
// Counts release EVENTS, not unique apps — a publisher who pushes 30 patch
// versions in a month contributes 30 events. Includes pre-release versions
// (alpha/beta/rc) because the production Zapstore Android client itself does
// not filter on channel or version-string pre-release markers.
//
// `new_native_count` is a derived per-day count of Nostr-native apps debuting
// on that day: distinct (pubkey, app_d_tag) whose all-history MIN(created_at)
// falls on that day, restricted to the native partition. Computed from the
// `per_app_first` CTE which scans all kind-30063 (zapstore-app-releases) history (not just the
// trailing window) so the "first ever" judgement is correct even for apps
// whose debut sits at the boundary. By construction new_native_count ≤
// native_count on the same day; the chart renders it as a yellow overlay
// bar IN FRONT OF the native (purple) bar.
//
// SQL exported for tests; see zapstore-charts.test.ts.
export const SQL_ZAPSTORE_APP_RELEASES_DAILY = `WITH per_app_first AS (
	SELECT pubkey, app_d_tag, MIN(created_at) AS first_release_at
	FROM events_kind_30063_app_releases
	GROUP BY pubkey, app_d_tag
),
window_releases AS (
	SELECT created_at, pubkey, app_d_tag
	FROM events_kind_30063_app_releases
	WHERE created_at >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '365 days'))::bigint
),
day_series AS (
	SELECT generate_series(
		date_trunc('day', NOW() - INTERVAL '365 days'),
		date_trunc('day', NOW()),
		'1 day'::interval
	) AS day
),
daily AS (
	SELECT date_trunc('day', to_timestamp(created_at)) AS day,
		COUNT(*) FILTER (WHERE pubkey =  $1 AND app_d_tag <> ALL($2))::bigint AS github_count,
		COUNT(*) FILTER (WHERE pubkey <> $1 OR  app_d_tag =  ANY($2))::bigint AS native_count
	FROM window_releases
	GROUP BY 1
),
new_native_daily AS (
	SELECT date_trunc('day', to_timestamp(first_release_at)) AS day,
		COUNT(*)::bigint AS new_native_count
	FROM per_app_first
	WHERE (pubkey <> $1 OR app_d_tag = ANY($2))
	  AND first_release_at >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '365 days'))::bigint
	GROUP BY 1
)
SELECT
	EXTRACT(EPOCH FROM ds.day)::bigint::text  AS timestamp,
	COALESCE(d.github_count, 0)::text         AS github_count,
	COALESCE(d.native_count, 0)::text         AS native_count,
	COALESCE(n.new_native_count, 0)::text     AS new_native_count
FROM day_series ds
LEFT JOIN daily d ON d.day = ds.day
LEFT JOIN new_native_daily n ON n.day = ds.day
ORDER BY ds.day`;

export async function getZapstoreAppReleasesDaily(): Promise<ZapstoreAppReleasesDaily> {
	const result = await pool.query<{
		timestamp: string;
		github_count: string;
		native_count: string;
		new_native_count: string;
	}>(SQL_ZAPSTORE_APP_RELEASES_DAILY, [ZAPSTORE_PUBKEY, ZAPSTORE_OWN_D_TAGS]);

	const github: Array<{ timestamp: number; value: number }> = [];
	const native: Array<{ timestamp: number; value: number }> = [];
	const newNative: Array<{ timestamp: number; value: number }> = [];
	for (const r of result.rows) {
		const ts = parseInt(r.timestamp);
		github.push({ timestamp: ts, value: parseInt(r.github_count) });
		native.push({ timestamp: ts, value: parseInt(r.native_count) });
		newNative.push({ timestamp: ts, value: parseInt(r.new_native_count) });
	}
	return { github, native, newNative };
}

export interface ZapstoreAppDetail {
	app_pubkey: string;
	app_d_tag: string;
	display_name: string;
	icon_url: string | null;
	summary: string | null;
	description: string | null;
	// kind-32267 (zapstore-app-catalog) `url` (publisher "website") and `repository` (source forge)
	// tags, each sanitized to a safe absolute http(s) URL or null. ~99% of apps
	// carry a repository; ~46% a website. See sanitizeExternalUrl.
	website_url: string | null;
	repository_url: string | null;
	publisher_display_name: string;
	publisher_picture_url: string | null;
	publisher_nip05: string | null;
	is_zapstore_republished: boolean;
	total_count: number;
	total_sats: number;
	daily: Array<{
		timestamp: number;
		daily_count: number;
		cumulative_count: number;
		daily_sats: number;
		cumulative_sats: number;
	}>;
}

// Detail for a single Zapstore app (one (pubkey, d_tag) pair), returning the
// trailing-365-day daily/cumulative series + catalog metadata (name, icon,
// summary, description, website_url, repository_url). Powers
// /zapstore/apps/[pubkey]/[d_tag]. Returns null when neither the zaps table nor the
// catalog has the entry — caller renders a 404.
export async function getZapstoreAppDetail(
	pubkey: string,
	d_tag: string
): Promise<ZapstoreAppDetail | null> {
	const dailyPromise = pool.query<{
		timestamp: string;
		daily_count: string;
		cumulative_count: string;
		daily_msats: string;
		cumulative_msats: string;
	}>(
		`WITH window_zaps AS (
			SELECT created_at, COALESCE(amount_msats, 0) AS amount_msats
			FROM events_kind_9735_zaps_zapstore
			WHERE app_pubkey = $1 AND app_d_tag = $2
				AND created_at >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '365 days'))::bigint
		),
		day_series AS (
			SELECT generate_series(
				date_trunc('day', NOW() - INTERVAL '365 days'),
				date_trunc('day', NOW()),
				'1 day'::interval
			) AS day
		),
		daily AS (
			SELECT date_trunc('day', to_timestamp(created_at)) AS day,
				COUNT(*)::bigint           AS daily_count,
				SUM(amount_msats)::bigint  AS daily_msats
			FROM window_zaps
			GROUP BY 1
		),
		filled AS (
			SELECT ds.day,
				COALESCE(d.daily_count, 0) AS daily_count,
				COALESCE(d.daily_msats, 0) AS daily_msats
			FROM day_series ds
			LEFT JOIN daily d ON d.day = ds.day
		)
		SELECT
			EXTRACT(EPOCH FROM day)::bigint::text                  AS timestamp,
			daily_count::text                                       AS daily_count,
			SUM(daily_count) OVER (ORDER BY day)::bigint::text     AS cumulative_count,
			daily_msats::text                                       AS daily_msats,
			SUM(daily_msats) OVER (ORDER BY day)::bigint::text     AS cumulative_msats
		FROM filled
		ORDER BY day`,
		[pubkey, d_tag]
	);

	const catalogPromise = pool.query<{
		name: string | null;
		icon: string | null;
		summary: string | null;
		content: string | null;
		url: string | null;
		repository: string | null;
	}>(
		`SELECT name, icon, summary, content, url, repository
		 FROM events_kind_32267_app_catalog
		 WHERE pubkey = $1 AND d_tag = $2
		 ORDER BY created_at DESC
		 LIMIT 1`,
		[pubkey, d_tag]
	);

	const profilePromise = pool.query<{
		name: string | null;
		display_name: string | null;
		picture: string | null;
		nip05: string | null;
	}>(
		`SELECT name, display_name, picture, nip05
		 FROM events_kind_0_profiles
		 WHERE pubkey = $1`,
		[pubkey]
	);

	const [dailyRes, catalogRes, profileRes] = await Promise.all([
		dailyPromise,
		catalogPromise,
		profilePromise
	]);
	const catalog = catalogRes.rows[0];
	const profile = profileRes.rows[0] ?? null;
	const totalCount = dailyRes.rows.reduce((acc, r) => acc + parseInt(r.daily_count), 0);
	const lastRow = dailyRes.rows[dailyRes.rows.length - 1];
	const totalMsats = lastRow ? parseInt(lastRow.cumulative_msats) : 0;

	if (!catalog && totalCount === 0) {
		return null;
	}

	const msatsToSats = (msats: number): number => Math.round(msats / 1000);
	return {
		app_pubkey: pubkey,
		app_d_tag: d_tag,
		display_name: catalog?.name ?? d_tag,
		icon_url: catalog?.icon ?? null,
		summary: catalog?.summary ?? null,
		// kind-32267 (zapstore-app-catalog) `content` is the full app description (the paragraph the
		// Zapstore client renders). `summary` is just the short tagline tag and
		// is often absent (e.g. Amber), so the description is the more reliable
		// blurb. Treat empty/whitespace-only content as absent.
		description: catalog?.content && catalog.content.trim().length > 0 ? catalog.content : null,
		website_url: sanitizeExternalUrl(catalog?.url),
		repository_url: sanitizeExternalUrl(catalog?.repository),
		publisher_display_name: publisherDisplayName(
			profile?.display_name ?? null,
			profile?.name ?? null,
			pubkey
		),
		publisher_picture_url:
			profile?.picture && profile.picture.length > 0 ? profile.picture : null,
		publisher_nip05: profile?.nip05 && profile.nip05.length > 0 ? profile.nip05 : null,
		is_zapstore_republished:
			pubkey === ZAPSTORE_PUBKEY && !ZAPSTORE_OWN_D_TAGS.includes(d_tag),
		total_count: totalCount,
		total_sats: msatsToSats(totalMsats),
		daily: dailyRes.rows.map((row) => ({
			timestamp: parseInt(row.timestamp),
			daily_count: parseInt(row.daily_count),
			cumulative_count: parseInt(row.cumulative_count),
			daily_sats: msatsToSats(parseInt(row.daily_msats)),
			cumulative_sats: msatsToSats(parseInt(row.cumulative_msats))
		}))
	};
}

export interface ZapstoreAppRelease {
	event_id: string;
	created_at: number;       // unix seconds; releases are sorted desc by this
	version: string | null;   // explicit 'version' tag, or parsed from d_tag '<pkg>@<ver>'
	d_tag: string;            // raw '<pkg>@<ver>' for fallback rendering
	channel: string | null;   // 'c' tag — usually 'main'
	// The page links `repo_url ?? url`. Both are sanitized (sanitizeExternalUrl), so each is a
	// safe absolute http(s) URL or null: any pubkey can publish a release event.
	url: string | null;       // explicit 'url' tag
	repo_url: string | null;  // 'r' tag, typically a GitHub release link
	commit_sha: string | null;
	content: string;          // release notes markdown (may be empty)
}

// All releases for one Zapstore app, reverse-chronological. Reads
// events_kind_30063_app_releases scoped by (pubkey, app_d_tag) — the same
// (pubkey, app_d_tag) pair used by the zap leaderboards / app detail page,
// so the join is direct. Returns [] when an app has no acquired releases.
export async function getZapstoreAppReleases(
	pubkey: string,
	app_d_tag: string
): Promise<ZapstoreAppRelease[]> {
	const result = await pool.query<{
		event_id: string;
		created_at: string;
		version: string | null;
		d_tag: string;
		channel: string | null;
		url: string | null;
		repo_url: string | null;
		commit_sha: string | null;
		content: string;
	}>(
		`SELECT event_id,
			created_at::text,
			version,
			d_tag,
			channel,
			url,
			repo_url,
			commit_sha,
			content
		FROM events_kind_30063_app_releases
		WHERE pubkey = $1 AND app_d_tag = $2
		ORDER BY created_at DESC`,
		[pubkey, app_d_tag]
	);

	return result.rows.map((row) => ({
		event_id: row.event_id,
		created_at: parseInt(row.created_at),
		version: row.version,
		d_tag: row.d_tag,
		channel: row.channel,
		// Both fields, not only the one the page tries first: it falls back to `url` whenever
		// `repo_url` is null, so a raw `url` would reach the href exactly then.
		url: sanitizeExternalUrl(row.url),
		repo_url: sanitizeExternalUrl(row.repo_url),
		commit_sha: row.commit_sha,
		content: row.content
	}));
}

// Count of distinct PUBLIC Zapstore app stacks (kind-30267 (zapstore-app-stacks)) that reference the
// given app via an `a` tag matching '32267:<pubkey>:<app_d_tag>'. Encrypted
// private stacks (Zapstore client features — bookmarks, installed-app
// backups) populate `app_refs` empty/null and are excluded by the GIN
// partial index's WHERE clause; same public-stack semantics as the App
// Stack Appearances leaderboard. See getZapstoreAppStackLeaderboards
// docstring for the full rationale.
export async function getZapstoreAppStackAppearances(
	pubkey: string,
	app_d_tag: string
): Promise<number> {
	const aTagValue = `32267:${pubkey}:${app_d_tag}`;
	const result = await pool.query<{ stack_count: string }>(
		`SELECT count(*)::text AS stack_count
		FROM events_kind_30267_app_stacks
		WHERE app_refs @> ARRAY[$1::text]`,
		[aTagValue]
	);
	return parseInt(result.rows[0]?.stack_count ?? '0');
}

// Per-window app leaderboards for the /zapstore page. Returns all apps with
// any zaps in each of the five trailing windows (7d / 30d / 90d / 6m / 1y) plus
// an all-time `all` bucket (no created_at filter), each list sorted by
// total_sats DESC. Caller re-sorts client-side for the by-zap-count
// leaderboard. msats → sats conversion at this API boundary.
export async function getZapstoreAppLeaderboards(): Promise<ZapstoreAppLeaderboards> {
	// intervalDays === null → all-time (no created_at filter), mirroring the
	// `period === 'all' ? null : …` pattern in getNutzapMintStats.
	async function queryWindow(intervalDays: number | null): Promise<AppLeaderboardRow[]> {
		const windowClause =
			intervalDays === null
				? ''
				: `WHERE created_at >= EXTRACT(EPOCH FROM (NOW() - ($1 || ' days')::interval))::bigint`;
		const result = await pool.query<{
			app_pubkey: string;
			app_d_tag: string;
			catalog_name: string | null;
			catalog_icon: string | null;
			total_count: string;
			total_msats: string;
		}>(
			`WITH window_zaps AS (
				SELECT app_pubkey, app_d_tag,
					COALESCE(amount_msats, 0) AS amount_msats
				FROM events_kind_9735_zaps_zapstore
				${windowClause}
			),
			totals AS (
				SELECT app_pubkey, app_d_tag,
					COUNT(*)::bigint           AS total_count,
					SUM(amount_msats)::bigint  AS total_msats
				FROM window_zaps
				GROUP BY app_pubkey, app_d_tag
			),
			catalog AS (
				SELECT DISTINCT ON (pubkey, d_tag)
					pubkey, d_tag,
					name AS catalog_name,
					icon AS catalog_icon
				FROM events_kind_32267_app_catalog
				WHERE (pubkey, d_tag) IN (SELECT app_pubkey, app_d_tag FROM totals)
				ORDER BY pubkey, d_tag, created_at DESC
			)
			SELECT
				t.app_pubkey,
				t.app_d_tag,
				c.catalog_name,
				c.catalog_icon,
				t.total_count::text  AS total_count,
				t.total_msats::text  AS total_msats
			FROM totals t
			LEFT JOIN catalog c
				ON c.pubkey = t.app_pubkey AND c.d_tag = t.app_d_tag
			ORDER BY t.total_msats DESC, t.total_count DESC, t.app_d_tag ASC`,
			intervalDays === null ? [] : [String(intervalDays)]
		);

		const msatsToSats = (msats: number): number => Math.round(msats / 1000);
		return result.rows.map((row) => ({
			app_pubkey: row.app_pubkey,
			app_d_tag: row.app_d_tag,
			display_name: row.catalog_name ?? row.app_d_tag,
			icon_url: row.catalog_icon ?? null,
			total_count: parseInt(row.total_count),
			total_sats: msatsToSats(parseInt(row.total_msats))
		}));
	}

	const [w7d, w30d, w90d, w6m, w1y, wAll] = await Promise.all([
		queryWindow(7),
		queryWindow(30),
		queryWindow(90),
		queryWindow(182),
		queryWindow(365),
		queryWindow(null)
	]);
	return { '7d': w7d, '30d': w30d, '90d': w90d, '6m': w6m, '1y': w1y, all: wAll };
}

// Per-window app-stack-appearance leaderboards for the /zapstore page.
//
// IMPORTANT — public stacks only. Zapstore's `app_stacks` (kind-30267 (zapstore-app-stacks)) is two
// distinct things sharing the same kind:
//   1) Curated public app collections — plaintext `a` tags, empty `content`.
//   2) Per-user private features — encrypted `content`, no plaintext `a` tags.
//      Two known examples (confirmed from Zapstore source):
//        - d='zapstore-bookmarks' / 'Saved Apps'
//          (kAppBookmarksIdentifier in zapstore mobile's
//           lib/constants/app_constants.dart, SAVED_APPS_STACK_D_TAG in
//           zapstore-webapp's src/lib/config.js)
//        - d='zapstore-installed-backup' / 'Installed Apps'
//          (kInstalledAppsBackupIdentifier in the same Dart file)
// Empirically (2026-04-26): 132 / 508 stacks (~26%) are public; the rest
// are encrypted private. Zapstore's own webapp filters via `!event.content`
// (see webapp/src/lib/nostr/server.js); we filter via
// `array_length(app_refs, 1) > 0`, which is equivalent — the loader only
// populates `app_refs` from plaintext `a` tags, so encrypted stacks have
// empty/null arrays. The leaderboard reflects the public-stack subset only.
//
// Returns every app that appears in at least one public stack, sorted by
// stack_count DESC. The `stack_names` array powers the hover tooltip on the
// count cell in the UI.
//
// ALL-TIME ONLY. kind-30267 (zapstore-app-stacks) is parameterized-replaceable, so the table holds
// just the latest revision per (pubkey, d_tag) and `created_at` is "last
// edited", not an activity timestamp. A trailing window would therefore mean
// "stacks last edited in this window" — which drops a still-referenced stack
// the moment its curator stops touching it, and conflates editing with
// engagement. The honest metric is the current snapshot: "how many distinct
// public stacks reference this app right now". `queryWindow` retains its
// window parameter (the filter machinery is preserved and any caller can pass
// 7/30/365) but the page load invokes it only with `null` (no date filter).
export async function getZapstoreAppStackLeaderboards(): Promise<ZapstoreAppStackLeaderboards> {
	// intervalDays === null → all-time (no created_at filter). A positive value
	// restricts to stacks last edited within the trailing window. Mirrors the
	// `period === 'all' ? null : …` pattern in getNutzapMintStats.
	async function queryWindow(intervalDays: number | null): Promise<AppStackLeaderboardRow[]> {
		const windowClause =
			intervalDays === null
				? ''
				: `AND created_at >= EXTRACT(EPOCH FROM (NOW() - ($1 || ' days')::interval))::bigint`;
		const result = await pool.query<{
			app_pubkey: string;
			app_d_tag: string;
			catalog_name: string | null;
			catalog_icon: string | null;
			stack_count: string;
			stack_names: string[];
		}>(
			`WITH public_stacks_in_window AS (
				-- Public stacks only — see function docstring + init.sql comment.
				SELECT event_id, name, d_tag, app_refs
				FROM events_kind_30267_app_stacks
				WHERE coalesce(array_length(app_refs, 1), 0) > 0
					${windowClause}
			),
			expanded AS (
				SELECT
					ps.event_id,
					COALESCE(ps.name, ps.d_tag) AS stack_display,
					regexp_match(ref, '^32267:([0-9a-f]{64}):(.+)$') AS m
				FROM public_stacks_in_window ps,
					unnest(ps.app_refs) AS ref
			),
			app_appearances AS (
				SELECT
					m[1] AS app_pubkey,
					m[2] AS app_d_tag,
					COUNT(DISTINCT event_id)::bigint AS stack_count,
					array_agg(DISTINCT stack_display ORDER BY stack_display) AS stack_names
				FROM expanded
				WHERE m IS NOT NULL
				GROUP BY m[1], m[2]
			),
			catalog AS (
				SELECT DISTINCT ON (pubkey, d_tag)
					pubkey, d_tag,
					name AS catalog_name,
					icon AS catalog_icon
				FROM events_kind_32267_app_catalog
				WHERE (pubkey, d_tag) IN (SELECT app_pubkey, app_d_tag FROM app_appearances)
				ORDER BY pubkey, d_tag, created_at DESC
			)
			SELECT
				aa.app_pubkey,
				aa.app_d_tag,
				c.catalog_name,
				c.catalog_icon,
				aa.stack_count::text AS stack_count,
				aa.stack_names
			FROM app_appearances aa
			LEFT JOIN catalog c ON c.pubkey = aa.app_pubkey AND c.d_tag = aa.app_d_tag
			ORDER BY aa.stack_count DESC, aa.app_d_tag ASC`,
			intervalDays === null ? [] : [String(intervalDays)]
		);

		return result.rows.map((row) => ({
			app_pubkey: row.app_pubkey,
			app_d_tag: row.app_d_tag,
			display_name: row.catalog_name ?? row.app_d_tag,
			icon_url: row.catalog_icon ?? null,
			stack_count: parseInt(row.stack_count),
			stack_names: row.stack_names ?? []
		}));
	}

	// All-time only (intervalDays = null). queryWindow keeps its window param so
	// the 7d/30d/365d filters can be re-enabled by a future caller without
	// touching the SQL — see docstring.
	const all = await queryWindow(null);
	return { all };
}

/** One row per app page the sitemap lists: the two fields that spell its URL.
 *
 * Deliberately NOT getZapstoreAllApps(), which the page beside it uses: that one runs a
 * CTE over the releases table, groups it, joins profiles and first-release, and returns
 * twelve columns including every app's free-text summary - to produce a URL made of two
 * of them. This is the same catalog, no joins, no free text.
 *
 * It matters because of who calls it. The sitemap is fetched by crawlers rather than by
 * people, on their schedule, and the serving cluster has a 1.0 ACU CEILING - so the cost
 * of a crawl shows up as slow pages for everyone, not as a bill. DISTINCT because the
 * catalog holds one row per app already, and a duplicate here would be a duplicate URL.
 *
 * The app page and the publisher page are both keyed by this same pubkey: an app's
 * publisher IS its event author (getZapstoreAllApps selects `a.pubkey AS
 * publisher_pubkey` for exactly that reason). */
export async function getSitemapApps(): Promise<{ pubkey: string; d_tag: string }[]> {
	const result = await pool.query<{ pubkey: string; d_tag: string }>(
		`SELECT DISTINCT pubkey, d_tag
		 FROM events_kind_32267_app_catalog
		 WHERE d_tag <> ''
		 ORDER BY pubkey, d_tag`
	);
	return result.rows;
}

// All apps in events_kind_32267_app_catalog with publisher profile + earliest
// release date, for /zapstore/apps. Returns the full list (~2.6K rows today)
// — sorting happens client-side.
export async function getZapstoreAllApps(): Promise<ZapstoreAppListRow[]> {
	const result = await pool.query<{
		app_pubkey: string;
		app_d_tag: string;
		app_name: string | null;
		publisher_pubkey: string;
		publisher_name: string | null;
		summary: string | null;
		icon_url: string | null;
		app_url: string | null;
		repo_url: string | null;
		first_release_at: string;
		first_release_is_release_event: boolean;
		is_zapstore_republished: boolean;
	}>(
		`WITH first_release AS (
			SELECT pubkey, app_d_tag, MIN(created_at) AS first_release_at
			FROM events_kind_30063_app_releases
			GROUP BY pubkey, app_d_tag
		)
		SELECT
			a.pubkey                                            AS app_pubkey,
			a.d_tag                                             AS app_d_tag,
			a.name                                              AS app_name,
			a.pubkey                                            AS publisher_pubkey,
			COALESCE(NULLIF(p.display_name, ''), NULLIF(p.name, '')) AS publisher_name,
			a.summary                                           AS summary,
			a.icon                                              AS icon_url,
			a.url                                               AS app_url,
			a.repository                                        AS repo_url,
			COALESCE(fr.first_release_at, a.created_at)::text   AS first_release_at,
			(fr.first_release_at IS NOT NULL)                   AS first_release_is_release_event,
			(a.pubkey = $1 AND a.d_tag <> ALL($2))             AS is_zapstore_republished
		FROM events_kind_32267_app_catalog a
		LEFT JOIN events_kind_0_profiles  p  ON p.pubkey = a.pubkey
		LEFT JOIN first_release           fr ON fr.pubkey = a.pubkey AND fr.app_d_tag = a.d_tag
		ORDER BY COALESCE(NULLIF(a.name, ''), a.d_tag) ASC`,
		[ZAPSTORE_PUBKEY, ZAPSTORE_OWN_D_TAGS]
	);

	return result.rows.map((r) => ({
		app_pubkey: r.app_pubkey,
		app_d_tag: r.app_d_tag,
		app_name: r.app_name && r.app_name.length > 0 ? r.app_name : r.app_d_tag,
		publisher_pubkey: r.publisher_pubkey,
		publisher_name: r.publisher_name,
		summary: r.summary,
		icon_url: r.icon_url,
		// The catalog's `url` and `repository`, which the app page links as Website and Repo,
		// so they get the same sanitizer here: this list links them too, for every pubkey's apps.
		app_url: sanitizeExternalUrl(r.app_url),
		repo_url: sanitizeExternalUrl(r.repo_url),
		first_release_at: parseInt(r.first_release_at),
		first_release_is_release_event: r.first_release_is_release_event,
		is_zapstore_republished: r.is_zapstore_republished
	}));
}

// ---------------------------------------------------------------------------
// Zapstore — publisher leaderboards
// ---------------------------------------------------------------------------
// "Publisher" = the pubkey that published the kind-32267 (zapstore-app-catalog) catalog entry. The
// Zapstore main account (78ce6faa…, see ZAPSTORE_PUBKEY) appears here too,
// but only its OWN apps (ZAPSTORE_OWN_D_TAGS — the Zapstore Android client,
// its alpha-track build, and zapstore-cli) count toward its publisher
// totals; the ~2.4K apps it republishes from GitHub/F-Droid don't, since
// it only republished them - the original developers wrote them, and this
// is exactly the case the "publisher" (pubkey that signed the kind-32267 (zapstore-app-catalog))
// vs "developer" (human who wrote the code) split exists to keep straight.
// Same partition rule as the /zapstore overview chart and the
// /zapstore/apps source filter.

// Helper — produces a stable, human-readable label even when no profile or
// kind-0 (profile-metadata) fields are present. Mirrors how the All Apps page falls back to a
// truncated pubkey, so behaviour is consistent across the Zapstore UI.
function publisherDisplayName(
	displayName: string | null,
	name: string | null,
	pubkey: string
): string {
	if (displayName && displayName.length > 0) return displayName;
	if (name && name.length > 0) return name;
	return `${pubkey.slice(0, 8)}…`;
}

// Lifetime count of distinct apps per publisher pubkey. No time window —
// this is a "Total Apps" view that mirrors how the /zapstore overview chart
// counts cumulative apps. Returns every pubkey with at least one catalog
// entry, sorted by app_count DESC.
export async function getZapstorePublisherAppCounts(): Promise<PublisherAppCount[]> {
	const result = await pool.query<{
		pubkey: string;
		display_name: string | null;
		name: string | null;
		picture_url: string | null;
		app_count: string;
	}>(
		`WITH publisher_apps AS (
			SELECT pubkey, COUNT(DISTINCT d_tag)::bigint AS app_count
			FROM events_kind_32267_app_catalog
			WHERE pubkey <> $1 OR d_tag = ANY($2)
			GROUP BY pubkey
		)
		SELECT
			pa.pubkey,
			NULLIF(p.display_name, '')   AS display_name,
			NULLIF(p.name, '')           AS name,
			NULLIF(p.picture, '')        AS picture_url,
			pa.app_count::text           AS app_count
		FROM publisher_apps pa
		LEFT JOIN events_kind_0_profiles p ON p.pubkey = pa.pubkey
		ORDER BY pa.app_count DESC, pa.pubkey ASC`,
		[ZAPSTORE_PUBKEY, ZAPSTORE_OWN_D_TAGS]
	);

	return result.rows.map((r) => ({
		pubkey: r.pubkey,
		display_name: publisherDisplayName(r.display_name, r.name, r.pubkey),
		picture_url: r.picture_url,
		app_count: parseInt(r.app_count)
	}));
}

// Per-window total sats and zap counts aggregated to the publisher pubkey
// (= app_pubkey on the zap event). Returns every publisher with at least
// one Zapstore-attributed zap in each of the trailing 7d / 30d / 90d / 6m / 1y
// windows plus an all-time `all` bucket (no created_at filter), server-sorted
// by total_sats DESC. Caller re-sorts for the by-zap-count card. Mirrors the
// per-app `getZapstoreAppLeaderboards` shape so the publisher card can use the
// same period-selector pattern.
export async function getZapstorePublisherZapLeaderboards(): Promise<ZapstorePublisherZapsLeaderboards> {
	// intervalDays === null → all-time (no created_at filter). The interval is the
	// LAST positional param ($3) so it can be dropped for all-time while the
	// static $1/$2 (Zapstore pubkey + own d-tags) keep their positions.
	async function queryWindow(intervalDays: number | null): Promise<PublisherZapTotals[]> {
		const windowClause =
			intervalDays === null
				? ''
				: `AND created_at >= EXTRACT(EPOCH FROM (NOW() - ($3 || ' days')::interval))::bigint`;
		const params: (string | string[])[] =
			intervalDays === null
				? [ZAPSTORE_PUBKEY, ZAPSTORE_OWN_D_TAGS]
				: [ZAPSTORE_PUBKEY, ZAPSTORE_OWN_D_TAGS, String(intervalDays)];
		const result = await pool.query<{
			pubkey: string;
			display_name: string | null;
			name: string | null;
			picture_url: string | null;
			total_count: string;
			total_msats: string;
		}>(
			`WITH window_zaps AS (
				SELECT app_pubkey, app_d_tag, COALESCE(amount_msats, 0) AS amount_msats
				FROM events_kind_9735_zaps_zapstore
				WHERE (app_pubkey <> $1 OR app_d_tag = ANY($2))
					${windowClause}
			),
			totals AS (
				SELECT app_pubkey AS pubkey,
					COUNT(*)::bigint           AS total_count,
					SUM(amount_msats)::bigint  AS total_msats
				FROM window_zaps
				GROUP BY app_pubkey
			)
			SELECT
				t.pubkey,
				NULLIF(p.display_name, '')   AS display_name,
				NULLIF(p.name, '')           AS name,
				NULLIF(p.picture, '')        AS picture_url,
				t.total_count::text          AS total_count,
				t.total_msats::text          AS total_msats
			FROM totals t
			LEFT JOIN events_kind_0_profiles p ON p.pubkey = t.pubkey
			ORDER BY t.total_msats DESC, t.total_count DESC, t.pubkey ASC`,
			params
		);

		const msatsToSats = (msats: number): number => Math.round(msats / 1000);
		return result.rows.map((r) => ({
			pubkey: r.pubkey,
			display_name: publisherDisplayName(r.display_name, r.name, r.pubkey),
			picture_url: r.picture_url,
			total_count: parseInt(r.total_count),
			total_sats: msatsToSats(parseInt(r.total_msats))
		}));
	}

	const [w7d, w30d, w90d, w6m, w1y, wAll] = await Promise.all([
		queryWindow(7),
		queryWindow(30),
		queryWindow(90),
		queryWindow(182),
		queryWindow(365),
		queryWindow(null)
	]);
	return { '7d': w7d, '30d': w30d, '90d': w90d, '6m': w6m, '1y': w1y, all: wAll };
}

export interface ZapstorePublisherDetailApp {
	app_d_tag: string;
	app_name: string;          // catalog name, falls back to d_tag
	summary: string | null;
	icon_url: string | null;
	first_release_at: number;  // earliest kind-30063 (zapstore-app-releases) release; falls back to catalog created_at
	first_release_is_release_event: boolean;
	zap_count_1y: number;
	zap_sats_1y: number;
	stack_count: number;       // distinct public app-stacks the app appears in
}

export interface ZapstorePublisherReleaseMarker {
	created_at: number;        // unix seconds
	app_d_tag: string;         // catalog d_tag (links the release to the app)
	app_name: string;          // catalog name, falls back to d_tag — used in chart tooltips
	version: string | null;    // typed `version` tag from kind-30063 (zapstore-app-releases)
	release_d_tag: string;     // raw kind-30063 (zapstore-app-releases) d_tag (typically `<pkg>@<ver>`); not used as a tooltip fallback — page uses releaseLabel() which falls back to app_name
}

export interface ZapstorePublisherDetail {
	pubkey: string;
	display_name: string;
	picture_url: string | null;
	about: string | null;
	nip05: string | null;
	is_zapstore_republished: boolean; // pubkey === Zapstore main account
	total_apps: number;
	total_count_1y: number;    // zaps in past 365d, summed across all apps
	total_sats_1y: number;     // sats in past 365d, summed across all apps
	apps: ZapstorePublisherDetailApp[];
	// Daily / cumulative zap-count and sats series, summed across all the
	// publisher's apps for the trailing 365-day window. Same shape as the
	// per-app `getZapstoreAppDetail.daily` series so the page can use the
	// same PerAppZapChart components.
	daily: Array<{
		timestamp: number;
		daily_count: number;
		cumulative_count: number;
		daily_sats: number;
		cumulative_sats: number;
	}>;
	// Every kind-30063 (zapstore-app-releases) release from this publisher in the trailing 365-day
	// window. The chart UI buckets these by UTC day and joins labels into
	// the tooltip, so multi-app same-day releases collapse cleanly.
	releases: ZapstorePublisherReleaseMarker[];
}

// Detail view for a single publisher (the pubkey that signed the kind-32267 (zapstore-app-catalog)
// catalog entry - see the leaderboards section header). Returns the
// publisher's profile, every app they've published, and a 365-day daily +
// cumulative series of zaps and sats summed across all their apps. Returns
// null when the pubkey has no kind-32267 (zapstore-app-catalog) catalog entries — caller renders
// a 404 (this page only makes sense for pubkeys that actually publish to
// the Zapstore catalog).
export async function getZapstorePublisherDetail(
	pubkey: string
): Promise<ZapstorePublisherDetail | null> {
	const profilePromise = pool.query<{
		name: string | null;
		display_name: string | null;
		picture: string | null;
		about: string | null;
		nip05: string | null;
	}>(
		`SELECT name, display_name, picture, about, nip05
		 FROM events_kind_0_profiles
		 WHERE pubkey = $1`,
		[pubkey]
	);

	const appsPromise = pool.query<{
		app_d_tag: string;
		app_name: string | null;
		summary: string | null;
		icon_url: string | null;
		first_release_at: string;
		first_release_is_release_event: boolean;
		zap_count_1y: string;
		zap_msats_1y: string;
	}>(
		`WITH first_release AS (
			SELECT app_d_tag, MIN(created_at) AS first_release_at
			FROM events_kind_30063_app_releases
			WHERE pubkey = $1
			GROUP BY app_d_tag
		),
		zaps_1y AS (
			SELECT app_d_tag,
				COUNT(*)::bigint                       AS zap_count,
				COALESCE(SUM(amount_msats), 0)::bigint AS zap_msats
			FROM events_kind_9735_zaps_zapstore
			WHERE app_pubkey = $1
				AND created_at >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '365 days'))::bigint
			GROUP BY app_d_tag
		)
		SELECT
			a.d_tag                                             AS app_d_tag,
			a.name                                              AS app_name,
			a.summary                                           AS summary,
			a.icon                                              AS icon_url,
			COALESCE(fr.first_release_at, a.created_at)::text   AS first_release_at,
			(fr.first_release_at IS NOT NULL)                   AS first_release_is_release_event,
			COALESCE(z.zap_count, 0)::text                      AS zap_count_1y,
			COALESCE(z.zap_msats, 0)::text                      AS zap_msats_1y
		FROM events_kind_32267_app_catalog a
		LEFT JOIN first_release fr ON fr.app_d_tag = a.d_tag
		LEFT JOIN zaps_1y       z  ON z.app_d_tag  = a.d_tag
		WHERE a.pubkey = $1
		ORDER BY COALESCE(z.zap_msats, 0) DESC,
			COALESCE(NULLIF(a.name, ''), a.d_tag) ASC,
			a.d_tag ASC`,
		[pubkey]
	);

	// Per-app stack appearances for this publisher's apps. Public stacks
	// only — same `coalesce(array_length(app_refs, 1), 0) > 0` filter as
	// the App Stack Appearances leaderboard. Returns one row per app that
	// appears in ≥1 public stack; missing apps default to 0 client-side.
	const stacksPromise = pool.query<{
		app_d_tag: string;
		stack_count: string;
	}>(
		`WITH expanded AS (
			SELECT ps.event_id,
				regexp_match(ref, '^32267:([0-9a-f]{64}):(.+)$') AS m
			FROM events_kind_30267_app_stacks ps,
				unnest(ps.app_refs) AS ref
			WHERE coalesce(array_length(ps.app_refs, 1), 0) > 0
		)
		SELECT m[2]                                AS app_d_tag,
			COUNT(DISTINCT event_id)::bigint::text AS stack_count
		FROM expanded
		WHERE m IS NOT NULL AND m[1] = $1
		GROUP BY m[2]`,
		[pubkey]
	);

	const releasesPromise = pool.query<{
		created_at: string;
		app_d_tag: string;
		app_name: string | null;
		version: string | null;
		release_d_tag: string;
	}>(
		`SELECT
			r.created_at::text                                                  AS created_at,
			r.app_d_tag                                                         AS app_d_tag,
			COALESCE(NULLIF(c.name, ''), r.app_d_tag)                           AS app_name,
			NULLIF(r.version, '')                                               AS version,
			r.d_tag                                                             AS release_d_tag
		 FROM events_kind_30063_app_releases r
		 LEFT JOIN events_kind_32267_app_catalog c
			ON c.pubkey = r.pubkey AND c.d_tag = r.app_d_tag
		 WHERE r.pubkey = $1
			AND r.created_at >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '365 days'))::bigint
		 ORDER BY r.created_at ASC`,
		[pubkey]
	);

	const dailyPromise = pool.query<{
		timestamp: string;
		daily_count: string;
		cumulative_count: string;
		daily_msats: string;
		cumulative_msats: string;
	}>(
		`WITH window_zaps AS (
			SELECT created_at, COALESCE(amount_msats, 0) AS amount_msats
			FROM events_kind_9735_zaps_zapstore
			WHERE app_pubkey = $1
				AND created_at >= EXTRACT(EPOCH FROM (NOW() - INTERVAL '365 days'))::bigint
		),
		day_series AS (
			SELECT generate_series(
				date_trunc('day', NOW() - INTERVAL '365 days'),
				date_trunc('day', NOW()),
				'1 day'::interval
			) AS day
		),
		daily AS (
			SELECT date_trunc('day', to_timestamp(created_at)) AS day,
				COUNT(*)::bigint           AS daily_count,
				SUM(amount_msats)::bigint  AS daily_msats
			FROM window_zaps
			GROUP BY 1
		),
		filled AS (
			SELECT ds.day,
				COALESCE(d.daily_count, 0) AS daily_count,
				COALESCE(d.daily_msats, 0) AS daily_msats
			FROM day_series ds
			LEFT JOIN daily d ON d.day = ds.day
		)
		SELECT
			EXTRACT(EPOCH FROM day)::bigint::text                  AS timestamp,
			daily_count::text                                       AS daily_count,
			SUM(daily_count) OVER (ORDER BY day)::bigint::text     AS cumulative_count,
			daily_msats::text                                       AS daily_msats,
			SUM(daily_msats) OVER (ORDER BY day)::bigint::text     AS cumulative_msats
		FROM filled
		ORDER BY day`,
		[pubkey]
	);

	const [profileRes, appsRes, dailyRes, releasesRes, stacksRes] = await Promise.all([
		profilePromise,
		appsPromise,
		dailyPromise,
		releasesPromise,
		stacksPromise
	]);

	const stackCountByDTag = new Map<string, number>();
	for (const row of stacksRes.rows) {
		stackCountByDTag.set(row.app_d_tag, parseInt(row.stack_count));
	}

	if (appsRes.rows.length === 0) {
		return null;
	}

	const profile = profileRes.rows[0] ?? null;
	const msatsToSats = (msats: number): number => Math.round(msats / 1000);

	let totalCount1y = 0;
	let totalMsats1y = 0;
	const apps: ZapstorePublisherDetailApp[] = appsRes.rows.map((r) => {
		const count = parseInt(r.zap_count_1y);
		const msats = parseInt(r.zap_msats_1y);
		totalCount1y += count;
		totalMsats1y += msats;
		return {
			app_d_tag: r.app_d_tag,
			app_name: r.app_name && r.app_name.length > 0 ? r.app_name : r.app_d_tag,
			summary: r.summary,
			icon_url: r.icon_url,
			first_release_at: parseInt(r.first_release_at),
			first_release_is_release_event: r.first_release_is_release_event,
			zap_count_1y: count,
			zap_sats_1y: msatsToSats(msats),
			stack_count: stackCountByDTag.get(r.app_d_tag) ?? 0
		};
	});

	return {
		pubkey,
		display_name: publisherDisplayName(
			profile?.display_name ?? null,
			profile?.name ?? null,
			pubkey
		),
		picture_url: profile?.picture && profile.picture.length > 0 ? profile.picture : null,
		about: profile?.about && profile.about.length > 0 ? profile.about : null,
		nip05: profile?.nip05 && profile.nip05.length > 0 ? profile.nip05 : null,
		is_zapstore_republished: pubkey === ZAPSTORE_PUBKEY,
		total_apps: apps.length,
		total_count_1y: totalCount1y,
		total_sats_1y: msatsToSats(totalMsats1y),
		apps,
		daily: dailyRes.rows.map((row) => ({
			timestamp: parseInt(row.timestamp),
			daily_count: parseInt(row.daily_count),
			cumulative_count: parseInt(row.cumulative_count),
			daily_sats: msatsToSats(parseInt(row.daily_msats)),
			cumulative_sats: msatsToSats(parseInt(row.cumulative_msats))
		})),
		releases: releasesRes.rows.map((row) => ({
			created_at: parseInt(row.created_at),
			app_d_tag: row.app_d_tag,
			app_name: row.app_name && row.app_name.length > 0 ? row.app_name : row.app_d_tag,
			version: row.version,
			release_d_tag: row.release_d_tag
		}))
	};
}

// Lightning Address (lud16) providers
// "Well-formed lud16" filter — local-part and domain non-empty and free of
// `@` / whitespace, with at least one dot in the domain. Matches the email-
// shaped subset of NIP-57 Lightning Addresses; rejects bare LNURLs, on-chain
// addresses, raw bolt11 invoices, and other junk we observed in profiles.
//
// Deliberately looser than LUD-16 (which restricts the local-part to
// lowercase `[a-z0-9-_.]` plus optional `+`). LUD-16 itself notes the spec is
// "way more strict than common email addresses" — but real wallets normalize
// before resolution, so addresses with uppercase or other email-legal chars
// (e.g. `Bob@primal.net`) are still resolvable in practice. ~2.6% of the
// otherwise-well-formed lud16 values in our profiles use uppercase; rejecting
// them would silently drop those users from the provider leaderboard.
//
// Exported as a constant (and used inline in SQL_LIGHTNING_PROVIDER_STATS_MV) so
// the test suite can exercise the *same* regex the production MV runs.
export const LUD16_WELL_FORMED_REGEX_SQL = String.raw`^[^@\s]+@[^@\s]+\.[^@\s]+$`;

// Aggregate Lightning Address providers from well-formed lud16 fields in the
// latest kind-0 (profile-metadata) of any non-blocklisted profile, grouped by domain. Powers the
// /lightning leaderboard.
//
// Promoted to a materialized view (lightning_provider_stats_mv, mirroring
// relay_stats_mv) on 2026-06-30: the live JIT scan was ~2 s warm at ~2.3M
// profiles (parallel seq scan + per-row regex, no usable index — measured, the
// earlier ~600 ms estimate was stale), I/O-bound at the serving-time 1-ACU
// ceiling. The MV is refreshed CONCURRENTLY by the Dagster lightning_mv asset
// after the kind-0 (profile-metadata) load; reading it is a ~2k-row scan (single-digit ms).
//
// MV BODY MIRROR: SQL_LIGHTNING_PROVIDER_STATS_MV below is the byte-faithful
// copy of the lightning_provider_stats_mv definition in nostrology-data's
// schema/init.sql — the integration tests CREATE a TEMP VIEW of that name from
// it to shadow the real MV over a temp kind-0 (profile-metadata) fixture (a VIEW, not a TABLE, so it
// recomputes live from the fixture on each read), so they exercise the SAME
// aggregation logic the production MV runs. Keep the two copies in sync.
export const SQL_LIGHTNING_PROVIDER_STATS_MV = `
WITH parsed AS (
	SELECT lower(split_part(lud16, '@', 2)) AS domain
	FROM events_kind_0_profiles
	WHERE lud16 ~ '${LUD16_WELL_FORMED_REGEX_SQL}'
)
SELECT domain, COUNT(*)::int AS user_count
FROM parsed
GROUP BY domain
`;

// Production query: read the pre-aggregated MV, ordering on read (the MV carries
// idx_lightning_provider_stats_mv_user_count_desc). Exported so the test suite
// runs the production SQL verbatim.
export const SQL_LIGHTNING_PROVIDER_STATS = `
SELECT domain, user_count
FROM lightning_provider_stats_mv
ORDER BY user_count DESC
`;

export async function getLightningProviderStats(): Promise<LightningProviderStat[]> {
	const result = await pool.query<{ domain: string; user_count: number }>(
		SQL_LIGHTNING_PROVIDER_STATS
	);
	return result.rows;
}

// ─────────────────────────────────────────────────────────────────────────
// /lightning trend charts — at-the-time provider attribution from kind-9735 (zap-receipts)
// ─────────────────────────────────────────────────────────────────────────
//
// Each kind-9735 (zap-receipts) zap-receipt is signed by the recipient wallet's NIP-57
// LNURL service signer (event.pubkey on the raw event). We capture that
// signer pubkey into events_kind_9735_zaps.lnurl_signer_pubkey and JOIN
// against the lightning_provider_signers mapping table, externally verified
// against each provider's published nostrPubkey.
//
// This gives ZERO survivorship bias — the signer is whoever signed THAT
// exact zap, regardless of whether the recipient later switched providers.
//
// Two independent amount guards protect the trend aggregation, both pinned
// by tests in lightning-trends.test.ts:
//
//   1. SPAM FILTER (WHERE amount_msats <= 21000000000 = 0.21 BTC, in
//      daily_raw): excludes economically impossible zaps ENTIRELY, on every
//      metric. Targets the 2026-05-19 relay.zapstore.dev spam — 23 structurally
//      flawless receipts (valid NIP-01 IDs, valid Schnorr sigs, matching
//      bolt11/description amounts AND description hashes) for 2,100 BTC up to
//      21M BTC per zap. They pass every deterministic NIP-57 check, so the
//      impossible amount is the only reliable signal.
//
//   2. SATS CAP (LEAST(amount_msats, 10000000000) = 0.1 BTC, sats-sum only):
//      clamps each zap's contribution to the sats SUM so a large-but-surviving
//      zap can't spike a provider line. Neutralizes the 4 older zap-requests
//      over 100M sats (largest ~10 BTC) that are almost certainly spoofed (no
//      LN settlement). A zap between 0.1 and 0.21 BTC survives the filter but
//      is clamped here.
//
// The cap is well above any plausible legitimate human-scale zap. Per user
// direction: documented here in the SQL comment, NOT surfaced in the chart
// subtitle.
//
// "Compute since beginning of (compute) time, trim only the OUTPUT to
// trailing 365d" — we compute from NOW() - 395 days so the leftmost day of
// the trimmed-365d output already has a full 30-day rolling window behind
// it.

// MV BODY MIRROR: byte-faithful copy of the lightning_daily_provider_mv
// definition in nostrology-data's schema/init.sql — the daily (day, provider)
// grain (signer→provider mapping, spam filter, sats cap) over ALL history. The
// expensive part (the ~3.5M-row LEFT JOIN against lightning_provider_signers)
// lives here and is computed ONCE per daily Dagster load, not per request.
// The integration tests CREATE a TEMP VIEW of this name from this constant to
// shadow the real MV over temp fixtures (a VIEW, not a TABLE, so it recomputes
// live from the fixtures on each read), so they run the SAME aggregation logic
// production serves. Keep in sync with init.sql. NB: unwindowed (all history) —
// the per-request window (-395d compute / -365d output) is applied below.
export const SQL_LIGHTNING_DAILY_PROVIDER_MV = `
SELECT
	date_trunc('day', to_timestamp(z.created_at))::date AS day,
	COALESCE(m.provider_domain, 'other') AS provider,
	COUNT(*) AS daily_zaps,
	SUM(LEAST(z.amount_msats, 10000000000))::bigint / 1000 AS daily_sats
FROM events_kind_9735_zaps z
LEFT JOIN lightning_provider_signers m ON m.signer_pubkey = z.lnurl_signer_pubkey
WHERE z.amount_msats IS NOT NULL
  AND z.amount_msats > 0
  AND z.amount_msats <= 21000000000  -- filter spam: zaps above 21M sats (0.21 BTC) are anomalous on Nostr; all three May-19-2026 spam groups (2.1Q/2.1B/210M-sat "21×" pattern from relay.zapstore.dev) fall above this threshold
GROUP BY 1, 2
`;

// Skeleton shared by all three trends queries. Distinguishing factors
// (top-N ordering metric + final SELECT projection) are spliced in via
// template parameters at module-init time. $1 = top-N limit.
//
// Performance shape: the heavy aggregate (signer-map LEFT JOIN + spam filter +
// sats cap collapsing the ~3.5M-row kind-9735 (zap-receipts) stream to a few-K (day, provider)
// buckets) is now PRECOMPUTED in lightning_daily_provider_mv — refreshed
// CONCURRENTLY by the Dagster lightning_mv asset, once per daily load. Each
// request reads ~a few-K MV rows and runs only the top-N selection + rolling-
// window math on that small intermediate, so warm latency drops from ~5.5 s
// (full re-scan, ×4 concurrent) to single-digit ms.
function _buildTrendsQuery(opts: {
	// `daily_raw` is keyed on the actual signer-mapped provider; top-N
	// metric is computed by aggregating from there, so the metric expression
	// is in terms of the daily aggregates, NOT the raw event stream.
	topNMetricExpr: 'SUM(daily_zaps)' | 'SUM(daily_sats)';
	// Final value column emitted from `shares`.
	finalValueExpr: string;
}): string {
	return `
WITH daily_raw AS (
	-- Read the precomputed daily provider grain from the MV. Window to -395d so
	-- day 1 of the trimmed -365d output already has a full 30-day rolling window
	-- behind it (the MV itself is unwindowed / all-history).
	SELECT day, provider, daily_zaps, daily_sats
	FROM lightning_daily_provider_mv
	WHERE day >= (NOW() - INTERVAL '395 days')::date
),
top_n_providers AS (
	-- Pick top-N providers by activity over the trimmed-output window
	-- (trailing 365d only — NOT the wider compute window). Keeps the line
	-- set stable across different top-N values; pre-365d activity doesn't
	-- influence membership.
	SELECT provider FROM (
		SELECT provider, ${opts.topNMetricExpr} AS metric
		FROM daily_raw
		WHERE day >= (NOW() - INTERVAL '365 days')::date
		  AND provider <> 'other'
		GROUP BY provider
		ORDER BY metric DESC
		LIMIT $1
	) s
),
daily AS (
	-- Re-bucket: keep top-N providers as-is, fold every other provider
	-- (including 'other' itself) into a single 'other' line so the share
	-- charts sum to 100%.
	SELECT day,
		CASE WHEN t.provider IS NOT NULL THEN d.provider ELSE 'other' END AS provider,
		SUM(d.daily_zaps) AS daily_zaps,
		SUM(d.daily_sats) AS daily_sats
	FROM daily_raw d
	LEFT JOIN top_n_providers t ON t.provider = d.provider
	GROUP BY 1, 2
),
calendar AS (
	-- Continuous date axis so missing-day gaps don't break the rolling sum
	-- (otherwise a quiet day collapses the window from 30 → fewer entries).
	SELECT generate_series(
		(NOW() - INTERVAL '395 days')::date,
		NOW()::date,
		'1 day'::interval
	)::date AS day
),
all_providers AS (SELECT DISTINCT provider FROM daily),
filled AS (
	SELECT c.day, p.provider,
		COALESCE(d.daily_zaps, 0) AS daily_zaps,
		COALESCE(d.daily_sats, 0) AS daily_sats
	FROM calendar c CROSS JOIN all_providers p
	LEFT JOIN daily d ON d.day = c.day AND d.provider = p.provider
),
rolling AS (
	SELECT day, provider,
		SUM(daily_zaps) OVER (PARTITION BY provider ORDER BY day ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) AS rolling_zaps,
		SUM(daily_sats) OVER (PARTITION BY provider ORDER BY day ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) AS rolling_sats
	FROM filled
),
shares AS (
	SELECT day, provider, rolling_zaps, rolling_sats,
		100.0 * rolling_zaps / NULLIF(SUM(rolling_zaps) OVER (PARTITION BY day), 0) AS rolling_zap_share_pct,
		100.0 * rolling_sats / NULLIF(SUM(rolling_sats) OVER (PARTITION BY day), 0) AS rolling_sats_share_pct
	FROM rolling
)
SELECT day::text AS day, provider,
	COALESCE(${opts.finalValueExpr}, 0)::float AS value
FROM shares
WHERE day >= (NOW() - INTERVAL '365 days')::date
ORDER BY day, provider
`;
}

export const SQL_LIGHTNING_TRENDS_ZAP_SHARE_30D = _buildTrendsQuery({
	topNMetricExpr: 'SUM(daily_zaps)',
	finalValueExpr: 'rolling_zap_share_pct',
});

export const SQL_LIGHTNING_TRENDS_SATS_SHARE_30D = _buildTrendsQuery({
	topNMetricExpr: 'SUM(daily_sats)',
	finalValueExpr: 'rolling_sats_share_pct',
});

export const SQL_LIGHTNING_TRENDS_SATS_ABSOLUTE_30D = _buildTrendsQuery({
	topNMetricExpr: 'SUM(daily_sats)',
	finalValueExpr: 'rolling_sats',
});

// Zap counts (absolute, rolling-30d) per provider — used client-side to
// enrich the zap-share chart's tooltip and rank table with absolute zap
// counts alongside the % share. Top-N selection is by zap count (matches
// the share query so candidate pool membership is identical).
export const SQL_LIGHTNING_TRENDS_ZAPS_ABSOLUTE_30D = _buildTrendsQuery({
	topNMetricExpr: 'SUM(daily_zaps)',
	finalValueExpr: 'rolling_zaps',
});

async function _fetchTrends(sql: string, limit: number): Promise<LightningTrendsRow[]> {
	const result = await pool.query<{ day: string; provider: string; value: string }>(
		sql,
		[limit],
	);
	// pg returns numerics as strings — cast on the way out so the chart
	// component can do arithmetic without re-parsing.
	return result.rows.map((r) => ({
		day: r.day,
		provider: r.provider,
		value: typeof r.value === 'string' ? parseFloat(r.value) : (r.value as unknown as number),
	}));
}

export function getLightningTrendsZapShare(limit: number): Promise<LightningTrendsRow[]> {
	return _fetchTrends(SQL_LIGHTNING_TRENDS_ZAP_SHARE_30D, limit);
}

export function getLightningTrendsSatsShare(limit: number): Promise<LightningTrendsRow[]> {
	return _fetchTrends(SQL_LIGHTNING_TRENDS_SATS_SHARE_30D, limit);
}

export function getLightningTrendsSatsAbsolute(limit: number): Promise<LightningTrendsRow[]> {
	return _fetchTrends(SQL_LIGHTNING_TRENDS_SATS_ABSOLUTE_30D, limit);
}

export function getLightningTrendsZapsAbsolute(limit: number): Promise<LightningTrendsRow[]> {
	return _fetchTrends(SQL_LIGHTNING_TRENDS_ZAPS_ABSOLUTE_30D, limit);
}

// NIP-65 Relays
// All relays mentioned in the latest kind-10002 (relay-list-metadata) of any non-blocklisted user,
// with read / write / both counts. Powers the /relays leaderboard. Single
// query — UNNEST + GROUP BY + array-membership SUMs is faster than a per-
// relay subquery loop.
export async function getRelayStats(): Promise<RelayStat[]> {
	// Reads relay_stats_mv (refreshed by load_jsonl_exports_into_postgres.py
	// after each kind-10002 (relay-list-metadata) load). The pre-aggregated MV cuts this from
	// ~12 s on the raw kind-10002 (relay-list-metadata) table down to ~10–30 ms.
	const result = await pool.query<{
		relay_url: string;
		user_count: number;
		read_count: number;
		write_count: number;
		both_count: number;
	}>(
		`SELECT relay_url, user_count, read_count, write_count, both_count
		 FROM relay_stats_mv
		 ORDER BY user_count DESC`
	);

	return result.rows.map((r) => ({
		relay_url: r.relay_url,
		user_count: r.user_count,
		read_count: r.read_count,
		write_count: r.write_count,
		both_count: r.both_count
	}));
}

// Distribution of "how many relays does each user list" across all
// non-blocklisted users with a kind-10002 (relay-list-metadata) event. Buckets chosen to give
// individual resolution at the typical range (1–10) and bin the long tail.
// Used by the per-user-relay-count histogram on /relays.
export interface RelayUserCountBucket {
	bucket: string;
	sort_key: number;
	user_count: number;
}

export async function getRelayPerUserDistribution(): Promise<RelayUserCountBucket[]> {
	// Reads relay_per_user_distribution_mv (refreshed alongside relay_stats_mv).
	const result = await pool.query<{
		bucket: string;
		sort_key: number;
		user_count: number;
	}>(
		`SELECT bucket, sort_key, user_count
		 FROM relay_per_user_distribution_mv
		 ORDER BY sort_key`
	);

	return result.rows.map((r) => ({
		bucket: r.bucket,
		sort_key: r.sort_key,
		user_count: r.user_count
	}));
}

// Per-tier distinct-user counts for the /relays tier-histogram chart.
// "Users in tier" = users who list at least one relay whose own user_count
// falls in this tier. A user can appear in multiple tiers (whoever lists
// both a singleton and a mega-relay counts in both), so the bars do NOT
// sum to 100% — that's a load-bearing property the chart relies on.
//
// Tier boundaries MUST stay in sync with the TIERS constant inside
// RelayTierHistogram.svelte.
export interface RelayTierUserCount {
	tier_label: string;
	sort_key: number;
	users_in_tier: number;
	total_users: number;
}

export async function getRelayTierUserCounts(): Promise<RelayTierUserCount[]> {
	// Reads relay_tier_user_counts_mv (refreshed alongside relay_stats_mv).
	// Tier boundaries live in the MV definition (nostrology-data's schema/init.sql)
	// and MUST stay in sync with TIERS in RelayTierHistogram.svelte.
	const result = await pool.query<{
		tier_label: string;
		sort_key: number;
		users_in_tier: number;
		total_users: number;
	}>(
		`SELECT tier_label, sort_key, users_in_tier, total_users
		 FROM relay_tier_user_counts_mv
		 ORDER BY sort_key`
	);

	return result.rows.map((r) => ({
		tier_label: r.tier_label,
		sort_key: r.sort_key,
		users_in_tier: r.users_in_tier,
		total_users: r.total_users
	}));
}

export interface RelayDetail {
	relay_url: string;
	user_count: number;
	read_count: number;
	write_count: number;
	both_count: number;
}

// Single-relay totals for the per-relay detail page. relay_stats_mv has a
// unique index on relay_url so this is an O(1) index lookup. Returns null
// when the relay isn't listed by any non-blocklisted user (caller renders
// 404).
export async function getRelayDetail(relay_url: string): Promise<RelayDetail | null> {
	const result = await pool.query<{
		user_count: number;
		read_count: number;
		write_count: number;
		both_count: number;
	}>(
		`SELECT user_count, read_count, write_count, both_count
		 FROM relay_stats_mv
		 WHERE relay_url = $1`,
		[relay_url]
	);

	const row = result.rows[0];
	if (!row || row.user_count === 0) return null;

	return {
		relay_url,
		user_count: row.user_count,
		read_count: row.read_count,
		write_count: row.write_count,
		both_count: row.both_count
	};
}

// ---------------------------------------------------------------------------
// /marketplaces
// The page serves ONE precomputed snapshot document per refresh: the newest
// marketplaces_snapshot row, written by nostrology-data's marketplaces_refresh
// Dagster job (append-only, so a failed refresh leaves the previous row
// serving). No per-request aggregation happens here at all - a single-row
// index-ordered read is the whole serving cost.
//
// SQL exported for tests; see marketplaces-snapshot.test.ts. The id DESC
// tie-break makes two rows sharing a generated_utc second deterministic.
export const SQL_MARKETPLACES_SNAPSHOT = `SELECT data
FROM marketplaces_snapshot
ORDER BY generated_utc DESC, id DESC
LIMIT 1`;

export async function getMarketplacesSnapshot(): Promise<MarketsSnapshot> {
	const result = await pool.query<{ data: MarketsSnapshot }>(SQL_MARKETPLACES_SNAPSHOT);
	if (result.rows.length === 0) {
		// No snapshot row yet (a fresh database): fail loud rather than render an
		// empty page that looks like "the marketplace died".
		throw new Error('marketplaces_snapshot is empty - has marketplaces_refresh ever run?');
	}
	// node-pg parses jsonb to an object already; the cast is the shape contract.
	return result.rows[0].data;
}

// The newest live listings, for /marketplaces' Recent listings table: the second table
// the same marketplaces_refresh writes, in the same transaction as the snapshot row
// (TRUNCATE+INSERT), so this and the page's figures are always the same run's. Reading a
// substrate table of the job beside its snapshot is what /git does for Stars and Zaps
// rather than growing the snapshot document.
//
// `excl IS NULL` is the live pool - the same population every figure on the page counts,
// so a reader checking the table against "Live listings" is comparing like with like.
// ORDER BY effective_ts DESC is the listing's own date (a plausible published_at, else
// created_at, capped at the run), which is the date the Growth charts bucket it on; the
// (pubkey, d_tag) tie-break makes one second's listings a stable order rather than
// whatever the scan returns, so two renders of the same refresh agree.
//
// THE SIX PER-LISTING FACTS THE SECTION READS arrived on 2026-10-24 (nostrology-data#29
// (/marketplaces: the listings table drops the title as published and four other per-listing
// facts the web needs)): `title_tag`, `event_id`, `market_image`, `expires_at`,
// `content_warning` and `summary_len`. Each is a condition one of the three marketplaces
// reads from the listing, and why each one is a condition is in $lib/markets/links. Two
// things to know about them here:
//   - EVERY ONE IS NULLABLE, and a null means "this row does not carry the fact", never a
//     good answer: a row written before the columns existed, or by a pipeline that could not
//     compute one, reads null and the marketplaces that need it decline it. That is also what
//     the whole section served between 2026-10-23 and this change, with every row going to
//     Shopstr because it is the one marketplace with no row conditions.
//   - `title` is still the LOWERCASED title (it is folded for the farm and synthetic
//     classifiers, which is why the section drew "arcanine for abra"), so the page prefers
//     `title_tag` and falls back to it.
// A SEVENTH, `seller_name`, is not a listing fact at all: it is the seller's
// kind-0 (profile-metadata) display name, so it needs a profile table beside this one, and
// the Seller column shows a shortened npub until it exists.
// THE NIP-40 EXPIRY IS CUT HERE, IN SQL, now that the column exists: relays delete an expired
// event, so nothing can open the listing, and testing it in the query puts the cut BEFORE the
// LIMIT where it belongs - a row dropped afterwards leaves the table one row shorter
// (nostrology-web#28 (Recent listings can come up short: the openability cut runs after the
// database's limit), its option 4). $3 is the reader's instant in unix SECONDS, the column's
// own unit; $lib/markets/links still applies the identical test to whatever it is handed,
// which is what a caller passing uncut rows relies on. The two agree exactly, because for
// integers `expires_at * 1000 > now_ms` is `expires_at > floor(now_ms / 1000)`.
// THE PER-SELLER CAP IS APPLIED HERE, BEFORE THE LIMIT. Capping the rows after reading
// the newest 60 left 10 of them, because those 60 came from 7 sellers; the window function
// takes each seller's own newest `$2` listings first, and the limit then cuts the newest
// 60 of those. `$2` is 2147483647 (int4 max) when no cap is wanted, so there is one query
// rather than two that could drift.
export const SQL_MARKETPLACES_RECENT = `SELECT pubkey, d_tag, effective_ts, title, title_tag,
       status, client, location, cc, categories, price, visibility,
       event_id, market_image, expires_at, content_warning, summary_len
FROM (
  SELECT pubkey,
         coalesce(d_tag, '') AS d_tag,
         effective_ts,
         title,
         title_tag,
         status,
         visibility,
         client,
         coalesce(location, '') AS location,
         cc,
         coalesce(categories, '[]'::jsonb) AS categories,
         price,
         event_id,
         market_image,
         expires_at,
         content_warning,
         summary_len,
         row_number() OVER (PARTITION BY pubkey
                            ORDER BY effective_ts DESC, coalesce(d_tag, '')) AS per_seller
  FROM marketplaces_listings
  WHERE excl IS NULL
    AND (expires_at IS NULL OR expires_at <= 0 OR expires_at > $3)
) t
WHERE per_seller <= $2
ORDER BY effective_ts DESC, pubkey, d_tag
LIMIT $1`;

/** int4 max: the cap's value when every listing is wanted in plain date order. */
export const NO_PER_SELLER_CAP = 2147483647;

/**
 * The `limit` newest live listings, newest first, at most `perSeller` per seller (null for
 * no cap). An EMPTY result is not an error here: the snapshot read above already fails
 * loud when the refresh has never run, and a missing table (a database seeded before this
 * column set) must not take the whole page down for one section - the page draws the
 * section only when it has rows.
 */
/**
 * The query's three bound values. EXPORTED, and the clock conversion is the reason: `$3` is in
 * unix SECONDS, the column's own unit, and binding milliseconds instead would make
 * `expires_at > 1.79e12` false for every real expiry - so every listing that sets a NIP-40
 * expiration would vanish from the table, expired or not. Nothing about that is visible in the
 * SQL text, so it is pinned as a unit in marketplaces-recent-sql.test.ts, beside the database
 * tests of the query itself.
 */
export function recentListingParams(
	limit: number,
	perSeller: number | null,
	nowMs: number
): [number, number, number] {
	return [limit, perSeller ?? NO_PER_SELLER_CAP, Math.floor(nowMs / 1000)];
}

/** One row of the read, as the page's type. Exported for the same reason as the parameters: a
 *  column dropped or hard-coded here is invisible in the SQL and in every test that mocks this
 *  module - `market_image: true` would give every row a Conduit link, and `title_tag: null`
 *  would quietly restore the lowercased titles (both survived the suite until 2026-10-24). */
export function recentListingRow(r: RecentListingDbRow): MarketsRecentListing {
	return {
		pubkey: r.pubkey,
		d_tag: r.d_tag,
		// Still not a listing fact, and still absent: it needs a profile table (see above).
		seller_name: null,
		event_id: r.event_id,
		market_image: r.market_image,
		// BIGINT again, and nullable this time: a row with no NIP-40 tag reads null, which
		// every reader of it treats as "this listing does not expire".
		expires_at: r.expires_at === null ? null : Number(r.expires_at),
		title_tag: r.title_tag,
		content_warning: r.content_warning,
		summary_len: r.summary_len,
		visibility: r.visibility,
		// BIGINT comes back as a string from node-pg (it does not fit a JS number in
		// general), and this one is a unix second, which does.
		effective_ts: Number(r.effective_ts),
		title: r.title,
		status: r.status,
		client: r.client,
		location: r.location,
		cc: r.cc,
		categories: Array.isArray(r.categories) ? (r.categories as string[]) : [],
		price: Array.isArray(r.price) ? (r.price as string[]) : null
	};
}

/** The columns SQL_MARKETPLACES_RECENT selects, as node-pg hands them over. */
export type RecentListingDbRow = {
	pubkey: string;
	d_tag: string;
	effective_ts: string | number;
	title: string;
	title_tag: string | null;
	status: string;
	visibility: string;
	client: string;
	location: string;
	cc: string | null;
	categories: unknown;
	price: unknown;
	event_id: string | null;
	market_image: boolean | null;
	expires_at: string | number | null;
	content_warning: string | null;
	summary_len: number | null;
};

export async function getMarketplacesRecentListings(
	limit = 60,
	perSeller: number | null = null,
	nowMs: number = Date.now()
): Promise<MarketsRecentListing[]> {
	const result = await pool.query<{
		pubkey: string;
		d_tag: string;
		effective_ts: string | number;
		title: string;
		title_tag: string | null;
		status: string;
		visibility: string;
		client: string;
		location: string;
		cc: string | null;
		categories: unknown;
		price: unknown;
		event_id: string | null;
		market_image: boolean | null;
		expires_at: string | number | null;
		content_warning: string | null;
		summary_len: number | null;
	}>(SQL_MARKETPLACES_RECENT, recentListingParams(limit, perSeller, nowMs));
	return result.rows.map(recentListingRow);
}

// ---------------------------------------------------------------------------
// /routstr
// Same snapshot-document serving shape as /marketplaces: the newest
// routstr_snapshot row, written by nostrology-data's routstr_refresh Dagster
// job (append-only; a failed refresh leaves the previous row serving).
//
// SQL exported for tests; see routstr-snapshot.test.ts. The id DESC tie-break
// makes two rows sharing a generated_utc second deterministic.
export const SQL_ROUTSTR_SNAPSHOT = `SELECT data
FROM routstr_snapshot
ORDER BY generated_utc DESC, id DESC
LIMIT 1`;

export async function getRoutstrSnapshot(): Promise<RoutstrSnapshot> {
	const result = await pool.query<{ data: RoutstrSnapshot }>(SQL_ROUTSTR_SNAPSHOT);
	if (result.rows.length === 0) {
		// No snapshot row yet (a fresh database): fail loud rather than render an
		// empty page that looks like "the network died".
		throw new Error('routstr_snapshot is empty - has routstr_refresh ever run?');
	}
	return result.rows[0].data;
}

// ---------------------------------------------------------------------------
// /git (the ngit snapshot)
// Same snapshot-document serving shape as /marketplaces and /routstr: the newest
// ngit_snapshot row, written by nostrology-data's ngit_refresh Dagster job
// (append-only; a failed refresh leaves the previous row serving). The job writes
// its substrate tables (ngit_repos, ngit_pushes, ngit_repo_stats) in the same
// transaction. Since 2026-10-18 (the operator's choice) the
// /git page reads one of them: its Stars and Zaps lists come from ngit_repo_stats,
// ranked and cut by SQL_NGIT_PAGE, so their length and ranking are the web's to change;
// the rest is the document (ngit-design.md section 8). The landing board reads the
// document alone (getNgitSnapshot).
//
// SQL exported for tests; see ngit-snapshot.test.ts. The id DESC tie-break
// makes two rows sharing a generated_utc second deterministic.
export const SQL_NGIT_SNAPSHOT = `SELECT data
FROM ngit_snapshot
ORDER BY generated_utc DESC, id DESC
LIMIT 1`;

export async function getNgitSnapshot(): Promise<NgitSnapshot> {
	const result = await pool.query<{ data: NgitSnapshot }>(SQL_NGIT_SNAPSHOT);
	if (result.rows.length === 0) {
		// No snapshot row yet (a fresh database, or the web deployed before the data
		// repo's first materialize - the deploy order is data first): fail loud rather
		// than render an empty page that looks like "Git on Nostr died".
		throw new Error('ngit_snapshot is empty - has ngit_refresh ever run?');
	}
	return result.rows[0].data;
}

/** How many repositories the Stars and Zaps lists hold: the page's choice since 2026-10-18.
 * The document carries its own top 20 of each, which the page falls back on. */
export const NGIT_STARS_SHOWN = 20;
export const NGIT_ZAPS_SHOWN = 20;

// The /git page in ONE statement, so it reads one database snapshot and can never pair a
// document with another run's rows: the newest ngit_snapshot row, as SQL_NGIT_SNAPSHOT
// picks it, and the Stars and Zaps lists from ngit_repo_stats for that row's run_id ($1 and
// $2 their lengths). They are ranked as the pipeline ranks the document's own lists
// (dataset reference 6.2, 6.3): stars by stars, zaps by receipts then msats, a full tie by
// repo_key in byte order (COLLATE "C", which is Python's string order), the order kept
// inside jsonb_agg. `has_run` says whether the table holds that run at all: when it does
// not (a pipeline from before the table, or rolled back to one), the page keeps the
// document's own lists.
export const SQL_NGIT_PAGE = `WITH snap AS (
	SELECT run_id, data FROM ngit_snapshot ORDER BY generated_utc DESC, id DESC LIMIT 1
)
SELECT
	snap.run_id,
	snap.data,
	EXISTS (SELECT 1 FROM ngit_repo_stats WHERE run_id = snap.run_id) AS has_run,
	COALESCE((
		SELECT jsonb_agg(jsonb_build_object('pubkey', pubkey, 'd', d, 'name', name, 'cls', cls, 'stars', stars)
		                 ORDER BY stars DESC, repo_key COLLATE "C")
		FROM (SELECT * FROM ngit_repo_stats WHERE run_id = snap.run_id AND stars > 0
		      ORDER BY stars DESC, repo_key COLLATE "C" LIMIT $1) s
	), '[]'::jsonb) AS starred,
	COALESCE((
		SELECT jsonb_agg(jsonb_build_object('pubkey', pubkey, 'd', d, 'name', name, 'cls', cls,
		                                    'receipts', zap_receipts, 'msats', zap_msats)
		                 ORDER BY zap_receipts DESC, zap_msats DESC, repo_key COLLATE "C")
		FROM (SELECT * FROM ngit_repo_stats WHERE run_id = snap.run_id AND zap_receipts > 0
		      ORDER BY zap_receipts DESC, zap_msats DESC, repo_key COLLATE "C" LIMIT $2) z
	), '[]'::jsonb) AS zapped
FROM snap`;

/** The run the last fallback was logged for: once per run, not once per request. */
let ngitFallbackLogged: string | null = null;

/** The /git page's data: the newest snapshot document, with its Stars and Zaps lists from
 * ngit_repo_stats when that table holds the document's run, and which of the two they came
 * from (the page marks the two cards with it, so a live check sees the path). The document's
 * own lists are the same run's top 20 under the pipeline's ranking: identical to the table's
 * while the web's lengths and ranking are the pipeline's, so a fallback is logged. */
export async function getNgitPage(): Promise<{ snapshot: NgitSnapshot; listsFrom: NgitListsFrom }> {
	let result;
	try {
		result = await pool.query<{
			run_id: string;
			data: NgitSnapshot;
			has_run: boolean;
			starred: NgitSnapshot['repos_starred'];
			zapped: NgitSnapshot['repos_zapped'];
		}>(SQL_NGIT_PAGE, [NGIT_STARS_SHOWN, NGIT_ZAPS_SHOWN]);
	} catch (err) {
		// ngit_repo_stats missing (a database no ngit run has reached since it came), a lock
		// or a timeout: the document alone still serves the page, its own lists in place.
		console.error(
			'[ngit] the page query failed, serving the document lists:',
			err instanceof Error ? err.message : err
		);
		return { snapshot: await getNgitSnapshot(), listsFrom: 'document' };
	}
	if (result.rows.length === 0) throw new Error('ngit_snapshot is empty - has ngit_refresh ever run?');
	const { run_id, data, has_run, starred, zapped } = result.rows[0];
	if (!has_run) {
		if (ngitFallbackLogged !== run_id) {
			ngitFallbackLogged = run_id;
			console.warn(`[ngit] ngit_repo_stats holds no row of run ${run_id}; serving the document lists`);
		}
		return { snapshot: data, listsFrom: 'document' };
	}
	return { snapshot: { ...data, repos_starred: starred, repos_zapped: zapped }, listsFrom: 'table' };
}
