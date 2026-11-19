// A small, hand-written ngit snapshot document covering EVERY field of NgitSnapshot, for
// the page tests and as the reference shape of the real-document smoke test (every list is
// non-empty so each row shape is present). Numbers are chosen to be recognisable in
// rendered text and roughly consistent with the contract's invariants (the hosting classes
// sum to repos, the announcement-unit ledger rows plus kept sum to announcements_total,
// grasp_share = grasp_repos / repos), not to reproduce any real run.
//
// The calendar matches a run on 2026-09-25: as_of_day is Thursday 2026-09-24, so the
// trailing ISO week (Monday 2026-09-21) and the month 2026-09 are partial.
import type { NgitRepoRow, NgitSnapshot } from '$lib/shared/data-types';

export const PK_A = 'a'.repeat(64);
export const PK_B = 'b'.repeat(64);
export const PK_C = 'c'.repeat(64);
export const PK_D = 'd'.repeat(64);
export const PK_E = 'e'.repeat(64);

/** ISO-week Mondays from `from` to as_of_day's week (2026-09-21). */
const weeksFrom = (from: string): string[] => {
	const out: string[] = [];
	for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse('2026-09-21T00:00:00Z'); t += 7 * 86_400_000) {
		out.push(new Date(t).toISOString().slice(0, 10));
	}
	return out;
};
/** From the states wall's week, as pushes_weekly runs. */
const WEEKS = weeksFrom('2026-06-08');

const PUSHES_WEEKLY = WEEKS.map((w, i) => ({
	w,
	pushes: i === 0 ? 90 : 1300 + i,
	repos: i === 0 ? 40 : 200 + i,
	maintainers: i === 0 ? 30 : 150 + i
}));

/** Comments per month from BEFORE the capture wall (2026-06-18), as every real run has:
 * relays still serve older comments. The totals are the months' sum, as the contract
 * requires, so a page line claiming "since the wall" would contradict them. */
const COMMENTS_MONTHLY = [
	{ m: '2026-04', issues: 30, prs: 10, patches: 20, repo: 5, other: 5, authors: 20, threads: 40 },
	{ m: '2026-05', issues: 40, prs: 20, patches: 20, repo: 10, other: 5, authors: 30, threads: 50 },
	{ m: '2026-06', issues: 100, prs: 50, patches: 80, repo: 10, other: 5, authors: 60, threads: 90 },
	{ m: '2026-07', issues: 400, prs: 300, patches: 250, repo: 40, other: 20, authors: 150, threads: 500 },
	{ m: '2026-08', issues: 500, prs: 400, patches: 300, repo: 60, other: 30, authors: 170, threads: 600 },
	{ m: '2026-09', issues: 300, prs: 250, patches: 200, repo: 50, other: 16, authors: 120, threads: 312 }
];
const COMMENTS_TOTAL = COMMENTS_MONTHLY.reduce(
	(a, r) => a + r.issues + r.prs + r.patches + r.repo + r.other,
	0
);

/** The weekly series each start with the week holding their kind's capture wall: the
 * announcements' (2026-04-27), the comments' (2026-06-15) and the states' (2026-06-08). */
const NEW_REPOS_WEEKLY = weeksFrom('2026-04-27').map((w, i) => ({
	w,
	v: 170 + 3 * i,
	grasp: 60 + i,
	other: 110 + 2 * i,
	s: 35 + i,
	// once per kind of host a repository is on: grasp = the row's grasp, the five sum past v
	by_host: [
		{ k: 'grasp' as const, v: 60 + i },
		{ k: 'hashtree' as const, v: 25 },
		{ k: 'forge' as const, v: 85 + 2 * i },
		{ k: 'self_hosted' as const, v: 20 },
		{ k: 'none' as const, v: 3 }
	]
}));
const COMMENTS_WEEKLY = weeksFrom('2026-06-15').map((w, i) => ({
	w,
	issues: 80 + i,
	prs: 60 + i,
	patches: 50 + i,
	repo: 10,
	other: 4,
	authors: 40 + i,
	threads: 120 + i
}));
/** 27 of the 77 list users first seen from the wall's week on: the other 50 earlier. */
const GRASP_PER_WEEK = [6, 4, 3, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1].map((v, i) => ({ w: WEEKS[i], v }));

const repo = (over: Partial<NgitRepoRow> & Pick<NgitRepoRow, 'pubkey' | 'd'>): NgitRepoRow => ({
	name: '',
	lead_name: null,
	pushes_30d: 0,
	pushes_90d: 0,
	last_push: null,
	last_state: null,
	branches: null,
	tags: null,
	cls: 'grasp_only',
	hosts: [],
	...over
});

export const ACTIVE_NAMED = repo({
	pubkey: PK_A,
	d: 'ngit',
	name: 'ngit',
	lead_name: 'Dan the maintainer',
	pushes_30d: 120,
	pushes_90d: 410,
	last_push: '2026-09-24',
	last_state: '2026-09-24',
	branches: 14,
	tags: 31,
	cls: 'grasp_mixed',
	host_kinds: ['grasp', 'forge'],
	hosts: ['relay.ngit.dev', 'gitnostr.com', 'github.com']
});

/** No name: the row must fall back to its d, which needs percent-encoding in a URL. */
export const ACTIVE_UNNAMED = repo({
	pubkey: PK_B,
	d: 'tools/sync bot',
	name: '',
	pushes_30d: 300,
	pushes_90d: 305,
	last_push: '2026-09-20',
	last_state: '2026-09-22',
	branches: 1,
	tags: 0,
	cls: 'forge_only',
	host_kinds: ['forge'],
	hosts: ['github.com']
});

export const FIXTURE: NgitSnapshot = {
	generated_utc: '2026-09-25 03:31:07Z',
	as_of_day: '2026-09-24',
	coverage: {
		announcements_since: '2026-05-02',
		states_since: '2026-06-14',
		comments_since: '2026-06-18',
		reactions_since: '2026-06-19',
		external_reactions_since: '2026-10-11',
		zaps_since: '2026-06-14',
		deletions_since: '2026-07-01',
		ngit_relay_since: '2026-06-14',
		partial_first_week: '2026-06-08',
		partial_week: '2026-09-21',
		partial_month: '2026-09'
	},
	anomalies: {
		future_dated: { announcements: 1, states: 0, grasp_lists: 0, comments: 2, reactions: 0, external_reactions: 0, zaps: 0 },
		past_dated: { announcements: 0, states: 4, grasp_lists: 0, comments: 0, reactions: 0, external_reactions: 0, zaps: 0 }
	},
	summary: {
		archive_events: {
			announcements: 92335,
			states: 87671,
			grasp_lists: 119,
			comments: 7302,
			reactions: 1234,
			external_reactions: 31,
			zaps: 56,
			deletions: 7
		},
		announcements_total: 6604,
		announcements_kept: 4614,
		repos: 4527,
		forks: 88,
		repos_with_state: 3155,
		repos_pushed_30d: 581,
		repos_pushed_90d: 1414,
		pushes_7d: 1203,
		pushes_30d: 5021,
		// the weekly series sums to the total by construction, as the contract requires
		pushes_total: PUSHES_WEEKLY.reduce((a, w) => a + w.pushes, 0),
		// hashtree's pushes are counted since the nostrology-data deploy of 2026-10-12
		pushes_hashtree_30d: 1227,
		maintainers: 1310,
		maintainers_active_30d: 402,
		multi_maintainer_repos: 65,
		shared_listed_repos: 132,
		fork_families: 259,
		grasp_repos: 1420,
		grasp_share: 1420 / 4527,
		grasp_servers: 41,
		grasp_list_users: 77,
		comments_total: COMMENTS_TOTAL,
		comments_30d: 876,
		comments_90d: 2210,
		comment_threads: 1502,
		comment_participants: 333,
		comments_attributable_share: 0.13,
		stars_total: 250,
		stars_repos: 120,
		stars_iris: 14,
		zap_receipts: 56,
		zap_msats: 1_234_567_000,
		zappers: 30,
		zaps_repos: 12,
		first_announcement: '2024-01-15',
		newest_state: '2026-09-24',
		newest_push: '2026-09-24',
		concentration: { top1_share: 0.083, top10_share: 0.291 }
	},
	// Exactly the reference's seventeen keys (section 9), in its order, each present even at
	// zero (no daily_cap: every push counts since 2026-10-02). The announcement rows plus
	// announcements_kept sum to announcements_total.
	exclusions: [
		{ k: 'N0', unit: 'announcements', v: 2, why: 'd over 200 characters or containing a control character' },
		{ k: 'N1', unit: 'announcements', v: 784, why: 'clone or web URL on nostr.life' },
		{ k: 'N2', unit: 'announcements', v: 200, why: 'example.com clone URLs or a bare euc tag' },
		{ k: 'N3', unit: 'announcements', v: 38, why: 'name is the NIP-34 (git collaboration) placeholder' },
		{ k: 'N4', unit: 'announcements', v: 139, why: 'the identifier is a bare date' },
		{ k: 'N5', unit: 'announcements', v: 1, why: 'thousands of versions minutes apart' },
		{ k: 'N6', unit: 'announcements', v: 66, why: 'deleted tag, or a deletion request' },
		{ k: 'N7', unit: 'announcements', v: 42, why: 'anyone can sign as secret key 1' },
		{ k: 'N8a', unit: 'announcements', v: 84, why: 'loopback and LAN clone URLs only' },
		{ k: 'N8b', unit: 'announcements', v: 561, why: 'no public clone URL, nothing pushed' },
		{ k: 'N9', unit: 'announcements', v: 73, why: 'personal-fork tag and no state' },
		{ k: 'N10', unit: 'announcements', v: 0, why: 'the awesome-nostr list re-published as announcements' },
		{ k: 'state_republish_loop', unit: 'state coordinates', v: 1, why: 'versions dropped from the push ledger' },
		{ k: 'orphan_states', unit: 'state coordinates', v: 799, why: 'states with no kept announcement' },
		{ k: 'ephemeral', unit: 'comments', v: 2600, why: 'declared temporary: review bots' },
		{ k: 'imported', unit: 'comments', v: 0, why: 'carry an imported tag' },
		{ k: 'mirrored', unit: 'comments', v: 1, why: 're-posted foreign author lines' }
	],
	new_repos_monthly: [
		{ m: '2026-02', v: 40, grasp: 5, other: 35, s: 12 },
		{ m: '2026-03', v: 55, grasp: 9, other: 46, s: 15 },
		{ m: '2026-04', v: 70, grasp: 20, other: 50, s: 22 },
		{ m: '2026-05', v: 900, grasp: 300, other: 600, s: 210 },
		{ m: '2026-06', v: 800, grasp: 280, other: 520, s: 190 },
		{ m: '2026-07', v: 760, grasp: 260, other: 500, s: 170 },
		{ m: '2026-08', v: 700, grasp: 250, other: 450, s: 160 },
		{ m: '2026-09', v: 420, grasp: 150, other: 270, s: 90 }
	],
	new_repos_weekly: NEW_REPOS_WEEKLY,
	cum_repos: [
		{ d: '2026-04-28', v: 4400 },
		{ d: '2026-05-02', v: 4410 },
		{ d: '2026-09-23', v: 4520 },
		{ d: '2026-09-24', v: 4527 }
	],
	pushes_weekly: PUSHES_WEEKLY,
	recency: [
		{ k: '30d', v: 700 },
		{ k: '90d', v: 800 },
		{ k: '180d', v: 600 },
		{ k: '365d', v: 555 },
		{ k: 'older', v: 500 }
	],
	no_state: {
		total: 1372,
		by_class: [
			{ k: 'forge_only', v: 700 },
			{ k: 'hashtree', v: 358 },
			{ k: 'none', v: 214 },
			{ k: 'grasp_only', v: 100 }
		]
	},
	hosting: [
		{ k: 'grasp_only', v: 900 },
		{ k: 'grasp_mixed', v: 520 },
		{ k: 'hashtree', v: 358 },
		{ k: 'forge_only', v: 1900 },
		{ k: 'other_hosts', v: 600 },
		{ k: 'none', v: 249 }
	],
	clone_hosts: [
		{ host: 'github.com', repos: 2300, cls: 'forge' },
		{ host: 'relay.ngit.dev', repos: 700, cls: 'grasp' },
		{ host: 'git.example.org', repos: 12, cls: 'self_hosted' }
	],
	grasp_servers: [
		{ host: 'relay.ngit.dev', repos: 700, users: 40, first_choice: 25 },
		{ host: 'gitnostr.com', repos: 500, users: 30, first_choice: 20 },
		{ host: 'git.shakespeare.diy', repos: 300, users: 5, first_choice: 1 }
	],
	grasp_per_repo: [
		{ k: '1', v: 800 },
		{ k: '2', v: 400 },
		{ k: '3', v: 150 },
		{ k: '4+', v: 70 }
	],
	relays: [
		{ relay: 'relay.damus.io', repos: 3000 },
		{ relay: 'nos.lol', repos: 2500 }
	],
	relays_per_repo: [
		{ k: '0', v: 300 },
		{ k: '1', v: 900 },
		{ k: '2-3', v: 2000 },
		{ k: '4-5', v: 1000 },
		{ k: '6+', v: 327 }
	],
	web_hosts: [{ host: 'gitworkshop.dev', repos: 800 }],
	default_branch: [
		{ k: 'main', v: 2000 },
		{ k: 'master', v: 900 },
		{ k: 'other', v: 150 },
		{ k: 'detached', v: 5 },
		{ k: 'none', v: 100 }
	],
	branches_per_repo: [
		{ k: '0', v: 20 },
		{ k: '1', v: 2000 },
		{ k: '2-5', v: 900 },
		{ k: '6-20', v: 200 },
		{ k: '21+', v: 35 }
	],
	tags_per_repo: [
		{ k: '0', v: 2500 },
		{ k: '1-5', v: 400 },
		{ k: '6-20', v: 200 },
		{ k: '21+', v: 55 }
	],
	topics: [
		{ t: 'nostr', repos: 900 },
		{ t: 'bitcoin', repos: 200 }
	],
	tools: [
		{ k: 'ngit / GitWorkshop (inferred)', v: 2000 },
		{ k: 'Shakespeare', v: 1050 },
		{ k: 'unknown', v: 300 }
	],
	repos_active: [ACTIVE_NAMED, ACTIVE_UNNAMED],
	// Still written by the pipeline, no longer shown (2026-09-29): one row each keeps the row
	// shapes in the smoke test's reference.
	repos_recent_pushes: [ACTIVE_NAMED],
	repos_new: [
		{
			...repo({ pubkey: PK_D, d: 'newer-repo', name: 'Newer repo', cls: 'grasp_only', host_kinds: ['grasp'], hosts: ['gitnostr.com'] }),
			first_seen: '2026-09-23'
		}
	],
	fork_families_top: [
		{ euc: '0123456789abcdef0123456789abcdef01234567', repos: 12, names: ['ngit', 'ngit', 'ngit', 'ngit-fork'] }
	],
	// Ranked by pushes in 90 d, THEN repositories (dataset reference 5.1): 661 pushes on 12
	// repositories above 340 on 47, so a repositories-first ranking would visibly invert it,
	// and B before A, so a pubkey tie-breaker would too.
	maintainers_top: [
		{ pubkey: PK_B, name: null, repos: 12, pushes_90d: 661, last_push: '2026-09-20' },
		{ pubkey: PK_A, name: 'Dan the maintainer', repos: 47, pushes_90d: 340, last_push: '2026-09-24' }
	],
	grasp_lists: {
		users: 77,
		per_month: [
			{ m: '2026-05', v: 30 },
			{ m: '2026-06', v: 20 },
			{ m: '2026-07', v: 15 },
			{ m: '2026-08', v: 8 },
			{ m: '2026-09', v: 4 }
		],
		per_week: GRASP_PER_WEEK,
		length: [
			{ k: '1', v: 20 },
			{ k: '2', v: 30 },
			{ k: '3', v: 20 },
			{ k: '4+', v: 7 }
		],
		first_choice: [{ host: 'relay.ngit.dev', v: 25 }]
	},
	comments_monthly: COMMENTS_MONTHLY,
	comments_weekly: COMMENTS_WEEKLY,
	repos_discussed: [PK_A, PK_B, PK_C, PK_D, PK_E].map((pubkey, i) => ({
		pubkey,
		d: `discussed-${i}`,
		name: i === 0 ? 'Most discussed' : '',
		cls: 'grasp_only' as const,
		comments: 90 - i * 10,
		authors: 20 - i
	})),
	// Four rows: below the leaderboard floor, so the page shows the summary instead.
	repos_starred: [PK_A, PK_B, PK_C, PK_D].map((pubkey, i) => ({
		pubkey,
		d: `starred-${i}`,
		name: `Starred ${i}`,
		cls: i === 2 ? ('hashtree' as const) : ('grasp_only' as const),
		stars: 40 - i
	})),
	// The second row is hashtree's (on hashtree, no GRASP server): it links to git.iris.to.
	repos_zapped: [PK_A, PK_B, PK_C, PK_D, PK_E].map((pubkey, i) => ({
		pubkey,
		d: `zapped-${i}`,
		name: `Zapped ${i}`,
		cls: i === 1 ? ('hashtree' as const) : i === 3 ? ('forge_only' as const) : ('grasp_mixed' as const),
		receipts: 10 - i,
		msats: 21_000_000 - i * 1_000_000
	}))
};
