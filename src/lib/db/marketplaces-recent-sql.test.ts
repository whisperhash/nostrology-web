// @vitest-environment node
//
// The /marketplaces Recent listings read. Nothing covered this query before review on
// 2026-10-23, although it carries the one thing the comments say was got wrong once: the
// per-seller cap is applied BEFORE the limit, by a window function, and capping after the
// limit left 10 rows of 60 because those 60 came from 7 sellers.
//
// The SQL is tested by running it verbatim against a TEMPORARY TABLE shadowing
// marketplaces_listings (pg_temp resolves before public, the pattern
// marketplaces-snapshot.test.ts explains), which proves the ordering with rows rather than by
// reading it. Those tests skip cleanly with no Postgres. The deploy workflow's test job starts
// one, and fails if they skip.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
	NO_PER_SELLER_CAP,
	recentListingParams,
	recentListingRow,
	SQL_MARKETPLACES_RECENT,
	type RecentListingDbRow
} from './postgres';

// --- the two parts of the read that are NOT in the SQL ---------------------------------------
// Neither needs a database. A review found both covered by nothing: each mutation named here
// survived the whole marketplaces suite on 2026-10-24.

describe('the bound parameters', () => {
	it('offers a no-cap value that is a legal int4, since the cap is an int4 parameter', () => {
		expect(NO_PER_SELLER_CAP).toBe(2 ** 31 - 1);
	});

	it('binds the instant in unix SECONDS, the column`s own unit', () => {
		// Milliseconds here would make `expires_at > 1.79e12` false for every real expiry, so
		// every listing that sets a NIP-40 expiration would vanish from the table - expired or
		// not - and the SQL text would look perfectly right.
		expect(recentListingParams(60, 2, 1_792_686_600_123)).toEqual([60, 2, 1_792_686_600]);
		// floor, not round: the page's own test is `expires_at * 1000 > now_ms`, and for
		// integers that is `expires_at > floor(now_ms / 1000)` exactly
		expect(recentListingParams(60, 2, 1_792_686_600_999)[2]).toBe(1_792_686_600);
	});

	it('passes the no-cap sentinel when no cap is wanted, never null', () => {
		expect(recentListingParams(60, null, 0)).toEqual([60, NO_PER_SELLER_CAP, 0]);
	});
});

describe('the row mapper', () => {
	const db: RecentListingDbRow = {
		pubkey: 'a'.repeat(64),
		d_tag: 'barattolo-3195',
		effective_ts: '1792686600',
		title: 'buono amazon 25 scontato',
		title_tag: 'Buono Amazon 25 scontato',
		status: 'active',
		visibility: '',
		client: '',
		location: 'Italia',
		cc: 'IT',
		categories: ['buoni'],
		price: ['price', '23.50', 'EUR'],
		event_id: 'b'.repeat(64),
		market_image: true,
		expires_at: '1900000000',
		content_warning: 'NSFW',
		summary_len: 12
	};

	it('carries every column through, with no default standing in for one', () => {
		expect(recentListingRow(db)).toEqual({
			pubkey: 'a'.repeat(64),
			d_tag: 'barattolo-3195',
			seller_name: null,
			event_id: 'b'.repeat(64),
			market_image: true,
			expires_at: 1900000000,
			title_tag: 'Buono Amazon 25 scontato',
			content_warning: 'NSFW',
			summary_len: 12,
			visibility: '',
			effective_ts: 1792686600,
			title: 'buono amazon 25 scontato',
			status: 'active',
			client: '',
			location: 'Italia',
			cc: 'IT',
			categories: ['buoni'],
			price: ['price', '23.50', 'EUR']
		});
	});

	it('keeps a false market_image false and a null one null', () => {
		// `market_image: true` hard-coded here would give EVERY row a Conduit link, including
		// the rows Conduit hides - the dead links the openability cut exists to prevent.
		expect(recentListingRow({ ...db, market_image: false }).market_image).toBe(false);
		expect(recentListingRow({ ...db, market_image: null }).market_image).toBeNull();
	});

	it('keeps the published title, and tells it from the lowercased one', () => {
		// `title_tag: null` here would silently restore "arcanine for abra".
		const row = recentListingRow(db);
		expect(row.title_tag).toBe('Buono Amazon 25 scontato');
		expect(row.title).toBe('buono amazon 25 scontato');
		expect(recentListingRow({ ...db, title_tag: null }).title_tag).toBeNull();
		expect(recentListingRow({ ...db, title_tag: '' }).title_tag).toBe('');
	});

	it('numbers the two BIGINTs node-pg hands over as strings', () => {
		expect(recentListingRow(db).effective_ts).toBe(1792686600);
		expect(recentListingRow(db).expires_at).toBe(1900000000);
		expect(recentListingRow({ ...db, expires_at: null }).expires_at).toBeNull();
	});

	it('answers an absent JSONB with an empty list and a null price, never undefined', () => {
		const bare = recentListingRow({ ...db, categories: null, price: null });
		expect(bare.categories).toEqual([]);
		expect(bare.price).toBeNull();
	});
});

const TEST_DATABASE_URL =
	process.env.TEST_DATABASE_URL ?? 'postgresql://nostr_brain:changeme@localhost:5432/nostr_brain';

const probePool = new pg.Pool({ connectionString: TEST_DATABASE_URL, connectionTimeoutMillis: 2000, max: 1 });
let postgresAvailable = false;
try {
	const c = await probePool.connect();
	await c.query('SELECT 1');
	c.release();
	postgresAvailable = true;
} catch (err) {
	console.warn(
		`[marketplaces-recent-sql.test] Postgres unreachable at ${TEST_DATABASE_URL}; skipping the row tests.`,
		err instanceof Error ? err.message : err
	);
}
await probePool.end();

describe.skipIf(!postgresAvailable)('SQL_MARKETPLACES_RECENT, run against rows', () => {
	const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
	const PK_A = 'a'.repeat(64);
	const PK_B = 'b'.repeat(64);
	/** The reader's instant, in the unix SECONDS the query's $3 takes. Fixed, so a case about
	 *  expiry is not about the clock: the fixture's dates are small numbers beside it. */
	const NOW_S = 1_800_000_000;

	beforeEach(async () => {
		await pool.query('DROP TABLE IF EXISTS pg_temp.marketplaces_listings');
		await pool.query(`CREATE TEMPORARY TABLE marketplaces_listings (
			pubkey text, d_tag text, effective_ts bigint, title text, status text, visibility text,
			client text, location text, cc text, categories jsonb, price jsonb, excl text,
			title_tag text, event_id text, market_image boolean, expires_at bigint,
			content_warning text, summary_len int
		)`);
		// Seller A holds the five newest listings; seller B holds the oldest one.
		const rows: [string, string, number][] = [
			[PK_A, 'a5', 500],
			[PK_A, 'a4', 400],
			[PK_A, 'a3', 300],
			[PK_A, 'a2', 200],
			[PK_A, 'a1', 100],
			[PK_B, 'b1', 50]
		];
		for (const [pubkey, d, ts] of rows)
			await pool.query(
				`INSERT INTO marketplaces_listings
				 (pubkey, d_tag, effective_ts, title, status, visibility, client, location, cc, categories, price, excl)
				 VALUES ($1, $2, $3, 'x', 'active', '', '', '', NULL, '[]'::jsonb, NULL, NULL)`,
				[pubkey, d, ts]
			);
	});
	afterAll(async () => await pool.end());

	it('fills the limit from the CAPPED pool, not from the newest rows', async () => {
		// The bug this guards: take the 3 newest rows first and they are all seller A's, so a
		// cap applied afterwards leaves 2. Capped first, the pool is A's 2 newest plus B's one,
		// and the limit returns all 3.
		const { rows } = await pool.query(SQL_MARKETPLACES_RECENT, [3, 2, NOW_S]);
		expect(rows).toHaveLength(3);
		expect(rows.map((r) => r.d_tag)).toEqual(['a5', 'a4', 'b1']);
	});

	/** 48 rows from 3 sellers, in no order a sort would leave them in, each dated by dateOf. */
	async function insertShuffled(dateOf: (i: number) => number) {
		await pool.query('DELETE FROM pg_temp.marketplaces_listings');
		const sellers = [PK_B, PK_A, 'c'.repeat(64)];
		const fixture: [string, string, number][] = [];
		for (let i = 0; i < 48; i++)
			fixture.push([sellers[i % 3], `d${String((i * 7) % 48).padStart(2, '0')}`, dateOf(i)]);
		for (const [pubkey, d, ts] of fixture)
			await pool.query(
				`INSERT INTO marketplaces_listings
				 (pubkey, d_tag, effective_ts, title, status, visibility, client, location, cc, categories, price, excl)
				 VALUES ($1, $2, $3, 'x', 'active', '', '', '', NULL, '[]'::jsonb, NULL, NULL)`,
				[pubkey, d, ts]
			);
		return fixture;
	}

	it('breaks a tie on the date by seller, then d tag, so two renders of one refresh agree', async () => {
		// Many rows on few dates. The window hands the outer sort rows already ordered by seller, so
		// with a few rows, or with every row on one date, that sort moves nothing and a missing
		// tie-break cannot be seen.
		const fixture = await insertShuffled((i) => 700 + (i % 5) * 10);
		const { rows } = await pool.query(SQL_MARKETPLACES_RECENT, [48, NO_PER_SELLER_CAP, NOW_S]);
		const want = [...fixture].sort(
			(a, b) => b[2] - a[2] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) || (a[1] < b[1] ? -1 : 1)
		);
		expect(rows.map((r) => [r.pubkey, r.d_tag])).toEqual(want.map(([pubkey, d]) => [pubkey, d]));
	});

	it('keeps the same listing at the cap when a seller has several on one date', async () => {
		// The window's own tie-break, by d tag. Without it, which listing a seller shows at a cap of 1
		// is whatever order the database reads them in, and it can change between refreshes.
		const fixture = await insertShuffled(() => 700);
		const { rows } = await pool.query(SQL_MARKETPLACES_RECENT, [48, 1, NOW_S]);
		const first = (seller: string) =>
			fixture
				.filter(([pubkey]) => pubkey === seller)
				.map(([, d]) => d)
				.sort()[0];
		const want = [PK_A, PK_B, 'c'.repeat(64)].map((seller) => [seller, first(seller)]);
		expect(rows.map((r) => [r.pubkey, r.d_tag])).toEqual(want);
	});

	it('keeps every listing when no cap is wanted', async () => {
		const { rows } = await pool.query(SQL_MARKETPLACES_RECENT, [10, NO_PER_SELLER_CAP, NOW_S]);
		expect(rows).toHaveLength(6);
		expect(rows[0].d_tag).toBe('a5');
	});

	it('caps a seller across every status, not within each', async () => {
		await pool.query(`UPDATE marketplaces_listings SET status = 'sold' WHERE d_tag IN ('a5', 'a3')`);
		const { rows } = await pool.query(SQL_MARKETPLACES_RECENT, [10, 2, NOW_S]);
		expect(rows.map((r) => r.d_tag)).toEqual(['a5', 'a4', 'b1']);
	});

	it('answers a null location and null categories with empties, which the page does not expect null from', async () => {
		await pool.query(`UPDATE marketplaces_listings SET location = NULL, categories = NULL WHERE d_tag = 'b1'`);
		const { rows } = await pool.query(SQL_MARKETPLACES_RECENT, [10, 2, NOW_S]);
		const b1 = rows.find((r) => r.d_tag === 'b1');
		expect(b1.location).toBe('');
		expect(b1.categories).toEqual([]);
	});

	it('coalesces a null d tag rather than dropping the row', async () => {
		await pool.query(
			`INSERT INTO marketplaces_listings
			 (pubkey, d_tag, effective_ts, title, status, visibility, client, location, cc, categories, price, excl)
			 VALUES ($1, NULL, 600, 'x', 'active', '', '', '', NULL, '[]'::jsonb, NULL, NULL)`,
			[PK_B]
		);
		const { rows } = await pool.query(SQL_MARKETPLACES_RECENT, [10, 2, NOW_S]);
		const nulls = rows.filter((r) => r.pubkey === PK_B && r.d_tag === '');
		expect(nulls).toHaveLength(1);
	});

	it('drops an expired listing, and fills the limit from the rest', async () => {
		// Seller A's two newest expire; with the cut inside the subquery their next two take
		// those places, so the table stays full rather than coming up two rows short.
		await pool.query(
			`UPDATE marketplaces_listings SET expires_at = $1 WHERE d_tag IN ('a5', 'a4')`,
			[NOW_S - 1]
		);
		const { rows } = await pool.query(SQL_MARKETPLACES_RECENT, [3, 2, NOW_S]);
		expect(rows.map((r) => r.d_tag)).toEqual(['a3', 'a2', 'b1']);
	});

	it('keeps a listing whose expiry has not come, and one that set none', async () => {
		await pool.query(`UPDATE marketplaces_listings SET expires_at = $1 WHERE d_tag = 'a5'`, [
			NOW_S + 1
		]);
		// 0 and a negative are not expiries at all, and must not read as "expired long ago"
		await pool.query(`UPDATE marketplaces_listings SET expires_at = 0 WHERE d_tag = 'a4'`);
		await pool.query(`UPDATE marketplaces_listings SET expires_at = -1 WHERE d_tag = 'b1'`);
		const { rows } = await pool.query(SQL_MARKETPLACES_RECENT, [10, NO_PER_SELLER_CAP, NOW_S]);
		expect(rows.map((r) => r.d_tag)).toEqual(['a5', 'a4', 'a3', 'a2', 'a1', 'b1']);
	});

	it('expires at exactly the instant the page reads, as the page does', async () => {
		// The agreement that lets the SQL cut and $lib/markets/links' test coexist: for
		// integers, `expires_at * 1000 <= now_ms` is `expires_at <= floor(now_ms / 1000)`.
		await pool.query(`UPDATE marketplaces_listings SET expires_at = $1 WHERE d_tag = 'a5'`, [
			NOW_S
		]);
		const { rows } = await pool.query(SQL_MARKETPLACES_RECENT, [10, NO_PER_SELLER_CAP, NOW_S]);
		expect(rows.map((r) => r.d_tag)).not.toContain('a5');
	});

	it('carries every column the page reads, so a rename fails here rather than in a cell', async () => {
		const { rows } = await pool.query(SQL_MARKETPLACES_RECENT, [1, 2, NOW_S]);
		expect(Object.keys(rows[0]).sort()).toEqual(
			[
				'categories', 'cc', 'client', 'content_warning', 'd_tag', 'effective_ts', 'event_id',
				'expires_at', 'location', 'market_image', 'price', 'pubkey', 'status', 'summary_len',
				'title', 'title_tag', 'visibility'
			].sort()
		);
	});

	it('leaves the excluded groups out', async () => {
		await pool.query(`UPDATE marketplaces_listings SET excl = 'bulk' WHERE pubkey = $1`, [PK_A]);
		const { rows } = await pool.query(SQL_MARKETPLACES_RECENT, [10, 2, NOW_S]);
		expect(rows.map((r) => r.pubkey)).toEqual([PK_B]);
	});

	it('does not count an excluded listing against its seller cap', async () => {
		// `excl` can be per listing (deleted, withdrawn, an option of a parent), so the filter has to
		// run before the window: after it, a seller whose two newest are excluded would show nothing.
		await pool.query(`UPDATE marketplaces_listings SET excl = 'deleted' WHERE d_tag IN ('a5', 'a4')`);
		const { rows } = await pool.query(SQL_MARKETPLACES_RECENT, [3, 2, NOW_S]);
		expect(rows.map((r) => r.d_tag)).toEqual(['a3', 'a2', 'b1']);
	});
});
