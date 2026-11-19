import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import type { NgitRepoRow } from '$lib/shared/data-types';
import RepoTable from './RepoTable.svelte';

/**
 * RepoTable is otherwise exercised through the /git page tests (git-page.test.ts). This
 * pins the phone line: at 390 px the column the table is sorted by sits off-screen behind its
 * horizontal scroll, so the first cell repeats that column under the name, below the sm
 * breakpoint only - the column sorted at the moment, since 2026-10-18 (the operator's rule
 * for the bright ink, which the line follows too). jsdom applies no CSS, so the breakpoint is asserted as the class contract
 * (`sm:hidden`), as LeaderboardTable.test.ts does for its column widths. It also pins the
 * Hosting cell: the kinds of host in Clone hosts' words, the class where there are none, and
 * the column's sort by those words.
 */
const ROW: NgitRepoRow = {
	pubkey: 'a'.repeat(64),
	d: 'ngit',
	name: 'ngit',
	lead_name: 'Dan the maintainer',
	pushes_30d: 120,
	pushes_90d: 1410,
	last_push: '2026-09-24',
	last_state: '2026-09-24',
	branches: 14,
	tags: 31,
	cls: 'grasp_mixed',
	hosts: ['relay.ngit.dev', 'github.com']
};

/** The text of each row's phone-only line in the first column. */
const phoneLines = (container: HTMLElement) =>
	[...container.querySelectorAll('tbody td:first-child [class~="sm:hidden"]')].map((el) => el.textContent?.trim());

describe('RepoTable phone line', () => {
	it('repeats the 90-day pushes under the name when they rank the table', () => {
		const { container } = render(RepoTable, {
			props: { rows: [ROW], initialKey: 'pushes_90d', caption: 'Most active repositories, 90 days' }
		});
		expect(phoneLines(container)).toEqual(['1,410 pushes in 90 d']);
	});

	it('repeats the last push when it ranks the table, and a dash for a repository never pushed', () => {
		const { container } = render(RepoTable, {
			props: {
				rows: [ROW, { ...ROW, d: 'never-pushed', last_push: null }],
				initialKey: 'last_push',
				caption: 'Repositories by last push'
			}
		});
		expect(phoneLines(container)).toEqual(['last push 2026-09-24', 'last push -']);
	});

	it('adds no line for a sort by name, which is in view', () => {
		const { container } = render(RepoTable, {
			props: { rows: [ROW], initialKey: 'label', caption: 'Repositories by name' }
		});
		expect(phoneLines(container)).toEqual([]);
		// the cell itself is there, with the name and the lead
		expect(container.querySelector('tbody td:first-child')?.textContent).toContain('by Dan the maintainer');
	});

	it("follows the reader's sort: every column's figure in turn, in the singular for one", async () => {
		const one = { ...ROW, d: 'one', name: 'one', pushes_30d: 1, pushes_90d: 1, branches: 1, tags: 1 };
		const { container } = render(RepoTable, {
			props: { rows: [ROW, one], initialKey: 'pushes_90d', caption: 'Most active repositories, 90 days' }
		});
		const click = (label: string) =>
			fireEvent.click([...container.querySelectorAll('thead button')].find((b) => b.getAttribute('aria-label') === `Sort by ${label}`)!);
		const sorted = (want: string[]) => expect(phoneLines(container).slice().sort()).toEqual(want.slice().sort());
		sorted(['1,410 pushes in 90 d', '1 push in 90 d']);
		await click('Pushes 30 d');
		sorted(['120 pushes in 30 d', '1 push in 30 d']);
		await click('Branches');
		sorted(['14 branches', '1 branch']);
		await click('Tags');
		sorted(['31 tags', '1 tag']);
		await click('Last state seen');
		sorted(['last state seen 2026-09-24', 'last state seen 2026-09-24']);
		await click('Hosting');
		sorted(['GRASP + other hosts', 'GRASP + other hosts']);
		await click('Repository');
		expect(phoneLines(container)).toEqual([]);
	});
});

/** Each row's Hosting cell, without the line of hosts under it. */
const hostingCells = (container: HTMLElement) =>
	[...container.querySelectorAll('tbody tr')].map((tr) => {
		const cell = tr.querySelector('td:nth-child(2)')!.cloneNode(true) as Element;
		cell.querySelector('div')?.remove();
		return cell.textContent?.replace(/\s+/g, ' ').trim();
	});

describe('RepoTable Hosting cell', () => {
	it("names the kinds of host a repository is on, in Clone hosts' words, comma-separated", () => {
		// the operator's choice, 2026-10-11: the kinds, not the class, in the document's order
		const rows: NgitRepoRow[] = [
			{ ...ROW, d: 'gf', cls: 'grasp_mixed', host_kinds: ['grasp', 'forge'] },
			{ ...ROW, d: 'gh', cls: 'grasp_mixed', host_kinds: ['grasp', 'hashtree', 'self_hosted'] },
			{ ...ROW, d: 'h', cls: 'hashtree', host_kinds: ['hashtree'] },
			{ ...ROW, d: 'f', cls: 'forge_only', host_kinds: ['forge'] },
			{ ...ROW, d: 'of', cls: 'other_hosts', host_kinds: ['forge', 'self_hosted'] }
		];
		const { container } = render(RepoTable, { props: { rows, caption: 'Most active repositories, 90 days' } });
		expect(hostingCells(container)).toEqual([
			'GRASP, Forge',
			'GRASP, hashtree, Self-hosted',
			'hashtree',
			'Forge',
			'Forge, Self-hosted'
		]);
		// the hosts stay on their own line under it
		expect(container.querySelector('tbody td:nth-child(2) div')?.textContent).toBe('relay.ngit.dev, github.com');
	});

	it('reads a repository with no public host, or a row without host_kinds, as its class', () => {
		// Clone hosts' "Not public" names a host; a repository with none public is its class.
		// A document written before the rows carried their kinds shows the class, as before.
		const rows: NgitRepoRow[] = [
			{ ...ROW, d: 'n', cls: 'none', host_kinds: ['none'] },
			{ ...ROW, d: 'old', cls: 'grasp_mixed' },
			{ ...ROW, d: 'empty', cls: 'forge_only', host_kinds: [] }
		];
		const { container } = render(RepoTable, { props: { rows, caption: 'Most active repositories, 90 days' } });
		expect(hostingCells(container)).toEqual(['No public host', 'GRASP + other hosts', 'Forges only']);
	});

	it('words a kind it does not know yet by its key, cleaned like any document text', () => {
		const rows = [{ ...ROW, host_kinds: ['grasp', 'relay\u202E'] }] as unknown as NgitRepoRow[];
		const { container } = render(RepoTable, { props: { rows, caption: 'Most active repositories, 90 days' } });
		expect(hostingCells(container)).toEqual(['GRASP, relay']);
	});

	it('sorts the Hosting column by the words it shows', async () => {
		// the words sort c, a, b; the document order and d give a, b, c, and the class key and
		// the class label give c, b, a, so only a sort by the words passes
		const rows: NgitRepoRow[] = [
			{ ...ROW, d: 'a', cls: 'other_hosts', host_kinds: ['forge', 'self_hosted'] },
			{ ...ROW, d: 'b', cls: 'grasp_mixed', host_kinds: ['grasp', 'forge'] },
			{ ...ROW, d: 'c', cls: 'forge_only', host_kinds: ['forge'] }
		];
		const { container } = render(RepoTable, { props: { rows, caption: 'Most active repositories, 90 days' } });
		expect(hostingCells(container)).toEqual(['Forge, Self-hosted', 'GRASP, Forge', 'Forge']);
		const header = [...container.querySelectorAll('thead button')].find((b) => b.textContent?.includes('Hosting'))!;
		await fireEvent.click(header);
		expect(hostingCells(container)).toEqual(['Forge', 'Forge, Self-hosted', 'GRASP, Forge']);
	});
});

/** Each row's Last state seen, Branches and Tags cells. */
const stateCells = (container: HTMLElement) =>
	[...container.querySelectorAll('tbody tr')].map((tr) =>
		[6, 7, 8].map((i) => tr.querySelector(`td:nth-child(${i})`)?.textContent?.trim())
	);

describe('RepoTable hashtree rows', () => {
	// Since the nostrology-data deploy of 2026-10-12 a hashtree repository's push is the
	// announcement its git tool republishes (dataset reference section 3), so one can rank among
	// the most active with no state at all: its refs live inside the hashtree tree.
	const HASHTREE: NgitRepoRow = {
		...ROW,
		d: 'hashtree',
		name: 'hashtree',
		pushes_30d: 35,
		pushes_90d: 196,
		last_push: '2026-10-11',
		last_state: null,
		branches: null,
		tags: null,
		cls: 'hashtree',
		host_kinds: ['hashtree'],
		hosts: []
	};

	it('shows a dash for the last state, branches and tags of a pushed repository with no state', () => {
		const { container } = render(RepoTable, {
			props: { rows: [ROW, HASHTREE], caption: 'Most active repositories, 90 days' }
		});
		expect(stateCells(container)).toEqual([
			['2026-09-24', '14', '31'],
			['-', '-', '-']
		]);
		expect(hostingCells(container)).toEqual(['GRASP + other hosts', 'hashtree']);
		// its pushes and last push are figures like any other row's
		const cells = [...container.querySelectorAll('tbody tr:nth-child(2) td')].map((td) => td.textContent?.trim());
		expect(cells.slice(2, 5)).toEqual(['35', '196', '2026-10-11']);
	});

	it.each(['Last state seen', 'Branches', 'Tags'])('sorts it after every row that has a %s, either way', async (label) => {
		const { container } = render(RepoTable, {
			props: { rows: [HASHTREE, ROW, { ...ROW, d: 'small', last_state: '2026-08-01', branches: 1, tags: 0 }], caption: 'x' }
		});
		const header = [...container.querySelectorAll('thead button')].find((b) => b.textContent?.includes(label))!;
		const order = () => [...container.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td a')?.textContent?.trim());
		await fireEvent.click(header);
		expect(order().at(-1)).toBe('hashtree');
		await fireEvent.click(header);
		expect(order().at(-1)).toBe('hashtree');
	});
});
