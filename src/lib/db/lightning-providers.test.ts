// @vitest-environment node
//
// Integration tests for the SQL behind /lightning's provider leaderboard.
// The query is exported as `SQL_LIGHTNING_PROVIDER_STATS` from postgres.ts so
// these tests run the production query verbatim — no risk of test-vs-prod
// SQL drift. Production now reads the lightning_provider_stats_mv materialized
// view; these tests shadow it with a same-named TEMP VIEW built from the
// production MV body (SQL_LIGHTNING_PROVIDER_STATS_MV), so the aggregation under
// test stays byte-identical to what the real MV materializes.
//
// Two responsibilities:
//   1. Aggregation correctness — domain extraction, case folding, GROUP BY
//      counts, ORDER BY user_count DESC.
//   2. lud16 well-formedness — exactly which strings survive the regex
//      filter. The filter is deliberately looser than LUD-16 spec-strict
//      validation; see the comment on LUD16_WELL_FORMED_REGEX_SQL in
//      postgres.ts for the rationale. Both spec-aligned cases AND the
//      intentional pragmatic deviations (uppercase, `+` tags, etc.) are
//      pinned down here so the divergence is explicit and won't drift.
//
// Isolation: each test creates a TEMPORARY TABLE shadowing
// `events_kind_0_profiles`. Postgres resolves `pg_temp` before `public` in
// the search_path, so the production query hits the test fixture. Temp
// tables are session-local and auto-dropped. Production data is untouched.
//
// Tests skip cleanly when Postgres is unreachable, so a local run with no database still passes.
// The deploy workflow's test job starts one, and fails if these skip.

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { SQL_LIGHTNING_PROVIDER_STATS, SQL_LIGHTNING_PROVIDER_STATS_MV } from './postgres';

const TEST_DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	'postgresql://nostr_brain:changeme@localhost:5432/nostr_brain';

// Probe at module init so the result is known BEFORE describe() registers —
// otherwise a beforeAll-set flag is evaluated after describe decides whether
// to skip, and every test silently skips.
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
		`[lightning-providers.test] Postgres unreachable at ${TEST_DATABASE_URL}; skipping integration tests.`,
		err instanceof Error ? err.message : err
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
	// Schema mirrors only the columns the query touches. Production columns
	// not referenced by the query (event_id, name, about, nip05, picture,
	// content_tsv, etc.) are omitted to keep the fixture minimal.
	await client.query(`
		CREATE TEMP TABLE events_kind_0_profiles (
			pubkey     TEXT NOT NULL,
			created_at BIGINT NOT NULL,
			lud16      TEXT
		) ON COMMIT PRESERVE ROWS
	`);
	// Production reads lightning_provider_stats_mv, not the base table. Shadow it
	// with a TEMP VIEW of the same name (pg_temp before public) defined by the
	// production MV body, so it recomputes live from the temp fixture above —
	// keeping these tests end-to-end (raw kind-0 → leaderboard) on the SAME
	// aggregation the real MV runs. Created AFTER the temp table (binds its OID).
	await client.query(
		`CREATE TEMP VIEW lightning_provider_stats_mv AS ${SQL_LIGHTNING_PROVIDER_STATS_MV}`
	);
});

afterEach(async () => {
	if (client) {
		try {
			await client.query('DROP VIEW IF EXISTS pg_temp.lightning_provider_stats_mv');
			await client.query('DROP TABLE IF EXISTS pg_temp.events_kind_0_profiles');
		} finally {
			client.release();
			client = null;
		}
	}
});

interface Profile {
	pubkey: string;
	lud16: string | null;
}

let pubkeyCounter = 0;
function nextPubkey(): string {
	// Realistic-shape 64-hex pubkey, unique per row. Padded with the seed
	// counter on the right so each row is its own profile.
	pubkeyCounter += 1;
	return pubkeyCounter.toString(16).padStart(64, '0');
}

async function seed(rows: Profile[]) {
	if (!client || rows.length === 0) return;
	const values = rows
		.map((_, i) => `($${3 * i + 1}, $${3 * i + 2}, $${3 * i + 3})`)
		.join(', ');
	// created_at is irrelevant to this query but the column is NOT NULL.
	const params = rows.flatMap((r) => [r.pubkey, 0, r.lud16]);
	await client!.query(
		`INSERT INTO events_kind_0_profiles (pubkey, created_at, lud16) VALUES ${values}`,
		params
	);
}

interface ProviderRow {
	domain: string;
	user_count: number;
}

async function run(): Promise<ProviderRow[]> {
	const result = await client!.query<{ domain: string; user_count: number }>(
		SQL_LIGHTNING_PROVIDER_STATS
	);
	return result.rows;
}

const describeOrSkip = postgresAvailable ? describe : describe.skip;

describeOrSkip('SQL_LIGHTNING_PROVIDER_STATS — aggregation', () => {
	it('returns no rows for an empty table', async () => {
		const rows = await run();
		expect(rows).toEqual([]);
	});

	it('counts a single profile on a single domain', async () => {
		await seed([{ pubkey: nextPubkey(), lud16: 'alice@primal.net' }]);
		const rows = await run();
		expect(rows).toEqual([{ domain: 'primal.net', user_count: 1 }]);
	});

	it('groups multiple profiles on the same domain', async () => {
		await seed([
			{ pubkey: nextPubkey(), lud16: 'alice@primal.net' },
			{ pubkey: nextPubkey(), lud16: 'bob@primal.net' },
			{ pubkey: nextPubkey(), lud16: 'carol@primal.net' }
		]);
		const rows = await run();
		expect(rows).toEqual([{ domain: 'primal.net', user_count: 3 }]);
	});

	it('orders by user_count DESC across domains', async () => {
		await seed([
			{ pubkey: nextPubkey(), lud16: 'a@small.example' },
			{ pubkey: nextPubkey(), lud16: 'a@medium.example' },
			{ pubkey: nextPubkey(), lud16: 'b@medium.example' },
			{ pubkey: nextPubkey(), lud16: 'a@big.example' },
			{ pubkey: nextPubkey(), lud16: 'b@big.example' },
			{ pubkey: nextPubkey(), lud16: 'c@big.example' }
		]);
		const rows = await run();
		expect(rows).toEqual([
			{ domain: 'big.example', user_count: 3 },
			{ domain: 'medium.example', user_count: 2 },
			{ domain: 'small.example', user_count: 1 }
		]);
	});

	it('case-folds the domain so PRIMAL.NET and primal.net group together', async () => {
		// LUD-16 §3 says implementations must lowercase before lookup, so
		// PRIMAL.NET and primal.net resolve to the same wallet. The aggregation
		// follows suit — folding via lower(split_part(...)) — otherwise we'd
		// fragment the leaderboard along casing variants.
		await seed([
			{ pubkey: nextPubkey(), lud16: 'alice@PRIMAL.NET' },
			{ pubkey: nextPubkey(), lud16: 'bob@Primal.Net' },
			{ pubkey: nextPubkey(), lud16: 'carol@primal.net' }
		]);
		const rows = await run();
		expect(rows).toEqual([{ domain: 'primal.net', user_count: 3 }]);
	});

	it('does NOT deduplicate within a domain — one row per profile', async () => {
		// The events_kind_0_profiles table contract is one row per pubkey
		// (loader keeps latest kind-0). The query trusts that contract: it
		// counts rows, not distinct pubkeys. If the contract ever breaks
		// (loader regression) the leaderboard would over-count — that's a
		// loader bug to surface, not a query-side concern.
		const sharedPubkey = nextPubkey();
		await seed([
			{ pubkey: sharedPubkey, lud16: 'a@dup.example' },
			{ pubkey: sharedPubkey, lud16: 'b@dup.example' }
		]);
		const rows = await run();
		expect(rows).toEqual([{ domain: 'dup.example', user_count: 2 }]);
	});

	it('ignores profiles with NULL lud16', async () => {
		await seed([
			{ pubkey: nextPubkey(), lud16: null },
			{ pubkey: nextPubkey(), lud16: null },
			{ pubkey: nextPubkey(), lud16: 'alice@primal.net' }
		]);
		const rows = await run();
		expect(rows).toEqual([{ domain: 'primal.net', user_count: 1 }]);
	});
});

// One table-driven test per case so a failure points at the exact input.
// Each case is annotated with WHY the regex makes the call it does — spec
// alignment vs intentional pragmatic divergence from LUD-16.
//
// LUD-16 spec recap (https://github.com/lnurl/luds/blob/luds/16.md):
//   format: <local>@<domain>  or  <local>+<tag>@<domain>
//   local-part: lowercase [a-z0-9-_.] plus optional `+`
//   domain: standard DNS hostname
//
// Our regex intentionally accepts a superset of LUD-16 because real Nostr
// clients lowercase before LNURL resolution; rejecting uppercase would drop
// ~2.6% of otherwise-resolvable users from provider stats. We document and
// pin those deviations here so future tightening (or loosening) is a
// conscious choice.

interface WellFormednessCase {
	lud16: string;
	expected: 'accept' | 'reject';
	rationale: string;
}

const wellFormednessCases: WellFormednessCase[] = [
	// --- Spec-aligned ACCEPT cases ---
	{
		lud16: 'satoshi@bitcoin.org',
		expected: 'accept',
		rationale: 'LUD-16 canonical example'
	},
	{
		lud16: 'a@b.co',
		expected: 'accept',
		rationale: 'minimal valid shape'
	},
	{
		lud16: 'user.name@sub.domain.tld',
		expected: 'accept',
		rationale: 'dots allowed in both local-part (LUD-16) and domain (DNS)'
	},
	{
		lud16: 'user-name@example.com',
		expected: 'accept',
		rationale: 'hyphens allowed in local-part (LUD-16)'
	},
	{
		lud16: 'user_name@example.com',
		expected: 'accept',
		rationale: 'underscores allowed in local-part (LUD-16)'
	},
	{
		lud16: 'user+tag@example.com',
		expected: 'accept',
		rationale: 'plus-tags allowed (LUD-16: optional tag extension)'
	},
	{
		lud16: 'abc123@example.com',
		expected: 'accept',
		rationale: 'digits allowed in local-part (LUD-16)'
	},

	// --- Spec-aligned REJECT cases ---
	{
		lud16: '',
		expected: 'reject',
		rationale: 'empty string'
	},
	{
		lud16: '@example.com',
		expected: 'reject',
		rationale: 'missing local-part'
	},
	{
		lud16: 'user@',
		expected: 'reject',
		rationale: 'missing domain'
	},
	{
		lud16: 'user@example',
		expected: 'reject',
		rationale: 'no dot in domain — not a DNS hostname'
	},
	{
		lud16: 'user @example.com',
		expected: 'reject',
		rationale: 'whitespace in local-part'
	},
	{
		lud16: 'user@exa mple.com',
		expected: 'reject',
		rationale: 'whitespace in domain'
	},
	{
		lud16: 'user@@example.com',
		expected: 'reject',
		rationale: 'double @ — only one @ permitted'
	},
	{
		lud16: 'user@a@b.com',
		expected: 'reject',
		rationale: 'multiple @ — split_part would silently grab "a" as domain'
	},
	{
		lud16: 'plain-string-no-at',
		expected: 'reject',
		rationale: 'missing @ entirely'
	},
	{
		lud16: 'lnurl1dp68gurn8ghj7ampd3kx2ar0veekzar0wd5xjtnrdakj7tnhv4kxctttdehhwm30d3h82unvwqhkzcnnw4exgamfvd4nqvc3n8vkz',
		expected: 'reject',
		rationale: 'bare LNURL bech32 — not an address'
	},
	{
		lud16: 'bc1q7u24dkmvqhcchwl7ufxdn579gxmyh05uq8k90t',
		expected: 'reject',
		rationale: 'bare on-chain BTC address — not an address'
	},
	{
		lud16: 'lnbc10u1p5t3cm0sp5ejd8kwp8044l',
		expected: 'reject',
		rationale: 'truncated bolt11 invoice — observed in real profiles'
	},
	{
		lud16: 'None',
		expected: 'reject',
		rationale: 'literal "None" — observed in real profiles (sloppy serializer)'
	},

	// --- Intentional pragmatic ACCEPT cases (deliberate LUD-16 divergence) ---
	{
		lud16: 'Bob@primal.net',
		expected: 'accept',
		rationale:
			'uppercase local-part — LUD-16-strict would reject; we accept because clients lowercase before LNURL lookup and rejecting drops ~2.6% of real users'
	},
	{
		lud16: 'user@PRIMAL.NET',
		expected: 'accept',
		rationale: 'uppercase domain — domain is case-insensitive per DNS; we case-fold before grouping'
	},
	{
		lud16: 'satoshi@bitcoin.org.',
		expected: 'accept',
		rationale: 'trailing dot is a valid FQDN; harmless for analytics (groups under "bitcoin.org.")'
	}
];

describeOrSkip('SQL_LIGHTNING_PROVIDER_STATS — lud16 well-formedness filter', () => {
	for (const c of wellFormednessCases) {
		const verb = c.expected === 'accept' ? 'accepts' : 'rejects';
		it(`${verb} ${JSON.stringify(c.lud16)} (${c.rationale})`, async () => {
			await seed([{ pubkey: nextPubkey(), lud16: c.lud16 }]);
			const rows = await run();
			if (c.expected === 'accept') {
				expect(rows).toHaveLength(1);
				expect(rows[0].user_count).toBe(1);
			} else {
				expect(rows).toEqual([]);
			}
		});
	}
});
