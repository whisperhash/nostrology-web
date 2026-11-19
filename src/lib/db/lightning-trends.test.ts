// @vitest-environment node
//
// Integration tests for the SQL behind /lightning's three rolling-30-day
// trend charts. The queries are exported as constants from postgres.ts so
// these tests run the production SQL verbatim — no risk of test-vs-prod
// SQL drift.
//
// Coverage:
//   - Aggregation correctness — daily bucketing, signer→provider mapping
//     via JOIN against lightning_provider_signers, NULL signer falls into
//     'other'.
//   - Top-N selection — top-N is computed over the trailing-365d window
//     (NOT the wider compute window), stable across the chart's days.
//   - 'other' bucket — every provider not in top-N folds into one 'other'
//     line so share charts sum to 100% per day.
//   - Rolling-30d math — window function emits sum-of-prior-30-days.
//   - Sats outlier cap — LEAST(amount_msats, 10000000000) caps spoofed
//     BTC-scale zap-requests at 10M sats per event.
//   - Trim-to-365d output — rows outside the trailing-365d output window
//     are excluded but still influence the rolling window for early days.
//   - Share charts sum to ~100% per day (within float tolerance).
//
// Isolation: each test creates TEMPORARY TABLEs shadowing
// `events_kind_9735_zaps` and `lightning_provider_signers`, plus a TEMP VIEW
// shadowing the `lightning_daily_provider_mv` materialized view the production
// trends queries now read (built from the production MV body
// SQL_LIGHTNING_DAILY_PROVIDER_MV, so it recomputes the byte-identical daily
// grain live over the temp fixtures). Postgres resolves `pg_temp` before
// `public` in the search_path, so the production queries hit the test fixtures.
// Production data is untouched.
//
// Tests skip cleanly when Postgres is unreachable.

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
	SQL_LIGHTNING_TRENDS_ZAP_SHARE_30D,
	SQL_LIGHTNING_TRENDS_SATS_SHARE_30D,
	SQL_LIGHTNING_TRENDS_SATS_ABSOLUTE_30D,
	SQL_LIGHTNING_TRENDS_ZAPS_ABSOLUTE_30D,
	SQL_LIGHTNING_DAILY_PROVIDER_MV,
} from './postgres';

const TEST_DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	'postgresql://nostr_brain:changeme@localhost:5432/nostr_brain';

const probePool = new pg.Pool({
	connectionString: TEST_DATABASE_URL,
	connectionTimeoutMillis: 2000,
	max: 1,
});
let postgresAvailable = false;
try {
	const c = await probePool.connect();
	await c.query('SELECT 1');
	c.release();
	postgresAvailable = true;
} catch (err) {
	console.warn(
		`[lightning-trends.test] Postgres unreachable at ${TEST_DATABASE_URL}; skipping integration tests.`,
		err instanceof Error ? err.message : err,
	);
}
await probePool.end();

const pool = postgresAvailable
	? new pg.Pool({ connectionString: TEST_DATABASE_URL, connectionTimeoutMillis: 2000 })
	: null;

afterAll(async () => {
	if (pool) await pool.end();
});

let client: pg.PoolClient | null = null;

beforeEach(async () => {
	if (!pool) return;
	client = await pool.connect();
	// Shadow both tables the trends queries touch. Schema mirrors only the
	// columns the queries reference; we omit indexes/constraints not used
	// by the test fixtures.
	await client.query(`
		CREATE TEMP TABLE events_kind_9735_zaps (
			event_id            CHAR(64) PRIMARY KEY,
			sender_pubkey       CHAR(64) NOT NULL,
			recipient_pubkey    CHAR(64),
			created_at          BIGINT   NOT NULL,
			target_event_id     CHAR(64),
			amount_msats        BIGINT,
			lnurl_signer_pubkey CHAR(64)
		) ON COMMIT PRESERVE ROWS
	`);
	await client.query(`
		CREATE TEMP TABLE lightning_provider_signers (
			signer_pubkey   CHAR(64) PRIMARY KEY,
			provider_domain TEXT     NOT NULL,
			verified_at     DATE,
			verified_via    TEXT,
			notes           TEXT
		) ON COMMIT PRESERVE ROWS
	`);
	// Production reads lightning_daily_provider_mv (the precomputed daily grain),
	// not the base tables directly. Shadow it with a TEMP VIEW of the SAME name
	// (pg_temp resolves before public) defined by the production MV body — so it
	// recomputes live from the temp fixtures above on each query. This keeps the
	// tests end-to-end (raw zaps + signers → final trend output) while exercising
	// the byte-identical aggregation the real MV runs. Created AFTER the temp
	// tables so it binds to their OIDs.
	await client.query(
		`CREATE TEMP VIEW lightning_daily_provider_mv AS ${SQL_LIGHTNING_DAILY_PROVIDER_MV}`,
	);
});

afterEach(async () => {
	if (client) {
		try {
			// Drop the view before the tables it depends on.
			await client.query('DROP VIEW IF EXISTS pg_temp.lightning_daily_provider_mv');
			await client.query('DROP TABLE IF EXISTS pg_temp.events_kind_9735_zaps');
			await client.query('DROP TABLE IF EXISTS pg_temp.lightning_provider_signers');
		} finally {
			client.release();
			client = null;
		}
	}
});

// ─── Test fixtures ────────────────────────────────────────────────────────

let eventCounter = 0;
function nextEventId(): string {
	// 64-hex distinct per row.
	eventCounter += 1;
	return eventCounter.toString(16).padStart(64, '0');
}

const SENDER = 'a'.repeat(64);
const RECIPIENT = 'b'.repeat(64);

interface ZapFixture {
	signer: string;        // raw signer pubkey for events_kind_9735_zaps.lnurl_signer_pubkey
	days_ago: number;      // 0 = today (UTC midnight); 30 = 30 days ago; etc.
	amount_msats?: number; // default 100_000 (100 sats)
}

async function seedZaps(zaps: ZapFixture[]) {
	if (!client || zaps.length === 0) return;
	// Anchor each zap at noon UTC of (today - days_ago) to avoid date_trunc
	// boundary races within a few seconds of midnight.
	const values = zaps
		.map(
			(_, i) =>
				`($${5 * i + 1}, $${5 * i + 2}, $${5 * i + 3}, $${5 * i + 4}, $${5 * i + 5})`,
		)
		.join(', ');
	const params: (string | number)[] = [];
	for (const z of zaps) {
		const noonUtcSecs = Math.floor(Date.now() / 86400000) * 86400 + 43200;
		const ts = noonUtcSecs - z.days_ago * 86400;
		params.push(nextEventId(), SENDER, ts, z.amount_msats ?? 100_000, z.signer);
	}
	await client.query(
		`INSERT INTO events_kind_9735_zaps
		 (event_id, sender_pubkey, created_at, amount_msats, lnurl_signer_pubkey)
		 VALUES ${values}`,
		params,
	);
	// recipient_pubkey is irrelevant to these queries; left NULL.
}

async function seedSigners(map: { signer: string; domain: string }[]) {
	if (!client || map.length === 0) return;
	const values = map.map((_, i) => `($${2 * i + 1}, $${2 * i + 2})`).join(', ');
	const params = map.flatMap((m) => [m.signer, m.domain]);
	await client.query(
		`INSERT INTO lightning_provider_signers (signer_pubkey, provider_domain)
		 VALUES ${values}`,
		params,
	);
}

interface TrendsRow {
	day: string;
	provider: string;
	value: number;
}

async function run(sql: string, limit: number): Promise<TrendsRow[]> {
	const result = await client!.query<{ day: string; provider: string; value: string }>(sql, [limit]);
	return result.rows.map((r) => ({
		day: r.day,
		provider: r.provider,
		value: typeof r.value === 'string' ? parseFloat(r.value) : (r.value as unknown as number),
	}));
}

// 64-hex helper for synthetic signer pubkeys.
const sk = (label: string): string => label.repeat(64).slice(0, 64);

const describeOrSkip = postgresAvailable ? describe : describe.skip;

// ─── Aggregation correctness ──────────────────────────────────────────────

describeOrSkip('SQL_LIGHTNING_TRENDS_* — aggregation', () => {
	it('returns no rows for an empty zap table', async () => {
		const z = await run(SQL_LIGHTNING_TRENDS_ZAP_SHARE_30D, 10);
		const ss = await run(SQL_LIGHTNING_TRENDS_SATS_SHARE_30D, 10);
		const sa = await run(SQL_LIGHTNING_TRENDS_SATS_ABSOLUTE_30D, 10);
		expect(z).toEqual([]);
		expect(ss).toEqual([]);
		expect(sa).toEqual([]);
	});

	it('maps a known signer to its provider via the mapping table', async () => {
		await seedSigners([{ signer: sk('1'), domain: 'primal.net' }]);
		await seedZaps([{ signer: sk('1'), days_ago: 0 }]);
		const rows = await run(SQL_LIGHTNING_TRENDS_ZAP_SHARE_30D, 5);
		// Today's row for primal.net should be 100% (only provider).
		const todays = rows.filter((r) => r.provider === 'primal.net');
		expect(todays.length).toBeGreaterThan(0);
		// Only provider in the result, so its share is 100% on today.
		const todayRow = todays[todays.length - 1];
		expect(todayRow.value).toBeCloseTo(100, 1);
	});

	it('falls back to "other" when signer has no mapping entry', async () => {
		await seedZaps([{ signer: sk('z'), days_ago: 0 }]);
		const rows = await run(SQL_LIGHTNING_TRENDS_ZAP_SHARE_30D, 10);
		const providers = new Set(rows.map((r) => r.provider));
		expect(providers).toEqual(new Set(['other']));
	});

	it('falls back to "other" when signer column is NULL on the zap row', async () => {
		await client!.query(
			`INSERT INTO events_kind_9735_zaps
			 (event_id, sender_pubkey, created_at, amount_msats, lnurl_signer_pubkey)
			 VALUES ($1, $2, $3, $4, NULL)`,
			[nextEventId(), SENDER, Math.floor(Date.now() / 1000) - 100, 100_000],
		);
		const rows = await run(SQL_LIGHTNING_TRENDS_ZAP_SHARE_30D, 10);
		expect(new Set(rows.map((r) => r.provider))).toEqual(new Set(['other']));
	});

	it('groups multiple zaps from the same signer into one daily bucket', async () => {
		await seedSigners([{ signer: sk('a'), domain: 'wallet.example' }]);
		await seedZaps([
			{ signer: sk('a'), days_ago: 0, amount_msats: 100_000 },
			{ signer: sk('a'), days_ago: 0, amount_msats: 200_000 },
			{ signer: sk('a'), days_ago: 0, amount_msats: 300_000 },
		]);
		const rows = await run(SQL_LIGHTNING_TRENDS_SATS_ABSOLUTE_30D, 5);
		// Today's wallet.example row should be (100 + 200 + 300)/1000 = 600 sats
		// rolling sum (it's also today's daily since no other days are seeded).
		const today = rows.filter((r) => r.provider === 'wallet.example').pop();
		expect(today).toBeDefined();
		expect(today!.value).toBeCloseTo(600, 1);
	});

	it('SQL_LIGHTNING_TRENDS_ZAPS_ABSOLUTE_30D emits the rolling-30d zap count', async () => {
		await seedSigners([{ signer: sk('a'), domain: 'wallet.example' }]);
		await seedZaps([
			{ signer: sk('a'), days_ago: 0 },
			{ signer: sk('a'), days_ago: 0 },
			{ signer: sk('a'), days_ago: 0 },
		]);
		const rows = await run(SQL_LIGHTNING_TRENDS_ZAPS_ABSOLUTE_30D, 5);
		const today = rows.filter((r) => r.provider === 'wallet.example').pop();
		expect(today).toBeDefined();
		expect(today!.value).toBeCloseTo(3, 1);
	});
});

// ─── Top-N selection ──────────────────────────────────────────────────────

describeOrSkip('SQL_LIGHTNING_TRENDS_* — top-N selection', () => {
	it('returns at most N + 1 distinct providers (top-N + "other")', async () => {
		// Seed 8 providers, each with a distinct zap count: 1, 2, 3, ..., 8.
		// Top-3 should be domains 6, 7, 8; everything else folds to 'other'.
		const signers = ['1', '2', '3', '4', '5', '6', '7', '8'].map((c) => ({
			signer: sk(c),
			domain: `p${c}.example`,
		}));
		await seedSigners(signers);
		const zaps: ZapFixture[] = [];
		for (let n = 1; n <= 8; n++) {
			for (let k = 0; k < n; k++) {
				zaps.push({ signer: sk(String(n)), days_ago: 0 });
			}
		}
		await seedZaps(zaps);
		const rows = await run(SQL_LIGHTNING_TRENDS_ZAP_SHARE_30D, 3);
		const distinctProviders = new Set(rows.map((r) => r.provider));
		// Exactly top-3 + "other" = 4 distinct providers.
		expect(distinctProviders.size).toBeLessThanOrEqual(4);
		expect(distinctProviders.has('other')).toBe(true);
		// Top-3 by zap count are p6, p7, p8.
		expect(distinctProviders.has('p6.example')).toBe(true);
		expect(distinctProviders.has('p7.example')).toBe(true);
		expect(distinctProviders.has('p8.example')).toBe(true);
		// Below-cutoff providers must NOT appear individually.
		expect(distinctProviders.has('p1.example')).toBe(false);
		expect(distinctProviders.has('p2.example')).toBe(false);
	});

	it('top-N for the zap-share query is by zap COUNT', async () => {
		// p_count: many small zaps. p_sats: few huge zaps.
		// By count: p_count wins. By sats: p_sats wins.
		await seedSigners([
			{ signer: sk('c'), domain: 'p_count.example' },
			{ signer: sk('s'), domain: 'p_sats.example' },
		]);
		const zaps: ZapFixture[] = [];
		for (let i = 0; i < 50; i++) zaps.push({ signer: sk('c'), days_ago: 0, amount_msats: 1_000 });
		for (let i = 0; i < 5; i++) zaps.push({ signer: sk('s'), days_ago: 0, amount_msats: 1_000_000 });
		await seedZaps(zaps);
		const byZap = await run(SQL_LIGHTNING_TRENDS_ZAP_SHARE_30D, 1);
		// Top-1 by zap COUNT → p_count + 'other'.
		const zapProviders = new Set(byZap.map((r) => r.provider));
		expect(zapProviders.has('p_count.example')).toBe(true);
		expect(zapProviders.has('p_sats.example')).toBe(false);
	});

	it('top-N for the sats query is by sats SUM', async () => {
		await seedSigners([
			{ signer: sk('c'), domain: 'p_count.example' },
			{ signer: sk('s'), domain: 'p_sats.example' },
		]);
		const zaps: ZapFixture[] = [];
		for (let i = 0; i < 50; i++) zaps.push({ signer: sk('c'), days_ago: 0, amount_msats: 1_000 });
		for (let i = 0; i < 5; i++) zaps.push({ signer: sk('s'), days_ago: 0, amount_msats: 1_000_000 });
		await seedZaps(zaps);
		const bySats = await run(SQL_LIGHTNING_TRENDS_SATS_ABSOLUTE_30D, 1);
		const satsProviders = new Set(bySats.map((r) => r.provider));
		expect(satsProviders.has('p_sats.example')).toBe(true);
		expect(satsProviders.has('p_count.example')).toBe(false);
	});

	it('top-N membership is stable across days', async () => {
		// Seed two providers; one is consistently bigger.
		await seedSigners([
			{ signer: sk('1'), domain: 'big.example' },
			{ signer: sk('2'), domain: 'small.example' },
		]);
		const zaps: ZapFixture[] = [];
		// 'big' consistently has ~3 zaps/day; 'small' has 1 zap/day. Across
		// 60 days both appear daily, but 'big' always dominates.
		for (let d = 0; d < 60; d++) {
			zaps.push({ signer: sk('1'), days_ago: d });
			zaps.push({ signer: sk('1'), days_ago: d });
			zaps.push({ signer: sk('1'), days_ago: d });
			zaps.push({ signer: sk('2'), days_ago: d });
		}
		await seedZaps(zaps);
		const rows = await run(SQL_LIGHTNING_TRENDS_ZAP_SHARE_30D, 1);
		// With limit=1 only 'big.example' should be in the line set across
		// every day in the output (plus 'other').
		const providersByDay = new Map<string, Set<string>>();
		for (const r of rows) {
			if (!providersByDay.has(r.day)) providersByDay.set(r.day, new Set());
			providersByDay.get(r.day)!.add(r.provider);
		}
		for (const [, providers] of providersByDay) {
			expect(providers.has('big.example')).toBe(true);
			// 'small.example' should NEVER appear individually — it folds to other.
			expect(providers.has('small.example')).toBe(false);
		}
	});
});

// ─── 'other' bucket ───────────────────────────────────────────────────────

describeOrSkip("SQL_LIGHTNING_TRENDS_* — 'other' bucket", () => {
	it("aggregates below-cutoff providers AND unmapped signers into one 'other' line", async () => {
		await seedSigners([
			{ signer: sk('1'), domain: 'top.example' },
			{ signer: sk('2'), domain: 'small1.example' },
			{ signer: sk('3'), domain: 'small2.example' },
		]);
		await seedZaps([
			// Top by far.
			...Array(20).fill(0).map(() => ({ signer: sk('1'), days_ago: 0 })),
			// Two small mapped providers.
			{ signer: sk('2'), days_ago: 0 },
			{ signer: sk('3'), days_ago: 0 },
			// One unmapped signer.
			{ signer: sk('z'), days_ago: 0 },
		]);
		const rows = await run(SQL_LIGHTNING_TRENDS_ZAP_SHARE_30D, 1);
		// 'other' rolling-30d count for today should be 3 (small1 + small2 + unmapped).
		// Compute by inverse: top.example fraction = 20 / (20 + 3) = 86.96%, other = 13.04%.
		const today = rows.filter((r) => r.day === rows[rows.length - 1].day);
		const top = today.find((r) => r.provider === 'top.example')!;
		const other = today.find((r) => r.provider === 'other')!;
		expect(top.value).toBeCloseTo((20 / 23) * 100, 1);
		expect(other.value).toBeCloseTo((3 / 23) * 100, 1);
	});

	it("share charts sum to ~100% on every day with activity", async () => {
		// Seed activity on multiple days so the rolling-30d sum is non-zero
		// across a wide span — otherwise days with zero activity legitimately
		// emit 0% per provider (NULLIF guards divide-by-zero on idle days).
		await seedSigners([
			{ signer: sk('1'), domain: 'a.example' },
			{ signer: sk('2'), domain: 'b.example' },
			{ signer: sk('3'), domain: 'c.example' },
		]);
		const zaps: ZapFixture[] = [];
		for (let d = 0; d < 30; d++) {
			zaps.push({ signer: sk('1'), days_ago: d });
			zaps.push({ signer: sk('2'), days_ago: d });
			zaps.push({ signer: sk('3'), days_ago: d });
			zaps.push({ signer: sk('z'), days_ago: d });
		}
		await seedZaps(zaps);
		const rows = await run(SQL_LIGHTNING_TRENDS_ZAP_SHARE_30D, 10);
		const sumByDay = new Map<string, number>();
		for (const r of rows) {
			sumByDay.set(r.day, (sumByDay.get(r.day) ?? 0) + r.value);
		}
		// Every day with a non-zero sum must sum to ~100. Idle days
		// (sum == 0) are valid output and not asserted on.
		let daysAssertedOn = 0;
		for (const [, sum] of sumByDay) {
			if (sum > 0) {
				expect(sum).toBeCloseTo(100, 1);
				daysAssertedOn += 1;
			}
		}
		// Sanity: the seeded activity covers ~30 days, so we should have
		// many active days in the output.
		expect(daysAssertedOn).toBeGreaterThan(20);
	});
});

// ─── Rolling 30-day window math ───────────────────────────────────────────

describeOrSkip('SQL_LIGHTNING_TRENDS_* — rolling 30-day math', () => {
	it('rolling sum at day=today equals the sum of zap counts on days 0..29', async () => {
		await seedSigners([{ signer: sk('1'), domain: 'roll.example' }]);
		// 1 zap per day for 30 days starting today.
		const zaps: ZapFixture[] = [];
		for (let d = 0; d < 30; d++) zaps.push({ signer: sk('1'), days_ago: d });
		await seedZaps(zaps);
		const rows = await run(SQL_LIGHTNING_TRENDS_SATS_ABSOLUTE_30D, 5);
		// Today's row for roll.example should sum 30 zaps × 100 sats = 3000 sats.
		const today = rows.filter((r) => r.provider === 'roll.example').pop()!;
		expect(today.value).toBeCloseTo(3000, 1);
	});

	it("a zap on day -60 influences the rolling window for early output days", async () => {
		// One zap 60 days ago. The earliest output day is today-365. Its
		// rolling-30d window covers days [today-394, today-365]. The zap on
		// day-60 is INSIDE the chart's output window — it should appear in
		// the rolling sum for days [today-60, today-31] (30 days centered
		// behind it). This test pins that the rolling math doesn't lose the
		// late-window event.
		await seedSigners([{ signer: sk('1'), domain: 'roll.example' }]);
		await seedZaps([{ signer: sk('1'), days_ago: 60 }]);
		const rows = await run(SQL_LIGHTNING_TRENDS_SATS_ABSOLUTE_30D, 5);
		const rollExampleRows = rows.filter((r) => r.provider === 'roll.example');
		// The 100-sat zap should propagate through 30 consecutive days of
		// non-zero rolling sums.
		const nonZero = rollExampleRows.filter((r) => r.value > 0);
		expect(nonZero.length).toBe(30);
	});
});

// ─── Sats outlier cap ─────────────────────────────────────────────────────

describeOrSkip('SQL_LIGHTNING_TRENDS_* — sats outlier cap', () => {
	it('caps individual zaps at 10M sats (= 10_000_000_000 msats)', async () => {
		await seedSigners([{ signer: sk('1'), domain: 'whale.example' }]);
		// One legit small zap + one large-but-below-filter zap that tests the LEAST cap.
		// Filter threshold: 21_000_000_000 msats (21M sats = 0.21 BTC). LEAST cap: 10_000_000_000 msats.
		// Use 15B msats (15M sats): above the cap so it gets capped, below the filter so it passes.
		await seedZaps([
			{ signer: sk('1'), days_ago: 0, amount_msats: 1_000 },              // 1 sat
			{ signer: sk('1'), days_ago: 0, amount_msats: 15_000_000_000 }, // 15M sats — above LEAST cap, below spam filter
		]);
		const rows = await run(SQL_LIGHTNING_TRENDS_SATS_ABSOLUTE_30D, 5);
		const today = rows.filter((r) => r.provider === 'whale.example').pop()!;
		// Cap = 10M sats. Total = 10M + 1 = 10_000_001 sats.
		expect(today.value).toBeCloseTo(10_000_001, 0);
	});

	it('excludes spam zaps above the 0.21 BTC filter (21_000_000_000 msats) entirely', async () => {
		// The 2026-05-19 relay.zapstore.dev spam is structurally valid and only
		// detectable by its economically impossible amount; the WHERE filter in
		// daily_raw drops it outright (NOT clamped like the LEAST cap).
		await seedSigners([{ signer: sk('1'), domain: 'spam.example' }]);
		await seedZaps([
			{ signer: sk('1'), days_ago: 0, amount_msats: 5_000 },                 // 5 sats — legit, kept
			{ signer: sk('1'), days_ago: 0, amount_msats: 21_000_000_001 },        // just over 0.21 BTC — filtered
			{ signer: sk('1'), days_ago: 0, amount_msats: 2_100_000_000_000_000 }, // Group-3-scale spam — filtered
		]);
		const rows = await run(SQL_LIGHTNING_TRENDS_SATS_ABSOLUTE_30D, 5);
		const today = rows.filter((r) => r.provider === 'spam.example').pop()!;
		// Only the 5-sat legit zap survives; the two above-threshold zaps are
		// excluded from the sum entirely (not capped).
		expect(today.value).toBeCloseTo(5, 0);
	});
});

// ─── Trim-to-365d output window ───────────────────────────────────────────

describeOrSkip('SQL_LIGHTNING_TRENDS_* — output window', () => {
	it('does not emit rows older than 365 days, even if their data is in the compute window', async () => {
		await seedSigners([{ signer: sk('1'), domain: 'old.example' }]);
		await seedZaps([{ signer: sk('1'), days_ago: 380 }]); // inside -395d compute, outside -365d output
		const rows = await run(SQL_LIGHTNING_TRENDS_ZAP_SHARE_30D, 10);
		// The seeded zap is in the compute window so 'old.example' may appear
		// on early days where its rolling-30d sum is non-zero — but no row
		// should have day < (today - 365).
		const cutoff = new Date();
		cutoff.setUTCDate(cutoff.getUTCDate() - 365);
		const cutoffISO = cutoff.toISOString().slice(0, 10);
		for (const r of rows) {
			expect(r.day >= cutoffISO).toBe(true);
		}
	});

	it('skips events with NULL or non-positive amount_msats', async () => {
		await seedSigners([{ signer: sk('1'), domain: 'q.example' }]);
		// One legitimate zap (so the output isn't entirely empty).
		await seedZaps([{ signer: sk('1'), days_ago: 0, amount_msats: 100_000 }]);
		// Insert a NULL-amount and a zero-amount row directly to bypass the
		// fixture helper (which always sets a positive amount).
		await client!.query(
			`INSERT INTO events_kind_9735_zaps
			 (event_id, sender_pubkey, created_at, amount_msats, lnurl_signer_pubkey)
			 VALUES ($1, $2, $3, NULL, $4), ($5, $6, $7, 0, $8)`,
			[
				nextEventId(), SENDER, Math.floor(Date.now() / 1000) - 1000, sk('1'),
				nextEventId(), SENDER, Math.floor(Date.now() / 1000) - 2000, sk('1'),
			],
		);
		const rows = await run(SQL_LIGHTNING_TRENDS_SATS_ABSOLUTE_30D, 5);
		// Today's row sees only the one 100-sat zap — NOT three.
		const today = rows.filter((r) => r.provider === 'q.example').pop()!;
		expect(today.value).toBeCloseTo(100, 1);
	});
});
