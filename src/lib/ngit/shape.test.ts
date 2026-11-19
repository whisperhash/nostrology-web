import { describe, expect, it } from 'vitest';

import { FIXTURE } from '../../routes/(app)/git/fixture';
import { checkShape, NGIT_NOT_SHOWN, NGIT_NULLABLE, NGIT_OPTIONAL } from './shape';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Deletes a path (`summary.forks`, `grasp_servers[].first_choice`) from a document, in
 * place; a `[]` segment deletes it from every row of that list. */
const deletePath = (node: unknown, path: string): void => {
	const [head, ...rest] = path.split('.');
	const obj = node as Record<string, unknown>;
	if (head.endsWith('[]')) {
		for (const row of (obj[head.slice(0, -2)] as unknown[] | undefined) ?? []) deletePath(row, rest.join('.'));
		return;
	}
	if (rest.length === 0) delete obj[head];
	else deletePath(obj[head], rest.join('.'));
};

describe('checkShape', () => {
	it('passes the fixture against itself, through a JSON round trip', () => {
		expect(checkShape(clone(FIXTURE), FIXTURE)).toEqual({ missing: [], wrongType: [], extra: [] });
	});

	it('reports a missing required key at any depth', () => {
		const doc = clone(FIXTURE) as unknown as Record<string, any>;
		delete doc.summary.grasp_repos;
		delete doc.repos_active[1].cls;
		delete doc.web_hosts;
		delete doc.anomalies.past_dated;
		const r = checkShape(doc, FIXTURE);
		expect(r.missing.sort()).toEqual([
			'anomalies.past_dated',
			'repos_active[].cls',
			'summary.grasp_repos',
			'web_hosts'
		]);
	});

	it('accepts an absent optional display name, and null wherever the interface allows it', () => {
		const doc = clone(FIXTURE) as unknown as Record<string, any>;
		delete doc.repos_active[0].lead_name;
		delete doc.maintainers_top[0].name;
		// a document written before 2026-09-25 has no capture date for the three social kinds,
		// and one written before 2026-09-26 no day for relay.ngit.dev joining
		delete doc.coverage.reactions_since;
		delete doc.coverage.zaps_since;
		delete doc.coverage.deletions_since;
		delete doc.coverage.ngit_relay_since;
		doc.coverage.partial_week = null;
		doc.summary.newest_push = null;
		doc.repos_new[0].branches = null;
		expect(checkShape(doc, FIXTURE)).toEqual({ missing: [], wrongType: [], extra: [] });
	});

	it('accepts leaderboard rows without their hosting class (a document from before 2026-10-09), never a mistyped one', () => {
		const doc = clone(FIXTURE) as unknown as Record<string, any>;
		for (const list of ['repos_discussed', 'repos_starred', 'repos_zapped']) deletePath(doc, `${list}[].cls`);
		expect(checkShape(doc, FIXTURE)).toEqual({ missing: [], wrongType: [], extra: [] });
		doc.repos_zapped[1].cls = 4;
		expect(checkShape(doc, FIXTURE).wrongType).toEqual(['repos_zapped[].cls: expected string, got number']);
	});

	it('accepts a document from before Iris Git stars were counted (2026-10-11), never a mistyped key', () => {
		// the five kind-17 (external-content-reactions) keys the first run after that deploy writes
		const doc = clone(FIXTURE) as unknown as Record<string, any>;
		for (const path of [
			'coverage.external_reactions_since',
			'anomalies.future_dated.external_reactions',
			'anomalies.past_dated.external_reactions',
			'summary.archive_events.external_reactions',
			'summary.stars_iris'
		])
			deletePath(doc, path);
		expect(checkShape(doc, FIXTURE)).toEqual({ missing: [], wrongType: [], extra: [] });
		doc.summary.stars_iris = '14';
		expect(checkShape(doc, FIXTURE).wrongType).toEqual(['summary.stars_iris: expected number, got string']);
	});

	it('accepts a document from before hashtree pushes were counted (2026-10-12), never a mistyped count', () => {
		const doc = clone(FIXTURE) as unknown as Record<string, any>;
		deletePath(doc, 'summary.pushes_hashtree_30d');
		expect(checkShape(doc, FIXTURE)).toEqual({ missing: [], wrongType: [], extra: [] });
		doc.summary.pushes_hashtree_30d = '217';
		expect(checkShape(doc, FIXTURE).wrongType).toEqual([
			'summary.pushes_hashtree_30d: expected number, got string'
		]);
	});

	it('accepts repository rows without their kinds of host (a document from before 2026-10-11), never a mistyped one', () => {
		const doc = clone(FIXTURE) as unknown as Record<string, any>;
		for (const list of ['repos_active', 'repos_recent_pushes', 'repos_new']) deletePath(doc, `${list}[].host_kinds`);
		expect(checkShape(doc, FIXTURE)).toEqual({ missing: [], wrongType: [], extra: [] });
		doc.repos_active[0].host_kinds = 'grasp';
		doc.repos_new[0].host_kinds = [3];
		expect(checkShape(doc, FIXTURE).wrongType.sort()).toEqual([
			'repos_active[].host_kinds: expected array, got string',
			'repos_new[].host_kinds[]: expected string, got number'
		]);
	});

	it('accepts a document without what the page stopped showing', () => {
		const doc = clone(FIXTURE) as unknown as Record<string, any>;
		for (const path of NGIT_NOT_SHOWN) deletePath(doc, path);
		expect(checkShape(doc, FIXTURE)).toEqual({ missing: [], wrongType: [], extra: [] });
	});

	it('holds an optional key to its type when it is present', () => {
		const doc = clone(FIXTURE) as unknown as Record<string, any>;
		doc.coverage.ngit_relay_since = 20260614;
		expect(checkShape(doc, FIXTURE).wrongType).toEqual(['coverage.ngit_relay_since: expected string, got number']);
	});

	it('reports wrong types, nulls that are not allowed and non-finite numbers', () => {
		const doc = clone(FIXTURE) as unknown as Record<string, any>;
		doc.summary.repos = '4527';
		doc.summary.grasp_repos = null;
		doc.recency = { k: '30d', v: 1 };
		doc.repos_active[0].last_push = 1790320121; // unix seconds where the type says a date
		doc.hosting[0].v = Number.NaN; // JSON cannot carry NaN; a hand-built doc can
		const r = checkShape(doc, FIXTURE);
		expect(r.wrongType.sort()).toEqual([
			'hosting[].v: non-finite number',
			'recency: expected array, got object',
			'repos_active[].last_push: expected string, got number',
			'summary.grasp_repos: null where the interface allows none',
			'summary.repos: expected number, got string'
		]);
	});

	it('reports additive keys as extra, never as an error', () => {
		const doc = clone(FIXTURE) as unknown as Record<string, any>;
		doc.brand_new_panel = [];
		doc.summary.new_count = 3;
		const r = checkShape(doc, FIXTURE);
		expect(r.extra.sort()).toEqual(['brand_new_panel', 'summary.new_count']);
		expect(r.missing).toEqual([]);
		expect(r.wrongType).toEqual([]);
	});

	it('only names paths the fixture actually has', () => {
		// Guards the two lists against drifting from the interface: a path that no longer
		// exists would silently stop exempting anything.
		const paths = new Set<string>();
		const walk = (v: unknown, p: string) => {
			// every path, a whole list or object included (an optional key can be one)
			if (p) paths.add(p);
			if (Array.isArray(v)) v.forEach((e) => walk(e, `${p}[]`));
			else if (v && typeof v === 'object')
				for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k);
		};
		walk(FIXTURE, '');
		for (const p of [...NGIT_NULLABLE.keys(), ...NGIT_OPTIONAL]) expect(paths, p).toContain(p);
	});
});
