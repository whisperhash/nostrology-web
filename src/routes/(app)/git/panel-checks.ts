// Every section of every /git pill, and what each must show for a given document - shared
// by the page test (the fixture) and the smoke test (a real document), so a panel that
// renders empty, drops its first row or prints a mis-mapped label fails on either. The ids
// are the ones the design's section-11 live check greps for.
//
// Expected text is derived FROM the document (its first row, its headline figures), so the
// same check holds for any document; the words come from the page's own label maps, and
// third-party strings go through the page's own cleaning (labelText, personLabel,
// repoLabel), so a document carrying a format character is held to what the page must show.
// The figures the page formats are also checked once without the page's formatters
// (`grouped`, the GRASP-server cut), and so is a clone host's label (`cloneHostWant`), so a
// unit, grouping or wording regression in them is not invisible here. Every linked repository row is held to the viewer its hosting class picks
// (repoUrl: git.iris.to for the hashtree class, gitworkshop.dev otherwise), every clone
// host's bar to the donut's colour of its kind of host and the kind's words, and the keys of
// Clone hosts and New repositories per week to the operator's order of the kinds - the order
// and each kind's class in the donut written out here (KINDS_BY_HAND), not read from the
// page's HOST_KIND_ORDER and HOST_KIND_COLOR.
import { decode as nip19Decode } from 'nostr-tools/nip19';

import {
	CLONE_HOST_KIND_LABEL,
	HOST_KIND_LABEL,
	hostClassKind,
	HOSTING_CLASS_LABEL,
	labelFor,
	labelText,
	n,
	pct,
	personLabel,
	repoLabel
} from '$lib/ngit/format';
import { repoUrl } from '$lib/ngit/links';
import { hostingColor, NEUTRAL_SERIES, OTHERS_COLOR } from '$lib/ngit/palette';
import { showLeaderboard } from '$lib/ngit/series';
import type { NgitSnapshot } from '$lib/shared/data-types';

export const PILL_SECTIONS: Record<string, string[]> = {
	// In page order: the charts first, What is counted (with its ledger) last. That section's
	// id is `methodology`, not an `ngit-` one: it is What is counted's on every domain page
	// ($lib/methodology), and /git/methodology opens it.
	overview: [
		'ngit-cumulative',
		'ngit-new-repos',
		'ngit-pushes',
		'ngit-pushed',
		'methodology',
		'ngit-ledger',
		'ngit-anomalies',
		'ngit-not'
	],
	repositories: ['ngit-repos-active', 'ngit-topics', 'ngit-anatomy'],
	hosting: [
		'ngit-hosting-classes',
		'ngit-clone-hosts',
		'ngit-grasp-servers',
		'ngit-relays-per-repo',
		'ngit-grasp-per-repo',
		'ngit-relays',
		'ngit-web-hosts'
	],
	maintainers: ['ngit-maintainers', 'ngit-grasp-lists'],
	collaboration: ['ngit-discussion', 'ngit-comment-ledger', 'ngit-stars', 'ngit-zaps']
};

/** Sections that draw a chart. */
const CHARTS = new Set([
	'ngit-new-repos',
	'ngit-cumulative',
	'ngit-pushes',
	'ngit-pushed',
	'ngit-grasp-lists',
	'ngit-discussion'
]);

/** The chart sections that read a weekly series added on 2026-10-02: a document written before
 * then lacks it, and the section says so in place of the chart. New repositories per week
 * also needs the series' count by kind of host, first written by the first run after the
 * 2026-10-08 deploy. */
const WEEKLY_SERIES: Record<string, (doc: NgitSnapshot) => unknown> = {
	'ngit-new-repos': (doc) =>
		doc.new_repos_weekly?.every((r) => Array.isArray(r.by_host)) ? doc.new_repos_weekly : undefined,
	'ngit-grasp-lists': (doc) => doc.grasp_lists.per_week,
	'ngit-discussion': (doc) => doc.comments_weekly
};
/** The page's note for such a section (+page.svelte NOT_IN_SNAPSHOT). */
const NOT_IN_SNAPSHOT = 'Not in this snapshot';
/** Whether a section's chart is drawn from this document. */
const charted = (id: string, doc: NgitSnapshot) =>
	CHARTS.has(id) && (!(id in WEEKLY_SERIES) || WEEKLY_SERIES[id](doc) !== undefined);

const first = <T>(rows: readonly T[]): T[] => (rows.length ? [rows[0]] : []);
/** Stars come from kind-7 (reactions) and, since the 2026-10-11 deploy,
 * kind-17 (external-content-reactions); the card ranks them unless neither input was read, and
 * then says that instead. */
const starsRead = (doc: NgitSnapshot) =>
	doc.summary.archive_events.reactions > 0 || (doc.summary.archive_events.external_reactions ?? 0) > 0;

/** The zapped rows in the order the Zaps table opens in since 2026-10-18 (the operator's ask):
 * most receipts first, the document's order kept among equal counts, whatever the document
 * ranks by - written out by hand, independent of the page's sortRows. */
const byReceipts = <T extends { receipts: number }>(rows: readonly T[]): T[] =>
	rows
		.map((r, i) => ({ r, i }))
		.sort((a, b) => b.r.receipts - a.r.receipts || a.i - b.i)
		.map(({ r }) => r);

type LinkedRow = { pubkey: string; d: string; cls?: string };
/** The sections whose table rows link a repository, with the rows they draw in the order the
 * table opens in - the document's, which a table keeps until the reader sorts, but Zaps' by
 * receipts - or undefined where the section draws no table (no input read, or too few rows to
 * rank). */
const LINKED_ROWS: Record<string, (doc: NgitSnapshot) => readonly LinkedRow[] | undefined> = {
	'ngit-repos-active': (doc) => doc.repos_active,
	'ngit-stars': (doc) => (starsRead(doc) && showLeaderboard(doc.repos_starred) ? doc.repos_starred : undefined),
	'ngit-zaps': (doc) =>
		doc.summary.archive_events.zaps > 0 && showLeaderboard(doc.repos_zapped) ? byReceipts(doc.repos_zapped) : undefined
};

/** A "#rrggbb" colour the way jsdom reports it back from a style. */
const rgbOf = (hex: string): string => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

/** The kinds of host in the order the page draws them, the operator's (2026-10-12: GRASP,
 * hashtree, Self-hosted, Forge, then the kind that is not public), each with the donut's class
 * whose colour it wears - by hand, independent of HOST_KIND_ORDER and HOST_KIND_COLOR. */
const KINDS_BY_HAND: readonly (readonly [kind: string, cls: string])[] = [
	['grasp', 'grasp_only'],
	['hashtree', 'hashtree'],
	['self_hosted', 'other_hosts'],
	['forge', 'forge_only'],
	['none', 'none']
];
/** Each kind once, in that order; a kind the page does not know yet after them, as given. */
const inKindOrder = (kinds: readonly string[]): string[] => {
	const rank = (k: string) => {
		const i = KINDS_BY_HAND.findIndex(([kind]) => kind === k);
		return i < 0 ? KINDS_BY_HAND.length : i;
	};
	return [...new Set(kinds)].sort((a, b) => rank(a) - rank(b));
};
/** A kind's colour: its class's in the donut, the slate for a kind the page does not know. */
const kindColour = (k: string): string => {
	const cls = KINDS_BY_HAND.find(([kind]) => kind === k)?.[1];
	return cls === undefined ? OTHERS_COLOR : hostingColor(cls);
};

/** The headline share the card and the donut's centre show: the repositories in the classes
 * grasp_only, grasp_mixed and hashtree, over every class's - read from the hosting rows alone,
 * so a page that summed the wrong figures, or divided by the wrong total, differs from it. */
export const graspOrHashtreeShare = (doc: NgitSnapshot): number => {
	const all = doc.hosting.reduce((t, r) => t + r.v, 0);
	const on = doc.hosting
		.filter((r) => r.k === 'grasp_only' || r.k === 'grasp_mixed' || r.k === 'hashtree')
		.reduce((t, r) => t + r.v, 0);
	return all > 0 ? on / all : 0;
};

/** en-US thousands grouping written out by hand, independent of n() and toLocaleString. */
export const grouped = (x: number): string => String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** A clone host's label and its hover title, written out by hand, independent of
 * cloneHostLabel / cloneHostTitle / shortNpub: a hashtree host that is a valid npub of a 32-byte
 * key (63 characters) reads "htree://" and its first 9 and last 4 characters, the whole npub on
 * hover (the operator's choice, 2026-10-11); every other host its cleaned text, both ways. */
export const cloneHostWant = (h: { host: string; cls: string }): { label: string; title: string } => {
	const host = labelText(h.host);
	let npub = false;
	if (hostClassKind(h.cls) === 'hashtree' && /^npub1[02-9ac-hj-np-z]{58}$/.test(host)) {
		try {
			npub = nip19Decode(host).type === 'npub';
		} catch {
			npub = false;
		}
	}
	return npub ? { label: `htree://${host.slice(0, 9)}...${host.slice(-4)}`, title: `htree://${host}` } : { label: host, title: host };
};

/** The Stars and Zaps cards since 2026-10-18 (the operator's ask), held exactly on their own
 * elements, so a third-party name in a row can neither fail nor pass them: each heading's
 * text and accessible name (no total in any words; the Zaps bolt drawn, out of the name)... */
const CARD_HEADS: Record<string, { text: string; name: string }> = {
	'ngit-stars': { text: 'Stars', name: 'Stars' },
	'ngit-zaps': { text: 'Zaps \u26a1', name: 'Zaps' }
};
/** ...and each table's caption, written out by hand: it names only the rows it holds - never
 * the population, which still decides whether the sort note follows, and since later that day
 * (the operator's ask) no measure either, as a reader can re-sort the table. */
const caption = (shown: number, total: number): string =>
	`The top ${grouped(shown)} repositories.` + (shown < total ? ` Sorting reorders these ${grouped(shown)} only.` : '');
const CAPTIONS: Record<string, (doc: NgitSnapshot) => string | undefined> = {
	'ngit-stars': (doc) =>
		starsRead(doc) && showLeaderboard(doc.repos_starred)
			? caption(doc.repos_starred.length, doc.summary.stars_repos)
			: undefined,
	'ngit-zaps': (doc) =>
		doc.summary.archive_events.zaps > 0 && showLeaderboard(doc.repos_zapped)
			? caption(doc.repos_zapped.length, doc.summary.zaps_repos)
			: undefined
};

/** Per section, strings its text must contain for this document. */
export function expectedContent(doc: NgitSnapshot): Record<string, string[]> {
	const s = doc.summary;
	const leaderboard = <T extends { pubkey: string; d: string; name: string }>(rows: T[], empty: string) =>
		showLeaderboard(rows) ? [repoLabel(rows[0])] : rows.length === 0 ? [empty] : ['Too few'];
	return {
		'methodology': ['kind-30617 (repo-announcements)', 'lower bound'],
		'ngit-ledger': [n(s.announcements_total), `${n(s.announcements_kept)} announcements kept`],
		'ngit-anomalies': ['after the run instant', 'before 2023'],
		// a document that counts hashtree's pushes (pushes_hashtree_30d, 2026-10-12) says how
		'ngit-not': [
			'Not commits',
			s.pushes_hashtree_30d !== undefined ? 'Not every hashtree push' : "Not hashtree's pushes",
			'Not verified payments'
		],
		// the legend keys of the host-kind bars and of the line on the second axis
		'ngit-new-repos': !doc.new_repos_weekly
			? ['New repositories per week', NOT_IN_SNAPSHOT]
			: doc.new_repos_weekly.every((r) => Array.isArray(r.by_host))
				? [
						'New repositories per week',
						...(doc.new_repos_weekly[0]?.by_host ?? []).map((c) => labelFor(HOST_KIND_LABEL, c.k)),
						'First-time maintainers'
					]
				: ['New repositories per week', NOT_IN_SNAPSHOT],
		'ngit-cumulative': ['last 12 months', 'Repositories by first-seen day.'],
		'ngit-pushes': [
			'A push is a published state',
			...(s.pushes_hashtree_30d !== undefined ? ['less than two minutes apart count once'] : []),
			...(doc.coverage.partial_week ? ['partial week'] : [])
		],
		'ngit-pushed': ['Repositories pushed', n(s.repos_with_state)],
		// the first row's name, and its Hosting cell: its kinds of host in Clone hosts' words, or
		// its class where it has none public or the document carries no host_kinds
		'ngit-repos-active': first(doc.repos_active).flatMap((r) => [
			repoLabel(r),
			r.host_kinds?.length && !(r.host_kinds.length === 1 && r.host_kinds[0] === 'none')
				? r.host_kinds.map((k) => labelText(labelFor(CLONE_HOST_KIND_LABEL, k))).join(', ')
				: labelFor(HOSTING_CLASS_LABEL, r.cls)
		]),
		'ngit-topics': first(doc.topics).flatMap((t) => [labelText(t.t), n(t.repos)]),
		'ngit-anatomy': [
			...first(doc.branches_per_repo).map((r) => n(r.v)),
			...first(doc.tags_per_repo).map((r) => n(r.v))
		],
		'ngit-hosting-classes': [
			// the centre: GRASP or hashtree, from the donut's own rows (the page sums grasp_repos
			// and the hashtree class over repos; the invariants make the two the same)
			pct(graspOrHashtreeShare(doc)),
			'GRASP or hashtree',
			// the first class's row: its label, its count and, beside the count, its share of the
			// hosting rows' whole in whole percents, as Servers per list gives its buckets'
			...first(doc.hosting).map(
				(r) =>
					`${labelFor(HOSTING_CLASS_LABEL, r.k)} ${n(r.v)} ${pct(r.v / Math.max(1, doc.hosting.reduce((t, x) => t + x.v, 0)), 0)}`
			)
		],
		'ngit-clone-hosts': first(doc.clone_hosts).flatMap((h) => [cloneHostWant(h).label, n(h.repos)]),
		'ngit-grasp-servers': [
			// the cut, from the document's own two counts
			doc.grasp_servers.length < s.grasp_servers
				? `top ${grouped(doc.grasp_servers.length)} of ${grouped(s.grasp_servers)} servers`
				: s.grasp_servers > 1
					? `All ${grouped(s.grasp_servers)} servers`
					: s.grasp_servers === 1
						? 'The only server'
						: 'No servers',
			...first(doc.grasp_servers).flatMap((g) => [labelText(g.host), n(g.repos)])
		],
		'ngit-grasp-per-repo': [n(s.grasp_repos), ...first(doc.grasp_per_repo).map((r) => n(r.v))],
		'ngit-relays': first(doc.relays).flatMap((r) => [labelText(r.relay), n(r.repos)]),
		'ngit-relays-per-repo': [n(s.repos), ...first(doc.relays_per_repo).map((r) => n(r.v))],
		'ngit-web-hosts': first(doc.web_hosts).flatMap((w) => [labelText(w.host), n(w.repos)]),
		'ngit-maintainers': [
			'by pushes in the last 90 days',
			...first(doc.maintainers_top).map((m) => personLabel(m.name, m.pubkey))
		],
		'ngit-grasp-lists': [
			n(doc.grasp_lists.users),
			'Users with a GRASP server list',
			...(doc.grasp_lists.per_week ? [] : [NOT_IN_SNAPSHOT]),
			...first(doc.grasp_lists.length).flatMap((r) => [n(r.v), pct(r.v / doc.grasp_lists.users, 0)])
		],
		'ngit-discussion': [
			'Discussion per week',
			...(doc.comments_weekly ? ['Issues', 'Authors', 'Threads'] : [NOT_IN_SNAPSHOT]),
			pct(s.comments_attributable_share),
			'in all'
		],
		'ngit-comment-ledger': [`${n(s.comments_total)} comments counted`],
		'ngit-stars':
			starsRead(doc)
				? [
						// the heading and the cut are held exactly (CARD_HEADS, CAPTIONS)
						...leaderboard(doc.repos_starred, 'No repository has a counted star')
					]
				: [
						s.archive_events.external_reactions === undefined
							? 'No kind-7 (reactions) were read in this run'
							: 'No kind-7 (reactions) or kind-17 (external-content-reactions) were read in this run'
					],
		'ngit-zaps':
			s.archive_events.zaps > 0
				? [
						// the receipts sentence, where the card's figures reach the reader since its
						// heading went bare on 2026-10-18, grouped by hand
						`${grouped(s.zap_receipts)} receipts to ${grouped(s.zaps_repos)} repositories from ${grouped(s.zappers)} zappers.`,
						'signed by a verified LNURL provider key',
						// the first row's sats (the most receipts), written without the page's
						// formatters: msats / 1000, rounded, grouped by hand (the heading and the cut:
						// CARD_HEADS, CAPTIONS)
						...(showLeaderboard(doc.repos_zapped)
							? [grouped(Math.round(byReceipts(doc.repos_zapped)[0].msats / 1000))]
							: []),
						...leaderboard(byReceipts(doc.repos_zapped), 'No repository has a counted zap')
					]
				: ['No kind-9735 (zap-receipts) were read in this run', 'signed by a verified LNURL provider key']
	};
}

const norm = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim();

/** Every sortable table in a section carries the bright ink in the column sorted at that
 * moment and the dim ink in every other (the operator's rule, 2026-10-18; $lib/sort-ink),
 * whatever the reader has clicked. The first column, the row's name, keeps its own
 * ink and is not checked. */
export function sortInkProblems(el: Element, id: string): string[] {
	const problems: string[] = [];
	for (const table of el.querySelectorAll('table')) {
		const heads = [...table.querySelectorAll('thead th')];
		if (!heads.some((th) => th.hasAttribute('aria-sort'))) continue;
		const rows = [...table.querySelectorAll('tbody tr')];
		heads.forEach((th, j) => {
			if (j === 0) return;
			const sorted = th.getAttribute('aria-sort') !== 'none';
			const [want, not] = sorted ? ['text-gray-200', 'text-gray-400'] : ['text-gray-400', 'text-gray-200'];
			const off = rows.filter((tr) => {
				const cell = tr.children[j];
				return !cell?.classList.contains(want) || cell.classList.contains(not);
			}).length;
			const name = th.querySelector('button')?.getAttribute('aria-label')?.replace(/^Sort by /, '') ?? `column ${j + 1}`;
			if (off) problems.push(`#${id} ${name} is ${sorted ? 'sorted but not bright' : 'not sorted but not dim'} in ${off} of ${rows.length} rows`);
		});
	}
	return problems;
}

/** A chart key's items, each its words and its swatch's colour. */
const keyOf = (el: Element): string[] =>
	[...el.querySelectorAll('[data-testid="chart-legend"] li')].map(
		(li) => `${norm(li.textContent)} ${li.querySelector<HTMLElement>('[data-swatch]')?.style.backgroundColor}`
	);

/** What is wrong with one pill's sections, as readable strings (empty = all good). The
 * pill must already be selected. */
export function panelProblems(container: Element, pill: string, doc: NgitSnapshot): string[] {
	const problems: string[] = [];
	const expected = expectedContent(doc);
	for (const id of PILL_SECTIONS[pill]) {
		const el = container.querySelector(`#${id}`);
		if (!el) {
			problems.push(`${pill}: #${id} is missing`);
			continue;
		}
		const text = norm(el.textContent);
		if (text.length < 20) problems.push(`#${id} is empty`);
		for (const want of expected[id] ?? []) {
			if (want !== '' && !text.includes(norm(want))) problems.push(`#${id} does not show "${want}"`);
		}
		const head = CARD_HEADS[id];
		if (head) {
			const h2 = el.querySelector('h2');
			// its accessible name: the text less what is hidden from assistive technology
			const named = h2?.cloneNode(true) as Element | undefined;
			named?.querySelectorAll('[aria-hidden="true"]').forEach((e) => e.remove());
			const [got, name] = [norm(h2?.textContent), norm(named?.textContent)];
			if (got !== head.text || name !== head.name)
				problems.push(`#${id} heading is "${got}" (named "${name}"), not "${head.text}" (named "${head.name}")`);
		}
		const cut = CAPTIONS[id]?.(doc);
		if (cut !== undefined) {
			const got = norm(el.querySelector('table')?.previousElementSibling?.textContent);
			if (got !== cut) problems.push(`#${id} caption is "${got}", not "${cut}"`);
		}
		problems.push(...sortInkProblems(el, id));
		if (charted(id, doc) && !el.querySelector('canvas')) problems.push(`#${id} has no chart`);
		// each row opens its own repository, on the viewer its hosting class picks
		const linked = LINKED_ROWS[id]?.(doc);
		if (linked) {
			const hrefs = [...el.querySelectorAll('tbody tr')].map(
				(tr) => tr.querySelector('td a')?.getAttribute('href') ?? null
			);
			const want = linked.map((r) => repoUrl(r.pubkey, r.d, r.cls));
			if (hrefs.length !== want.length) problems.push(`#${id} shows ${hrefs.length} rows, the document has ${want.length}`);
			want.forEach((w, i) => {
				if (i < hrefs.length && hrefs[i] !== w) problems.push(`#${id} row ${i + 1} links ${hrefs[i]}, not ${w}`);
			});
		}
		// each clone host's bar, in the document's order, wears the donut's colour of its host's
		// kind, and names the kind in words: its screen-reader text, and the end of the hover title
		// on its track; its label is the host's (htree:// and a short npub for hashtree, the whole
		// npub on hover); the key holds exactly the kinds the bars shown wear, in the operator's
		// order
		if (id === 'ngit-clone-hosts') {
			const bars = el.querySelectorAll('[data-fill] > div');
			// a selector that stopped matching would pass every row below without looking at one
			if (bars.length === 0 && doc.clone_hosts.length > 0) problems.push(`#${id} shows no bar`);
			bars.forEach((row, i) => {
				const h = doc.clone_hosts[i];
				if (!h) {
					problems.push(`#${id} row ${i + 1} has no document row`);
					return;
				}
				const kind = hostClassKind(h.cls);
				const words = labelFor(CLONE_HOST_KIND_LABEL, kind);
				const label = row.querySelector('span[title]');
				const got = [
					row.querySelector('[data-category]')?.textContent,
					row.querySelector<HTMLElement>('[data-bar]')?.style.backgroundColor,
					row.querySelector('div[title]')?.getAttribute('title')?.endsWith(` - ${words}`),
					label?.textContent?.trim(),
					label?.getAttribute('title')
				];
				const { label: wantLabel, title: wantTitle } = cloneHostWant(h);
				const want = [words, rgbOf(kindColour(kind)), true, wantLabel, wantTitle];
				if (got.some((g, j) => g !== want[j]))
					problems.push(`#${id} row ${i + 1} (${h.cls}) shows ${got.join(' / ')}, not ${want.join(' / ')}`);
			});
			const kinds = inKindOrder(doc.clone_hosts.slice(0, bars.length).map((h) => hostClassKind(h.cls)));
			const key = keyOf(el);
			const wantKey = kinds.map((k) => `${labelFor(CLONE_HOST_KIND_LABEL, k)} ${rgbOf(kindColour(k))}`);
			if (key.join(' | ') !== wantKey.join(' | ')) problems.push(`#${id} key is ${key.join(' | ')}, not ${wantKey.join(' | ')}`);
		}
		// New repositories per week: a bar per kind the document's first week carries, each once,
		// bars and key in the operator's order whatever the document's (its by_host lists grasp,
		// hashtree, forge, self_hosted, none), each in the donut's colour of its kind; the line's
		// key last, in the neutral ink. The bars follow the key: both are the chart's series, in
		// one order (the chart test holds the bars).
		if (id === 'ngit-new-repos' && charted(id, doc) && el.querySelector('canvas')) {
			const kinds = inKindOrder((doc.new_repos_weekly?.[0]?.by_host ?? []).map((c) => c.k as string));
			const key = keyOf(el);
			const wantKey = [
				...kinds.map((k) => `${labelFor(HOST_KIND_LABEL, k)} ${rgbOf(kindColour(k))}`),
				`First-time maintainers ${rgbOf(NEUTRAL_SERIES)}`
			];
			if (key.join(' | ') !== wantKey.join(' | ')) problems.push(`#${id} key is ${key.join(' | ')}, not ${wantKey.join(' | ')}`);
		}
		// the other way round: a chart drawn from a document that cannot carry it is drawn from
		// nothing (zeros or a stale assumption), not from the document
		if (CHARTS.has(id) && !charted(id, doc) && el.querySelector('canvas'))
			problems.push(`#${id} has a chart the document cannot draw`);
		// Numeric cells render numbers, dates or '-' only.
		for (const cell of el.querySelectorAll('.tabular-nums')) {
			if (/NaN|undefined|null/.test(cell.textContent ?? '')) {
				problems.push(`#${id} shows "${norm(cell.textContent)}"`);
			}
		}
	}
	if (pill === 'overview') {
		const rows = container.querySelectorAll('#ngit-ledger [data-ledger-row]').length;
		if (rows !== doc.exclusions.length) problems.push(`ledger shows ${rows} rows, the document has ${doc.exclusions.length}`);
	}
	return problems;
}
