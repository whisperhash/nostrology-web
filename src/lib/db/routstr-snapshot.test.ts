// @vitest-environment node
//
// Integration test for the /routstr serving query. The page serves ONE precomputed
// snapshot document - the newest routstr_snapshot row - so the whole serving contract
// is "newest row wins, deterministically". The SQL is exported from postgres.ts
// (`SQL_ROUTSTR_SNAPSHOT`) and run verbatim here, against a TEMPORARY TABLE shadowing
// `routstr_snapshot` (pg_temp resolves before public, so the production SQL hits the
// fixture; see zapstore-charts.test.ts for the pattern's full rationale).
//
// Tests skip cleanly when Postgres is unreachable.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { SQL_ROUTSTR_SNAPSHOT } from './postgres';

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
		`[routstr-snapshot.test] Postgres unreachable at ${TEST_DATABASE_URL}; skipping integration tests.`,
		err instanceof Error ? err.message : err
	);
}
await probePool.end();

describe.skipIf(!postgresAvailable)('SQL_ROUTSTR_SNAPSHOT', () => {
	let client: pg.Client;

	beforeEach(async () => {
		client = new pg.Client({ connectionString: TEST_DATABASE_URL });
		await client.connect();
		await client.query(`
			CREATE TEMPORARY TABLE routstr_snapshot (
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
			`INSERT INTO routstr_snapshot (generated_utc, run_id, data) VALUES
			 ('2026-08-23T22:30:00Z', 'r1', '{"summary":{"providers_announced":48}}'),
			 ('2026-08-24T22:30:00Z', 'r2', '{"summary":{"providers_announced":49}}')`
		);
		const res = await client.query(SQL_ROUTSTR_SNAPSHOT);
		expect(res.rows).toHaveLength(1);
		expect(res.rows[0].data.summary.providers_announced).toBe(49);
	});

	it('breaks a same-second tie on the higher id (the later insert)', async () => {
		await client.query(
			`INSERT INTO routstr_snapshot (generated_utc, run_id, data) VALUES
			 ('2026-08-24T22:30:00Z', 'first',  '{"which":"first"}'),
			 ('2026-08-24T22:30:00Z', 'second', '{"which":"second"}')`
		);
		const res = await client.query(SQL_ROUTSTR_SNAPSHOT);
		expect(res.rows[0].data.which).toBe('second');
	});

	it('returns zero rows from an empty table (the caller turns this into a loud error)', async () => {
		const res = await client.query(SQL_ROUTSTR_SNAPSHOT);
		expect(res.rows).toHaveLength(0);
	});

	it('round-trips a full-shaped snapshot document intact through jsonb', async () => {
		const doc = {
			generated_utc: '2026-08-24 15:50:00Z',
			summary: { providers_announced: 49, revenue_alltime_sats: 12433216, success_rate_30d: 0.9689 },
			daily: [{ d: '2026-08-23', msats: 21000000, req: 100, tok: 5000, prov: 3 }],
			models: [{ model: 'gpt-x', msats_30d: 21000000 }],
			anomalies: { bad_snapshots: 0, bad_buckets: 0 }
		};
		await client.query(
			`INSERT INTO routstr_snapshot (generated_utc, run_id, data) VALUES ('2026-08-24T15:50:00Z', 'r', $1)`,
			[doc]
		);
		const res = await client.query(SQL_ROUTSTR_SNAPSHOT);
		// Numeric fidelity matters: 0.9689 must come back 0.9689, not a string.
		expect(res.rows[0].data).toEqual(doc);
	});
});
