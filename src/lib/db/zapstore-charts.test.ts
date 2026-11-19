// @vitest-environment node
//
// Integration tests for the SQL behind /zapstore's "Zapstore Apps" cumulative
// chart, "Nostr-native Apps as % of Total" chart, and "App Releases" daily
// stacked-bar chart. The queries themselves are exported as constants from
// postgres.ts (`SQL_ZAPSTORE_APPS_CUMULATIVE`, `SQL_ZAPSTORE_NATIVE_SHARE`,
// `SQL_ZAPSTORE_APP_RELEASES_DAILY`), so these tests run the production query
// verbatim — no risk of test-vs-prod SQL drift.
//
// Isolation strategy: each test connects to the running nostr_brain Postgres,
// creates a TEMPORARY TABLE shadowing `events_kind_30063_app_releases` (Postgres
// resolves `pg_temp` before `public` in the search_path, so the production
// query hits the test fixture), seeds synthetic data, runs the SQL, and asserts.
// Temp tables are session-local and auto-dropped when the connection releases —
// production data is never touched.
//
// Tests skip cleanly when Postgres is unreachable, so a local run with no database still passes.
// The deploy workflow's test job starts one, and fails if these skip.

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
	SQL_ZAPSTORE_APP_RELEASES_DAILY,
	SQL_ZAPSTORE_APPS_CUMULATIVE,
	SQL_ZAPSTORE_NATIVE_SHARE,
	ZAPSTORE_OWN_D_TAGS,
	ZAPSTORE_PUBKEY
} from './postgres';

const TEST_DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	'postgresql://nostr_brain:changeme@localhost:5432/nostr_brain';

// Connectivity probed at module-init (top-level await) so the result is known
// BEFORE `describe()` registers — otherwise a `beforeAll`-set flag is evaluated
// after the describe block decides whether to skip, and every test silently skips.
const probePool = new pg.Pool({
	connectionString: TEST_DATABASE_URL,
	connectionTimeoutMillis: 2000,
	max: 1
});
let postgresAvailable = false;
try {
	const c = await probePool.connect();
	await c.query('SELECT 1');
	c.release();
	postgresAvailable = true;
} catch (err) {
	console.warn(
		`[zapstore-charts.test] Postgres unreachable at ${TEST_DATABASE_URL}; skipping integration tests.`,
		err instanceof Error ? err.message : err
	);
}
await probePool.end();

// Stable timestamps anchored to noon UTC of the current day. Using noon (not
// midnight) avoids `date_trunc('day', ...)` boundary flakiness if the test
// happens to run within a few seconds of midnight.
const NOON_TODAY_UTC = Math.floor(Date.now() / 86400000) * 86400 + 43200;
const ONE_DAY = 86400;
const daysAgo = (n: number) => NOON_TODAY_UTC - n * ONE_DAY;

// Realistic-shape synthetic pubkeys (64-hex). Distinct from ZAPSTORE_PUBKEY.
const ALICE_PUBKEY = 'a'.repeat(64);
const BOB_PUBKEY = 'b'.repeat(64);
const CAROL_PUBKEY = 'c'.repeat(64);

// Real test pool, separate from the connectivity probe above so each test
// gets its own client + fresh TEMP table.
const pool = postgresAvailable
	? new pg.Pool({ connectionString: TEST_DATABASE_URL, connectionTimeoutMillis: 2000 })
	: null;

afterAll(async () => {
	if (pool) await pool.end();
});

// Each test gets its own client + freshly-seeded TEMP table. Releasing the
// client at end of test discards the table.
let client: pg.PoolClient | null = null;

beforeEach(async () => {
	if (!pool) return;
	client = await pool.connect();
	// Schema mirrors the columns the query touches. Other production columns
	// are irrelevant to these queries and are omitted.
	await client.query(`
		CREATE TEMP TABLE events_kind_30063_app_releases (
			pubkey    TEXT   NOT NULL,
			app_d_tag TEXT   NOT NULL,
			created_at BIGINT NOT NULL
		) ON COMMIT PRESERVE ROWS
	`);
});

afterEach(async () => {
	if (client) {
		// Releasing returns the connection to the pool; pg_temp is dropped
		// when the underlying session ends. To guarantee a clean slate for
		// the NEXT test on the SAME pooled connection, drop explicitly.
		try {
			await client.query('DROP TABLE IF EXISTS pg_temp.events_kind_30063_app_releases');
		} finally {
			client.release();
			client = null;
		}
	}
});

interface Release {
	pubkey: string;
	app_d_tag: string;
	created_at: number;
}

async function seed(rows: Release[]) {
	if (!client || rows.length === 0) return;
	const values = rows
		.map((_, i) => `($${3 * i + 1}, $${3 * i + 2}, $${3 * i + 3})`)
		.join(', ');
	const params = rows.flatMap((r) => [r.pubkey, r.app_d_tag, r.created_at]);
	await client.query(
		`INSERT INTO events_kind_30063_app_releases (pubkey, app_d_tag, created_at) VALUES ${values}`,
		params
	);
}

interface CumulativeRow {
	timestamp: number;
	total: number;
	github: number;
	native: number;
}

async function runCumulative(): Promise<CumulativeRow[]> {
	const result = await client!.query<{
		timestamp: string;
		total: string;
		github: string;
		native: string;
	}>(SQL_ZAPSTORE_APPS_CUMULATIVE, [ZAPSTORE_PUBKEY, ZAPSTORE_OWN_D_TAGS]);
	return result.rows.map((r) => ({
		timestamp: parseInt(r.timestamp),
		total: parseInt(r.total),
		github: parseInt(r.github),
		native: parseInt(r.native)
	}));
}

async function runShare(): Promise<Array<{ timestamp: number; value: number }>> {
	const result = await client!.query<{ timestamp: string; native_pct: string }>(
		SQL_ZAPSTORE_NATIVE_SHARE,
		[ZAPSTORE_PUBKEY, ZAPSTORE_OWN_D_TAGS]
	);
	return result.rows.map((r) => ({
		timestamp: parseInt(r.timestamp),
		value: parseFloat(r.native_pct)
	}));
}

// Find the row whose `timestamp` is the truncated day for the given epoch.
function findDay<T extends { timestamp: number }>(
	rows: T[],
	epoch: number
): T | undefined {
	const truncated = Math.floor(epoch / ONE_DAY) * ONE_DAY;
	return rows.find((r) => r.timestamp === truncated);
}

const describeIfDb = (postgresAvailable ? describe : describe.skip) as typeof describe;

describeIfDb('Zapstore charts SQL — kind-30063 first-release semantics', () => {
	describe('SQL_ZAPSTORE_APPS_CUMULATIVE', () => {
		it('uses the EARLIEST release per (pubkey, app_d_tag), not the latest', async () => {
			// One native app with three versions over 60 days. The chart must
			// place this app on day -60 (first version), not day -10 (latest).
			await seed([
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(60) },
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(30) },
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(10) }
			]);

			const rows = await runCumulative();

			// On day -60 (the first release), native count steps from 0 to 1.
			const day60 = findDay(rows, daysAgo(60));
			expect(day60?.native).toBe(1);
			expect(day60?.total).toBe(1);

			// On day -30 and day -10 (subsequent versions), no NEW app —
			// native count must stay at 1, not grow.
			const day30 = findDay(rows, daysAgo(30));
			expect(day30?.native).toBe(1);

			const day10 = findDay(rows, daysAgo(10));
			expect(day10?.native).toBe(1);

			// Output left edge is now always NOW()-365d (the cumulative is
			// computed across full history, then trimmed). Day -60 is well
			// inside the window, so the chart starts at NOW()-365d with
			// native=0 and steps up to native=1 at day -60.
			const expectedFirstTimestamp = Math.floor(daysAgo(365) / ONE_DAY) * ONE_DAY;
			expect(rows[0].timestamp).toBe(expectedFirstTimestamp);
			expect(rows[0].native).toBe(0);
		});

		it('partitions Zapstore-account non-own-d_tag apps as github (republished)', async () => {
			await seed([
				{
					pubkey: ZAPSTORE_PUBKEY,
					app_d_tag: 'com.example.republished_app',
					created_at: daysAgo(30)
				}
			]);

			const rows = await runCumulative();
			const today = rows[rows.length - 1];

			expect(today.github).toBe(1);
			expect(today.native).toBe(0);
			expect(today.total).toBe(1);
		});

		it.each(ZAPSTORE_OWN_D_TAGS)(
			"counts Zapstore-account's own-software d_tag '%s' as native (not github)",
			async (ownTag) => {
				await seed([
					{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: ownTag, created_at: daysAgo(30) }
				]);

				const rows = await runCumulative();
				const today = rows[rows.length - 1];

				expect(today.native).toBe(1);
				expect(today.github).toBe(0);
				expect(today.total).toBe(1);
			}
		);

		it('counts independent publishers as native', async () => {
			await seed([
				{ pubkey: BOB_PUBKEY, app_d_tag: 'org.bob.app', created_at: daysAgo(20) },
				{ pubkey: CAROL_PUBKEY, app_d_tag: 'org.carol.app', created_at: daysAgo(10) }
			]);

			const rows = await runCumulative();
			const today = rows[rows.length - 1];

			expect(today.native).toBe(2);
			expect(today.github).toBe(0);
		});

		it('cumulative running totals grow correctly across a mixed timeline', async () => {
			// Four apps spread across 50 days, mix of buckets:
			//   day -50: native (alice)
			//   day -40: github (zapstore republish)
			//   day -30: native (zapstore first-party — counts as native)
			//   day -10: github (zapstore republish)
			await seed([
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(50) },
				{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'com.gh.app1', created_at: daysAgo(40) },
				{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'dev.zapstore.app', created_at: daysAgo(30) },
				{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'com.gh.app2', created_at: daysAgo(10) }
			]);

			const rows = await runCumulative();

			const at = (n: number) => findDay(rows, daysAgo(n));

			expect(at(50)).toMatchObject({ native: 1, github: 0, total: 1 });
			expect(at(45)).toMatchObject({ native: 1, github: 0, total: 1 });
			expect(at(40)).toMatchObject({ native: 1, github: 1, total: 2 });
			expect(at(35)).toMatchObject({ native: 1, github: 1, total: 2 });
			expect(at(30)).toMatchObject({ native: 2, github: 1, total: 3 });
			expect(at(15)).toMatchObject({ native: 2, github: 1, total: 3 });
			expect(at(10)).toMatchObject({ native: 2, github: 2, total: 4 });
			expect(at(0)).toMatchObject({ native: 2, github: 2, total: 4 });
		});

		it('folds pre-window first-releases into the cumulative starting count', async () => {
			// One app well outside the window (400d), one inside (300d). The
			// cumulative is computed from min(MIN(day), NOW()-365d) so the
			// 400d-old app DOES contribute to the running totals; the output
			// is then trimmed to the trailing 365d window. So the chart's
			// left-edge value reflects all-time-as-of-that-date, not zero.
			await seed([
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.old', created_at: daysAgo(400) },
				{ pubkey: BOB_PUBKEY, app_d_tag: 'org.bob.recent', created_at: daysAgo(300) }
			]);

			const rows = await runCumulative();

			// First row in the chart is day NOW()-365d.
			const earliest = rows[0];
			const expectedEarliestEpoch = Math.floor(daysAgo(365) / ONE_DAY) * ONE_DAY;
			expect(earliest.timestamp).toBe(expectedEarliestEpoch);
			// On that left-edge day the cumulative already reflects the 400d-old
			// app (released before the visible window).
			expect(earliest.native).toBe(1);
			expect(earliest.total).toBe(1);
			// The 300-day-old app appears on its first-release day, bumping
			// cumulative to 2.
			const at300 = findDay(rows, daysAgo(300));
			expect(at300?.native).toBe(2);
			// Today shows both apps cumulative.
			const today = rows[rows.length - 1];
			expect(today.native).toBe(2);
			expect(today.total).toBe(2);
		});

		it('returns the trailing 365-day window with all-zero counts when there are no releases', async () => {
			// With an empty fixture, MIN(day) IS NULL, so
			// `GREATEST(NULL, NOW()-365d)` collapses to the non-null anchor.
			// generate_series therefore produces the full 365-day window
			// (366 rows: 365 days back through today inclusive), each with
			// total/github/native = 0.
			const rows = await runCumulative();

			expect(rows.length).toBe(366);
			for (const r of rows) {
				expect(r.total).toBe(0);
				expect(r.github).toBe(0);
				expect(r.native).toBe(0);
			}
		});

		it('day_series is dense — every day in the trailing 365d window is present', async () => {
			await seed([
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(5) }
			]);

			const rows = await runCumulative();

			// Output is always the trailing 365d + today regardless of where
			// MIN(day) falls — 366 rows, contiguous, day-by-day.
			expect(rows.length).toBe(366);
			for (let i = 1; i < rows.length; i++) {
				expect(rows[i].timestamp - rows[i - 1].timestamp).toBe(ONE_DAY);
			}
			// Cumulative is 0 before the (only) seed at day -5, then 1 from
			// day -5 onwards.
			const at6 = findDay(rows, daysAgo(6));
			expect(at6?.total).toBe(0);
			const at5 = findDay(rows, daysAgo(5));
			expect(at5?.total).toBe(1);
			expect(rows[rows.length - 1].total).toBe(1);
		});
	});

	describe('SQL_ZAPSTORE_NATIVE_SHARE', () => {
		it('computes (native / (native+github)) * 100, rounded to 2 decimals', async () => {
			// 1 native + 3 github → 25.00 %
			await seed([
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(30) },
				{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'com.gh.a', created_at: daysAgo(30) },
				{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'com.gh.b', created_at: daysAgo(30) },
				{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'com.gh.c', created_at: daysAgo(30) }
			]);

			const rows = await runShare();
			const today = rows[rows.length - 1];

			expect(today.value).toBeCloseTo(25.0, 2);
		});

		it('reports 0% on days where (native+github) = 0', async () => {
			// Native release on day -30, but the day_series goes back to that
			// release date so days within the 365d trailing window before -30
			// (none) won't have any data. To exercise the 0% branch, seed
			// only on day -30 and ensure the SHARE query still produces
			// densely-filled rows including day -30 itself.
			await seed([
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(30) }
			]);

			const rows = await runShare();

			// Latest day has 1 native, 0 github → 100%
			expect(rows[rows.length - 1].value).toBeCloseTo(100.0, 2);

			// Note: SQL_ZAPSTORE_NATIVE_SHARE's day_series starts at MIN(day),
			// so there are no pre-data rows in this fixture. The 0%-branch is
			// exercised when there's a github-only future date but no native
			// yet — see the next test for that case.
		});

		it('emits 0% before the first native release on a github-only timeline', async () => {
			// Github app on day -50, then a native app on day -10. Days
			// between -50 and -11 should report 0% native (only github).
			await seed([
				{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'com.gh.a', created_at: daysAgo(50) },
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(10) }
			]);

			const rows = await runShare();

			const at = (n: number) => findDay(rows, daysAgo(n));

			expect(at(50)?.value).toBeCloseTo(0.0, 2); // 0/1 = 0%
			expect(at(30)?.value).toBeCloseTo(0.0, 2); // still 0/1
			expect(at(11)?.value).toBeCloseTo(0.0, 2); // still 0/1
			expect(at(10)?.value).toBeCloseTo(50.0, 2); // 1/2 = 50%
			expect(at(0)?.value).toBeCloseTo(50.0, 2);
		});

		it('cumulative includes pre-window apps in the running denominator (unlike the cumulative chart)', async () => {
			// Critical distinction from SQL_ZAPSTORE_APPS_CUMULATIVE:
			// SHARE's day_series starts at MIN(day) (true earliest), then
			// trims the OUTPUT to the trailing 365d. So apps released >365d
			// ago DO contribute to the running cumulative — they just don't
			// show up as their own dated row in the output.
			await seed([
				// 400d-old github app: included in cumulative starting point
				{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'com.gh.old', created_at: daysAgo(400) },
				// 30d-old native app
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(30) }
			]);

			const rows = await runShare();

			// On day NOW()-365 (the left edge of the OUTPUT window), the
			// running cumulative is already (0 native, 1 github) because the
			// 400d-old app is folded in. So percentage = 0/1 = 0%.
			const earliest = rows[0];
			expect(earliest.value).toBeCloseTo(0.0, 2);

			// On day -30, native arrives → 1 native, 1 github = 50%.
			const at30 = findDay(rows, daysAgo(30));
			expect(at30?.value).toBeCloseTo(50.0, 2);
		});

		it('handles a typical real-data shape (mixed buckets, multiple versions per app)', async () => {
			// Mini-replica of real /zapstore data: 2 native apps (one with
			// multiple versions), 5 github republishes spread across time.
			await seed([
				// Alice: 3 versions over 60d → first-seen day -60
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(60) },
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(30) },
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(5) },
				// Bob: 1 version
				{ pubkey: BOB_PUBKEY, app_d_tag: 'org.bob.app', created_at: daysAgo(20) },
				// Zapstore github republishes
				{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'com.gh.a', created_at: daysAgo(45) },
				{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'com.gh.b', created_at: daysAgo(40) },
				{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'com.gh.c', created_at: daysAgo(35) },
				{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'com.gh.d', created_at: daysAgo(15) },
				{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'com.gh.e', created_at: daysAgo(2) }
			]);

			const cumulative = await runCumulative();
			const today = cumulative[cumulative.length - 1];
			expect(today).toMatchObject({ native: 2, github: 5, total: 7 });

			const share = await runShare();
			const todayShare = share[share.length - 1];
			// 2 native / 7 total = 28.57 %
			expect(todayShare.value).toBeCloseTo(28.57, 1);
		});
	});

	// ----- SQL_ZAPSTORE_APP_RELEASES_DAILY ---------------------------------
	//
	// The daily-bar "App Releases" chart on /zapstore. Distinct from the
	// cumulative chart in four important ways, all of which these tests
	// pin down:
	//
	//   (a) it counts release EVENTS (one per published version), not unique
	//       apps. A publisher pushing 30 versions in a month contributes 30
	//       bars-worth of activity, not 1.
	//   (b) it does NOT dedupe across publishers — when the curator AND the
	//       native publisher both publish the same (app_d_tag, version),
	//       both events are counted. This matches relay semantics (two
	//       distinct events from two distinct signers, not NIP-33-replaceable
	//       against each other).
	//   (c) the trailing-365-day window is enforced strictly for the
	//       native/github EVENT counts: events with created_at outside the
	//       window are dropped, and the day_series is always exactly 366
	//       dense rows (today + 365 previous days), regardless of whether
	//       any release falls in the window.
	//   (d) the new_native overlay counts DISTINCT apps debuting that day
	//       (per (pubkey, app_d_tag), restricted to the native partition),
	//       computed against ALL kind-30063 history. So an app with multiple
	//       versions contributes 1 to new_native (on its first-ever day),
	//       and an app whose first-ever release predates the window
	//       contributes 0 — even if it has releases inside the window.
	//       By construction new_native[i] ≤ native[i] on every day.

	interface DailyRow {
		timestamp: number;
		github: number;
		native: number;
		newNative: number;
	}

	async function runDaily(): Promise<DailyRow[]> {
		const result = await client!.query<{
			timestamp: string;
			github_count: string;
			native_count: string;
			new_native_count: string;
		}>(SQL_ZAPSTORE_APP_RELEASES_DAILY, [ZAPSTORE_PUBKEY, ZAPSTORE_OWN_D_TAGS]);
		return result.rows.map((r) => ({
			timestamp: parseInt(r.timestamp),
			github: parseInt(r.github_count),
			native: parseInt(r.native_count),
			newNative: parseInt(r.new_native_count)
		}));
	}

	describe('SQL_ZAPSTORE_APP_RELEASES_DAILY', () => {
		it('returns exactly 366 dense rows when there are no releases', async () => {
			const rows = await runDaily();
			expect(rows.length).toBe(366);
			for (const r of rows) {
				expect(r.github).toBe(0);
				expect(r.native).toBe(0);
				expect(r.newNative).toBe(0);
			}
			// Days are contiguous, exactly ONE_DAY apart.
			for (let i = 1; i < rows.length; i++) {
				expect(rows[i].timestamp - rows[i - 1].timestamp).toBe(ONE_DAY);
			}
			// Earliest row is exactly NOW()-365d (truncated to day).
			const expectedEarliest = Math.floor(daysAgo(365) / ONE_DAY) * ONE_DAY;
			expect(rows[0].timestamp).toBe(expectedEarliest);
		});

		it('counts release EVENTS, not unique apps — three versions on the same day = 3', async () => {
			// Three release events for the SAME (pubkey, app_d_tag) on the
			// same day. Cumulative chart would count this as 1 app appearing;
			// daily chart MUST count 3 events.
			await seed([
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(10) },
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(10) },
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(10) }
			]);

			const rows = await runDaily();
			const day10 = findDay(rows, daysAgo(10));
			expect(day10?.native).toBe(3);
			expect(day10?.github).toBe(0);
		});

		it('attributes releases to the day they happened (not aggregated across days)', async () => {
			// Three versions over three different days — each gets its own bar.
			await seed([
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(30) },
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(20) },
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(10) }
			]);

			const rows = await runDaily();
			expect(findDay(rows, daysAgo(30))?.native).toBe(1);
			expect(findDay(rows, daysAgo(20))?.native).toBe(1);
			expect(findDay(rows, daysAgo(10))?.native).toBe(1);
			// Days in between have no native releases.
			expect(findDay(rows, daysAgo(25))?.native).toBe(0);
			expect(findDay(rows, daysAgo(15))?.native).toBe(0);
		});

		it('partitions Zapstore-pubkey non-own-d_tag releases as github (republished)', async () => {
			await seed([
				{
					pubkey: ZAPSTORE_PUBKEY,
					app_d_tag: 'com.example.republished_app',
					created_at: daysAgo(10)
				}
			]);

			const rows = await runDaily();
			const day10 = findDay(rows, daysAgo(10));
			expect(day10?.github).toBe(1);
			expect(day10?.native).toBe(0);
		});

		it.each(ZAPSTORE_OWN_D_TAGS)(
			"counts Zapstore-pubkey's own-software d_tag '%s' as native (not github)",
			async (ownTag) => {
				await seed([
					{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: ownTag, created_at: daysAgo(15) }
				]);

				const rows = await runDaily();
				const day15 = findDay(rows, daysAgo(15));
				expect(day15?.native).toBe(1);
				expect(day15?.github).toBe(0);
			}
		);

		it('counts independent publishers as native', async () => {
			await seed([
				{ pubkey: BOB_PUBKEY, app_d_tag: 'org.bob.app', created_at: daysAgo(20) },
				{ pubkey: CAROL_PUBKEY, app_d_tag: 'org.carol.app', created_at: daysAgo(20) }
			]);

			const rows = await runDaily();
			const day20 = findDay(rows, daysAgo(20));
			expect(day20?.native).toBe(2);
			expect(day20?.github).toBe(0);
		});

		it('does NOT dedupe across publishers — multi-publisher releases are counted independently', async () => {
			// Real-world case: native publisher (Alice) publishes
			// org.alice.app@1.0.0, then the Zapstore curator republishes the
			// SAME logical version on the same day. Both are distinct kind-30063
			// events from distinct signers — neither is NIP-33-replaceable against
			// the other. The chart counts BOTH (1 native + 1 github = 2 total
			// release events on that day).
			await seed([
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(10) },
				{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(10) }
			]);

			const rows = await runDaily();
			const day10 = findDay(rows, daysAgo(10));
			expect(day10?.native).toBe(1);
			expect(day10?.github).toBe(1);
		});

		it('drops events older than the trailing-365-day window', async () => {
			// 400-day-old release MUST NOT appear; 300-day-old release MUST appear.
			await seed([
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.too_old', created_at: daysAgo(400) },
				{ pubkey: BOB_PUBKEY, app_d_tag: 'org.bob.in_window', created_at: daysAgo(300) }
			]);

			const rows = await runDaily();
			// Output is still 366 dense rows.
			expect(rows.length).toBe(366);
			// 400d-old event contributes nothing to ANY day in output.
			const totalNative = rows.reduce((sum, r) => sum + r.native, 0);
			const totalGithub = rows.reduce((sum, r) => sum + r.github, 0);
			expect(totalNative).toBe(1); // only the 300d Bob release
			expect(totalGithub).toBe(0);
			// Spot-check: the 300d release lands on its day.
			expect(findDay(rows, daysAgo(300))?.native).toBe(1);
		});

		it('output window is dense even when releases cluster on a few days', async () => {
			// All releases on day -50 — the chart still renders 366 rows with
			// zero on every other day.
			await seed([
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.a', created_at: daysAgo(50) },
				{ pubkey: BOB_PUBKEY, app_d_tag: 'org.bob.b', created_at: daysAgo(50) },
				{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'com.gh.c', created_at: daysAgo(50) }
			]);

			const rows = await runDaily();
			expect(rows.length).toBe(366);

			const day50 = findDay(rows, daysAgo(50));
			expect(day50?.native).toBe(2);
			expect(day50?.github).toBe(1);

			// Every other day is zero.
			const otherDayNonZero = rows.filter(
				(r) => r.timestamp !== day50!.timestamp && (r.native > 0 || r.github > 0)
			);
			expect(otherDayNonZero.length).toBe(0);
		});

		it('handles a typical real-data shape (mixed buckets, multiple versions per app, mixed days)', async () => {
			// Shape mirrors what production /zapstore data looks like in
			// miniature: a noisy curator publishing many different apps over
			// many days, plus a smaller cohort of native publishers each
			// pushing a few versions of their own app.
			await seed([
				// Alice: 3 versions (-60, -30, -5)
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(60) },
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(30) },
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(5) },
				// Bob: 1 version
				{ pubkey: BOB_PUBKEY, app_d_tag: 'org.bob.app', created_at: daysAgo(20) },
				// Zapstore "own software" (counts as native)
				{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'dev.zapstore.app', created_at: daysAgo(40) },
				// Curator republishes spread across days
				{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'com.gh.a', created_at: daysAgo(45) },
				{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'com.gh.b', created_at: daysAgo(45) },
				{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'com.gh.c', created_at: daysAgo(35) },
				{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'com.gh.d', created_at: daysAgo(15) },
				{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'com.gh.e', created_at: daysAgo(2) }
			]);

			const rows = await runDaily();

			// Alice's 3 versions land on -60, -30, -5
			expect(findDay(rows, daysAgo(60))?.native).toBe(1);
			expect(findDay(rows, daysAgo(30))?.native).toBe(1);
			expect(findDay(rows, daysAgo(5))?.native).toBe(1);
			// Bob on -20
			expect(findDay(rows, daysAgo(20))?.native).toBe(1);
			// Zapstore own-software on -40 → native (NOT github)
			expect(findDay(rows, daysAgo(40))?.native).toBe(1);
			expect(findDay(rows, daysAgo(40))?.github).toBe(0);
			// Two curator republishes on -45 → 2 github
			expect(findDay(rows, daysAgo(45))?.github).toBe(2);
			expect(findDay(rows, daysAgo(45))?.native).toBe(0);
			// Single republishes on -35, -15, -2
			expect(findDay(rows, daysAgo(35))?.github).toBe(1);
			expect(findDay(rows, daysAgo(15))?.github).toBe(1);
			expect(findDay(rows, daysAgo(2))?.github).toBe(1);

			// Aggregate sanity: 5 native (Alice×3 + Bob + zapstore-own) +
			//                   5 github (curator republishes a..e)
			const totalNative = rows.reduce((sum, r) => sum + r.native, 0);
			const totalGithub = rows.reduce((sum, r) => sum + r.github, 0);
			expect(totalNative).toBe(5);
			expect(totalGithub).toBe(5);
		});

		it('output always covers the trailing 365 days, regardless of data presence', async () => {
			// Seed a single recent release. Window must still be 366 rows
			// from NOW()-365d through today.
			await seed([
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(1) }
			]);

			const rows = await runDaily();
			expect(rows.length).toBe(366);

			const expectedEarliest = Math.floor(daysAgo(365) / ONE_DAY) * ONE_DAY;
			const expectedLatest = Math.floor(daysAgo(0) / ONE_DAY) * ONE_DAY;
			expect(rows[0].timestamp).toBe(expectedEarliest);
			expect(rows[rows.length - 1].timestamp).toBe(expectedLatest);

			// Single release lands on day -1, all others zero.
			expect(findDay(rows, daysAgo(1))?.native).toBe(1);
			const totalNative = rows.reduce((sum, r) => sum + r.native, 0);
			expect(totalNative).toBe(1);
		});

		// ----- new_native overlay metric ----------------------------------
		//
		// Dedicated tests for the "New Nostr-native" overlay added to the
		// /zapstore App Releases chart: distinct native (pubkey, app_d_tag)
		// debuting on each day, computed against ALL kind-30063 history (not
		// just the trailing window) so the "first ever" judgement is
		// boundary-correct.

		describe('new_native overlay column', () => {
			it("counts a brand-new app exactly once on its first-ever release day", async () => {
				await seed([
					{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(20) }
				]);

				const rows = await runDaily();
				const day20 = findDay(rows, daysAgo(20));
				expect(day20?.native).toBe(1);
				expect(day20?.newNative).toBe(1);

				// Every other day is zero on both columns.
				const otherNonZero = rows.filter(
					(r) => r.timestamp !== day20!.timestamp && (r.native > 0 || r.newNative > 0)
				);
				expect(otherNonZero.length).toBe(0);
			});

			it("debut + update on the same day: native = 2 events, newNative = 1 (distinct app)", async () => {
			// Publisher ships v1.0.0 in the morning then v1.0.1 hot-fix the
			// same day. Both events share (pubkey, app_d_tag) so per_app_first
			// has a single row → newNative counts the app once. native counts
			// release EVENTS, so it's 2.
			const morning = daysAgo(10);
			const evening = daysAgo(10) + 6 * 3600; // same UTC day
			await seed([
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: morning },
				{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: evening }
			]);

			const rows = await runDaily();
			const day10 = findDay(rows, daysAgo(10));
			expect(day10?.native).toBe(2);
			expect(day10?.newNative).toBe(1);
		});

		it('counts a multi-version native app: native = N events; newNative = 1 on debut day only', async () => {
				// Three versions over three days. native_count rises on each
				// release day; newNative only fires on the FIRST release day.
				await seed([
					{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(60) },
					{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(30) },
					{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(5) }
				]);

				const rows = await runDaily();

				// Debut: both native and newNative.
				expect(findDay(rows, daysAgo(60))?.native).toBe(1);
				expect(findDay(rows, daysAgo(60))?.newNative).toBe(1);

				// Subsequent versions: native increments, newNative stays 0.
				expect(findDay(rows, daysAgo(30))?.native).toBe(1);
				expect(findDay(rows, daysAgo(30))?.newNative).toBe(0);
				expect(findDay(rows, daysAgo(5))?.native).toBe(1);
				expect(findDay(rows, daysAgo(5))?.newNative).toBe(0);

				// Aggregate over the window: 3 native events, 1 newNative app.
				const totalNative = rows.reduce((sum, r) => sum + r.native, 0);
				const totalNewNative = rows.reduce((sum, r) => sum + r.newNative, 0);
				expect(totalNative).toBe(3);
				expect(totalNewNative).toBe(1);
			});

			it("does NOT count an app whose first-ever release predates the window, even if it has releases inside the window", async () => {
				// Ground-truth first release is 400 days ago (outside the
				// trailing-365d window). A subsequent release inside the
				// window must NOT be counted as newNative — the app is no
				// longer "new" by the time the visible window starts.
				await seed([
					{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(400) },
					{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(50) }
				]);

				const rows = await runDaily();

				// Visible release on day -50 counts as native (event in window)
				// but newNative stays 0 (debut day was outside the window).
				expect(findDay(rows, daysAgo(50))?.native).toBe(1);
				expect(findDay(rows, daysAgo(50))?.newNative).toBe(0);

				// Aggregate: 1 native event in the window, 0 newNative apps.
				const totalNative = rows.reduce((sum, r) => sum + r.native, 0);
				const totalNewNative = rows.reduce((sum, r) => sum + r.newNative, 0);
				expect(totalNative).toBe(1);
				expect(totalNewNative).toBe(0);
			});

			it('does NOT count Zapstore-pubkey republishes (github partition) — even on their first-ever day', async () => {
				// Curator's first-ever publish of an app (under non-OWN d_tag).
				// This is github by partition, so newNative MUST be 0.
				await seed([
					{
						pubkey: ZAPSTORE_PUBKEY,
						app_d_tag: 'com.example.republished_app',
						created_at: daysAgo(10)
					}
				]);

				const rows = await runDaily();
				const day10 = findDay(rows, daysAgo(10));
				expect(day10?.github).toBe(1);
				expect(day10?.native).toBe(0);
				expect(day10?.newNative).toBe(0);
			});

			it.each(ZAPSTORE_OWN_D_TAGS)(
				"counts Zapstore-pubkey's own-software first release '%s' as newNative",
				async (ownTag) => {
					// ZAPSTORE_OWN_D_TAGS are partitioned into native (the
					// Zapstore client and CLI are themselves Nostr-native
					// software) — so their first publish should fire newNative.
					await seed([
						{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: ownTag, created_at: daysAgo(15) }
					]);

					const rows = await runDaily();
					const day15 = findDay(rows, daysAgo(15));
					expect(day15?.native).toBe(1);
					expect(day15?.newNative).toBe(1);
					expect(day15?.github).toBe(0);
				}
			);

			it('counts each independent publisher separately when both debut on the same day', async () => {
				// Two different native publishers debut their apps the same
				// day → newNative = 2 on that day.
				await seed([
					{ pubkey: BOB_PUBKEY, app_d_tag: 'org.bob.app', created_at: daysAgo(20) },
					{ pubkey: CAROL_PUBKEY, app_d_tag: 'org.carol.app', created_at: daysAgo(20) }
				]);

				const rows = await runDaily();
				const day20 = findDay(rows, daysAgo(20));
				expect(day20?.native).toBe(2);
				expect(day20?.newNative).toBe(2);
			});

			it('multi-publisher case: native debut counts; same-d_tag curator republish does NOT', async () => {
				// Alice publishes org.alice.app on day -30 (Alice's first-ever
				// for that (pubkey, app_d_tag)) — native, newNative.
				// Curator publishes org.alice.app on day -10 (curator's
				// first-ever for that (pubkey, app_d_tag) tuple) — github,
				// NOT newNative (it's not in the native partition).
				await seed([
					{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(30) },
					{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(10) }
				]);

				const rows = await runDaily();

				const day30 = findDay(rows, daysAgo(30));
				expect(day30?.native).toBe(1);
				expect(day30?.newNative).toBe(1);

				const day10 = findDay(rows, daysAgo(10));
				expect(day10?.github).toBe(1);
				expect(day10?.native).toBe(0);
				expect(day10?.newNative).toBe(0);
			});

			it('newNative[i] ≤ native[i] on every day (overlay invariant)', async () => {
				// Mixed shape: multiple apps, multiple versions, mixed
				// publishers, mixed days. newNative is a strict subset of
				// native on every output day; this invariant is what makes
				// the chart's overlay-bar render correctly (yellow never
				// exceeds purple).
				await seed([
					// Alice: 3 versions (-60 debut, -30, -5)
					{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(60) },
					{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(30) },
					{ pubkey: ALICE_PUBKEY, app_d_tag: 'org.alice.app', created_at: daysAgo(5) },
					// Bob: 1 version (-20 debut)
					{ pubkey: BOB_PUBKEY, app_d_tag: 'org.bob.app', created_at: daysAgo(20) },
					// Carol: 2 versions (-20 debut SAME DAY as Bob's debut, -10)
					{ pubkey: CAROL_PUBKEY, app_d_tag: 'org.carol.app', created_at: daysAgo(20) },
					{ pubkey: CAROL_PUBKEY, app_d_tag: 'org.carol.app', created_at: daysAgo(10) },
					// Zapstore-own (counts as native)
					{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'dev.zapstore.app', created_at: daysAgo(40) },
					// Curator republishes (github — never newNative)
					{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'com.gh.a', created_at: daysAgo(45) },
					{ pubkey: ZAPSTORE_PUBKEY, app_d_tag: 'com.gh.b', created_at: daysAgo(15) }
				]);

				const rows = await runDaily();

				for (const r of rows) {
					expect(r.newNative).toBeLessThanOrEqual(r.native);
				}

				// Spot-check the debut day with two simultaneous newNative apps.
				const day20 = findDay(rows, daysAgo(20));
				expect(day20?.native).toBe(2); // Bob v1 + Carol v1
				expect(day20?.newNative).toBe(2); // both debuting

				// Day -10: Carol v2 (NOT a debut)
				const day10 = findDay(rows, daysAgo(10));
				expect(day10?.native).toBe(1);
				expect(day10?.newNative).toBe(0);

				// Aggregate: 4 distinct native apps debuting in the window
				// (Alice, Bob, Carol, dev.zapstore.app); 6 native events
				// (Alice×3 + Bob + Carol×2 + zapstore-own).
				const totalNative = rows.reduce((sum, r) => sum + r.native, 0);
				const totalNewNative = rows.reduce((sum, r) => sum + r.newNative, 0);
				expect(totalNative).toBe(7);
				expect(totalNewNative).toBe(4);
			});
		});
	});
});
