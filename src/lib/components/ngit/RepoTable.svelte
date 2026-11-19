<script lang="ts">
	// A sortable repository table for /git's most active repositories. Rows are the
	// document's repository rows; nothing is computed here but presentation: the label
	// (name, else the d identifier) linked to its viewer (RepoLink: git.iris.to for the
	// hashtree class, gitworkshop.dev otherwise), dates, and the sort.
	//
	// ORDER: the table first renders the rows exactly as the document ranks them, and a
	// header click sorts a copy, with equal keys keeping their document order. The
	// document's ranking is finer than any column shown here - push counts tie often, and the
	// document breaks a tie on both of them by the last push's timestamp, shown only as a
	// day - so a re-sort on first render would scramble it.
	//
	// "Last state seen" is never called a push: it is the newest state PUBLICATION, which at
	// any date may be an identical republish or a HEAD-only change, and before the capture
	// wall is the one version relays still served.
	//
	// The lead's display name and the hosts are third-party text: each passes through
	// personLabel() / labelText() and is drawn in its own <bdi>, so a bidi override in one
	// host cannot reverse the next host on the same line.
	//
	// The Hosting cell names the kinds of host a repository is on in Clone hosts' words,
	// comma-separated ("GRASP, Forge"), above its hosts (repoHostingLabel; the operator's choice,
	// 2026-10-11); the column sorts by those words.
	import type { NgitRepoRow } from '$lib/shared/data-types';
	import { counted, fmtDay, labelText, n, personLabel, repoHostingLabel, repoLabel, type Noun } from '$lib/ngit/format';
	import { sortRows, type SortDir } from '$lib/ngit/series';
	import { sortInk } from '$lib/sort-ink';
	import RepoLink from './RepoLink.svelte';
	import SortTh from './SortTh.svelte';

	type ColKey =
		| 'label'
		| 'hosting'
		| 'pushes_30d'
		| 'pushes_90d'
		| 'last_push'
		| 'last_state'
		| 'branches'
		| 'tags';

	export let rows: NgitRepoRow[];
	/** The column the document ranks these rows by: marked as the active sort, descending. */
	export let initialKey: ColKey = 'pushes_90d';
	/** Accessible name of the table. */
	export let caption: string;

	type View = {
		key: string;
		row: NgitRepoRow;
		label: string;
		by: string;
		hosting: string;
		hosts: string[];
		pushes_30d: number;
		pushes_90d: number;
		last_push: string | null;
		last_state: string | null;
		branches: number | null;
		tags: number | null;
	};

	const day = (v: string | null | undefined) => {
		const s = fmtDay(v);
		return s === '-' ? null : s;
	};

	const view: View[] = rows.map((r) => ({
		key: `${r.pubkey}:${r.d}`,
		row: r,
		label: repoLabel(r),
		by: personLabel(r.lead_name, r.pubkey),
		hosting: repoHostingLabel(r),
		hosts: r.hosts.map(labelText),
		pushes_30d: r.pushes_30d,
		pushes_90d: r.pushes_90d,
		last_push: day(r.last_push),
		last_state: day(r.last_state),
		branches: r.branches,
		tags: r.tags
	}));

	// The column the rows are sorted by at the moment, repeated under the name on a phone: at
	// 390 px it sits off-screen behind the table's horizontal scroll. It follows the reader's
	// sort, as the bright ink does (the operator's rule, 2026-10-18), so a phone screenshot
	// shows the figure the rows are in order of. No line for a sort by name, which is in view.
	const PUSHES: Noun = ['push', 'pushes'];
	function sortedLine(r: View, key: ColKey): string | null {
		switch (key) {
			case 'hosting':
				return r.hosting;
			case 'pushes_30d':
				return `${counted(r.pushes_30d, PUSHES)} in 30 d`;
			case 'pushes_90d':
				return `${counted(r.pushes_90d, PUSHES)} in 90 d`;
			case 'last_push':
				return `last push ${r.last_push ?? '-'}`;
			case 'last_state':
				return `last state seen ${r.last_state ?? '-'}`;
			case 'branches':
				return counted(r.branches, ['branch', 'branches']);
			case 'tags':
				return counted(r.tags, ['tag', 'tags']);
			default:
				return null;
		}
	}

	const COLUMNS: { key: ColKey; label: string; right?: boolean; first: SortDir }[] = [
		{ key: 'label', label: 'Repository', first: 'asc' },
		{ key: 'hosting', label: 'Hosting', first: 'asc' },
		{ key: 'pushes_30d', label: 'Pushes 30 d', right: true, first: 'desc' },
		{ key: 'pushes_90d', label: 'Pushes 90 d', right: true, first: 'desc' },
		{ key: 'last_push', label: 'Last push', first: 'desc' },
		{ key: 'last_state', label: 'Last state seen', first: 'desc' },
		{ key: 'branches', label: 'Branches', right: true, first: 'desc' },
		{ key: 'tags', label: 'Tags', right: true, first: 'desc' }
	];

	let sortKey: ColKey = initialKey;
	let sortDir: SortDir = 'desc';
	// Until a header is clicked, the rows are the document's own order.
	let userSorted = false;
	function onSort(key: string) {
		const col = COLUMNS.find((c) => c.key === key);
		if (!col) return;
		if (sortKey === col.key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else {
			sortKey = col.key;
			sortDir = col.first;
		}
		userSorted = true;
	}
	// Keyed by index below, not by r.key: the identifier is third-party text, and a
	// duplicate key (a crafted or buggy repeat) makes Svelte 5 throw even in production.
	$: sorted = userSorted ? sortRows(view, sortKey, sortDir) : view;
</script>

<div class="overflow-x-auto">
	<table class="w-full min-w-[860px] text-left text-sm" aria-label={caption}>
		<thead>
			<tr class="border-b border-gray-700 text-xs uppercase tracking-wider text-gray-400">
				{#each COLUMNS as c (c.key)}
					<SortTh label={c.label} key={c.key} {sortKey} {sortDir} right={c.right} {onSort} />
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each sorted as r, i (i)}
				{@const ranked = sortedLine(r, sortKey)}
				<tr class="border-b border-gray-700/50 align-top">
					<td class="max-w-[18rem] py-2 pr-3" title={r.key}>
						<RepoLink pubkey={r.row.pubkey} d={r.row.d} name={r.row.name} cls={r.row.cls} />
						<div class="truncate text-xs text-gray-400" title={r.row.pubkey}>by <bdi>{r.by}</bdi></div>
						{#if ranked}
							<div class="sm:hidden text-xs text-gray-400 tabular-nums">{ranked}</div>
						{/if}
					</td>
					<td class="py-2 pr-3 {sortInk(sortKey, 'hosting')}">
						{r.hosting}
						{#if r.hosts.length}
							<div class="max-w-[14rem] truncate text-xs text-gray-400" title={r.hosts.join(', ')}>
								{#each r.hosts as h, j (j)}{#if j > 0}{', '}{/if}<bdi>{h}</bdi>{/each}
							</div>
						{/if}
					</td>
					<td class="py-2 pr-3 text-right tabular-nums {sortInk(sortKey, 'pushes_30d')}">{n(r.pushes_30d)}</td>
					<td class="py-2 pr-3 text-right tabular-nums {sortInk(sortKey, 'pushes_90d')}">{n(r.pushes_90d)}</td>
					<td class="py-2 pr-3 tabular-nums {sortInk(sortKey, 'last_push')}">{r.last_push ?? '-'}</td>
					<td class="py-2 pr-3 tabular-nums {sortInk(sortKey, 'last_state')}">{r.last_state ?? '-'}</td>
					<td class="py-2 pr-3 text-right tabular-nums {sortInk(sortKey, 'branches')}">{n(r.branches)}</td>
					<td class="py-2 text-right tabular-nums {sortInk(sortKey, 'tags')}">{n(r.tags)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
