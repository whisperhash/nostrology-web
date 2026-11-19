// @vitest-environment jsdom
//
// REAL-DOCUMENT SMOKE TEST, opt-in. Point NGIT_SNAPSHOT_JSON at a snapshot document the
// pipeline produced (nostrology-data's dry run, or a row exported with
// `SELECT data FROM ngit_snapshot ORDER BY generated_utc DESC, id DESC LIMIT 1`) and this
// holds it to the NgitSnapshot interface structurally - every required key present with
// the right JSON type, the fixture serving as the reference shape - then renders the page
// on it and checks every section of every pill against the document's own figures and
// first rows (panel-checks.ts, the same check the page test runs on the fixture). Skips
// cleanly when the variable is unset, which is the normal case (CI included).
// A document holds the page's Stars and Zaps lists only as the fallback the page keeps when
// ngit_repo_stats does not hold its run, or when the page's query fails (since 2026-10-18):
// this renders that path. The table path is held live: the web's own SQL run against Aurora
// must return the document's lists, and the live page must have taken it - listsFrom:"table"
// in the page data a fetch of the deployed /git carries, data-lists="table" on
// the two cards at /git/collaboration (in the server's HTML too: the pill has had an address
// of its own since 2026-10-19).
//
//   NGIT_SNAPSHOT_JSON=/path/to/doc.json NODE_OPTIONS=--no-experimental-webstorage \
//     pnpm exec vitest run 'src/routes/(app)/git/ngit-snapshot-smoke'
import { fireEvent, render } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { readable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';

import { HOSTING_CLASS_LABEL, LEDGER_LABEL, pct } from '$lib/ngit/format';
import { showLeaderboard } from '$lib/ngit/series';
import { checkShape } from '$lib/ngit/shape';
import type { NgitSnapshot } from '$lib/shared/data-types';
import NgitPage from './+page.svelte';
import { FIXTURE } from './fixture';
import { graspOrHashtreeShare, grouped, PILL_SECTIONS, panelProblems } from './panel-checks';
import { standInPillRouter } from '../pill-router.test-helper';

vi.mock('$app/stores', () => ({
	page: readable({ url: new URL('https://site.test/git') })
}));
// SvelteKit's router, stood in for ($lib/domain-page uses it): with no router there is
// nothing to fire afterNavigate, and a pill click's own part is the stand-in below.
vi.mock('$app/navigation', () => ({
	replaceState: vi.fn((url: string) => window.history.replaceState(window.history.state, '', url)),
	afterNavigate: vi.fn(),
	goto: vi.fn()
}));
// A pill is a link: the router's part in a click is stood in for (pill-router.test-helper.ts).
standInPillRouter();

const PATH = process.env.NGIT_SNAPSHOT_JSON;

describe.skipIf(!PATH)('real ngit snapshot document on /git (NGIT_SNAPSHOT_JSON)', () => {
	const load = () => JSON.parse(readFileSync(PATH as string, 'utf8')) as unknown;

	it('carries every key of the contract, with the right types', () => {
		const report = checkShape(load(), FIXTURE);
		if (report.extra.length) console.info('[ngit smoke] keys the interface does not know:', report.extra);
		expect(report.missing, 'missing keys').toEqual([]);
		expect(report.wrongType, 'wrong types').toEqual([]);
	});

	it('ships exactly the ledger keys the page words, and the sums the page presents', () => {
		const doc = load() as NgitSnapshot;
		// dataset reference section 9: exactly these keys, every one present even when zero.
		// The page still words the daily cap's row, which documents written before 2026-10-02
		// carry; a current document has none.
		const RETIRED = new Set(['daily_cap']);
		const keys = doc.exclusions.map((e) => e.k as string);
		// N10 (the nostr.net catalog) came with the nostrology-data deploy of 2026-10-12: a
		// document generated before 2026-10-13 may lack its row, any later one must carry it
		const NEW_KEYS = doc.generated_utc < '2026-10-13' ? new Set(['N10']) : new Set<string>();
		const want = Object.keys(LEDGER_LABEL).filter((k) => !RETIRED.has(k) && (keys.includes(k) || !NEW_KEYS.has(k)));
		expect(keys.filter((k) => !RETIRED.has(k)).sort()).toEqual(want.sort());
		for (const k of keys) expect(Object.keys(LEDGER_LABEL), k).toContain(k);
		const sum = (xs: { v: number }[]) => xs.reduce((a, x) => a + x.v, 0);
		const s = doc.summary;
		// the ledger reads as arithmetic: total - announcement rows = kept
		expect(s.announcements_total - sum(doc.exclusions.filter((e) => e.unit === 'announcements'))).toBe(
			s.announcements_kept
		);
		// the donut partitions the repositories, its classes in the precedence of dataset
		// reference 4.4: the Hosting intro says each repository is in "the first in the list
		// below that fits", and the list is drawn in the document's order
		expect(sum(doc.hosting)).toBe(s.repos);
		const precedence = Object.keys(HOSTING_CLASS_LABEL);
		const known = doc.hosting.map((h) => h.k as string).filter((k) => precedence.includes(k));
		expect(known).toEqual(precedence.filter((k) => known.includes(k)));
		// the running total of list users starts from the users first seen before the weekly
		// series: never a negative count
		if (doc.grasp_lists.per_week) expect(sum(doc.grasp_lists.per_week)).toBeLessThanOrEqual(doc.grasp_lists.users);
		// the weekly series sums to the all-time total, while the document still carries one
		// (optional to the page since 2026-09-29)
		if (s.pushes_total !== undefined) {
			expect(doc.pushes_weekly.reduce((a, w) => a + w.pushes, 0)).toBe(s.pushes_total);
		}
	});

	it('ranks a zapped list by receipts, then msats, wherever its top depends on it', () => {
		// Since 2026-10-18 (the operator's ask) the Zaps table opens by receipts and its cut
		// reads "The top 20 repositories.", which reads as the top by receipts; the document
		// ranks so from that day's second nostrology-data deploy (dataset reference 6.3). A
		// document generated from 2026-10-19 on must be so ranked, and so must any whose list is
		// cut, or its "top" is another measure's. A list that holds every zapped repository is
		// the top by any figure.
		const doc = load() as NgitSnapshot;
		const z = doc.repos_zapped;
		const outOfOrder = z.findIndex(
			(r, i) => i > 0 && (z[i - 1].receipts < r.receipts || (z[i - 1].receipts === r.receipts && z[i - 1].msats < r.msats))
		);
		if (doc.generated_utc >= '2026-10-19' || z.length < doc.summary.zaps_repos)
			expect(outOfOrder, 'the first row out of receipts-then-msats order (-1: none)').toBe(-1);
	});

	it('renders every section of every pill with the document in it', async () => {
		const snapshot = load() as NgitSnapshot;
		const { container } = render(NgitPage, { props: { data: { snapshot } } });
		expect(container.querySelector('#ngit-cards')?.textContent).toContain('Repositories');
		// the headline share, GRASP or hashtree, from the donut's own rows
		expect(container.querySelector('#ngit-cards')?.textContent).toContain(pct(graspOrHashtreeShare(snapshot)));
		const problems: string[] = [];
		for (const pill of Object.keys(PILL_SECTIONS)) {
			await fireEvent.click(container.querySelector(`#tab-${pill}`)!);
			expect(container.querySelector(`#panel-${pill}`), pill).not.toBeNull();
			problems.push(...panelProblems(container, pill, snapshot));
		}
		expect(problems).toEqual([]);
		// the snapshot's dates, in the footer only since 2026-10-18
		expect(container.querySelector('#ngit-footer')?.textContent).toContain(snapshot.generated_utc);
		expect(container.querySelector(`#ngit-footer time[datetime="${snapshot.as_of_day}"]`)).not.toBeNull();
		expect(container.querySelector('#ngit-asof')).toBeNull();
		window.history.replaceState(null, '', '/');
	});

	it('opens a hashtree-class row on git.iris.to, every other on gitworkshop.dev (a class marked on real rows)', async () => {
		// No hashtree repository is in the real lists on 2026-10-09 (its pushes publish no
		// kind-30618 (repo-states), and none is among the most starred or zapped), so the first
		// row of each list is marked hashtree to run the git.iris.to path on real rows.
		const doc = load() as NgitSnapshot;
		const mark = <T,>(rows: T[]): T[] => rows.map((r, i) => (i === 0 ? { ...r, cls: 'hashtree' } : r));
		const snapshot: NgitSnapshot = {
			...doc,
			repos_active: mark(doc.repos_active),
			repos_starred: mark(doc.repos_starred),
			repos_zapped: mark(doc.repos_zapped)
		};
		const { container } = render(NgitPage, { props: { data: { snapshot } } });
		const problems: string[] = [];
		let iris = 0;
		for (const pill of ['repositories', 'collaboration']) {
			await fireEvent.click(container.querySelector(`#tab-${pill}`)!);
			problems.push(...panelProblems(container, pill, snapshot));
			iris += container.querySelectorAll('a[href^="https://git.iris.to/#/npub1"]').length;
		}
		expect(problems).toEqual([]);
		expect(iris, 'a marked row on git.iris.to').toBeGreaterThan(0);
		window.history.replaceState(null, '', '/');
	});

	it('shows the document figures in the units and grouping a reader expects (checked without the page formatters)', async () => {
		// panel-checks derives most expected strings through the page's own n / pct /
		// satsFromMsats, which cannot see a regression in them. These are written out by hand
		// from the raw document values: msats / 1000 for sats, en-US grouping, and a known
		// value injected into the real document for a fully literal string - into the zapped
		// row the table shows first since 2026-10-18, when the Zaps heading stopped carrying the
		// total: the most receipts, the first of them in the document's order, as the table
		// opens by receipts (the operator's ask of the same day).
		const doc = load() as NgitSnapshot;
		const top = doc.repos_zapped.reduce((best, r, i, rows) => (r.receipts > rows[best].receipts ? i : best), 0);
		const snapshot: NgitSnapshot = {
			...doc,
			repos_zapped: doc.repos_zapped.map((r, i) => (i === top ? { ...r, msats: 16_719_000 } : r))
		};
		const { container } = render(NgitPage, { props: { data: { snapshot } } });
		expect(container.querySelector('#ngit-cards')?.textContent).toContain(grouped(doc.summary.repos));
		// the headline share's count: GRASP-hosted plus the hashtree class, grouped by hand
		const hashtree = doc.hosting.find((h) => h.k === 'hashtree')?.v ?? 0;
		expect((container.querySelector('#ngit-cards')?.textContent ?? '').replace(/\s+/g, ' ')).toContain(
			`${grouped(doc.summary.grasp_repos + hashtree)} repositories on GRASP servers or hashtree`
		);
		await fireEvent.click(container.querySelector('#tab-collaboration')!);
		const zaps = (container.querySelector('#ngit-zaps')?.textContent ?? '').replace(/\s+/g, ' ');
		if (doc.summary.archive_events.zaps > 0 && showLeaderboard(doc.repos_zapped)) {
			const cells = [...container.querySelectorAll('#ngit-zaps tbody tr:first-child td')];
			expect(cells.at(-1)?.textContent?.trim()).toBe('16,719');
		} else if (doc.summary.archive_events.zaps > 0) expect(zaps).toContain('Too few zapped repositories to rank');
		else expect(zaps).toContain('No kind-9735 (zap-receipts) were read in this run');
		window.history.replaceState(null, '', '/');
	});
});
