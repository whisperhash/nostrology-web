// @vitest-environment node
//
// getNgitSnapshot() must fail LOUD on an empty ngit_snapshot table (a fresh database, or a
// web deploy that ran ahead of the data repo's first materialize): an exception becomes the
// error page, while a quietly empty document would render as "Git on Nostr died". It is the
// document alone, which the landing board reads; since 2026-10-18 the /git page reads
// getNgitPage, which also takes the Stars and Zaps lists from ngit_repo_stats when that table
// holds the snapshot's run, and the document's own lists otherwise. The SQL itself is
// covered against a real Postgres in ngit-snapshot.test.ts; this pins the functions around
// it with the driver mocked, so it runs everywhere.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above every statement, so the spy is hoisted with them.
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('pg', () => ({
	default: {
		Pool: class {
			query = query;
			on() {}
		}
	}
}));
vi.mock('$env/dynamic/private', () => ({ env: {} }));

import { getNgitPage, getNgitSnapshot, NGIT_STARS_SHOWN, NGIT_ZAPS_SHOWN, SQL_NGIT_PAGE, SQL_NGIT_SNAPSHOT } from './postgres';

const PK = 'a'.repeat(64);
const doc = {
	generated_utc: '2026-10-18 07:39:29Z',
	summary: { repos: 4983 },
	repos_starred: [{ pubkey: PK, d: 'doc-star', name: 'doc star', cls: 'grasp_only', stars: 9 }],
	repos_zapped: [{ pubkey: PK, d: 'doc-zap', name: 'doc zap', cls: 'grasp_only', receipts: 2, msats: 21_000 }]
};

describe('getNgitSnapshot (the landing board: the document alone)', () => {
	beforeEach(() => query.mockReset());

	it('throws a loud, named error when the table holds no row', async () => {
		query.mockResolvedValue({ rows: [] });
		await expect(getNgitSnapshot()).rejects.toThrow(/ngit_snapshot is empty/);
	});

	it('returns the newest row document untouched, via the exported SQL', async () => {
		query.mockResolvedValue({ rows: [{ data: doc }] });
		await expect(getNgitSnapshot()).resolves.toBe(doc);
		expect(query).toHaveBeenCalledWith(SQL_NGIT_SNAPSHOT);
		expect(query).toHaveBeenCalledTimes(1);
	});
});

describe('getNgitPage (the /git page: the document, its Stars and Zaps lists from ngit_repo_stats)', () => {
	beforeEach(() => query.mockReset());

	it('takes both lists from the table when it holds the run, everything else from the document, in one query', async () => {
		const starred = [{ pubkey: PK, d: 'table-star', name: 'table star', cls: 'hashtree', stars: 7 }];
		const zapped = [{ pubkey: PK, d: 'table-zap', name: 'table zap', cls: 'forge_only', receipts: 5, msats: 1_005_000 }];
		query.mockResolvedValueOnce({ rows: [{ run_id: 'run-b', data: doc, has_run: true, starred, zapped }] });
		await expect(getNgitPage()).resolves.toEqual({
			snapshot: { ...doc, repos_starred: starred, repos_zapped: zapped },
			listsFrom: 'table'
		});
		// one statement, at the page's lengths: it cannot pair a document with another run
		expect(query).toHaveBeenCalledTimes(1);
		expect(query).toHaveBeenCalledWith(SQL_NGIT_PAGE, [NGIT_STARS_SHOWN, NGIT_ZAPS_SHOWN]);
		expect([NGIT_STARS_SHOWN, NGIT_ZAPS_SHOWN]).toEqual([20, 20]);
		// an empty list is the table's answer too, never a reason to fall back
		query.mockResolvedValueOnce({ rows: [{ run_id: 'run-b', data: doc, has_run: true, starred: [], zapped }] });
		expect((await getNgitPage()).snapshot.repos_starred).toEqual([]);
	});

	it("keeps the document's own lists when the table holds another run, and says so once per run", async () => {
		const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const row = (run: string) => ({ rows: [{ run_id: run, data: doc, has_run: false, starred: [], zapped: [] }] });
		query.mockResolvedValueOnce(row('run-c')).mockResolvedValueOnce(row('run-c')).mockResolvedValueOnce(row('run-d'));
		for (let i = 0; i < 3; i++) await expect(getNgitPage()).resolves.toEqual({ snapshot: doc, listsFrom: 'document' });
		expect(warned.mock.calls).toEqual([
			['[ngit] ngit_repo_stats holds no row of run run-c; serving the document lists'],
			['[ngit] ngit_repo_stats holds no row of run run-d; serving the document lists']
		]);
		warned.mockRestore();
	});

	it('falls back on the document alone, logged, when the page query fails', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		query
			.mockRejectedValueOnce(Object.assign(new Error('relation "ngit_repo_stats" does not exist'), { code: '42P01' }))
			.mockResolvedValueOnce({ rows: [{ data: doc }] });
		await expect(getNgitPage()).resolves.toEqual({ snapshot: doc, listsFrom: 'document' });
		expect(query).toHaveBeenNthCalledWith(2, SQL_NGIT_SNAPSHOT);
		expect(logged).toHaveBeenCalledWith(
			'[ngit] the page query failed, serving the document lists:',
			'relation "ngit_repo_stats" does not exist'
		);
		logged.mockRestore();
	});

	it('throws the loud error on an empty ngit_snapshot, as the landing does', async () => {
		query.mockResolvedValueOnce({ rows: [] });
		await expect(getNgitPage()).rejects.toThrow(/ngit_snapshot is empty/);
	});
});
