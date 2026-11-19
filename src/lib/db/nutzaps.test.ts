// @vitest-environment node
//
// Integration tests for the SQL behind /nutzaps and /nutzaps/mints: only
// PAYMENTS count (nostrology-data#8).
//
// The loader keeps every nutzap-shaped kind-9321 (nutzaps) event, but only rows
// with value_source = 'proof_tags' carry Cashu ecash in the NIP-61 form. Rows
// with value_source = 'none' (2024 draft format, encrypted, bare tokens,
// zero-ecash) are worth 0 and are not payments; 'unclassified' rows are ones a
// loader older than #8 wrote, still holding the amount-tag value that made ~95%
// of all-time served sats phantom. Every query here must count, sum and count
// senders over 'proof_tags' rows only. The seeds below put a phantom
// 'unclassified' row and a zero-value 'none' row next to real payments, so a
// query that loses its filter fails on both the count and the sum.
//
// Nor do rows on EXCLUDED mints (nostrology-data#9): nutzap_mint_classes marks
// private hosts and reviewed test mints, whose payments, senders, leaderboard rows
// and per-mint pages all go. A mint absent from that table counts (unreviewed).
//
// The queries are the exported production constants, run verbatim. Isolation
// is the same as zapstore-charts.test.ts: TEMP tables shadow the production
// tables (pg_temp resolves before public). Skips when Postgres is unreachable.

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
	NUTZAP_ALL_TIME_CONFIG_FLOOR,
	nutzapMintIsListed,
	SQL_NUTZAP_MINT_DAILY,
	SQL_NUTZAP_MINT_LISTING,
	SQL_NUTZAP_MINT_MAU,
	SQL_NUTZAP_MINT_STATS,
	SQL_NUTZAPS_DAILY_SERIES,
	SQL_NUTZAPS_TOP_MINTS_CUMULATIVE
} from './postgres';

const TEST_DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	'postgresql://nostr_brain:changeme@localhost:5432/nostr_brain';

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
		`[nutzaps.test] Postgres unreachable at ${TEST_DATABASE_URL}; skipping integration tests.`,
		err instanceof Error ? err.message : err
	);
}
await probePool.end();

const NOON_TODAY_UTC = Math.floor(Date.now() / 86400000) * 86400 + 43200;
const daysAgo = (n: number) => NOON_TODAY_UTC - n * 86400;

const MINT_A = 'https://mint.a.example';
const MINT_B = 'https://mint.b.example';
const MINT_PHANTOM = 'https://mint.phantom.example';
// Excluded (#9): the loopback test harness and a fake-backend test mint.
const MINT_LOOPBACK = 'http://127.0.0.1:3338';
const MINT_TESTNUT = 'https://testnut.cashu.space';
// Counted although nutzap_mint_classes has no row for it (first seen since the
// last classification) or labels it without excluding it.
const MINT_UNCLASSIFIED = 'https://mint.new.example';
const MINT_LABELLED = 'https://mint.routstr.example';
// Listed on 'all' for its configs alone, one below the floor, and an excluded
// mint with plenty of configs (the nofee.testnut shape).
const MINT_CONFIGURED = 'https://mint.configured.example';
const MINT_UNDER_FLOOR = 'https://mint.underfloor.example';
const MINT_FAKE_CONFIGURED = 'https://nofee.testnut.cashu.space';
const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const CAROL = 'c'.repeat(64);
const HARNESS = 'd'.repeat(64);
const DAVE = 'e'.repeat(64);

interface Row {
	pubkey: string;
	created_at: number;
	mint_url: string;
	amount_sats: number;
	value_source: 'proof_tags' | 'none' | 'unclassified';
}

// Payments on A and B; around them, what must NOT count:
//  - CAROL's pre-#8 'unclassified' row: 76,000 sats of amount-tag value
//    (the "Encrypted NutZap" shape) on A.
//  - CAROL's 'none' rows (0 sats) on B and on MINT_PHANTOM, a mint that only
//    ever saw non-payments.
const SEED: Row[] = [
	{ pubkey: ALICE, created_at: daysAgo(3), mint_url: MINT_A, amount_sats: 21, value_source: 'proof_tags' },
	{ pubkey: ALICE, created_at: daysAgo(2), mint_url: MINT_A, amount_sats: 5, value_source: 'proof_tags' },
	{ pubkey: BOB, created_at: daysAgo(2), mint_url: MINT_B, amount_sats: 100, value_source: 'proof_tags' },
	{ pubkey: CAROL, created_at: daysAgo(2), mint_url: MINT_A, amount_sats: 76000, value_source: 'unclassified' },
	{ pubkey: CAROL, created_at: daysAgo(2), mint_url: MINT_B, amount_sats: 0, value_source: 'none' },
	{ pubkey: CAROL, created_at: daysAgo(1), mint_url: MINT_PHANTOM, amount_sats: 0, value_source: 'none' },
	// Excluded mints: real proof-tag rows that must still not count.
	{ pubkey: HARNESS, created_at: daysAgo(2), mint_url: MINT_LOOPBACK, amount_sats: 31318, value_source: 'proof_tags' },
	{ pubkey: HARNESS, created_at: daysAgo(3), mint_url: MINT_TESTNUT, amount_sats: 32, value_source: 'proof_tags' },
	// Counted: no class row, and a labelled-but-kept class.
	{ pubkey: DAVE, created_at: daysAgo(2), mint_url: MINT_UNCLASSIFIED, amount_sats: 7, value_source: 'proof_tags' },
	{ pubkey: DAVE, created_at: daysAgo(3), mint_url: MINT_LABELLED, amount_sats: 3, value_source: 'proof_tags' }
];

// nutzap_mint_classes as the classification writes it. MINT_UNCLASSIFIED has no row.
const CLASSES: Array<[string, string, boolean]> = [
	[MINT_A, 'unreviewed', false],
	[MINT_B, 'unreviewed', false],
	[MINT_PHANTOM, 'unreviewed', false],
	[MINT_LOOPBACK, 'private-host', true],
	[MINT_TESTNUT, 'fake-backend', true],
	[MINT_FAKE_CONFIGURED, 'fake-backend', true],
	[MINT_LABELLED, 'test-wording-live', false],
	[MINT_CONFIGURED, 'unreviewed', false],
	[MINT_UNDER_FLOOR, 'unreviewed', false]
];

// Latest kind-10019 (nutzap-configs) per pubkey: MINT_CONFIGURED and
// MINT_FAKE_CONFIGURED on NUTZAP_ALL_TIME_CONFIG_FLOOR + 2 configs each,
// MINT_UNDER_FLOOR on one fewer than the floor, and one config naming the loopback.
const CONFIGS: Array<[string, string[]]> = [
	...Array.from({ length: NUTZAP_ALL_TIME_CONFIG_FLOOR + 2 }, (_, i): [string, string[]] => [
		String(1000 + i).padStart(64, '0'),
		[MINT_CONFIGURED, MINT_FAKE_CONFIGURED, ...(i < NUTZAP_ALL_TIME_CONFIG_FLOOR - 1 ? [MINT_UNDER_FLOOR] : [])]
	]),
	['f'.repeat(64), [MINT_LOOPBACK, MINT_A]]
];

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
	// The columns the queries touch; the rest of the production table is omitted.
	await client.query(`
		CREATE TEMP TABLE events_kind_9321_nutzaps (
			event_id     TEXT   NOT NULL,
			pubkey       TEXT   NOT NULL,
			created_at   BIGINT NOT NULL,
			mint_url     TEXT   NOT NULL,
			amount_sats  BIGINT NOT NULL DEFAULT 0,
			value_source TEXT   NOT NULL
		) ON COMMIT PRESERVE ROWS
	`);
	await client.query(`
		CREATE TEMP TABLE events_kind_10019_nutzap_configs (
			pubkey     TEXT   NOT NULL,
			created_at BIGINT NOT NULL,
			mint_urls  TEXT[] NOT NULL
		) ON COMMIT PRESERVE ROWS
	`);
	await client.query(`
		CREATE TEMP TABLE nutzap_mint_classes (
			mint_url   TEXT    PRIMARY KEY,
			mint_class TEXT    NOT NULL,
			excluded   BOOLEAN NOT NULL
		) ON COMMIT PRESERVE ROWS
	`);
	for (const [url, cls, excluded] of CLASSES) {
		await client.query(`INSERT INTO nutzap_mint_classes VALUES ($1, $2, $3)`, [url, cls, excluded]);
	}
	for (const [pubkey, mints] of CONFIGS) {
		await client.query(`INSERT INTO events_kind_10019_nutzap_configs VALUES ($1, $2, $3)`, [
			pubkey,
			daysAgo(1),
			mints
		]);
	}
	for (const [i, r] of SEED.entries()) {
		await client.query(
			`INSERT INTO events_kind_9321_nutzaps VALUES ($1, $2, $3, $4, $5, $6)`,
			[String(i), r.pubkey, r.created_at, r.mint_url, r.amount_sats, r.value_source]
		);
	}
});

afterEach(async () => {
	if (client) {
		try {
			await client.query('DROP TABLE IF EXISTS pg_temp.events_kind_9321_nutzaps');
			await client.query('DROP TABLE IF EXISTS pg_temp.events_kind_10019_nutzap_configs');
			await client.query('DROP TABLE IF EXISTS pg_temp.nutzap_mint_classes');
		} finally {
			client.release();
			client = null;
		}
	}
});

const last = <T>(xs: T[]) => xs[xs.length - 1];

// The calendar around SQL_NUTZAP_MINT_MAU's window, in UTC: a month by how many months back from
// this one it is, and the months the chart always shows, oldest first: all but the cut oldest one.
const monthStart = (back: number) => {
	const d = new Date();
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1) / 1000;
};
const midMonth = (back: number) => monthStart(back) + 14 * 86400 + 43200;
const oldestMonthsAgo = () => {
	const d = new Date();
	const cutoff = new Date(d.getTime() - 365 * 86400_000);
	return (d.getUTCFullYear() - cutoff.getUTCFullYear()) * 12 + d.getUTCMonth() - cutoff.getUTCMonth();
};
const shownMonths = () => Array.from({ length: oldestMonthsAgo() }, (_, i) => monthStart(oldestMonthsAgo() - 1 - i));

describe.skipIf(!postgresAvailable)('nutzap queries count payments only', () => {
	it('mint leaderboard: payments and total amount exclude non-payment rows', async () => {
		for (const window of [null, 7 * 86400]) {
			const { rows } = await client!.query(SQL_NUTZAP_MINT_STATS, [window, 1]);
			const byMint = Object.fromEntries(
				rows.map((r) => [r.mint_url, [Number(r.payment_count), Number(r.total_amount_sats)]])
			);
			expect(byMint).toEqual({
				[MINT_B]: [1, 100],
				[MINT_A]: [2, 26],
				[MINT_UNCLASSIFIED]: [1, 7],
				[MINT_LABELLED]: [1, 3],
				// Listed for its configs alone (floor 1 here), with no payment.
				[MINT_CONFIGURED]: [0, 0],
				[MINT_UNDER_FLOOR]: [0, 0]
			});
		}
	});

	it('mint leaderboard: a mint that only saw non-payments is not listed', async () => {
		const { rows } = await client!.query(SQL_NUTZAP_MINT_STATS, [null, 1]);
		expect(rows.map((r) => r.mint_url)).not.toContain(MINT_PHANTOM);
	});

	it('overview daily series: counts and sats are payments only', async () => {
		const { rows } = await client!.query(SQL_NUTZAPS_DAILY_SERIES);
		// A, B, the unclassified and the labelled mint; never the loopback or testnut.
		expect(Number(last(rows).cumulative_count)).toBe(5);
		expect(Number(last(rows).cumulative_sats)).toBe(136);
		const twoDaysAgo = rows.find((r) => Number(r.timestamp) === daysAgo(2) - 43200);
		expect([Number(twoDaysAgo.daily_count), Number(twoDaysAgo.daily_sats)]).toEqual([3, 112]);
	});

	it('per-mint detail: payments, sats and MAU exclude non-payment rows', async () => {
		const daily = await client!.query(SQL_NUTZAP_MINT_DAILY, [MINT_A]);
		expect(Number(last(daily.rows).cumulative_count)).toBe(2);
		expect(Number(last(daily.rows).cumulative_sats)).toBe(26);
		const mau = await client!.query(SQL_NUTZAP_MINT_MAU, [MINT_A]);
		const users = mau.rows.reduce((n, r) => n + Number(r.unique_users), 0);
		// ALICE only; CAROL's 'unclassified' row is not a payment. (Both of ALICE's
		// payments are 2-3 days ago, so they can straddle a month boundary: count
		// the months she appears in, which is 1 or 2, never CAROL.)
		expect(users).toBe(new Set([daysAgo(3), daysAgo(2)].map((t) => new Date(t * 1000).getUTCMonth())).size);
	});

	it('per-mint detail: a mint with no payments has no activity', async () => {
		const daily = await client!.query(SQL_NUTZAP_MINT_DAILY, [MINT_PHANTOM]);
		expect(daily.rows.reduce((n, r) => n + Number(r.daily_count), 0)).toBe(0);
		const mau = await client!.query(SQL_NUTZAP_MINT_MAU, [MINT_PHANTOM]);
		expect(mau.rows.map((r) => Number(r.timestamp))).toEqual(shownMonths());
		expect(mau.rows.every((r) => Number(r.unique_users) === 0)).toBe(true);
	});

	// nostrology-web#33 (Per-mint monthly users chart hides months with no activity): the chart's
	// x-axis has one slot per row, so a month with no row vanishes with no sign.
	describe('per-mint monthly users, a true timeline', () => {
		const MINT = 'https://mint.timeline.example';
		let seq = 0;
		const pay = (pubkey: string, created_at: number, value_source = 'proof_tags') =>
			client!.query(`INSERT INTO events_kind_9321_nutzaps VALUES ($1, $2, $3, $4, $5, $6)`, [
				`timeline-${seq++}`,
				pubkey,
				created_at,
				MINT,
				1,
				value_source
			]);
		const series = async () => {
			const { rows } = await client!.query(SQL_NUTZAP_MINT_MAU, [MINT]);
			return rows.map((r) => [Number(r.timestamp), Number(r.unique_users)] as const);
		};
		const NOW = () => Math.floor(Date.now() / 1000);

		it('gives every month a row, 0 where it had no sender', async () => {
			await pay(ALICE, midMonth(5));
			await pay(ALICE, midMonth(2));
			await pay(BOB, midMonth(2));
			expect(await series()).toEqual(
				shownMonths().map((m) => [m, m === monthStart(2) ? 2 : m === monthStart(5) ? 1 : 0])
			);
		});

		it('counts a non-payment for nothing, in a month it would otherwise fill', async () => {
			await pay(CAROL, midMonth(3), 'none');
			await pay(CAROL, midMonth(3), 'unclassified');
			expect((await series()).every(([, users]) => users === 0)).toBe(true);
		});

		it('shows the current month, at 0 until it has a sender (the operator, 2026-11-05)', async () => {
			await pay(ALICE, midMonth(1));
			expect((await series()).slice(-2)).toEqual([
				[monthStart(1), 1],
				[monthStart(0), 0]
			]);
			await pay(BOB, NOW());
			expect((await series()).slice(-2)).toEqual([
				[monthStart(1), 1],
				[monthStart(0), 1]
			]);
		});

		it('keeps the partial oldest month off until a sender inside the window, then counts it', async () => {
			const cutoff = NOW() - 365 * 86400;
			// Before the cutoff: not in the window, so it counts for nothing, in whatever month it is.
			await pay(ALICE, cutoff - 3600);
			expect((await series())[0]).toEqual([shownMonths()[0], 0]);
			// Inside the window, and still inside the cut month if the cutoff is in its last minute.
			await pay(BOB, Math.min(cutoff + 60, monthStart(oldestMonthsAgo() - 1) - 1));
			expect((await series())[0]).toEqual([monthStart(oldestMonthsAgo()), 1]);
		});

		it('draws no month past now, whatever date a forged event carries', async () => {
			await pay(ALICE, midMonth(1));
			await pay(BOB, NOW() + 400 * 86400);
			await pay(BOB, Date.UTC(3000, 0, 1) / 1000);
			const rows = await series();
			expect(rows.at(-1)).toEqual([monthStart(0), 0]);
			expect(rows.map(([m]) => m)).toEqual(shownMonths());
		});

		it('buckets by the UTC month whatever the session time zone', async () => {
			// 23:30Z on the last day of a month is already the next month in Tokyo, at 08:30 the next
			// day.
			const d = new Date();
			await pay(ALICE, Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 2, 0, 23, 30) / 1000);
			await client!.query(`SET TIME ZONE 'Asia/Tokyo'`);
			try {
				expect(await series()).toEqual(shownMonths().map((m) => [m, m === monthStart(3) ? 1 : 0]));
			} finally {
				await client!.query('RESET TIME ZONE');
			}
		});

		// The months come from the clock, so these pin the clock: the one departure from "run
		// verbatim" above is NOW() as a literal. Each runs in three session zones, because a month
		// edge that followed the session would show only in the hours that zone is in a different
		// month from UTC, which a test reading the wall clock almost never lands in.
		describe('at a fixed clock, in any session time zone', () => {
			const ZONES = ['UTC', 'Asia/Tokyo', 'America/New_York'];
			const atClock = async (iso: string) => {
				const sql = SQL_NUTZAP_MINT_MAU.replaceAll('NOW()', `'${iso}'::timestamptz`);
				const { rows } = await client!.query(sql, [MINT]);
				return rows.map((r) => [new Date(Number(r.timestamp) * 1000).toISOString().slice(0, 7), Number(r.unique_users)] as const);
			};
			const inEveryZone = async (check: () => Promise<void>) => {
				for (const zone of ZONES) {
					await client!.query(`SET TIME ZONE '${zone}'`);
					try {
						await check();
					} finally {
						await client!.query('RESET TIME ZONE');
					}
				}
			};
			// 'YYYY-MM' for each of `count` months from `first`.
			const monthsFrom = (first: string, count: number) =>
				Array.from({ length: count }, (_, i) =>
					new Date(Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5)) - 1 + i, 1)).toISOString().slice(0, 7)
				);

			it.each([
				['2026-11-05T12:00:00Z', '2025-12', 12, 'an ordinary day: 12 months, the cut one off'],
				['2026-11-30T20:00:00Z', '2025-12', 12, 'already 12-01 in Tokyo, at both edges of the window'],
				['2026-12-01T02:00:00Z', '2026-01', 12, 'still 11-30 in New York, at both edges of the window'],
				['2026-11-30T23:59:59Z', '2025-12', 12, "a month's last second"],
				['2026-12-01T00:00:00Z', '2026-01', 12, "a month's first second: it has its row, at 0"],
				['2028-02-29T12:00:00Z', '2027-04', 11, 'a leap day: 365 days back is 03-01, so only 11 months']
			])('at %s starts at %s with %i months: %s', async (clock, first, count) => {
				await inEveryZone(async () => {
					expect(await atClock(clock)).toEqual(monthsFrom(first, count).map((m) => [m, 0]));
				});
			});

			it('counts from the cut to the second, and only then shows the cut month', async () => {
				const clock = '2026-11-30T20:00:00Z';
				const cut = Date.UTC(2025, 10, 30, 20) / 1000;
				await pay(ALICE, cut - 1);
				await inEveryZone(async () => {
					expect(await atClock(clock)).toEqual(monthsFrom('2025-12', 12).map((m) => [m, 0]));
				});
				await pay(BOB, cut);
				await inEveryZone(async () => {
					expect(await atClock(clock)).toEqual(monthsFrom('2025-11', 13).map((m) => [m, m === '2025-11' ? 1 : 0]));
				});
			});

			it('takes a date later this month, as the tool does, but adds no month past the clock', async () => {
				const clock = '2026-11-30T20:00:00Z';
				await pay(ALICE, Date.UTC(2026, 10, 30, 23, 59) / 1000);
				await pay(BOB, Date.UTC(2026, 11, 1) / 1000);
				await inEveryZone(async () => {
					expect(await atClock(clock)).toEqual(monthsFrom('2025-12', 12).map((m) => [m, m === '2026-11' ? 1 : 0]));
				});
			});
		});
	});

	it('top mints by cumulative sats: ranked and summed on payments only', async () => {
		const { rows } = await client!.query(SQL_NUTZAPS_TOP_MINTS_CUMULATIVE, [10]);
		const totals = new Map(rows.map((r) => [r.mint_url, Number(r.total_sats)]));
		expect([...totals.entries()]).toEqual([
			[MINT_B, 100],
			[MINT_A, 26],
			[MINT_UNCLASSIFIED, 7],
			[MINT_LABELLED, 3]
		]);
		const lastA = rows.filter((r) => r.mint_url === MINT_A).at(-1);
		expect(Number(lastA.cumulative_sats)).toBe(26);
	});

	it('mint leaderboard: excluded mints are not listed, by payments or by configs', async () => {
		for (const window of [null, 7 * 86400]) {
			for (const floor of [1, NUTZAP_ALL_TIME_CONFIG_FLOOR]) {
				const { rows } = await client!.query(SQL_NUTZAP_MINT_STATS, [window, floor]);
				const listed = rows.map((r) => r.mint_url);
				expect(listed).not.toContain(MINT_LOOPBACK);
				expect(listed).not.toContain(MINT_TESTNUT);
				expect(listed).not.toContain(MINT_FAKE_CONFIGURED);
				expect(listed).toContain(MINT_UNCLASSIFIED);
			}
		}
	});

	it("mint leaderboard 'all': the config floor lists MINT_CONFIGURED and not MINT_UNDER_FLOOR", async () => {
		const { rows } = await client!.query(SQL_NUTZAP_MINT_STATS, [null, NUTZAP_ALL_TIME_CONFIG_FLOOR]);
		const configs = Object.fromEntries(rows.map((r) => [r.mint_url, Number(r.config_count)]));
		expect(configs[MINT_CONFIGURED]).toBe(NUTZAP_ALL_TIME_CONFIG_FLOOR + 2);
		expect(configs).not.toHaveProperty(MINT_UNDER_FLOOR);
		expect(configs[MINT_A]).toBe(1);
	});

	// The per-mint page exists for exactly the mints the 'all' leaderboard lists.
	it("per-mint page: exists for exactly the mints on the 'all' leaderboard", async () => {
		const { rows } = await client!.query(SQL_NUTZAP_MINT_STATS, [null, NUTZAP_ALL_TIME_CONFIG_FLOOR]);
		const onLeaderboard = new Set(rows.map((r) => r.mint_url));
		const candidates = [
			MINT_A, MINT_B, MINT_PHANTOM, MINT_LOOPBACK, MINT_TESTNUT, MINT_UNCLASSIFIED,
			MINT_LABELLED, MINT_CONFIGURED, MINT_UNDER_FLOOR, MINT_FAKE_CONFIGURED, 'https://never.seen.example'
		];
		for (const mint of candidates) {
			const { rows: listing } = await client!.query(SQL_NUTZAP_MINT_LISTING, [mint]);
			const r = listing[0];
			const listed = nutzapMintIsListed(r.excluded, Number(r.all_time_payments), Number(r.config_count));
			expect([mint, listed]).toEqual([mint, onLeaderboard.has(mint)]);
		}
	});

	it('mint leaderboard: has_page agrees with the per-mint page in every window', async () => {
		for (const window of [null, 7 * 86400]) {
			for (const floor of [1, NUTZAP_ALL_TIME_CONFIG_FLOOR]) {
				const { rows } = await client!.query(SQL_NUTZAP_MINT_STATS, [window, floor]);
				for (const r of rows) {
					const { rows: listing } = await client!.query(SQL_NUTZAP_MINT_LISTING, [r.mint_url]);
					const l = listing[0];
					expect([r.mint_url, r.has_page]).toEqual([
						r.mint_url,
						nutzapMintIsListed(l.excluded, Number(l.all_time_payments), Number(l.config_count))
					]);
				}
			}
		}
		// The windowed view lists MINT_UNDER_FLOOR on its configs, without a page.
		const { rows } = await client!.query(SQL_NUTZAP_MINT_STATS, [7 * 86400, 1]);
		expect(rows.find((r) => r.mint_url === MINT_UNDER_FLOOR)?.has_page).toBe(false);
		expect(rows.find((r) => r.mint_url === MINT_CONFIGURED)?.has_page).toBe(true);
	});

	it('per-mint listing: all-time totals are payments only', async () => {
		const { rows } = await client!.query(SQL_NUTZAP_MINT_LISTING, [MINT_A]);
		expect(rows[0]).toMatchObject({ all_time_payments: '2', all_time_sats: '26', config_count: '1', excluded: false });
		const loop = await client!.query(SQL_NUTZAP_MINT_LISTING, [MINT_LOOPBACK]);
		expect(loop.rows[0].excluded).toBe(true);
	});
});
