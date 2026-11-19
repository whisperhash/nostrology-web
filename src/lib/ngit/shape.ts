// A structural check of a real /git snapshot document against a reference document of
// the same type - in practice the page tests' hand-written fixture, which is typed as
// NgitSnapshot (so the compiler guarantees it carries every required key) and has every
// list non-empty (so every row shape is present). TypeScript types are erased at run time;
// this is how a document produced by the pipeline is held to the interface before the page
// is pointed at it (the NGIT_SNAPSHOT_JSON smoke test).
//
// Paths read `summary.grasp_repos`, `repos_active[].last_push`.
import type { NgitSnapshot } from '$lib/shared/data-types';

// Every path of a key NgitSnapshot marks optional (`?:`). The two lists below are typed with
// it, so naming a key the interface requires in either one fails the type check.
type Join<P extends string, K extends string> = P extends '' ? K : `${P}.${K}`;
type OptionalKeys<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? K : never }[keyof T];
type OptionalPaths<T, P extends string = ''> = T extends readonly (infer E)[]
	? OptionalPaths<E, `${P}[]`>
	: T extends object
		? {
				[K in keyof T & string]-?:
					| (K extends OptionalKeys<T> ? Join<P, K> : never)
					| OptionalPaths<NonNullable<T[K]>, Join<P, K>>;
			}[keyof T & string]
		: never;
export type NgitOptionalPath = OptionalPaths<NgitSnapshot>;

/** Leaves the interface types `T | null`, with the type of the non-null case. */
export const NGIT_NULLABLE: ReadonlyMap<string, 'string' | 'number'> = new Map([
	['coverage.partial_week', 'string'],
	['coverage.partial_month', 'string'],
	['summary.newest_state', 'string'],
	['summary.newest_push', 'string'],
	...['repos_active', 'repos_recent_pushes', 'repos_new'].flatMap(
		(list) =>
			[
				[`${list}[].lead_name`, 'string'],
				[`${list}[].last_push`, 'string'],
				[`${list}[].last_state`, 'string'],
				[`${list}[].branches`, 'number'],
				[`${list}[].tags`, 'number']
			] as [string, 'string' | 'number'][]
	),
	['maintainers_top[].name', 'string'],
	['maintainers_top[].last_push', 'string']
]);

/** What the page stopped showing: on 2026-09-29; on 2026-10-01 the first_choice lists (a
 * list's first host mostly records which client wrote it); on 2026-10-02 the monthly
 * series (the charts went weekly and start after every capture wall, so the walls' coverage
 * keys went too), recency and no_state, the Maintainers cards' figures and the repositories
 * named in comments; on 2026-10-08 the announcing tools (a hand-kept heuristic) and the
 * weekly new repositories' GRASP-hosted / other split (the chart counts kinds of host); on
 * 2026-10-10 the GRASP-hosted share (the headline share is GRASP or hashtree, which the
 * page sums from grasp_repos and the hosting donut's hashtree class); and on 2026-10-18 the
 * stars and zaps totals, when the two cards' headings went bare (the operator's ask). The
 * pipeline still writes all of it; the page reads none of it
 * (git-page.test.ts renders every pill with and without these keys and requires the same
 * text), so the pipeline can drop any of them without a coordinated deploy - as far as the
 * page is concerned: the pipeline's own checks and the cross-check may still read one
 * (summary.stars_total, say). A key the page
 * has never read (summary.newest_push, say) is not listed: this is the record of what was
 * dropped from the page, not of everything it leaves unread. */
export const NGIT_NOT_SHOWN: readonly NgitOptionalPath[] = [
	'default_branch',
	'repos_recent_pushes',
	'repos_new',
	'fork_families_top',
	'summary.forks',
	'summary.fork_families',
	'summary.concentration',
	'summary.pushes_total',
	'grasp_servers[].first_choice',
	'grasp_lists.first_choice',
	'new_repos_monthly',
	'comments_monthly',
	'grasp_lists.per_month',
	'recency',
	'no_state',
	'summary.multi_maintainer_repos',
	'summary.shared_listed_repos',
	'repos_discussed',
	'coverage.partial_first_week',
	'coverage.partial_month',
	'coverage.ngit_relay_since',
	'tools',
	'new_repos_weekly[].grasp',
	'new_repos_weekly[].other',
	'summary.grasp_share',
	'summary.stars_total',
	'summary.zap_msats'
];

/** Keys the interface marks optional (`?:`): what the page no longer shows, the display
 * names, absent when unknown, the capture dates of the three social kinds, absent from a
 * document written before 2026-09-25, comments_90d and the three weekly series, absent
 * before 2026-10-02, the weekly new repositories' count by kind of host, absent before the
 * first run after the 2026-10-08 deploy (the page then leaves out the sub-line, or says the
 * chart is not in the snapshot), the leaderboard rows' hosting class, absent before the
 * first run after the 2026-10-09 deploy (the row then links to gitworkshop.dev), and the
 * kind-17 (external-content-reactions) keys - Iris Git's stars - absent before the first run
 * after the 2026-10-11 deploy (the page then describes the stars as kind-7 (reactions)
 * alone, as it did before), the hashtree push count (summary.pushes_hashtree_30d), absent
 * before the first run after the 2026-10-12 deploy that counts hashtree's pushes (the page then
 * says none is counted), and the repository rows' kinds of host (host_kinds), absent before
 * the first run after the later 2026-10-11 deploy that added them (the Hosting column then
 * shows the class). */
export const NGIT_OPTIONAL: ReadonlySet<NgitOptionalPath> = new Set<NgitOptionalPath>([
	...NGIT_NOT_SHOWN,
	'coverage.reactions_since',
	'coverage.zaps_since',
	'coverage.deletions_since',
	'summary.comments_90d',
	'new_repos_weekly',
	'new_repos_weekly[].by_host',
	'comments_weekly',
	'grasp_lists.per_week',
	'repos_active[].lead_name',
	'repos_recent_pushes[].lead_name',
	'repos_new[].lead_name',
	'maintainers_top[].name',
	'repos_discussed[].cls',
	'repos_starred[].cls',
	'repos_zapped[].cls',
	'coverage.external_reactions_since',
	'anomalies.future_dated.external_reactions',
	'anomalies.past_dated.external_reactions',
	'summary.archive_events.external_reactions',
	'summary.stars_iris',
	'repos_active[].host_kinds',
	'repos_recent_pushes[].host_kinds',
	'repos_new[].host_kinds',
	'summary.pushes_hashtree_30d'
]);

export interface ShapeReport {
	/** Required keys the document lacks. */
	missing: string[];
	/** Keys whose value has the wrong JSON type (or a non-finite number). */
	wrongType: string[];
	/** Keys the reference does not know - additive fields, reported, never an error. */
	extra: string[];
}

function kindOf(v: unknown): string {
	if (v === null) return 'null';
	if (Array.isArray(v)) return 'array';
	return typeof v;
}

export function checkShape(
	actual: unknown,
	reference: unknown,
	nullable: ReadonlyMap<string, 'string' | 'number'> = NGIT_NULLABLE,
	optional: ReadonlySet<string> = NGIT_OPTIONAL
): ShapeReport {
	const missing = new Set<string>();
	const wrongType = new Set<string>();
	const extra = new Set<string>();

	const walk = (a: unknown, r: unknown, path: string) => {
		const rk = kindOf(r);
		const ak = kindOf(a);
		if (rk === 'object') {
			if (ak !== 'object') {
				wrongType.add(`${path || '(root)'}: expected object, got ${ak}`);
				return;
			}
			const ao = a as Record<string, unknown>;
			const ro = r as Record<string, unknown>;
			for (const key of Object.keys(ro)) {
				const p = path ? `${path}.${key}` : key;
				if (!Object.prototype.hasOwnProperty.call(ao, key)) {
					if (!optional.has(p)) missing.add(p);
					continue;
				}
				walk(ao[key], ro[key], p);
			}
			for (const key of Object.keys(ao)) {
				if (!Object.prototype.hasOwnProperty.call(ro, key)) extra.add(path ? `${path}.${key}` : key);
			}
			return;
		}
		if (rk === 'array') {
			if (ak !== 'array') {
				wrongType.add(`${path}: expected array, got ${ak}`);
				return;
			}
			const ra = r as unknown[];
			if (ra.length === 0) return; // no row shape to hold the rows to
			for (const el of a as unknown[]) walk(el, ra[0], `${path}[]`);
			return;
		}
		// A leaf. A nullable leaf accepts null or its declared type; the reference's own
		// value decides the type everywhere else.
		const declared = nullable.get(path);
		if (ak === 'null') {
			if (!declared) wrongType.add(`${path}: null where the interface allows none`);
			return;
		}
		const want = declared ?? rk;
		if (ak !== want) wrongType.add(`${path}: expected ${want}, got ${ak}`);
		else if (ak === 'number' && !Number.isFinite(a as number)) wrongType.add(`${path}: non-finite number`);
	};

	walk(actual, reference, '');
	return { missing: [...missing], wrongType: [...wrongType], extra: [...extra] };
}
