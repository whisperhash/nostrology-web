// @vitest-environment node
//
// Integration test for the /git serving queries. The page serves ONE precomputed snapshot
// document - the newest ngit_snapshot row, "newest row wins, deterministically" - and since
// 2026-10-18 its Stars and Zaps lists from ngit_repo_stats for that row's run, in the same
// statement (SQL_NGIT_PAGE, below); the landing board reads the document alone. The SQL is exported from postgres.ts (`SQL_NGIT_SNAPSHOT`) and
// run verbatim here, against a TEMPORARY TABLE shadowing `ngit_snapshot` (pg_temp resolves
// before public, so the production SQL hits the fixture; see zapstore-charts.test.ts for
// the pattern's full rationale). The table's four columns are the DDL in nostrology-data
// docs/design/ngit-design.md section 8.
//
// Tests skip cleanly when Postgres is unreachable. The deploy workflow's test job starts one, and
// fails if they skip. To run them locally: CLAUDE.md's section "The test gate" has the recipe.
// Temporary tables only - nothing is written to the database itself.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { SQL_NGIT_PAGE, SQL_NGIT_SNAPSHOT } from './postgres';

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
		`[ngit-snapshot.test] Postgres unreachable at ${TEST_DATABASE_URL}; skipping integration tests.`,
		err instanceof Error ? err.message : err
	);
}
await probePool.end();

describe.skipIf(!postgresAvailable)('SQL_NGIT_SNAPSHOT', () => {
	let client: pg.Client;

	beforeEach(async () => {
		client = new pg.Client({ connectionString: TEST_DATABASE_URL });
		await client.connect();
		await client.query(`
			CREATE TEMPORARY TABLE ngit_snapshot (
				id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
				generated_utc TIMESTAMPTZ NOT NULL,
				run_id        TEXT        NOT NULL,
				data          JSONB       NOT NULL
			)
		`);
	});

	afterEach(async () => {
		await client.end();
	});

	it('returns the newest row by generated_utc', async () => {
		await client.query(
			`INSERT INTO ngit_snapshot (generated_utc, run_id, data) VALUES
			 ('2026-09-26T03:15:00Z', 'r2', '{"summary":{"repos":4530}}'),
			 ('2026-09-25T03:15:00Z', 'r1', '{"summary":{"repos":4527}}')`
		);
		const res = await client.query(SQL_NGIT_SNAPSHOT);
		expect(res.rows).toHaveLength(1);
		// Inserted newest-first on purpose: the order is the query's, not the insert's.
		expect(res.rows[0].data.summary.repos).toBe(4530);
	});

	it('breaks a same-second tie on the higher id (the later insert)', async () => {
		await client.query(
			`INSERT INTO ngit_snapshot (generated_utc, run_id, data) VALUES
			 ('2026-09-25T03:15:00Z', 'first',  '{"which":"first"}'),
			 ('2026-09-25T03:15:00Z', 'second', '{"which":"second"}')`
		);
		const res = await client.query(SQL_NGIT_SNAPSHOT);
		expect(res.rows[0].data.which).toBe('second');
	});

	it('returns zero rows from an empty table (the caller turns this into a loud error)', async () => {
		const res = await client.query(SQL_NGIT_SNAPSHOT);
		expect(res.rows).toHaveLength(0);
	});

	it('round-trips a full-shaped snapshot document intact through jsonb', async () => {
		const doc = {
			generated_utc: '2026-09-25 03:31:07Z',
			as_of_day: '2026-09-24',
			coverage: { partial_week: '2026-09-22', partial_month: '2026-09' },
			summary: { repos: 4527, grasp_share: 0.3137, newest_push: null },
			pushes_weekly: [{ w: '2026-06-08', pushes: 12, repos: 5, maintainers: 4 }],
			repos_active: [{ pubkey: 'a'.repeat(64), d: 'ngit', name: '', hosts: ['relay.ngit.dev'] }]
		};
		await client.query(
			`INSERT INTO ngit_snapshot (generated_utc, run_id, data) VALUES ('2026-09-25T03:31:07Z', 'r', $1)`,
			[doc]
		);
		const res = await client.query(SQL_NGIT_SNAPSHOT);
		// Numeric fidelity (0.3137 stays a number), nulls and empty strings all survive.
		expect(res.rows[0].data).toEqual(doc);
	});
});

// The /git page's one statement (2026-10-18): SQL_NGIT_PAGE against TEMPORARY TABLES shadowing
// ngit_snapshot and ngit_repo_stats, the latter's DDL nostrology-data schema/init.sql's.
describe.skipIf(!postgresAvailable)('SQL_NGIT_PAGE', () => {
	let client: pg.Client;
	const PK = 'a'.repeat(64);
	type Row = [key: string, run: string, stars: number, receipts: number, msats: number];
	const insert = (rows: Row[]) =>
		client.query(
			`INSERT INTO ngit_repo_stats (repo_key, run_id, pubkey, d, name, cls, stars, zap_receipts, zap_msats)
			 SELECT r[1], r[2], $1, split_part(r[1], ':', 2), 'n-' || split_part(r[1], ':', 2), 'grasp_only',
			        r[3]::int, r[4]::int, r[5]::bigint
			 FROM jsonb_array_elements($2::jsonb) e, LATERAL (SELECT ARRAY(SELECT jsonb_array_elements_text(e)) r) x`,
			[PK, JSON.stringify(rows)]
		);
	// two runs: r1 older, r2 the newest row, the one the page serves
	const snapshots = () =>
		client.query(
			`INSERT INTO ngit_snapshot (generated_utc, run_id, data) VALUES
			 ('2026-10-18T07:39:29Z', 'r2', '{"which":"r2"}'),
			 ('2026-10-17T03:18:39Z', 'r1', '{"which":"r1"}')`
		);
	const page = async (stars = 20, zaps = 20) => (await client.query(SQL_NGIT_PAGE, [stars, zaps])).rows;
	const ds = (rows: { d: string }[]) => rows.map((r) => r.d);

	beforeEach(async () => {
		client = new pg.Client({ connectionString: TEST_DATABASE_URL });
		await client.connect();
		await client.query(`
			CREATE TEMPORARY TABLE ngit_snapshot (
				id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
				generated_utc TIMESTAMPTZ NOT NULL,
				run_id        TEXT        NOT NULL,
				data          JSONB       NOT NULL
			)
		`);
		// repo_key takes a locale-aware collation, as on Aurora (en_US.UTF-8 there sorts
		// "alpha" before "Zeta"). The test server's own default may not be: musl's "en_US"
		// in the Alpine image compares bytes, and would hide a query that forgot COLLATE "C".
		await client.query(`
			CREATE TEMPORARY TABLE ngit_repo_stats (
				repo_key     TEXT     COLLATE "en-US-x-icu" PRIMARY KEY,
				run_id       TEXT     NOT NULL,
				pubkey       CHAR(64) NOT NULL,
				d            TEXT     NOT NULL,
				name         TEXT     NOT NULL,
				cls          TEXT     NOT NULL,
				stars        INTEGER  NOT NULL,
				zap_receipts INTEGER  NOT NULL,
				zap_msats    BIGINT   NOT NULL
			)
		`);
		await snapshots();
	});

	afterEach(async () => {
		await client.end();
	});

	it("returns the newest row's run id and document beside that run's lists", async () => {
		await insert([
			[`${PK}:new`, 'r2', 3, 1, 21_000],
			[`${PK}:old`, 'r1', 9, 9, 9_000_000]
		]);
		const rows = await page();
		expect(rows).toHaveLength(1);
		expect(rows[0].run_id).toBe('r2');
		expect(rows[0].data).toEqual({ which: 'r2' });
		expect(rows[0].has_run).toBe(true);
		// r1's rows are never read beside r2's document
		expect(ds(rows[0].starred)).toEqual(['new']);
		expect(ds(rows[0].zapped)).toEqual(['new']);
	});

	it('ranks stars by stars, a tie by repo_key in byte order, and leaves out the unstarred', async () => {
		// "Zeta" sorts before "alpha" in byte order (Z is 0x5A, a is 0x61), after it in most
		// locales' collation: the order must be Python's, the pipeline's. The control: the
		// column's own collation does put "alpha" first.
		const control = await client.query(`SELECT 'alpha' < ('Zeta' COLLATE "en-US-x-icu") AS locale_first`);
		expect(control.rows[0].locale_first).toBe(true);
		await insert([
			[`${PK}:alpha`, 'r2', 4, 0, 0],
			[`${PK}:Zeta`, 'r2', 4, 0, 0],
			[`${PK}:most`, 'r2', 9, 0, 0],
			[`${PK}:none`, 'r2', 0, 0, 0]
		]);
		const [got] = await page();
		expect(ds(got.starred)).toEqual(['most', 'Zeta', 'alpha']);
		expect(got.starred[0]).toEqual({ pubkey: PK, d: 'most', name: 'n-most', cls: 'grasp_only', stars: 9 });
		// cut after the ranking, inside the tie: the byte order decides who stays
		expect(ds((await page(2))[0].starred)).toEqual(['most', 'Zeta']);
	});

	it('ranks zaps by receipts, then msats, then repo_key, cut after the ranking, msats a number', async () => {
		await insert([
			[`${PK}:big-one`, 'r2', 0, 1, 10_000_000],
			[`${PK}:five`, 'r2', 0, 5, 1_005_000],
			[`${PK}:two-small`, 'r2', 0, 2, 42_000],
			[`${PK}:two-big`, 'r2', 0, 2, 1_021_000],
			[`${PK}:b-tie`, 'r2', 0, 1, 21_000],
			[`${PK}:a-tie`, 'r2', 0, 1, 21_000],
			[`${PK}:unzapped`, 'r2', 3, 0, 0]
		]);
		const [got] = await page();
		expect(ds(got.zapped)).toEqual(['five', 'two-big', 'two-small', 'big-one', 'a-tie', 'b-tie']);
		expect(got.zapped[0]).toEqual({ pubkey: PK, d: 'five', name: 'n-five', cls: 'grasp_only', receipts: 5, msats: 1_005_000 });
		expect(typeof got.zapped[0].msats).toBe('number');
		// the cut keeps the top by the ranking - a cut ranked by msats would keep big-one third -
		// and, inside the tie at its edge, a-tie by repo_key
		expect(ds((await page(20, 3))[0].zapped)).toEqual(['five', 'two-big', 'two-small']);
		expect(ds((await page(20, 5))[0].zapped)).toEqual(['five', 'two-big', 'two-small', 'big-one', 'a-tie']);
	});

	it('says the table does not hold the run when its rows are another run\'s, or there are none', async () => {
		await insert([[`${PK}:old`, 'r1', 8, 3, 3_000]]);
		expect(await page()).toEqual([{ run_id: 'r2', data: { which: 'r2' }, has_run: false, starred: [], zapped: [] }]);
		// the run there with no star or zap: empty lists, from the table
		await insert([[`${PK}:quiet`, 'r2', 0, 0, 0]]);
		expect(await page()).toEqual([{ run_id: 'r2', data: { which: 'r2' }, has_run: true, starred: [], zapped: [] }]);
	});

	it('breaks a same-second tie on the higher id, as SQL_NGIT_SNAPSHOT does, and reads that run', async () => {
		await client.query(
			`INSERT INTO ngit_snapshot (generated_utc, run_id, data) VALUES
			 ('2026-10-19T03:18:39Z', 'first', '{"which":"first"}'),
			 ('2026-10-19T03:18:39Z', 'second', '{"which":"second"}')`
		);
		await insert([
			[`${PK}:of-first`, 'first', 5, 0, 0],
			[`${PK}:of-second`, 'second', 4, 0, 0]
		]);
		const [got] = await page();
		expect([got.run_id, got.data.which, ds(got.starred)]).toEqual(['second', 'second', ['of-second']]);
		// the landing's query picks the same row
		expect((await client.query(SQL_NGIT_SNAPSHOT)).rows[0].data.which).toBe('second');
	});

	it('returns no row from an empty ngit_snapshot (the caller turns it into a loud error)', async () => {
		await client.query('DELETE FROM ngit_snapshot');
		expect(await page()).toEqual([]);
	});
});
