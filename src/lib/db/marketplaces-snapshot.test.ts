// @vitest-environment node
//
// Integration test for the /marketplaces serving query. The page serves ONE
// precomputed snapshot document - the newest marketplaces_snapshot row - so the
// whole serving contract is "newest row wins, deterministically". The SQL is
// exported from postgres.ts (`SQL_MARKETPLACES_SNAPSHOT`) and run verbatim here,
// against a TEMPORARY TABLE shadowing `marketplaces_snapshot` (pg_temp resolves
// before public, so the production SQL hits the fixture; see
// zapstore-charts.test.ts for the pattern's full rationale).
//
// Tests skip cleanly when Postgres is unreachable.

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { SQL_MARKETPLACES_SNAPSHOT } from './postgres';

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
		`[marketplaces-snapshot.test] Postgres unreachable at ${TEST_DATABASE_URL}; skipping integration tests.`,
		err instanceof Error ? err.message : err
	);
}
await probePool.end();

describe.skipIf(!postgresAvailable)('SQL_MARKETPLACES_SNAPSHOT', () => {
	let client: pg.Client;

	beforeEach(async () => {
		client = new pg.Client({ connectionString: TEST_DATABASE_URL });
		await client.connect();
		await client.query(`
			CREATE TEMPORARY TABLE marketplaces_snapshot (
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

	afterAll(async () => {
		// nothing shared to tear down - temp tables die with each client session
	});

	it('returns the newest row by generated_utc', async () => {
		await client.query(
			`INSERT INTO marketplaces_snapshot (generated_utc, run_id, data) VALUES
			 ('2026-08-22T10:00:00Z', 'r1', '{"generated_utc":"2026-08-22 10:00:00Z","summary":{"active_listings":100}}'),
			 ('2026-08-23T10:00:00Z', 'r2', '{"generated_utc":"2026-08-23 10:00:00Z","summary":{"active_listings":200}}')`
		);
		const res = await client.query(SQL_MARKETPLACES_SNAPSHOT);
		expect(res.rows).toHaveLength(1);
		expect(res.rows[0].data.summary.active_listings).toBe(200);
	});

	it('breaks a same-second tie on the higher id (the later insert)', async () => {
		await client.query(
			`INSERT INTO marketplaces_snapshot (generated_utc, run_id, data) VALUES
			 ('2026-08-23T10:00:00Z', 'first',  '{"which":"first"}'),
			 ('2026-08-23T10:00:00Z', 'second', '{"which":"second"}')`
		);
		const res = await client.query(SQL_MARKETPLACES_SNAPSHOT);
		expect(res.rows[0].data.which).toBe('second');
	});

	it('returns zero rows from an empty table (the caller turns this into a loud error)', async () => {
		const res = await client.query(SQL_MARKETPLACES_SNAPSHOT);
		expect(res.rows).toHaveLength(0);
	});

	it('round-trips a full-shaped snapshot document intact through jsonb', async () => {
		const doc = {
			generated_utc: '2026-08-23 09:43:05Z',
			summary: { active_listings: 4935, sellers: 1292, countries: 54 },
			map_points: [{ lat: 45.35, lon: 15.55, cc: 'HR', prec: 'country', listings: 3, sellers: 2 }],
			cum_sellers: [{ d: '2023-07-13', v: 1 }],
			geo_nonattr: { NOTAG: { listings: 2901, sellers: 642 } }
		};
		await client.query(
			`INSERT INTO marketplaces_snapshot (generated_utc, run_id, data) VALUES ('2026-08-23T09:43:05Z', 'r', $1)`,
			[doc]
		);
		const res = await client.query(SQL_MARKETPLACES_SNAPSHOT);
		// Numeric fidelity matters: 45.35 must come back 45.35, not a string or a rounded float.
		expect(res.rows[0].data).toEqual(doc);
	});
});
